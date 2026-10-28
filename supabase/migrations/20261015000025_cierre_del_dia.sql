-- =====================================================================
-- BARBERÍAS · 0025 · CIERRE DEL DÍA (tarea 3.7 · SPEC F9)
--
--   registrar_cierre(...)   cierra un día: guarda sus cifras, cuánto efectivo se contó y la diferencia.
--   anular_cierre(id, ...)  lo anula con motivo y reabre el día.
--   obtener_cierre(fecha)   el día para la pantalla de cierre: sus cifras, su cierre (si ya se hizo) y qué falta.
--   fn_resumen_dia(...)     las cifras de un día (las mismas para el cierre y para Inicio).
--   fn_jornada(...)         (redefinida) a qué día pertenece lo que se registra ahora.
--   obtener_caja(...)       (redefinida) la caja de «hoy» sigue al día en que hoy se registra.
--
-- REGLAS
--   * El día es el día calendario de Bogotá. El efectivo esperado es lo cobrado en efectivo (lo que quedó en la caja,
--     sin el vuelto) MENOS los gastos pagados en efectivo y MENOS lo que se le pagó en efectivo a los barberos
--     (liquidaciones). La diferencia es lo contado MENOS lo esperado: sobra (+) o falta (−).
--   * Cerrar guarda las cifras del día (instantánea). Un día cerrado ya no recibe nada: lo que se registre después va al
--     día siguiente (fn_jornada), y no se puede anular un cobro, un gasto ni una liquidación de ese día. Así las cifras
--     del cierre no se mueven. Para corregir algo, se anula el cierre.
--   * Anular el cierre reabre el día: lo que se registró después de cerrar y se había ido al día siguiente vuelve a su
--     día. Solo se anula el cierre más reciente (los de días posteriores se anulan primero).
--   * Un día tiene un solo cierre vigente (índice único parcial). Idempotente por clave, como cobros y gastos.
--   * Mientras se cierra, nadie registra: cobros, gastos y liquidaciones toman un candado compartido sobre la barbería y
--     el cierre uno exclusivo, así un cobro a medias no se queda fuera de las cifras ni cae en un día ya cerrado.
--   * Permiso: área "cierre".
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. La tabla de cierres
-- ---------------------------------------------------------------------
create table if not exists public.cierres (
  id                          uuid primary key default gen_random_uuid(),
  barberia_id                 uuid not null references public.barberias(id),
  fecha                       date not null,                   -- el día que se cierra
  clave                       uuid not null,                   -- idempotencia: la crea la pantalla al abrirse
  -- Las cifras del día al cerrar (instantánea): no cambian aunque después se toque algo.
  cobros                      integer not null check (cobros >= 0),
  servicios                   integer not null check (servicios >= 0),
  propinas                    integer not null check (propinas >= 0),
  comisiones                  integer not null check (comisiones >= 0),
  propinas_barbero            integer not null check (propinas_barbero >= 0),
  efectivo_cobros             integer not null check (efectivo_cobros >= 0),
  transferencia_cobros        integer not null check (transferencia_cobros >= 0),
  gastos                      integer not null check (gastos >= 0),
  gastos_efectivo             integer not null check (gastos_efectivo >= 0),
  gastos_transferencia        integer not null check (gastos_transferencia >= 0),
  liquidaciones_efectivo      integer not null check (liquidaciones_efectivo >= 0),
  liquidaciones_transferencia integer not null check (liquidaciones_transferencia >= 0),
  efectivo_esperado           integer not null,                -- puede ser negativo si salió más efectivo del que entró
  efectivo_contado            integer not null check (efectivo_contado >= 0),
  diferencia                  integer not null,                -- contado − esperado: sobra (+) o falta (−)
  nota                        text check (nota is null or length(btrim(nota)) between 1 and 200),
  anulado                     boolean not null default false,
  anulado_motivo              text,
  anulado_por                 uuid references auth.users(id) on delete set null,
  anulado_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  registrado_por              uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  constraint ux_cierres_clave unique (barberia_id, clave),
  constraint chk_cierre_esperado check (efectivo_esperado = efectivo_cobros - gastos_efectivo - liquidaciones_efectivo),
  constraint chk_cierre_diferencia check (diferencia = efectivo_contado - efectivo_esperado),
  constraint chk_cierre_anulacion check (
    (anulado = false and anulado_motivo is null and anulado_at is null)
    or (anulado = true and length(btrim(coalesce(anulado_motivo, ''))) > 0 and anulado_at is not null)
  )
);
-- Un día tiene un solo cierre vigente.
create unique index if not exists ux_cierre_dia_vigente on public.cierres (barberia_id, fecha) where not anulado;
create index if not exists idx_cierres_fecha on public.cierres (barberia_id, fecha desc);
comment on table public.cierres is 'Cierre del día: cifras al cerrar, efectivo contado y diferencia. No se edita ni se borra: se anula con motivo.';

-- De un cierre solo cambia la anulación; uno anulado no se reactiva.
create or replace function public.fn_cierre_inmutables()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if to_jsonb(new) - 'anulado' - 'anulado_motivo' - 'anulado_por' - 'anulado_at'
     is distinct from to_jsonb(old) - 'anulado' - 'anulado_motivo' - 'anulado_por' - 'anulado_at' then
    raise exception 'Un cierre no se edita: anúlalo con motivo y vuelve a cerrar.' using errcode = '42501';
  end if;
  if old.anulado and not new.anulado then
    raise exception 'Un cierre anulado no se reactiva: se cierra el día de nuevo.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_cierre_inmutables on public.cierres;
create trigger trg_cierre_inmutables before update on public.cierres
  for each row execute function public.fn_cierre_inmutables();

drop trigger if exists trg_bloquear_borrado on public.cierres;
create trigger trg_bloquear_borrado before delete on public.cierres
  for each row execute function public.fn_bloquear_borrado();

-- Lectura (RLS): solo el área «cierre» ve los cierres. Se escribe únicamente por funciones.
alter table public.cierres enable row level security;

drop policy if exists cierres_select on public.cierres;
create policy cierres_select on public.cierres
  for select to authenticated
  using (barberia_id = (select public.mi_barberia()) and (select public.tiene_area('cierre')));

grant select on public.cierres to authenticated;

-- ---------------------------------------------------------------------
-- 2. A qué día pertenece lo que se registra
-- ---------------------------------------------------------------------
-- El día de Bogotá del instante; pero un día con cierre vigente (hecho antes de ese instante) ya no recibe más: lo que
-- se registra después va al día siguiente (y así mientras el siguiente también esté cerrado).
create or replace function public.fn_jornada(p_barberia uuid, p_ts timestamptz)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_dia date := public.fecha_bogota(p_ts);
begin
  while exists (select 1 from public.cierres c
                 where c.barberia_id = p_barberia and c.fecha = v_dia and not c.anulado and c.created_at <= p_ts) loop
    v_dia := v_dia + 1;
  end loop;
  return v_dia;
end $$;

-- El día en que hoy se registra, para las lecturas con los permisos de quien llama (no pueden llamar a fn_jornada):
-- el de la fecha de Bogotá, o el siguiente si ese ya se cerró.
create or replace function public.jornada_actual()
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select public.fn_jornada(public.mi_barberia(), now()) $$;

-- Lo mismo, para quien REGISTRA algo: antes de decidir el día toma el candado compartido de la barbería, que el cierre
-- pide exclusivo. Si se está cerrando, espera a que termine y ve el cierre; si no, el cierre espera a este registro.
create or replace function public.fn_jornada_de_registro(p_barberia uuid, p_ts timestamptz default now())
returns date
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.barberias b where b.id = p_barberia for share;
  return public.fn_jornada(p_barberia, p_ts);
end $$;

-- Los cobros, los gastos y las liquidaciones ponen su día así (antes: el día de Bogotá, sin mirar los cierres).
create or replace function public.fn_cobro_fecha()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.fecha := public.fn_jornada_de_registro(new.barberia_id, coalesce(new.created_at, now()));
  return new;
end $$;

create or replace function public.fn_gasto_fecha()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.fecha := public.fn_jornada_de_registro(new.barberia_id, coalesce(new.created_at, now()));
  return new;
end $$;

create or replace function public.fn_liquidacion_fecha()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.fecha := public.fn_jornada_de_registro(new.barberia_id, coalesce(new.created_at, now()));
  return new;
end $$;

drop trigger if exists trg_liquidacion_fecha on public.liquidaciones;
create trigger trg_liquidacion_fecha before insert on public.liquidaciones
  for each row execute function public.fn_liquidacion_fecha();

-- Al anular el cierre, la `fecha` de lo que se había ido al día siguiente tiene que poder volver: una liquidación ya no
-- fija su fecha para siempre (copia de la ÚLTIMA versión, la de 0023, sin `fecha`).
create or replace function public.fn_liquidacion_inmutables()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.barberia_id is distinct from old.barberia_id
     or new.barbero_id is distinct from old.barbero_id
     or new.clave is distinct from old.clave
     or new.hasta is distinct from old.hasta
     or new.medio is distinct from old.medio
     or new.cobros is distinct from old.cobros
     or new.comision is distinct from old.comision
     or new.propina is distinct from old.propina
     or new.total is distinct from old.total
     or new.nota is distinct from old.nota
     or new.created_at is distinct from old.created_at then
    raise exception 'Lo que ya se liquidó no se edita: anula la liquidación con motivo y vuelve a liquidar.' using errcode = '42501';
  end if;
  if old.anulada and not new.anulada then
    raise exception 'Una liquidación anulada no se reactiva: se liquida de nuevo.' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Un día cerrado no se mueve: no se anula nada de él
-- ---------------------------------------------------------------------
create or replace function public.fn_dia_cerrado_no_se_anula()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nuevo boolean := coalesce((to_jsonb(new) ->> tg_argv[0])::boolean, false);
  v_viejo boolean := coalesce((to_jsonb(old) ->> tg_argv[0])::boolean, false);
begin
  if v_nuevo and not v_viejo
     and exists (select 1 from public.cierres c
                  where c.barberia_id = old.barberia_id and c.fecha = old.fecha and not c.anulado) then
    raise exception 'El día % ya está cerrado: anular esto movería las cifras del cierre. Anula primero el cierre del día.',
      to_char(old.fecha, 'DD/MM/YYYY');
  end if;
  return new;
end $$;

drop trigger if exists trg_dia_cerrado_no_se_anula on public.cobros;
create trigger trg_dia_cerrado_no_se_anula before update of anulado on public.cobros
  for each row execute function public.fn_dia_cerrado_no_se_anula('anulado');

drop trigger if exists trg_dia_cerrado_no_se_anula on public.gastos;
create trigger trg_dia_cerrado_no_se_anula before update of anulado on public.gastos
  for each row execute function public.fn_dia_cerrado_no_se_anula('anulado');

drop trigger if exists trg_dia_cerrado_no_se_anula on public.liquidaciones;
create trigger trg_dia_cerrado_no_se_anula before update of anulada on public.liquidaciones
  for each row execute function public.fn_dia_cerrado_no_se_anula('anulada');

-- ---------------------------------------------------------------------
-- 4. Las cifras de un día (las mismas para el cierre y para Inicio)
-- ---------------------------------------------------------------------
create or replace function public.fn_resumen_dia(p_barberia uuid, p_fecha date)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with rc as (
    select count(*)::integer as cobros,
           coalesce(sum(k.total), 0)::integer as servicios,
           coalesce(sum(k.propina), 0)::integer as propinas,
           coalesce(sum(k.comision), 0)::integer as comisiones,
           coalesce(sum(k.propina_barbero), 0)::integer as propinas_barbero
      from public.cobros k
     where k.barberia_id = p_barberia and k.fecha = p_fecha and not k.anulado),
  rp as (
    select coalesce(sum(x.monto) filter (where x.medio = 'efectivo'), 0)::integer as efectivo,
           coalesce(sum(x.monto) filter (where x.medio = 'transferencia'), 0)::integer as transferencia
      from public.cobro_pagos x
      join public.cobros k on k.barberia_id = x.barberia_id and k.id = x.cobro_id
     where k.barberia_id = p_barberia and k.fecha = p_fecha and not k.anulado),
  rg as (
    select count(*)::integer as gastos,
           coalesce(sum(g.monto) filter (where g.medio = 'efectivo'), 0)::integer as efectivo,
           coalesce(sum(g.monto) filter (where g.medio = 'transferencia'), 0)::integer as transferencia
      from public.gastos g
     where g.barberia_id = p_barberia and g.fecha = p_fecha and not g.anulado),
  rl as (
    select coalesce(sum(l.total) filter (where l.medio = 'efectivo'), 0)::integer as efectivo,
           coalesce(sum(l.total) filter (where l.medio = 'transferencia'), 0)::integer as transferencia
      from public.liquidaciones l
     where l.barberia_id = p_barberia and l.fecha = p_fecha and not l.anulada)
  select jsonb_build_object(
           'cobros', rc.cobros, 'servicios', rc.servicios, 'propinas', rc.propinas,
           'comisiones', rc.comisiones, 'propinas_barbero', rc.propinas_barbero,
           'efectivo_cobros', rp.efectivo, 'transferencia_cobros', rp.transferencia,
           'gastos', rg.gastos, 'gastos_efectivo', rg.efectivo, 'gastos_transferencia', rg.transferencia,
           'liquidaciones_efectivo', rl.efectivo, 'liquidaciones_transferencia', rl.transferencia,
           'efectivo_esperado', rp.efectivo - rg.efectivo - rl.efectivo)
    from rc, rp, rg, rl
$$;

-- ---------------------------------------------------------------------
-- 5. Cerrar y anular
-- ---------------------------------------------------------------------
create or replace function public.fn_resultado_cierre(p_barberia uuid, p_id uuid, p_ya boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_res     jsonb;
  v_anulado boolean;
begin
  select jsonb_build_object(
           'ok', true, 'ya_existia', p_ya, 'id', c.id, 'fecha', c.fecha, 'created_at', c.created_at,
           'cobros', c.cobros, 'servicios', c.servicios, 'propinas', c.propinas,
           'comisiones', c.comisiones, 'propinas_barbero', c.propinas_barbero,
           'efectivo_cobros', c.efectivo_cobros, 'transferencia_cobros', c.transferencia_cobros,
           'gastos', c.gastos, 'gastos_efectivo', c.gastos_efectivo, 'gastos_transferencia', c.gastos_transferencia,
           'liquidaciones_efectivo', c.liquidaciones_efectivo, 'liquidaciones_transferencia', c.liquidaciones_transferencia,
           'efectivo_esperado', c.efectivo_esperado, 'efectivo_contado', c.efectivo_contado, 'diferencia', c.diferencia,
           'nota', c.nota, 'anulado', c.anulado, 'anulado_motivo', c.anulado_motivo, 'anulado_at', c.anulado_at,
           'registrado_por', p.nombre),
         c.anulado
    into v_res, v_anulado
    from public.cierres c
    left join public.perfiles p on p.barberia_id = c.barberia_id and p.user_id = c.registrado_por
   where c.barberia_id = p_barberia and c.id = p_id;

  -- Repetir la clave de un cierre que ya se anuló no lo da por hecho.
  if p_ya and coalesce(v_anulado, false) then
    raise exception 'Ese cierre ya se anuló. Abre el cierre de nuevo para cerrar el día otra vez.';
  end if;
  return v_res;
end $$;

-- Cierra un día: guarda las cifras de ese momento, el efectivo contado y la diferencia con el esperado.
create or replace function public.registrar_cierre(p_fecha date, p_efectivo_contado integer, p_clave uuid, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('cierre');
  v_prev     uuid;
  v_nota     text := nullif(left(public.fn_limpiar_texto(p_nota), 200), '');
  v_r        jsonb;
  v_esperado integer;
  v_id       uuid := gen_random_uuid();
begin
  if p_clave is null then
    raise exception 'Falta la clave del cierre. Recarga la pantalla e intenta de nuevo.';
  end if;

  -- Repetir la misma clave (doble toque, mala señal, reintento) devuelve el cierre que ya se hizo.
  select c.id into v_prev from public.cierres c where c.barberia_id = v_barberia and c.clave = p_clave;
  if found then
    return public.fn_resultado_cierre(v_barberia, v_prev, true);
  end if;

  if p_fecha is null then
    raise exception 'Elige el día que se cierra.';
  end if;
  if p_efectivo_contado is null or p_efectivo_contado < 0 or p_efectivo_contado > 1000000000 then
    raise exception 'Escribe cuánto efectivo contaste (desde $ 0).';
  end if;

  -- Candado exclusivo: mientras se cierra, nadie registra un cobro, un gasto ni una liquidación.
  perform 1 from public.barberias b where b.id = v_barberia for no key update;

  if p_fecha > public.fn_jornada(v_barberia, now()) then
    raise exception 'Todavía no se puede cerrar el %.', to_char(p_fecha, 'DD/MM/YYYY');
  end if;
  if exists (select 1 from public.cierres c where c.barberia_id = v_barberia and c.fecha = p_fecha and not c.anulado) then
    raise exception 'El % ya está cerrado.', to_char(p_fecha, 'DD/MM/YYYY');
  end if;

  v_r := public.fn_resumen_dia(v_barberia, p_fecha);
  v_esperado := (v_r ->> 'efectivo_esperado')::integer;

  insert into public.cierres (
    id, barberia_id, fecha, clave, cobros, servicios, propinas, comisiones, propinas_barbero,
    efectivo_cobros, transferencia_cobros, gastos, gastos_efectivo, gastos_transferencia,
    liquidaciones_efectivo, liquidaciones_transferencia, efectivo_esperado, efectivo_contado, diferencia, nota)
  values (
    v_id, v_barberia, p_fecha, p_clave,
    (v_r ->> 'cobros')::integer, (v_r ->> 'servicios')::integer, (v_r ->> 'propinas')::integer,
    (v_r ->> 'comisiones')::integer, (v_r ->> 'propinas_barbero')::integer,
    (v_r ->> 'efectivo_cobros')::integer, (v_r ->> 'transferencia_cobros')::integer,
    (v_r ->> 'gastos')::integer, (v_r ->> 'gastos_efectivo')::integer, (v_r ->> 'gastos_transferencia')::integer,
    (v_r ->> 'liquidaciones_efectivo')::integer, (v_r ->> 'liquidaciones_transferencia')::integer,
    v_esperado, p_efectivo_contado, p_efectivo_contado - v_esperado, v_nota);

  return public.fn_resultado_cierre(v_barberia, v_id, false);
end $$;

-- Anula un cierre con motivo y reabre el día. Solo el más reciente: los de días posteriores se anulan antes.
create or replace function public.anular_cierre(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('cierre');
  v_motivo   text := public.fn_motivo(p_motivo);
  v_c        record;
  v_despues  date;
begin
  perform 1 from public.barberias b where b.id = v_barberia for no key update;

  select c.fecha, c.anulado, c.created_at into v_c
    from public.cierres c where c.barberia_id = v_barberia and c.id = p_id
     for update;
  if not found then
    raise exception 'No existe ese cierre.' using errcode = 'P0002';
  end if;
  if v_c.anulado then
    raise exception 'Este cierre ya está anulado.';
  end if;

  select min(c.fecha) into v_despues
    from public.cierres c where c.barberia_id = v_barberia and not c.anulado and c.fecha > v_c.fecha;
  if v_despues is not null then
    raise exception 'Para anular el cierre del %, primero anula el del %.',
      to_char(v_c.fecha, 'DD/MM/YYYY'), to_char(v_despues, 'DD/MM/YYYY');
  end if;

  update public.cierres
     set anulado = true, anulado_motivo = v_motivo, anulado_por = auth.uid(), anulado_at = now()
   where barberia_id = v_barberia and id = p_id;

  -- Reabrir el día: lo que se registró después de cerrar (todavía ese día) y se fue al siguiente vuelve a este día.
  update public.cobros set fecha = v_c.fecha
   where barberia_id = v_barberia and fecha > v_c.fecha and created_at >= v_c.created_at
     and public.fecha_bogota(created_at) = v_c.fecha;
  update public.gastos set fecha = v_c.fecha
   where barberia_id = v_barberia and fecha > v_c.fecha and created_at >= v_c.created_at
     and public.fecha_bogota(created_at) = v_c.fecha;
  update public.liquidaciones set fecha = v_c.fecha
   where barberia_id = v_barberia and fecha > v_c.fecha and created_at >= v_c.created_at
     and public.fecha_bogota(created_at) = v_c.fecha;

  return jsonb_build_object('ok', true, 'id', p_id, 'fecha', v_c.fecha);
end $$;

-- ---------------------------------------------------------------------
-- 6. El día para la pantalla de cierre
-- ---------------------------------------------------------------------
--   fecha       el día que se mira (sin fecha, el día en que hoy se registra)
--   cierre      el cierre vigente de ese día, si ya se hizo (con su efectivo contado y la diferencia)
--   resumen     las cifras del día: las guardadas si está cerrado, las de ahora si no
--   sin_cobrar  citas de ese día calendario que se atendieron y todavía no tienen cobro
--   sin_cerrar  días anteriores con movimiento que nadie cerró (para no olvidarlos)
create or replace function public.obtener_cierre(p_fecha date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('cierre');
  v_jornada  date := public.fn_jornada(v_barberia, now());
  v_fecha    date := coalesce(p_fecha, v_jornada);
  v_ini      timestamptz := v_fecha::timestamp at time zone 'America/Bogota';
  v_id       uuid;
  v_cierre   jsonb;
begin
  select c.id into v_id from public.cierres c
   where c.barberia_id = v_barberia and c.fecha = v_fecha and not c.anulado;
  if v_id is not null then
    v_cierre := public.fn_resultado_cierre(v_barberia, v_id, false);
  end if;

  return jsonb_build_object(
    'fecha', v_fecha,
    'jornada', v_jornada,
    'cierre', v_cierre,
    'resumen', coalesce(v_cierre, public.fn_resumen_dia(v_barberia, v_fecha)),
    'sin_cobrar', (
      select count(*)::integer from public.citas c
       where c.barberia_id = v_barberia and c.inicio >= v_ini and c.inicio < v_ini + interval '1 day'
         and c.estado in ('en_atencion', 'atendida')
         and not exists (select 1 from public.cobros k
                          where k.barberia_id = c.barberia_id and k.cita_id = c.id and not k.anulado)),
    'sin_cerrar', coalesce((
      select jsonb_agg(m.f order by m.f desc)
        from (select distinct x.f
                from (select k.fecha as f from public.cobros k
                       where k.barberia_id = v_barberia and not k.anulado and k.fecha < v_jornada and k.fecha >= v_jornada - 14
                      union
                      select g.fecha from public.gastos g
                       where g.barberia_id = v_barberia and not g.anulado and g.fecha < v_jornada and g.fecha >= v_jornada - 14
                      union
                      select l.fecha from public.liquidaciones l
                       where l.barberia_id = v_barberia and not l.anulada and l.fecha < v_jornada and l.fecha >= v_jornada - 14) x
               where not exists (select 1 from public.cierres c
                                  where c.barberia_id = v_barberia and c.fecha = x.f and not c.anulado)) m), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 7. La caja de «hoy» (copia de la ÚLTIMA versión, la de 0020): con fecha explícita, igual que antes; sin fecha,
--    las citas son las de hoy (calendario) y los cobros los del día en que hoy se registra (tras cerrar, el siguiente)
-- ---------------------------------------------------------------------
create or replace function public.obtener_caja(p_fecha date default null)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_fecha date := coalesce(p_fecha, public.hoy_bogota());                -- el día de las citas
  v_dia   date := coalesce(p_fecha, public.jornada_actual());            -- el día de los cobros
  v_ini   timestamptz := v_fecha::timestamp at time zone 'America/Bogota';
begin
  return jsonb_build_object(
    'fecha', v_dia,

    -- Citas del día que se pueden cobrar y todavía no tienen cobro vigente.
    'por_cobrar', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'inicio', c.inicio, 'fin', c.fin, 'estado', c.estado, 'precio', c.precio,
               'cliente', cl.nombre, 'servicio', s.nombre, 'barbero', b.nombre) order by c.inicio, c.id)
        from public.citas c
        join public.barberos b  on b.barberia_id = c.barberia_id and b.id = c.barbero_id
        join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
        join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
       where c.inicio >= v_ini and c.inicio < v_ini + interval '1 day'
         and c.estado in ('confirmada', 'en_atencion', 'atendida')
         and not exists (select 1 from public.cobros k
                          where k.barberia_id = c.barberia_id and k.cita_id = c.id and not k.anulado)
    ), '[]'::jsonb),

    -- Atendidas (o en atención) de los últimos días que se quedaron sin cobrar: plata que no se debe olvidar.
    'atrasadas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'inicio', c.inicio, 'fin', c.fin, 'estado', c.estado, 'precio', c.precio,
               'cliente', cl.nombre, 'servicio', s.nombre, 'barbero', b.nombre) order by c.inicio, c.id)
        from public.citas c
        join public.barberos b  on b.barberia_id = c.barberia_id and b.id = c.barbero_id
        join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
        join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
       where c.inicio < v_ini and c.inicio >= v_ini - interval '14 days'
         and c.estado in ('en_atencion', 'atendida')
         and not exists (select 1 from public.cobros k
                          where k.barberia_id = c.barberia_id and k.cita_id = c.id and not k.anulado)
    ), '[]'::jsonb),

    -- Los cobros del día (también los anulados, marcados), el más reciente primero.
    'cobros', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'created_at', k.created_at, 'cita_id', k.cita_id,
               'barbero', b.nombre, 'cliente', cl.nombre,
               'total', k.total, 'propina', k.propina, 'anulado', k.anulado, 'anulado_motivo', k.anulado_motivo,
               'medios', coalesce((select jsonb_agg(distinct p.medio)
                                     from public.cobro_pagos p where p.barberia_id = k.barberia_id and p.cobro_id = k.id), '[]'::jsonb))
             order by k.created_at desc, k.id)
        from public.cobros k
        join public.barberos b on b.barberia_id = k.barberia_id and b.id = k.barbero_id
        left join public.clientes cl on cl.barberia_id = k.barberia_id and cl.id = k.cliente_id
       where k.fecha = v_dia
    ), '[]'::jsonb),

    -- Cuánto entró ese día (sin contar los anulados): lo cobrado por servicios, las propinas y por qué medio.
    'totales', jsonb_build_object(
      'cobros', (select count(*) from public.cobros k where k.fecha = v_dia and not k.anulado),
      'servicios', (select coalesce(sum(k.total), 0) from public.cobros k where k.fecha = v_dia and not k.anulado),
      'propinas', (select coalesce(sum(k.propina), 0) from public.cobros k where k.fecha = v_dia and not k.anulado),
      'efectivo', (select coalesce(sum(p.monto), 0)
                     from public.cobro_pagos p join public.cobros k on k.barberia_id = p.barberia_id and k.id = p.cobro_id
                    where k.fecha = v_dia and not k.anulado and p.medio = 'efectivo'),
      'transferencia', (select coalesce(sum(p.monto), 0)
                          from public.cobro_pagos p join public.cobros k on k.barberia_id = p.barberia_id and k.id = p.cobro_id
                         where k.fecha = v_dia and not k.anulado and p.medio = 'transferencia')
    )
  );
end $$;

select public.fn_aplicar_permisos();
