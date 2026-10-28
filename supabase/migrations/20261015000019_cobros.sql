-- =====================================================================
-- BARBERÍAS · 0019 · COBROS Y PAGOS (tarea 3.1 · SPEC F6)
--
--   cobrar_cita(...)    cobra una cita: servicios (editables) + extras + descuento con motivo + propina.
--   cobrar_venta(...)   cobra algo SIN cita (llegó, se atendió y se pagó): hay que decir qué barbero lo hizo.
--   obtener_cobro(id)   un cobro con sus líneas y sus pagos.
--
-- REGLAS
--   * Pesos enteros. Un cobro es: líneas (servicios y extras) − descuento = total; la propina va aparte.
--     Los pagos (efectivo con vuelto, Nequi/transferencia, o parte y parte) suman EXACTAMENTE total + propina.
--   * No hay doble cobro: cada cobro lleva una clave de idempotencia (la pantalla la crea al abrirse; repetirla
--     devuelve el mismo cobro) y una cita solo puede tener UN cobro vigente (índice único).
--   * Una cita cancelada o que no asistió no se cobra. Cobrar deja la cita `atendida`.
--   * El descuento se reparte entre las líneas en proporción a su precio (el sobrante de redondeo, a las líneas con
--     mayor fracción): la parte de cada línea queda guardada y las partes suman el descuento al peso.
--   * Todo lo que se registra se conserva: un cobro no se edita ni se borra, se anula con motivo (tarea 3.3).
--   * Permiso: área "caja". Se lee con RLS: "caja", "cierre" y "comisiones" ven todos; el barbero (mi_agenda), los suyos.
--   * Las comisiones (3.4) se calculan aquí mismo, al cobrar, con fn_comision_pct; por ahora es 0 %.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ayudantes
-- ---------------------------------------------------------------------

-- 12500 -> '$ 12.500' (para los mensajes de error).
create or replace function public.fn_pesos(n integer)
returns text
language sql
immutable
set search_path = ''
as $$ select '$ ' || replace(to_char(n, 'FM999,999,999,999'), ',', '.') $$;

-- Motivo de una anulación: obligatorio, sin espacios de más, recortado a 200 caracteres.
create or replace function public.fn_motivo(p_motivo text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := left(public.fn_limpiar_texto(p_motivo), 200);
begin
  if length(v) = 0 then
    raise exception 'Escribe el motivo de la anulación.';
  end if;
  return v;
end $$;

-- A qué día pertenece lo que se registra en un instante (por ahora, el día de Bogotá; el cierre del día, en 3.7,
-- pasa lo que se registre después de cerrar al día siguiente).
create or replace function public.fn_jornada(p_barberia uuid, p_ts timestamptz)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select public.fecha_bogota(p_ts) $$;

-- Porcentaje de comisión de una línea (servicio o extra) del barbero. 3.4 lo llena con las reglas de F7.
create or replace function public.fn_comision_pct(p_barberia uuid, p_barbero uuid, p_servicio uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select 0 $$;

-- Cualquier cambio a algo ya registrado se rechaza con un mensaje claro.
create or replace function public.fn_bloquear_edicion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Lo que ya se cobró no se edita: anula el cobro con motivo y vuelve a cobrar.' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------
-- 2. Tablas
-- ---------------------------------------------------------------------
create table if not exists public.cobros (
  id              uuid primary key default gen_random_uuid(),
  barberia_id     uuid not null references public.barberias(id),
  cita_id         uuid,                                   -- null = venta sin cita
  barbero_id      uuid not null,                          -- quién atendió (de ahí sale su comisión)
  cliente_id      uuid,
  clave           uuid not null,                          -- idempotencia: la crea la pantalla al abrirse
  subtotal        integer not null check (subtotal >= 0), -- líneas, antes del descuento
  descuento       integer not null default 0,
  descuento_motivo text,
  total           integer not null,                       -- subtotal − descuento
  propina         integer not null default 0 check (propina >= 0 and propina <= 1000000),
  comision        integer not null default 0,             -- suma de las comisiones de las líneas (instantánea, 3.4)
  propina_barbero integer not null default 0,             -- la parte de la propina que es del barbero (3.4)
  fecha           date not null,                          -- el día al que pertenece (lo pone fn_jornada)
  anulado         boolean not null default false,
  anulado_motivo  text,
  anulado_por     uuid references auth.users(id) on delete set null,
  anulado_at      timestamptz,
  created_at      timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  constraint ux_cobros_clave unique (barberia_id, clave),
  foreign key (barberia_id, cita_id)    references public.citas (barberia_id, id),
  foreign key (barberia_id, barbero_id) references public.barberos (barberia_id, id),
  foreign key (barberia_id, cliente_id) references public.clientes (barberia_id, id),
  constraint chk_cobro_montos check (descuento between 0 and subtotal and total = subtotal - descuento),
  constraint chk_cobro_descuento_motivo check (descuento = 0 or length(btrim(coalesce(descuento_motivo, ''))) > 0),
  constraint chk_cobro_comision check (comision between 0 and total and propina_barbero between 0 and propina),
  constraint chk_cobro_anulacion check (
    (anulado = false and anulado_motivo is null and anulado_at is null)
    or (anulado = true and length(btrim(coalesce(anulado_motivo, ''))) > 0 and anulado_at is not null)
  )
);
-- Una cita solo puede tener UN cobro vigente: para cobrarla otra vez hay que anular el anterior.
create unique index if not exists ux_cobro_cita_vigente on public.cobros (barberia_id, cita_id) where cita_id is not null and not anulado;
create index if not exists idx_cobros_fecha on public.cobros (barberia_id, fecha) where not anulado;
create index if not exists idx_cobros_barbero on public.cobros (barberia_id, barbero_id, fecha) where not anulado;
comment on table public.cobros is 'Cobros de citas y ventas sin cita. No se editan ni se borran: se anulan con motivo.';

create table if not exists public.cobro_items (
  id              uuid primary key default gen_random_uuid(),
  barberia_id     uuid not null references public.barberias(id),
  cobro_id        uuid not null,
  orden           smallint not null,
  tipo            text not null check (tipo in ('servicio', 'extra')),
  servicio_id     uuid,                                   -- solo en los servicios
  nombre          text not null check (length(btrim(nombre)) between 1 and 60),   -- copiado del catálogo al cobrar
  precio          integer not null check (precio >= 0 and precio <= 10000000),    -- lo que se cobró por la línea
  precio_lista    integer check (precio_lista is null or precio_lista >= 0),     -- el del catálogo (servicios): se ve si se cambió
  descuento       integer not null default 0,             -- la parte del descuento del cobro que le tocó a esta línea
  comision_pct    integer not null default 0 check (comision_pct between 0 and 100),   -- instantánea (3.4)
  comision        integer not null default 0,
  created_at      timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  foreign key (barberia_id, cobro_id)    references public.cobros (barberia_id, id),
  foreign key (barberia_id, servicio_id) references public.servicios (barberia_id, id),
  constraint chk_item_tipo check ((tipo = 'servicio' and servicio_id is not null) or (tipo = 'extra' and servicio_id is null)),
  constraint chk_item_montos check (descuento between 0 and precio and comision between 0 and precio - descuento)
);
create index if not exists idx_cobro_items_cobro on public.cobro_items (barberia_id, cobro_id);
comment on table public.cobro_items is 'Líneas de un cobro: servicios (precio editable) y extras con nombre y precio.';

create table if not exists public.cobro_pagos (
  id              uuid primary key default gen_random_uuid(),
  barberia_id     uuid not null references public.barberias(id),
  cobro_id        uuid not null,
  medio           text not null check (medio in ('efectivo', 'transferencia')),   -- transferencia = Nequi / Daviplata / banco
  monto           integer not null check (monto > 0),     -- lo aplicado al cobro (ya sin el vuelto)
  recibido        integer check (recibido is null or recibido > 0),
  vuelto          integer check (vuelto is null or vuelto >= 0),
  referencia      text check (referencia is null or length(btrim(referencia)) between 1 and 60),
  created_at      timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  foreign key (barberia_id, cobro_id) references public.cobros (barberia_id, id),
  constraint chk_pago_efectivo check (
    (medio = 'efectivo' and recibido is not null and vuelto is not null and recibido >= monto and vuelto = recibido - monto)
    or (medio = 'transferencia' and recibido is null and vuelto is null)
  )
);
create index if not exists idx_cobro_pagos_cobro on public.cobro_pagos (barberia_id, cobro_id);
comment on table public.cobro_pagos is 'Cómo se pagó un cobro. Un cobro anulado anula también sus pagos (ya no cuentan).';

-- Fecha del cobro al insertarlo.
create or replace function public.fn_cobro_fecha()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.fecha := public.fn_jornada(new.barberia_id, coalesce(new.created_at, now()));
  return new;
end $$;

drop trigger if exists trg_cobro_fecha on public.cobros;
create trigger trg_cobro_fecha before insert on public.cobros
  for each row execute function public.fn_cobro_fecha();

-- De un cobro solo cambian la anulación (y, en 3.5 y 3.7, su liquidación y su fecha): lo cobrado no se edita.
create or replace function public.fn_cobro_inmutables()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.barberia_id is distinct from old.barberia_id
     or new.cita_id is distinct from old.cita_id
     or new.barbero_id is distinct from old.barbero_id
     or new.cliente_id is distinct from old.cliente_id
     or new.clave is distinct from old.clave
     or new.subtotal is distinct from old.subtotal
     or new.descuento is distinct from old.descuento
     or new.descuento_motivo is distinct from old.descuento_motivo
     or new.total is distinct from old.total
     or new.propina is distinct from old.propina
     or new.comision is distinct from old.comision
     or new.propina_barbero is distinct from old.propina_barbero
     or new.created_at is distinct from old.created_at then
    raise exception 'Lo que ya se cobró no se edita: anula el cobro con motivo y vuelve a cobrar.' using errcode = '42501';
  end if;
  if old.anulado and not new.anulado then
    raise exception 'Un cobro anulado no se reactiva: se cobra de nuevo.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_cobro_inmutables on public.cobros;
create trigger trg_cobro_inmutables before update on public.cobros
  for each row execute function public.fn_cobro_inmutables();

drop trigger if exists trg_bloquear_edicion on public.cobro_items;
create trigger trg_bloquear_edicion before update on public.cobro_items
  for each row execute function public.fn_bloquear_edicion();
drop trigger if exists trg_bloquear_edicion on public.cobro_pagos;
create trigger trg_bloquear_edicion before update on public.cobro_pagos
  for each row execute function public.fn_bloquear_edicion();

drop trigger if exists trg_bloquear_borrado on public.cobros;
create trigger trg_bloquear_borrado before delete on public.cobros
  for each row execute function public.fn_bloquear_borrado();
drop trigger if exists trg_bloquear_borrado on public.cobro_items;
create trigger trg_bloquear_borrado before delete on public.cobro_items
  for each row execute function public.fn_bloquear_borrado();
drop trigger if exists trg_bloquear_borrado on public.cobro_pagos;
create trigger trg_bloquear_borrado before delete on public.cobro_pagos
  for each row execute function public.fn_bloquear_borrado();

-- ---------------------------------------------------------------------
-- 3. Lectura (RLS): "caja", "cierre" y "comisiones" ven todos los cobros; el barbero, solo los suyos
-- ---------------------------------------------------------------------
alter table public.cobros enable row level security;
alter table public.cobro_items enable row level security;
alter table public.cobro_pagos enable row level security;

drop policy if exists cobros_select on public.cobros;
create policy cobros_select on public.cobros
  for select to authenticated
  using (
    barberia_id = (select public.mi_barberia())
    and (
      (select public.tiene_area('caja', 'cierre', 'comisiones'))
      or ((select public.tiene_area('mi_agenda')) and barbero_id = (select public.mi_barbero()))
    )
  );

-- Las líneas y los pagos se ven si se ve su cobro (la política de cobros también corre aquí).
drop policy if exists cobro_items_select on public.cobro_items;
create policy cobro_items_select on public.cobro_items
  for select to authenticated
  using (
    barberia_id = (select public.mi_barberia())
    and exists (select 1 from public.cobros c where c.barberia_id = cobro_items.barberia_id and c.id = cobro_items.cobro_id)
  );

drop policy if exists cobro_pagos_select on public.cobro_pagos;
create policy cobro_pagos_select on public.cobro_pagos
  for select to authenticated
  using (
    barberia_id = (select public.mi_barberia())
    and exists (select 1 from public.cobros c where c.barberia_id = cobro_pagos.barberia_id and c.id = cobro_pagos.cobro_id)
  );

grant select on public.cobros, public.cobro_items, public.cobro_pagos to authenticated;

-- ---------------------------------------------------------------------
-- 4. El resultado de un cobro (lo mismo al cobrar que al repetir la clave)
-- ---------------------------------------------------------------------
create or replace function public.fn_resultado_cobro(p_barberia uuid, p_id uuid, p_ya boolean)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'ok', true, 'ya_existia', p_ya, 'id', c.id, 'cita_id', c.cita_id,
           'subtotal', c.subtotal, 'descuento', c.descuento, 'total', c.total, 'propina', c.propina,
           'cobrado', c.total + c.propina,
           'vuelto', coalesce((select sum(p.vuelto) from public.cobro_pagos p where p.barberia_id = c.barberia_id and p.cobro_id = c.id), 0),
           'comision', c.comision, 'fecha', c.fecha, 'anulado', c.anulado)
    from public.cobros c
   where c.barberia_id = p_barberia and c.id = p_id
$$;

-- ---------------------------------------------------------------------
-- 5. Cobrar (lo comparten cobrar_cita y cobrar_venta)
-- ---------------------------------------------------------------------
--   p_items: [{"servicio_id": uuid, "precio"?: n}, {"nombre": "Cera", "precio": 8000}, ...]
--            Un servicio sin precio usa el de la cita (si es el de la cita) o el del catálogo para ese barbero.
--   p_pagos: [{"medio": "efectivo"|"transferencia", "monto": n, "recibido"?: n, "referencia"?: "..."}]
create or replace function public.fn_cobrar(
  p_barberia uuid, p_cita uuid, p_barbero uuid, p_cliente uuid, p_clave uuid,
  p_items jsonb, p_descuento integer, p_motivo text, p_propina integer, p_pagos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev     record;
  v_cita_est text;                -- datos de la cita (null si es una venta sin cita)
  v_cita_srv uuid;
  v_cita_pre integer;
  v_barbero  record;
  v_items    jsonb := p_items;
  v_el       jsonb;
  v_n        integer := 0;
  i          integer;
  v_sid      uuid;
  v_nombre   text;
  v_precio   integer;
  v_lista    integer;
  v_serv     record;
  v_asig     record;
  a_tipo     text[] := '{}';
  a_sid      uuid[] := '{}';
  a_nombre   text[] := '{}';
  a_precio   integer[] := '{}';
  a_lista    integer[] := '{}';
  a_desc     integer[] := '{}';
  a_pct      integer[] := '{}';
  a_com      integer[] := '{}';
  v_subtotal integer := 0;
  v_desc     integer := coalesce(p_descuento, 0);
  v_motivo   text := nullif(left(public.fn_limpiar_texto(p_motivo), 120), '');
  v_total    integer;
  v_prop     integer := coalesce(p_propina, 0);
  v_debido   integer;
  v_resto    integer;
  v_comision integer := 0;
  v_pago     jsonb;
  v_medio    text;
  v_monto    integer;
  v_rec      integer;
  v_ref      text;
  v_suma     integer := 0;
  m_medio    text[] := '{}';
  m_monto    integer[] := '{}';
  m_rec      integer[] := '{}';
  m_ref      text[] := '{}';
  v_id       uuid := gen_random_uuid();
begin
  if p_clave is null then
    raise exception 'Falta la clave del cobro. Recarga la pantalla e intenta de nuevo.';
  end if;

  -- Repetir la misma clave (doble toque, mala señal, reintento) devuelve el cobro que ya se hizo.
  select c.id into v_prev from public.cobros c where c.barberia_id = p_barberia and c.clave = p_clave;
  if found then
    return public.fn_resultado_cobro(p_barberia, v_prev.id, true);
  end if;

  if p_cita is not null then
    select c.barbero_id, c.cliente_id, c.servicio_id, c.estado, c.precio
      into p_barbero, p_cliente, v_cita_srv, v_cita_est, v_cita_pre
      from public.citas c where c.barberia_id = p_barberia and c.id = p_cita
       for update;
    if not found then
      raise exception 'No existe esa cita.' using errcode = 'P0002';
    end if;
    if v_cita_est in ('cancelada', 'no_asistio') then
      raise exception 'Una cita % no se cobra. Reactívala primero si sí se atendió.', public.fn_texto_estado(v_cita_est);
    end if;
    if exists (select 1 from public.cobros c where c.barberia_id = p_barberia and c.cita_id = p_cita and not c.anulado) then
      raise exception 'Esta cita ya está cobrada.';
    end if;
    -- "Cobrar tal cual": sin líneas, el servicio de la cita al precio con el que se agendó.
    if v_items is null then
      v_items := jsonb_build_array(jsonb_build_object('servicio_id', v_cita_srv));
    end if;
  else
    select b.nombre, b.activo into v_barbero from public.barberos b where b.barberia_id = p_barberia and b.id = p_barbero;
    if not found then
      raise exception 'No existe ese barbero.' using errcode = 'P0002';
    end if;
    if not v_barbero.activo then
      raise exception '% ya no está activo.', v_barbero.nombre;
    end if;
    if p_cliente is not null
       and not exists (select 1 from public.clientes cl where cl.barberia_id = p_barberia and cl.id = p_cliente and cl.activo) then
      raise exception 'No existe ese cliente.' using errcode = 'P0002';
    end if;
  end if;

  -- Líneas ----------------------------------------------------------------
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Agrega al menos un servicio o un extra al cobro.';
  end if;
  if jsonb_array_length(v_items) > 20 then
    raise exception 'Un cobro lleva máximo 20 líneas.';
  end if;

  for v_el in select value from jsonb_array_elements(v_items) loop
    v_n := v_n + 1;
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'Una línea del cobro no es válida.';
    end if;
    begin
      v_sid := nullif(v_el ->> 'servicio_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'El servicio de una línea no es válido.';
    end;
    v_precio := public.fn_json_entero(v_el, 'precio');

    if v_sid is not null then
      select s.nombre, s.activo, s.precio into v_serv
        from public.servicios s where s.barberia_id = p_barberia and s.id = v_sid;
      if not found then
        raise exception 'No existe ese servicio.' using errcode = 'P0002';
      end if;
      if not v_serv.activo and v_sid is distinct from v_cita_srv then
        raise exception 'El servicio % está archivado.', v_serv.nombre;
      end if;
      if v_sid is not distinct from v_cita_srv then
        v_lista := v_cita_pre;               -- el precio con el que se agendó (no cambia aunque cambie el catálogo)
      else
        select bs.precio_propio into v_asig
          from public.barbero_servicios bs where bs.barbero_id = p_barbero and bs.servicio_id = v_sid;
        v_lista := coalesce(v_asig.precio_propio, v_serv.precio);
      end if;
      v_nombre := v_serv.nombre;
      v_precio := coalesce(v_precio, v_lista);
      a_tipo := array_append(a_tipo, 'servicio');
    else
      v_nombre := public.fn_limpiar_texto(v_el ->> 'nombre');
      if length(v_nombre) = 0 or length(v_nombre) > 60 then
        raise exception 'Escribe el nombre del extra (máximo 60 letras).';
      end if;
      if v_precio is null or v_precio <= 0 then
        raise exception 'El extra «%» necesita un precio.', v_nombre;
      end if;
      v_lista := null;
      a_tipo := array_append(a_tipo, 'extra');
    end if;

    if v_precio < 0 or v_precio > 10000000 then
      raise exception 'El precio de «%» no es válido.', v_nombre;
    end if;
    a_sid := array_append(a_sid, v_sid);
    a_nombre := array_append(a_nombre, v_nombre);
    a_precio := array_append(a_precio, v_precio);
    a_lista := array_append(a_lista, v_lista);
    v_subtotal := v_subtotal + v_precio;
  end loop;

  -- Descuento: con motivo, y repartido entre las líneas -------------------------------------------------------
  if v_desc < 0 or v_desc > v_subtotal then
    raise exception 'El descuento no puede ser mayor que lo que se cobra (%).', public.fn_pesos(v_subtotal);
  end if;
  if v_desc > 0 and v_motivo is null then
    raise exception 'Escribe el motivo del descuento.';
  end if;
  if v_desc = 0 then
    v_motivo := null;
  end if;
  v_total := v_subtotal - v_desc;

  for i in 1 .. v_n loop
    a_desc := array_append(a_desc, 0);
  end loop;
  if v_desc > 0 then
    for i in 1 .. v_n loop
      a_desc[i] := ((v_desc::bigint * a_precio[i]) / v_subtotal)::integer;     -- parte entera
    end loop;
    v_resto := v_desc - (select coalesce(sum(x), 0) from unnest(a_desc) as x);
    -- El sobrante, de a un peso, a las líneas con mayor fracción (a igual fracción, la primera).
    for i in select g from generate_subscripts(a_precio, 1) as g
              order by (v_desc::bigint * a_precio[g]) % v_subtotal desc, g
              limit v_resto loop
      a_desc[i] := a_desc[i] + 1;
    end loop;
  end if;

  -- Comisiones (instantánea): sobre lo que realmente se cobró de cada línea, al peso hacia abajo.
  for i in 1 .. v_n loop
    a_pct := array_append(a_pct, public.fn_comision_pct(p_barberia, p_barbero, a_sid[i]));
    a_com := array_append(a_com, (((a_precio[i] - a_desc[i])::bigint * a_pct[i]) / 100)::integer);
    v_comision := v_comision + a_com[i];
  end loop;

  -- Propina y pagos --------------------------------------------------------------------------------------------
  if v_prop < 0 or v_prop > 1000000 then
    raise exception 'La propina no es válida.';
  end if;
  v_debido := v_total + v_prop;

  if v_debido = 0 then
    if p_pagos is not null and jsonb_typeof(p_pagos) = 'array' and jsonb_array_length(p_pagos) > 0 then
      raise exception 'No hay nada que cobrar: quita los pagos.';
    end if;
  else
    if p_pagos is null or jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
      raise exception 'Elige cómo se paga.';
    end if;
    for v_pago in select value from jsonb_array_elements(p_pagos) loop
      if jsonb_typeof(v_pago) <> 'object' then
        raise exception 'Un pago no es válido.';
      end if;
      v_medio := v_pago ->> 'medio';
      if v_medio is null or v_medio not in ('efectivo', 'transferencia') then
        raise exception 'El medio de pago no es válido.';
      end if;
      v_monto := public.fn_json_entero(v_pago, 'monto', true);
      if v_monto <= 0 then
        raise exception 'El valor de cada pago debe ser mayor que cero.';
      end if;
      v_rec := null;
      v_ref := null;
      if v_medio = 'efectivo' then
        v_rec := coalesce(public.fn_json_entero(v_pago, 'recibido'), v_monto);
        if v_rec < v_monto then
          raise exception 'El efectivo recibido (%) no alcanza para lo que se cobra en efectivo (%).',
            public.fn_pesos(v_rec), public.fn_pesos(v_monto);
        end if;
      else
        v_ref := nullif(left(public.fn_limpiar_texto(v_pago ->> 'referencia'), 60), '');
      end if;
      m_medio := array_append(m_medio, v_medio);
      m_monto := array_append(m_monto, v_monto);
      m_rec := array_append(m_rec, v_rec);
      m_ref := array_append(m_ref, v_ref);
      v_suma := v_suma + v_monto;
    end loop;
    if v_suma <> v_debido then
      raise exception 'Los pagos suman % y el total a cobrar es %.', public.fn_pesos(v_suma), public.fn_pesos(v_debido);
    end if;
  end if;

  -- Guardar -------------------------------------------------------------------------------------------------
  begin
    insert into public.cobros (id, barberia_id, cita_id, barbero_id, cliente_id, clave, subtotal, descuento,
                               descuento_motivo, total, propina, comision)
    values (v_id, p_barberia, p_cita, p_barbero, p_cliente, p_clave, v_subtotal, v_desc, v_motivo, v_total, v_prop, v_comision);
  exception when unique_violation then
    -- Dos toques a la vez con la misma clave, o la cita se cobró un instante antes.
    select c.id into v_prev from public.cobros c where c.barberia_id = p_barberia and c.clave = p_clave;
    if found then
      return public.fn_resultado_cobro(p_barberia, v_prev.id, true);
    end if;
    raise exception 'Esta cita ya está cobrada.';
  end;

  for i in 1 .. v_n loop
    insert into public.cobro_items (barberia_id, cobro_id, orden, tipo, servicio_id, nombre, precio, precio_lista,
                                    descuento, comision_pct, comision)
    values (p_barberia, v_id, i, a_tipo[i], a_sid[i], a_nombre[i], a_precio[i], a_lista[i], a_desc[i], a_pct[i], a_com[i]);
  end loop;

  for i in 1 .. coalesce(array_length(m_medio, 1), 0) loop
    insert into public.cobro_pagos (barberia_id, cobro_id, medio, monto, recibido, vuelto, referencia)
    values (p_barberia, v_id, m_medio[i], m_monto[i], m_rec[i], case when m_medio[i] = 'efectivo' then m_rec[i] - m_monto[i] end, m_ref[i]);
  end loop;

  -- Lo cobrado ya se atendió.
  if p_cita is not null then
    update public.citas set estado = 'atendida'
     where barberia_id = p_barberia and id = p_cita and estado in ('confirmada', 'en_atencion');
  end if;

  return public.fn_resultado_cobro(p_barberia, v_id, false);
end $$;

-- ---------------------------------------------------------------------
-- 6. API del personal (área "caja")
-- ---------------------------------------------------------------------

-- Cobra una cita. Sin p_items cobra su servicio tal cual; con p_items, las líneas que lleguen.
create or replace function public.cobrar_cita(
  p_cita uuid, p_clave uuid, p_items jsonb default null, p_descuento integer default 0,
  p_descuento_motivo text default null, p_propina integer default 0, p_pagos jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('caja');
begin
  return public.fn_cobrar(v_barberia, p_cita, null, null, p_clave, p_items, p_descuento, p_descuento_motivo, p_propina, p_pagos);
end $$;

-- Cobra algo sin cita: hay que decir qué barbero lo hizo (de ahí sale su comisión).
create or replace function public.cobrar_venta(
  p_barbero uuid, p_clave uuid, p_items jsonb, p_cliente uuid default null, p_descuento integer default 0,
  p_descuento_motivo text default null, p_propina integer default 0, p_pagos jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('caja');
begin
  return public.fn_cobrar(v_barberia, null, p_barbero, p_cliente, p_clave, p_items, p_descuento, p_descuento_motivo, p_propina, p_pagos);
end $$;

-- Un cobro con sus líneas y sus pagos (null si no existe o no lo puede ver quien pregunta: RLS).
create or replace function public.obtener_cobro(p_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'id', c.id, 'cita_id', c.cita_id,
           'barbero_id', c.barbero_id, 'barbero', b.nombre,
           'cliente_id', c.cliente_id, 'cliente', cl.nombre,
           'subtotal', c.subtotal, 'descuento', c.descuento, 'descuento_motivo', c.descuento_motivo,
           'total', c.total, 'propina', c.propina, 'comision', c.comision, 'propina_barbero', c.propina_barbero,
           'fecha', c.fecha, 'created_at', c.created_at,
           'anulado', c.anulado, 'anulado_motivo', c.anulado_motivo, 'anulado_at', c.anulado_at,
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', i.id, 'tipo', i.tipo, 'servicio_id', i.servicio_id, 'nombre', i.nombre, 'precio', i.precio,
                      'precio_lista', i.precio_lista, 'descuento', i.descuento, 'comision_pct', i.comision_pct,
                      'comision', i.comision) order by i.orden)
               from public.cobro_items i where i.barberia_id = c.barberia_id and i.cobro_id = c.id), '[]'::jsonb),
           'pagos', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', p.id, 'medio', p.medio, 'monto', p.monto, 'recibido', p.recibido, 'vuelto', p.vuelto,
                      'referencia', p.referencia) order by p.created_at, p.id)
               from public.cobro_pagos p where p.barberia_id = c.barberia_id and p.cobro_id = c.id), '[]'::jsonb))
    from public.cobros c
    join public.barberos b on b.barberia_id = c.barberia_id and b.id = c.barbero_id
    left join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
   where c.id = p_id
$$;

select public.fn_aplicar_permisos();
