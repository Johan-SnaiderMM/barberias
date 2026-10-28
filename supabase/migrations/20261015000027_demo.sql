-- =====================================================================
-- BARBERÍAS · 0027 · BARBERÍA DE DEMO CON DATOS FICTICIOS Y REINICIO (tarea 4.1 · SPEC F12)
--
--   fn_provisionar_demo(correo, nombre)   deja lista la barbería de demo para un usuario que ya existe en Supabase
--                                         (la crea quien administra, una vez) y le carga los datos de ejemplo.
--   fn_cargar_datos_demo(barbería, ahora) borra TODO lo de la demo y lo vuelve a crear, siempre igual y RELATIVO A HOY:
--                                         el calendario, las ventas, los gastos, los pagos y los cierres se arman con el
--                                         día de hoy como punto de partida (nunca fechas fijas).
--   reiniciar_demo(pin)                   lo que llama el dueño desde «Más»: solo en una demo, con PIN si la demo lo tiene.
--   fn_definir_pin_reinicio(pin, barbería) pone, cambia o quita el PIN (solo quien administra, desde el SQL Editor).
--
-- REGLAS
--   * TODO es inventado: nombres, celulares (+57 300 000 10xx), direcciones y montos. Nada de personas reales.
--   * Determinista: lo que se elige (qué cliente, qué servicio, a qué hora) sale de un hash del día y del turno, no de
--     random(). Dos reinicios en el mismo instante dejan exactamente lo mismo (los ids son nuevos; el contenido, igual).
--   * Es la ÚNICA excepción a «no se borra»: reinicia solo una barbería con es_demo = true, y durante su transacción
--     activa app.reiniciando_demo (ver fn_bloquear_borrado). Una barbería de verdad no se puede reiniciar.
--   * Lo que sobrevive al reinicio: la barbería (nombre, enlace), la cuenta del dueño, los roles y el PIN. Lo demás se
--     recrea: catálogo, barberos, horarios, comisiones, clientes, citas, cobros, gastos, liquidaciones y cierres. Las
--     personas que entraron con un código de invitación y sus avisos en el celular se van (cada visita empieza limpia).
--   * Lo cobrado, pagado y cerrado se inserta con las mismas cifras que producen las funciones de la API (comisiones al
--     peso, descuento, propina, pagos mixtos, cierre con su diferencia). Las pruebas lo comparan.
--   * Nada de datos ni claves reales: la cuenta de la demo (correo y contraseña) vive en las variables del servidor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PIN para reiniciar la demo
-- ---------------------------------------------------------------------
alter table public.barberias add column if not exists reinicio_con_pin boolean not null default false;
comment on column public.barberias.reinicio_con_pin is 'true = reiniciar la demo pide PIN (lo define quien administra la base; ver fn_definir_pin_reinicio).';

create table if not exists public.pines_reinicio (
  barberia_id     uuid primary key references public.barberias(id) on delete cascade,
  hash            text not null,
  intentos        integer not null default 0,
  bloqueado_hasta timestamptz,
  actualizado_at  timestamptz not null default now()
);
alter table public.pines_reinicio enable row level security;
-- Sin políticas y sin permisos: nadie la lee (ni el dueño); solo las funciones de abajo.
revoke all on public.pines_reinicio from anon, authenticated;
comment on table public.pines_reinicio is 'PIN (cifrado) para reiniciar la demo y sus intentos fallidos. Nadie la lee directamente.';

create or replace function public.fn_hash_pin(p_barberia uuid, p_pin text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$ select encode(sha256(convert_to(p_barberia::text || ':' || coalesce(p_pin, ''), 'UTF8')), 'hex') $$;

-- Pone, cambia o quita (null) el PIN. Es fn_*: no la puede ejecutar ningún usuario de la app, solo quien administra la
-- base (SQL Editor). Sin p_barberia aplica a TODAS las barberías de demostración. Devuelve a cuántas.
create or replace function public.fn_definir_pin_reinicio(p_pin text, p_barberia uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pin text := nullif(btrim(coalesce(p_pin, '')), '');
  v_n   integer := 0;
  r     record;
begin
  if v_pin is not null and v_pin !~ '^[0-9]{4,8}$' then
    raise exception 'El PIN debe tener entre 4 y 8 dígitos.';
  end if;
  for r in select b.id from public.barberias b where b.es_demo and (p_barberia is null or b.id = p_barberia) loop
    if v_pin is null then
      delete from public.pines_reinicio where barberia_id = r.id;
    else
      insert into public.pines_reinicio (barberia_id, hash)
      values (r.id, public.fn_hash_pin(r.id, v_pin))
      on conflict (barberia_id) do update
        set hash = excluded.hash, intentos = 0, bloqueado_hasta = null, actualizado_at = now();
    end if;
    update public.barberias set reinicio_con_pin = (v_pin is not null) where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 2. Ayudantes de los datos de ejemplo
-- ---------------------------------------------------------------------

-- Un número «al azar» pero fijo: el mismo texto da siempre el mismo valor (0 a p_modulo − 1).
create or replace function public.fn_demo_hash(p_texto text, p_modulo integer)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select (abs(hashtext(p_texto)::bigint) % greatest(p_modulo, 1))::integer $$;

-- El instante de una hora de pared de Bogotá: (2026-10-16, 570) = 9:30 a. m. de ese día.
create or replace function public.fn_demo_instante(p_dia date, p_min integer)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$ select (p_dia::timestamp + make_interval(mins => p_min)) at time zone 'America/Bogota' $$;

-- Un cobro de ejemplo con las mismas cifras que dejaría cobrar_cita / cobrar_venta (copia de la lógica de fn_cobrar):
-- el servicio al precio con el que se agendó, a veces un extra, a veces un descuento con motivo, a veces propina, y el
-- pago en efectivo (con vuelto), por transferencia o mixto. La comisión sale de los porcentajes que tenga el barbero
-- (así que los porcentajes se guardan ANTES de cobrar). Devuelve el id del cobro.
create or replace function public.fn_demo_cobro(
  p_barberia uuid, p_cita uuid, p_barbero uuid, p_cliente uuid, p_servicio uuid, p_precio integer,
  p_ts timestamptz, p_semilla text, p_dueno uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id           uuid := gen_random_uuid();
  v_nombre       text;
  v_pct          integer := public.fn_comision_pct(p_barberia, p_barbero, p_servicio);
  v_pct_extra    integer := public.fn_comision_pct(p_barberia, p_barbero, null);
  v_h            integer := public.fn_demo_hash('x|' || p_semilla, 100);
  v_extra_nombre text;
  v_extra_precio integer := 0;
  v_desc         integer := 0;
  v_motivo       text;
  v_subtotal     integer;
  v_total        integer;
  v_prop         integer := 0;
  v_prop_barbero integer := 0;
  v_com1         integer;
  v_com2         integer := 0;
  v_debido       integer;
  v_efectivo     integer;
  v_recibido     integer;
begin
  select s.nombre into v_nombre from public.servicios s where s.barberia_id = p_barberia and s.id = p_servicio;

  -- Un extra de vez en cuando (22 %).
  if v_h < 22 then
    v_extra_nombre := case when v_h % 2 = 0 then 'Cera para peinar' else 'Aceite para barba' end;
    v_extra_precio := case when v_h % 2 = 0 then 12000 else 18000 end;
  end if;
  v_subtotal := p_precio + v_extra_precio;

  -- Un descuento (7 %) solo cuando el cobro es de una línea: así todo el descuento le toca a esa línea.
  if v_extra_precio = 0 and public.fn_demo_hash('d|' || p_semilla, 100) < 7 then
    v_desc := 2000;
    v_motivo := 'Cliente frecuente';
  end if;
  v_total := v_subtotal - v_desc;

  -- Propina (45 %), de $ 1.000 a $ 5.000; es del barbero según el ajuste de la barbería.
  if public.fn_demo_hash('p|' || p_semilla, 100) < 45 then
    v_prop := (1 + public.fn_demo_hash('q|' || p_semilla, 5)) * 1000;
  end if;
  select case when b.propina_del_barbero then v_prop else 0 end into v_prop_barbero
    from public.barberias b where b.id = p_barberia;

  -- Comisión sobre lo que realmente se cobró de cada línea, al peso hacia abajo (como fn_cobrar).
  v_com1 := (((p_precio - v_desc)::bigint * v_pct) / 100)::integer;
  if v_extra_precio > 0 then
    v_com2 := ((v_extra_precio::bigint * v_pct_extra) / 100)::integer;
  end if;
  v_debido := v_total + v_prop;

  insert into public.cobros (id, barberia_id, cita_id, barbero_id, cliente_id, clave, subtotal, descuento, descuento_motivo,
                             total, propina, comision, propina_barbero, created_at, registrado_por)
  values (v_id, p_barberia, p_cita, p_barbero, p_cliente, gen_random_uuid(), v_subtotal, v_desc, v_motivo,
          v_total, v_prop, v_com1 + v_com2, v_prop_barbero, p_ts, p_dueno);

  insert into public.cobro_items (barberia_id, cobro_id, orden, tipo, servicio_id, nombre, precio, precio_lista,
                                  descuento, comision_pct, comision, created_at, registrado_por)
  values (p_barberia, v_id, 1, 'servicio', p_servicio, v_nombre, p_precio, p_precio, v_desc, v_pct, v_com1, p_ts, p_dueno);
  if v_extra_precio > 0 then
    insert into public.cobro_items (barberia_id, cobro_id, orden, tipo, servicio_id, nombre, precio, precio_lista,
                                    descuento, comision_pct, comision, created_at, registrado_por)
    values (p_barberia, v_id, 2, 'extra', null, v_extra_nombre, v_extra_precio, null, 0, v_pct_extra, v_com2, p_ts, p_dueno);
  end if;

  -- Cómo se pagó: 55 % efectivo (casi siempre con billete y vuelto), 35 % Nequi, el resto mitad y mitad.
  v_h := public.fn_demo_hash('m|' || p_semilla, 100);
  if v_h < 55 then
    v_recibido := (ceil(v_debido / 5000.0))::integer * 5000;
    insert into public.cobro_pagos (barberia_id, cobro_id, medio, monto, recibido, vuelto, created_at, registrado_por)
    values (p_barberia, v_id, 'efectivo', v_debido, v_recibido, v_recibido - v_debido, p_ts, p_dueno);
  elsif v_h < 90 or v_debido < 20000 then
    insert into public.cobro_pagos (barberia_id, cobro_id, medio, monto, referencia, created_at, registrado_por)
    values (p_barberia, v_id, 'transferencia', v_debido,
            case when public.fn_demo_hash('r|' || p_semilla, 2) = 0 then 'NEQ' || lpad(public.fn_demo_hash('n|' || p_semilla, 999999)::text, 6, '0') end,
            p_ts, p_dueno);
  else
    v_efectivo := (v_debido / 2 / 1000) * 1000;
    insert into public.cobro_pagos (barberia_id, cobro_id, medio, monto, recibido, vuelto, created_at, registrado_por)
    values (p_barberia, v_id, 'efectivo', v_efectivo, v_efectivo, 0, p_ts, p_dueno);
    insert into public.cobro_pagos (barberia_id, cobro_id, medio, monto, created_at, registrado_por)
    values (p_barberia, v_id, 'transferencia', v_debido - v_efectivo, p_ts, p_dueno);
  end if;

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Cargar los datos de ejemplo (borra lo de la demo y lo recrea, relativo a «hoy»)
-- ---------------------------------------------------------------------
create or replace function public.fn_cargar_datos_demo(p_barberia uuid, p_ahora timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy     date := public.fecha_bogota(p_ahora);
  v_antes   timestamptz := p_ahora - interval '60 days';      -- «desde cuándo existe» lo que se arma de base
  v_dueno   uuid;
  -- servicios
  s_corte   uuid := gen_random_uuid();
  s_degrade uuid := gen_random_uuid();
  s_barba   uuid := gen_random_uuid();
  s_combo   uuid := gen_random_uuid();
  s_nino    uuid := gen_random_uuid();
  s_cejas   uuid := gen_random_uuid();
  s_tinte   uuid := gen_random_uuid();
  -- barberos: 1 Mateo, 2 Santiago, 3 Julián
  b_ids     uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_cli     uuid[] := array(select gen_random_uuid() from generate_series(1, 20));
  v_nombres text[] := array['Andrés Pardo', 'Felipe Mora', 'Camilo Ortega', 'Juan David Gil', 'Sebastián Torres',
                            'Daniel Suárez', 'Nicolás Peña', 'Esteban Ruiz', 'Alejandro Herrera', 'Tomás Londoño',
                            'Brayan Castaño', 'Yeison Rojas', 'Kevin Salcedo', 'Cristian Díaz', 'Óscar Mejía',
                            'Hernán Quintero', 'Álvaro Restrepo', 'Stiven Ramírez', 'Luis Fernando Cano', 'Mauricio Bedoya'];
  v_notas_insumos text[] := array['Cuchillas y navajas', 'Espuma y talco', 'Toallas desechables', 'Gel y cera para el mostrador',
                                  'Capas y cuellos de papel', 'Alcohol y desinfectante'];
  -- citas
  v_off     integer;
  v_dia     date;
  v_dow     integer;
  v_bi      integer;
  v_w       record;
  v_min     integer;
  v_ocup    integer;
  v_menu    uuid[];
  v_serv    uuid;
  v_dur     integer;
  v_precio  integer;
  v_ini     timestamptz;
  v_fin     timestamptz;
  v_estado  text;
  v_origen  text;
  v_r       integer;
  v_cita    uuid;
  v_cliente uuid;
  v_creada  timestamptz;
  v_motivo  text;
  v_notas   text;
  v_cobrar  boolean;
  v_ayuda_ayer  boolean := false;
  v_ayuda_antes boolean := false;
  v_semilla text;
  v_ts      timestamptz;
  -- ventas, gastos, pagos a barberos y cierres
  v_k       integer;
  v_arriendo boolean := false;
  v_luz     boolean := false;
  v_agua    boolean := false;
  v_n       integer;
  v_com     integer;
  v_prop    integer;
  v_liq     uuid;
  v_medio   text;
  v_efectivo_dia integer;
  v_res     jsonb;
  v_esperado integer;
  v_ajuste  integer;
  v_contado integer;
begin
  if not exists (select 1 from public.barberias b where b.id = p_barberia and b.es_demo) then
    raise exception 'Solo la demo se puede reiniciar.' using errcode = '42501';
  end if;
  select p.user_id into v_dueno from public.perfiles p where p.barberia_id = p_barberia and p.rol = 'dueno' limit 1;

  -- 1) Limpiar. Es la única excepción al «no se borra»: solo en la demo y solo aquí.
  perform set_config('app.reiniciando_demo', 'on', true);
  delete from public.liquidacion_cobros where barberia_id = p_barberia;
  delete from public.liquidaciones      where barberia_id = p_barberia;
  delete from public.cierres            where barberia_id = p_barberia;
  delete from public.cobro_pagos        where barberia_id = p_barberia;
  delete from public.cobro_items        where barberia_id = p_barberia;
  delete from public.cobros             where barberia_id = p_barberia;
  delete from public.gastos             where barberia_id = p_barberia;
  delete from public.citas              where barberia_id = p_barberia;
  delete from public.bloqueos           where barberia_id = p_barberia;
  delete from public.horarios_barbero   where barberia_id = p_barberia;
  delete from public.comisiones_servicio where barberia_id = p_barberia;
  delete from public.comisiones_barbero  where barberia_id = p_barberia;
  delete from public.barbero_servicios   where barberia_id = p_barberia;
  delete from public.invitaciones        where barberia_id = p_barberia;
  delete from public.suscripciones_push  where barberia_id = p_barberia;
  -- Quien entró con un código de invitación se va (con sus roles); la cuenta del dueño se queda.
  delete from public.perfiles           where barberia_id = p_barberia and rol <> 'dueno';
  delete from public.barberos           where barberia_id = p_barberia;
  delete from public.clientes           where barberia_id = p_barberia;
  delete from public.servicios          where barberia_id = p_barberia;
  perform set_config('app.reiniciando_demo', 'off', true);

  -- La barbería vuelve a sus ajustes de siempre (reservas en línea encendidas, propina del barbero, agenda cada 30 min).
  update public.barberias
     set whatsapp = '+573000001000', direccion = 'Carrera 9 #12-34, Centro',
         paso_min = 30, dias_adelante = 30, anticipacion_min = 60, colchon_min = 0,
         reservas_en_linea = true, cancelar_hasta_horas = 2, propina_del_barbero = true
   where id = p_barberia;

  -- 2) Catálogo. Todo inventado.
  insert into public.servicios (id, barberia_id, nombre, precio, duracion_min, orden, activo, created_at, registrado_por)
  values (s_corte,   p_barberia, 'Corte clásico',     20000, 30, 1, true,  v_antes, v_dueno),
         (s_degrade, p_barberia, 'Degradé',           25000, 45, 2, true,  v_antes, v_dueno),
         (s_barba,   p_barberia, 'Barba',             15000, 30, 3, true,  v_antes, v_dueno),
         (s_combo,   p_barberia, 'Corte y barba',     32000, 60, 4, true,  v_antes, v_dueno),
         (s_nino,    p_barberia, 'Corte niño',        15000, 30, 5, true,  v_antes, v_dueno),
         (s_cejas,   p_barberia, 'Cejas',              5000, 15, 6, true,  v_antes, v_dueno),
         (s_tinte,   p_barberia, 'Tinte',             50000, 90, 7, true,  v_antes, v_dueno),
         (gen_random_uuid(), p_barberia, 'Mascarilla facial', 12000, 20, 8, false, v_antes, v_dueno);   -- archivado

  insert into public.barberos (id, barberia_id, nombre, orden, created_at, registrado_por)
  values (b_ids[1], p_barberia, 'Mateo Ríos',      1, v_antes, v_dueno),
         (b_ids[2], p_barberia, 'Santiago Vargas', 2, v_antes, v_dueno),
         (b_ids[3], p_barberia, 'Julián Cárdenas', 3, v_antes, v_dueno);

  -- Qué hace cada uno. Mateo (el de más experiencia) cobra más; Julián (el aprendiz) cobra menos y se demora más.
  insert into public.barbero_servicios (barberia_id, barbero_id, servicio_id, precio_propio, duracion_propia, created_at, registrado_por)
  values (p_barberia, b_ids[1], s_corte,   25000, null, v_antes, v_dueno),
         (p_barberia, b_ids[1], s_degrade, 30000, null, v_antes, v_dueno),
         (p_barberia, b_ids[1], s_barba,   18000, null, v_antes, v_dueno),
         (p_barberia, b_ids[1], s_combo,   40000, null, v_antes, v_dueno),
         (p_barberia, b_ids[1], s_cejas,   null,  null, v_antes, v_dueno),
         (p_barberia, b_ids[1], s_tinte,   60000, null, v_antes, v_dueno),
         (p_barberia, b_ids[2], s_corte,   null,  null, v_antes, v_dueno),
         (p_barberia, b_ids[2], s_degrade, null,  null, v_antes, v_dueno),
         (p_barberia, b_ids[2], s_barba,   null,  null, v_antes, v_dueno),
         (p_barberia, b_ids[2], s_combo,   null,  null, v_antes, v_dueno),
         (p_barberia, b_ids[2], s_nino,    null,  null, v_antes, v_dueno),
         (p_barberia, b_ids[2], s_cejas,   null,  null, v_antes, v_dueno),
         (p_barberia, b_ids[3], s_corte,   18000, 45,   v_antes, v_dueno),
         (p_barberia, b_ids[3], s_nino,    12000, 45,   v_antes, v_dueno),
         (p_barberia, b_ids[3], s_barba,   12000, 45,   v_antes, v_dueno),
         (p_barberia, b_ids[3], s_cejas,   null,  null, v_antes, v_dueno);

  -- Horarios: Mateo y Santiago, todos los días; Julián, de martes a sábado. (0 = domingo … 6 = sábado)
  insert into public.horarios_barbero (barberia_id, barbero_id, dia_semana, desde_min, hasta_min, created_at, registrado_por)
  select p_barberia, b.id, f.dia, f.desde, f.hasta, v_antes, v_dueno
    from unnest(b_ids) with ordinality as b(id, n)
    join (values (0, 540, 840),
                 (1, 540, 780), (1, 870, 1140), (2, 540, 780), (2, 870, 1140), (3, 540, 780), (3, 870, 1140),
                 (4, 540, 780), (4, 870, 1140), (5, 540, 780), (5, 870, 1140),
                 (6, 540, 960)) as f(dia, desde, hasta)
      on b.n < 3 or f.dia between 2 and 6;

  -- Lo que gana cada barbero (y una excepción: el tinte de Mateo).
  insert into public.comisiones_barbero (barberia_id, barbero_id, pct, created_at, actualizado_at, registrado_por)
  values (p_barberia, b_ids[1], 60, v_antes, v_antes, v_dueno),
         (p_barberia, b_ids[2], 50, v_antes, v_antes, v_dueno),
         (p_barberia, b_ids[3], 40, v_antes, v_antes, v_dueno);
  insert into public.comisiones_servicio (barberia_id, barbero_id, servicio_id, pct, created_at, actualizado_at, registrado_por)
  values (p_barberia, b_ids[1], s_tinte, 70, v_antes, v_antes, v_dueno);

  -- 3) Clientes (nombres y celulares INVENTADOS: +57 300 000 10xx).
  insert into public.clientes (id, barberia_id, nombre, telefono, nota, created_at, registrado_por)
  select v_cli[n.i], p_barberia, n.nombre, '+5730000010' || lpad(n.i::text, 2, '0'),
         case n.i when 1 then 'Degradé bajo, número 1 a los lados'
                  when 3 then 'Prefiere que lo atienda Mateo'
                  when 7 then 'Piel sensible: sin talco'
                  when 12 then 'Llega siempre cinco minutos antes' end,
         v_antes, v_dueno
    from unnest(v_nombres) with ordinality as n(nombre, i);

  -- Un día libre de Julián, de aquí a tres días (la agenda no le da citas ese día).
  insert into public.bloqueos (barberia_id, barbero_id, inicio, fin, motivo, created_at, registrado_por)
  values (p_barberia, b_ids[3], public.fn_demo_instante(v_hoy + 3, 0), public.fn_demo_instante(v_hoy + 4, 0),
          'Día libre: trámite personal', p_ahora - interval '2 days', v_dueno);

  -- 4) Citas de los últimos 14 días, de hoy y de los próximos 7. El estado sale de la hora: lo que ya pasó se atendió
  --    (y se cobró), lo que está en curso está en atención y lo que viene está confirmado. Cada barbero llena su horario
  --    de corrido, sin cruzarse; cuántas citas lleva cada día lo decide un hash (más llenos los días pasados y los de hoy).
  for v_off in -14..7 loop
    v_dia := v_hoy + v_off;
    v_dow := extract(dow from v_dia)::integer;
    for v_bi in 1..3 loop
      continue when v_bi = 3 and v_off = 3;               -- su día libre
      v_menu := case v_bi
                  when 1 then array[s_corte, s_corte, s_degrade, s_degrade, s_barba, s_combo, s_combo, s_cejas, s_tinte]
                  when 2 then array[s_corte, s_corte, s_degrade, s_barba, s_combo, s_nino, s_cejas]
                  else array[s_corte, s_corte, s_nino, s_barba, s_cejas]
                end;
      v_ocup := case when v_off < 0 then 72 when v_off = 0 then 65 when v_off <= 2 then 55
                     else greatest(20, 50 - (v_off - 2) * 6) end;
      if v_bi = 3 then
        v_ocup := v_ocup - 12;
      end if;

      for v_w in
        select h.desde_min::integer as desde, h.hasta_min::integer as hasta
          from public.horarios_barbero h
         where h.barberia_id = p_barberia and h.barbero_id = b_ids[v_bi] and h.dia_semana = v_dow
         order by h.desde_min
      loop
        v_min := v_w.desde;
        while v_min < v_w.hasta loop
          v_semilla := v_off || '|' || v_bi || '|' || v_min;
          if public.fn_demo_hash('c|' || v_semilla, 100) >= v_ocup then
            v_min := v_min + 30;
            continue;
          end if;

          v_serv := v_menu[1 + public.fn_demo_hash('s|' || v_semilla, cardinality(v_menu))];
          select coalesce(bs.duracion_propia, s.duracion_min), coalesce(bs.precio_propio, s.precio)
            into v_dur, v_precio
            from public.servicios s
            join public.barbero_servicios bs on bs.barberia_id = s.barberia_id and bs.servicio_id = s.id
           where s.barberia_id = p_barberia and s.id = v_serv and bs.barbero_id = b_ids[v_bi];
          if v_min + v_dur > v_w.hasta then
            v_min := v_min + 30;
            continue;
          end if;

          v_ini := public.fn_demo_instante(v_dia, v_min);
          v_fin := v_ini + v_dur * interval '1 minute';
          v_cliente := v_cli[1 + public.fn_demo_hash('u|' || v_semilla, 20)];
          v_origen := case when public.fn_demo_hash('o|' || v_semilla, 100) < 35 then 'cliente' else 'personal' end;
          -- Se agendó entre 4 horas y 3 días antes (nunca en el futuro).
          v_creada := least(v_ini - (4 + public.fn_demo_hash('k|' || v_semilla, 68)) * interval '1 hour',
                            p_ahora - interval '10 minutes');
          v_motivo := null;
          v_cobrar := false;
          v_r := public.fn_demo_hash('e|' || v_semilla, 100);

          if v_fin <= p_ahora then
            if v_r >= 93 then
              v_estado := 'cancelada';
              v_motivo := case when v_origen = 'cliente' then 'Cancelada por el cliente'
                               else (array['El cliente avisó que no puede venir', 'Se le cruzó otro compromiso', 'Cambió de planes'])
                                      [1 + public.fn_demo_hash('x|' || v_semilla, 3)] end;
            elsif v_r >= 86 then
              v_estado := 'no_asistio';
            else
              v_estado := 'atendida';
              v_cobrar := true;
              if v_off = 0 then
                -- Hoy: lo que terminó hace menos de 20 minutos todavía no se cobra (para que «Caja» tenga qué cobrar).
                v_cobrar := v_fin <= p_ahora - interval '20 minutes';
              elsif v_off = -1 and v_bi = 2 and not v_ayuda_ayer then
                -- Una cita de ayer que se atendió y se quedó sin cobrar (para que el cierre de ayer avise).
                v_ayuda_ayer := true;
                v_cobrar := false;
              elsif v_off = -3 and v_bi = 1 and not v_ayuda_antes then
                v_ayuda_antes := true;
                v_cobrar := false;
              end if;
            end if;
          elsif v_ini <= p_ahora then
            v_estado := 'en_atencion';
          else
            v_estado := 'confirmada';
          end if;

          v_notas := case when public.fn_demo_hash('n|' || v_semilla, 100) < 8
                          then (array['Quiere el mismo corte de la vez pasada', 'Trae foto de referencia',
                                      'Cliente nuevo: primera visita', 'Pidió máquina en el 2'])
                                 [1 + public.fn_demo_hash('m|' || v_semilla, 4)] end;

          v_cita := gen_random_uuid();
          insert into public.citas (id, barberia_id, barbero_id, cliente_id, servicio_id, inicio, estado, origen, notas,
                                    recordatorio_enviado_at, cancelada_motivo, cancelada_at, consentimiento_at,
                                    aviso_reserva_at, created_at, registrado_por)
          values (v_cita, p_barberia, b_ids[v_bi], v_cliente, v_serv, v_ini, v_estado, v_origen, v_notas,
                  -- A algunas de hoy y de mañana ya se les mandó el recordatorio por WhatsApp.
                  case when v_estado = 'confirmada' and v_off in (0, 1)
                            and public.fn_demo_hash('r|' || v_semilla, 100) < 50
                       then greatest(v_creada, p_ahora - interval '2 hours') end,
                  v_motivo,
                  case when v_estado = 'cancelada' then v_ini - interval '3 hours' end,
                  case when v_origen = 'cliente' then v_creada end,
                  case when v_origen = 'cliente' then v_creada end,      -- ya «avisada»: la demo no manda avisos
                  v_creada,
                  case when v_origen = 'personal' then v_dueno end);

          if v_cobrar then
            v_ts := least(v_fin + (3 + public.fn_demo_hash('t|' || v_semilla, 10)) * interval '1 minute',
                          p_ahora - interval '1 minute');
            perform public.fn_demo_cobro(p_barberia, v_cita, b_ids[v_bi], v_cliente, v_serv, v_precio, v_ts, v_semilla, v_dueno);
          end if;

          -- La siguiente cita puede empezar al terminar esta (de 15 en 15 minutos).
          v_min := ((v_min + v_dur + 14) / 15) * 15;
        end loop;
      end loop;
    end loop;
  end loop;

  -- 5) Ventas sin cita (llegó, lo atendieron y pagó): una o dos por día, de Mateo o Santiago.
  for v_off in -14..0 loop
    v_dia := v_hoy + v_off;
    for v_k in 1..(1 + public.fn_demo_hash('vn|' || v_off, 2)) loop
      v_semilla := 'v|' || v_off || '|' || v_k;
      v_bi := 1 + public.fn_demo_hash('vb|' || v_semilla, 2);
      v_serv := (array[s_corte, s_corte, s_barba, s_cejas])[1 + public.fn_demo_hash('vs|' || v_semilla, 4)];
      v_ts := public.fn_demo_instante(v_dia, 600 + public.fn_demo_hash('vh|' || v_semilla, 480));
      continue when v_ts > p_ahora - interval '5 minutes';
      select coalesce(bs.precio_propio, s.precio) into v_precio
        from public.servicios s
        join public.barbero_servicios bs on bs.barberia_id = s.barberia_id and bs.servicio_id = s.id
       where s.barberia_id = p_barberia and s.id = v_serv and bs.barbero_id = b_ids[v_bi];
      perform public.fn_demo_cobro(p_barberia, null, b_ids[v_bi], null, v_serv, v_precio, v_ts, v_semilla, v_dueno);
    end loop;
  end loop;

  -- Un cobro anulado con motivo (una venta sin cita de hace unos días), para ver la anulación en acción.
  update public.cobros
     set anulado = true, anulado_motivo = 'Se cobró dos veces el mismo corte', anulado_por = v_dueno,
         anulado_at = created_at + interval '10 minutes'
   where id = (select k.id from public.cobros k
                where k.barberia_id = p_barberia and k.cita_id is null and k.fecha <= v_hoy - 5
                order by k.fecha desc, k.created_at, k.id limit 1);

  -- 6) Gastos de los últimos 14 días: insumos (casi cada dos días), café, el arriendo, la luz y el agua.
  for v_off in -14..0 loop
    v_dia := v_hoy + v_off;
    if public.fn_demo_hash('gi|' || v_off, 100) < 45 then
      v_ts := public.fn_demo_instante(v_dia, 600 + public.fn_demo_hash('gh|' || v_off, 120));
      if v_ts <= p_ahora - interval '5 minutes' then
        insert into public.gastos (barberia_id, clave, monto, categoria, medio, nota, created_at, registrado_por)
        values (p_barberia, gen_random_uuid(), 15000 + 5000 * public.fn_demo_hash('gm|' || v_off, 14), 'insumos',
                case when public.fn_demo_hash('gp|' || v_off, 100) < 70 then 'efectivo' else 'transferencia' end,
                v_notas_insumos[1 + public.fn_demo_hash('gn|' || v_off, cardinality(v_notas_insumos))], v_ts, v_dueno);
      end if;
    end if;
    if public.fn_demo_hash('gc|' || v_off, 100) < 25 then
      v_ts := public.fn_demo_instante(v_dia, 780 + public.fn_demo_hash('gk|' || v_off, 60));
      if v_ts <= p_ahora - interval '5 minutes' then
        insert into public.gastos (barberia_id, clave, monto, categoria, medio, nota, created_at, registrado_por)
        values (p_barberia, gen_random_uuid(), 8000 + 2000 * public.fn_demo_hash('gq|' || v_off, 4), 'otros', 'efectivo',
                'Café, aromática y vasos para los clientes', v_ts, v_dueno);
      end if;
    end if;
    if not v_arriendo then
      v_arriendo := true;
      insert into public.gastos (barberia_id, clave, monto, categoria, medio, nota, created_at, registrado_por)
      values (p_barberia, gen_random_uuid(), 1400000, 'arriendo', 'transferencia', 'Arriendo del local',
              public.fn_demo_instante(v_dia, 510), v_dueno);
    end if;
    if v_off >= -11 and not v_luz then
      v_luz := true;
      insert into public.gastos (barberia_id, clave, monto, categoria, medio, nota, created_at, registrado_por)
      values (p_barberia, gen_random_uuid(), 92000, 'servicios_publicos', 'transferencia', 'Factura de la luz',
              public.fn_demo_instante(v_dia, 540), v_dueno);
    end if;
    if v_off >= -5 and not v_agua then
      v_agua := true;
      insert into public.gastos (barberia_id, clave, monto, categoria, medio, nota, created_at, registrado_por)
      values (p_barberia, gen_random_uuid(), 38000, 'servicios_publicos', 'transferencia', 'Agua y alcantarillado',
              public.fn_demo_instante(v_dia, 540), v_dueno);
    end if;
  end loop;
  -- Un gasto anulado ayer (mal digitado), con su motivo.
  insert into public.gastos (barberia_id, clave, monto, categoria, medio, nota, created_at, registrado_por,
                             anulado, anulado_motivo, anulado_por, anulado_at)
  values (p_barberia, gen_random_uuid(), 250000, 'insumos', 'efectivo', 'Compra de insumos',
          public.fn_demo_instante(v_hoy - 1, 675), v_dueno,
          true, 'Se digitó mal: eran $ 25.000', v_dueno, public.fn_demo_instante(v_hoy - 1, 680));

  -- 7) Pago a los barberos de lo generado hasta hace ocho días (lo de la última semana queda pendiente, para que
  --    «Comisiones» tenga qué pagar). Julián cobra en efectivo si la caja de ese día alcanza con holgura.
  for v_bi in 1..3 loop
    select count(*)::integer, coalesce(sum(k.comision), 0)::integer, coalesce(sum(k.propina_barbero), 0)::integer
      into v_n, v_com, v_prop
      from public.cobros k
     where k.barberia_id = p_barberia and k.barbero_id = b_ids[v_bi] and not k.anulado and k.fecha <= v_hoy - 8;
    continue when v_n = 0;

    v_medio := 'transferencia';
    if v_bi = 3 then
      select coalesce(sum(x.monto) filter (where x.medio = 'efectivo'), 0)::integer into v_efectivo_dia
        from public.cobro_pagos x
        join public.cobros k on k.barberia_id = x.barberia_id and k.id = x.cobro_id
       where k.barberia_id = p_barberia and k.fecha = v_hoy - 7 and not k.anulado;
      v_efectivo_dia := v_efectivo_dia - coalesce((select sum(g.monto) filter (where g.medio = 'efectivo')
                                                     from public.gastos g
                                                    where g.barberia_id = p_barberia and g.fecha = v_hoy - 7 and not g.anulado), 0);
      if v_com + v_prop <= v_efectivo_dia / 2 then
        v_medio := 'efectivo';
      end if;
    end if;

    v_ts := public.fn_demo_instante(v_hoy - 7, 1110);                 -- 6:30 p. m. de hace una semana
    v_liq := gen_random_uuid();
    insert into public.liquidaciones (id, barberia_id, barbero_id, clave, hasta, medio, cobros, comision, propina, total,
                                      nota, created_at, registrado_por)
    values (v_liq, p_barberia, b_ids[v_bi], gen_random_uuid(), v_hoy - 8, v_medio, v_n, v_com, v_prop, v_com + v_prop,
            'Pago de la semana', v_ts, v_dueno);
    insert into public.liquidacion_cobros (barberia_id, liquidacion_id, cobro_id, comision, propina_barbero, created_at, registrado_por)
    select p_barberia, v_liq, k.id, k.comision, k.propina_barbero, v_ts, v_dueno
      from public.cobros k
     where k.barberia_id = p_barberia and k.barbero_id = b_ids[v_bi] and not k.anulado and k.fecha <= v_hoy - 8;
  end loop;

  -- 8) Cierres de los días con movimiento hasta anteayer. Ayer queda SIN cerrar a propósito: el cierre avisa que falta.
  --    La mayoría cuadra; algunos tienen una diferencia pequeña (sobra o falta).
  for v_off in -14..-2 loop
    v_dia := v_hoy + v_off;
    v_res := public.fn_resumen_dia(p_barberia, v_dia);
    continue when (v_res ->> 'cobros')::integer + (v_res ->> 'gastos')::integer
                  + (v_res ->> 'liquidaciones_efectivo')::integer + (v_res ->> 'liquidaciones_transferencia')::integer = 0;
    v_esperado := (v_res ->> 'efectivo_esperado')::integer;
    v_ajuste := (array[0, 0, 0, -2000, 0, 1000, 0, 0, -5000, 0])[1 + public.fn_demo_hash('ci|' || v_off, 10)];
    v_contado := greatest(0, v_esperado + v_ajuste);
    insert into public.cierres (
      barberia_id, fecha, clave, cobros, servicios, propinas, comisiones, propinas_barbero,
      efectivo_cobros, transferencia_cobros, gastos, gastos_efectivo, gastos_transferencia,
      liquidaciones_efectivo, liquidaciones_transferencia, efectivo_esperado, efectivo_contado, diferencia,
      nota, created_at, registrado_por)
    values (
      p_barberia, v_dia, gen_random_uuid(),
      (v_res ->> 'cobros')::integer, (v_res ->> 'servicios')::integer, (v_res ->> 'propinas')::integer,
      (v_res ->> 'comisiones')::integer, (v_res ->> 'propinas_barbero')::integer,
      (v_res ->> 'efectivo_cobros')::integer, (v_res ->> 'transferencia_cobros')::integer,
      (v_res ->> 'gastos')::integer, (v_res ->> 'gastos_efectivo')::integer, (v_res ->> 'gastos_transferencia')::integer,
      (v_res ->> 'liquidaciones_efectivo')::integer, (v_res ->> 'liquidaciones_transferencia')::integer,
      v_esperado, v_contado, v_contado - v_esperado,
      case v_ajuste when -2000 then 'Faltan 2 mil: se dieron mal unos vueltos'
                    when 1000 then 'Sobró una moneda de mil'
                    when -5000 then 'Se prestaron 5 mil para el almuerzo' end,
      public.fn_demo_instante(v_dia, 1290), v_dueno);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Dar de alta la demo (una sola vez, quien administra)
-- ---------------------------------------------------------------------
--   1. Supabase → Authentication → Users → Add user: el correo y la contraseña de la demo, con «Auto Confirm User».
--      Ese mismo correo y contraseña van en DEMO_EMAIL y DEMO_PASSWORD (variables del servidor; ver .env.example).
--   2. SQL Editor:  select public.fn_provisionar_demo('demo@tu-dominio.com');
--   3. (Opcional) un PIN para que nadie reinicie la demo en plena visita:  select public.fn_definir_pin_reinicio('4821');
-- Se puede volver a correr: si la barbería ya existe y es una demo, solo recarga los datos de ejemplo.
create or replace function public.fn_provisionar_demo(
  p_correo text, p_nombre text default 'Barbería Demo', p_ahora timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_correo text := lower(btrim(coalesce(p_correo, '')));
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_user   uuid;
  v_barb   uuid;
  v_slug   text;
begin
  if length(v_nombre) = 0 or length(v_nombre) > 60 then
    raise exception 'Escribe el nombre de la barbería de demo (máximo 60 caracteres).';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_correo;
  if v_user is null then
    raise exception 'No existe el usuario %. Créalo primero en Authentication > Users (con "Auto Confirm User").', v_correo;
  end if;

  select p.barberia_id into v_barb from public.perfiles p where p.user_id = v_user;
  if v_barb is not null then
    if not (select b.es_demo from public.barberias b where b.id = v_barb) then
      raise exception 'El usuario % ya tiene una barbería de verdad: la demo necesita su propio usuario.', v_correo;
    end if;
  else
    insert into public.barberias (nombre, es_demo) values (v_nombre, true) returning id into v_barb;
    insert into public.perfiles (user_id, barberia_id, rol, nombre) values (v_user, v_barb, 'dueno', 'Dueño de la demo');
  end if;

  perform public.fn_cargar_datos_demo(v_barb, p_ahora);
  select b.slug into v_slug from public.barberias b where b.id = v_barb;
  return jsonb_build_object('barberia_id', v_barb, 'slug', v_slug, 'enlace_reservas', '/reservar/' || v_slug);
end $$;

-- ---------------------------------------------------------------------
-- 5. Reiniciar la demo desde la app (solo el dueño, solo una demo)
-- ---------------------------------------------------------------------
--   {"ok": true}                                          listo: datos de ejemplo recargados.
--   {"ok": false, "motivo": "pin", "intentos_restantes"}  el PIN no coincide (a los 5 fallos se bloquea 5 minutos).
--   {"ok": false, "motivo": "bloqueado", "minutos"}       demasiados intentos: espera.
create or replace function public.reiniciar_demo(p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_dueno();
  v_b        public.barberias%rowtype;
  v_pin      public.pines_reinicio%rowtype;
  v_fallos   integer;
begin
  select * into v_b from public.barberias where id = v_barberia for update;
  if not coalesce(v_b.es_demo, false) then
    raise exception 'Solo la demo se puede reiniciar.' using errcode = '42501';
  end if;

  select * into v_pin from public.pines_reinicio where barberia_id = v_barberia for update;
  if found then
    if v_pin.bloqueado_hasta is not null and v_pin.bloqueado_hasta > now() then
      return jsonb_build_object('ok', false, 'motivo', 'bloqueado',
                                'minutos', greatest(1, ceil(extract(epoch from (v_pin.bloqueado_hasta - now())) / 60.0)::integer));
    end if;
    if public.fn_hash_pin(v_barberia, btrim(coalesce(p_pin, ''))) <> v_pin.hash then
      v_fallos := v_pin.intentos + 1;
      update public.pines_reinicio
         set intentos = case when v_fallos >= 5 then 0 else v_fallos end,
             bloqueado_hasta = case when v_fallos >= 5 then now() + interval '5 minutes' end
       where barberia_id = v_barberia;
      if v_fallos >= 5 then
        return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'minutos', 5);
      end if;
      return jsonb_build_object('ok', false, 'motivo', 'pin', 'intentos_restantes', 5 - v_fallos);
    end if;
    update public.pines_reinicio set intentos = 0, bloqueado_hasta = null where barberia_id = v_barberia;
  end if;

  perform public.fn_cargar_datos_demo(v_barberia);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 6. La app necesita saber si debe pedir el PIN (nunca cuál es)
-- ---------------------------------------------------------------------
-- Igual que la de 0017, con `reinicio_con_pin` dentro de `barberia`.
create or replace function public.obtener_contexto()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'barberia', (select jsonb_build_object('id', b.id, 'nombre', b.nombre, 'slug', b.slug, 'es_demo', b.es_demo,
                                           'reinicio_con_pin', b.reinicio_con_pin,
                                           'whatsapp', b.whatsapp, 'direccion', b.direccion,
                                           'agenda', jsonb_build_object(
                                             'paso_min', b.paso_min, 'dias_adelante', b.dias_adelante,
                                             'anticipacion_min', b.anticipacion_min, 'colchon_min', b.colchon_min,
                                             'reservas_en_linea', b.reservas_en_linea,
                                             'cancelar_hasta_horas', b.cancelar_hasta_horas))
                   from public.barberias b limit 1),
    'perfil', (select jsonb_build_object(
                        'nombre', p.nombre, 'rol', p.rol,
                        'areas', to_jsonb(public.mis_areas()),
                        'roles', coalesce((select jsonb_agg(r.nombre order by r.orden, r.nombre)
                                             from public.perfil_roles pr
                                             join public.roles_equipo r on r.id = pr.rol_id and r.activo
                                            where pr.user_id = p.user_id), '[]'::jsonb))
                 from public.perfiles p where p.user_id = auth.uid())
  )
$$;

select public.fn_aplicar_permisos();
