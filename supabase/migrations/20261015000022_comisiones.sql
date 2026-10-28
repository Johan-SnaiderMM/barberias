-- =====================================================================
-- BARBERÍAS · 0022 · COMISIONES (tarea 3.4 · SPEC F7)
--
--   fn_comision_pct(...)              el % que le toca al barbero por una línea del cobro.
--   guardar_comisiones_barbero(...)   fija el % de un barbero y sus excepciones por servicio.
--   fijar_propina_del_barbero(...)    la propina es del barbero (lo normal) o se queda en la barbería.
--   obtener_comisiones_config()       lo que muestra la pantalla de porcentajes.
--
-- REGLAS
--   * Un porcentaje por barbero (0 a 100), con una excepción opcional por servicio. Sin nada guardado: 50 %.
--     Un extra (cera, producto) usa el porcentaje base del barbero.
--   * Se calcula al cobrar y se GUARDA en cada línea del cobro (porcentaje y monto): cambiar el porcentaje después
--     no toca los cobros ya hechos (instantánea).
--   * Redondeo: floor(lo que realmente se cobró de la línea × % / 100), al peso. El resto queda para la barbería, así
--     que comisión + parte de la barbería = lo cobrado por servicios, al peso, con cualquier descuento o pago mixto.
--   * La propina es del barbero o de la barbería según el ajuste del momento; queda guardada en cada cobro.
--   * Los porcentajes son del área "comisiones": solo quien la tiene los ve y los cambia (las tablas no se leen
--     de otra forma, así un barbero no ve lo que gana otro).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------
create table if not exists public.comisiones_barbero (
  barbero_id      uuid primary key,
  barberia_id     uuid not null references public.barberias(id),
  pct             integer not null check (pct between 0 and 100),
  created_at      timestamptz not null default now(),
  actualizado_at  timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  foreign key (barberia_id, barbero_id) references public.barberos (barberia_id, id)
);
comment on table public.comisiones_barbero is 'Porcentaje base de comisión de cada barbero. Sin fila: el de por defecto (fn_comision_defecto).';

create table if not exists public.comisiones_servicio (
  barbero_id      uuid not null,
  servicio_id     uuid not null,
  barberia_id     uuid not null references public.barberias(id),
  pct             integer not null check (pct between 0 and 100),
  created_at      timestamptz not null default now(),
  actualizado_at  timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (barbero_id, servicio_id),
  foreign key (barberia_id, barbero_id)  references public.barberos (barberia_id, id),
  foreign key (barberia_id, servicio_id) references public.servicios (barberia_id, id)
);
create index if not exists idx_comisiones_servicio_servicio on public.comisiones_servicio (barberia_id, servicio_id);
comment on table public.comisiones_servicio is 'Excepción al porcentaje base de un barbero para un servicio.';

alter table public.barberias
  add column if not exists propina_del_barbero boolean not null default true;
comment on column public.barberias.propina_del_barbero is 'true = la propina de cada cobro es del barbero; false = se queda en la barbería. Cada cobro guarda la parte que fue del barbero.';

-- Los porcentajes se leen solo con el área "comisiones" (se escriben únicamente por funciones).
alter table public.comisiones_barbero  enable row level security;
alter table public.comisiones_servicio enable row level security;

drop policy if exists comisiones_barbero_select on public.comisiones_barbero;
create policy comisiones_barbero_select on public.comisiones_barbero
  for select to authenticated
  using (barberia_id = (select public.mi_barberia()) and (select public.tiene_area('comisiones')));

drop policy if exists comisiones_servicio_select on public.comisiones_servicio;
create policy comisiones_servicio_select on public.comisiones_servicio
  for select to authenticated
  using (barberia_id = (select public.mi_barberia()) and (select public.tiene_area('comisiones')));

grant select on public.comisiones_barbero, public.comisiones_servicio to authenticated;

-- ---------------------------------------------------------------------
-- 2. El porcentaje de una línea
-- ---------------------------------------------------------------------
-- Lo que se le paga a un barbero que no tiene porcentaje guardado.
create or replace function public.fn_comision_defecto()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select 50 $$;

-- Excepción del servicio -> porcentaje base del barbero -> el de por defecto. Un extra (sin servicio) usa el base.
-- (Reemplaza el `select 0` provisional de 0019.)
create or replace function public.fn_comision_pct(p_barberia uuid, p_barbero uuid, p_servicio uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select e.pct from public.comisiones_servicio e
      where e.barberia_id = p_barberia and e.barbero_id = p_barbero and e.servicio_id = p_servicio),
    (select c.pct from public.comisiones_barbero c
      where c.barberia_id = p_barberia and c.barbero_id = p_barbero),
    public.fn_comision_defecto())
$$;

-- ---------------------------------------------------------------------
-- 3. Cobrar (copia de la ÚLTIMA versión, la de 0019) con un solo cambio: guarda cuánta propina es del barbero
-- ---------------------------------------------------------------------
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
  v_prop_barbero integer := 0;    -- la parte de la propina que es del barbero (según el ajuste de este momento)
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
  select case when b.propina_del_barbero then v_prop else 0 end into v_prop_barbero
    from public.barberias b where b.id = p_barberia;
  v_prop_barbero := coalesce(v_prop_barbero, 0);
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
                               descuento_motivo, total, propina, comision, propina_barbero)
    values (v_id, p_barberia, p_cita, p_barbero, p_cliente, p_clave, v_subtotal, v_desc, v_motivo, v_total, v_prop, v_comision,
            v_prop_barbero);
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
-- 4. API (área "comisiones")
-- ---------------------------------------------------------------------

-- Fija el porcentaje base de un barbero y deja EXACTAMENTE estas excepciones por servicio (reemplaza las anteriores).
--   p_excepciones = [{"servicio_id": "<uuid>", "pct": 70}, …]
-- Las excepciones de servicios ARCHIVADOS no se tocan (si el servicio se restaura, vuelven solas).
create or replace function public.guardar_comisiones_barbero(p_barbero uuid, p_pct integer, p_excepciones jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('comisiones');
  v_item     jsonb;
  v_servicio uuid;
  v_pct      integer;
  v_ids      uuid[] := '{}';
  v_filas    jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.barberos where barberia_id = v_barberia and id = p_barbero) then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then
    raise exception 'La comisión va de 0 %% a 100 %%.';
  end if;
  if p_excepciones is null or jsonb_typeof(p_excepciones) <> 'array' then
    raise exception 'La lista de excepciones no es válida.';
  end if;
  if jsonb_array_length(p_excepciones) > 100 then
    raise exception 'Son demasiadas excepciones.';
  end if;

  for v_item in select e from jsonb_array_elements(p_excepciones) e loop
    -- Ojo con los NULL: si falta la clave, jsonb_typeof(...) es NULL y la condición no se cumpliría nunca.
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(jsonb_typeof(v_item -> 'servicio_id'), '') <> 'string'
       or (v_item ->> 'servicio_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'La lista de excepciones no es válida.';
    end if;
    v_servicio := (v_item ->> 'servicio_id')::uuid;
    if v_servicio = any (v_ids) then
      raise exception 'Un servicio aparece dos veces en la lista.';
    end if;
    if not exists (select 1 from public.servicios where barberia_id = v_barberia and id = v_servicio and activo) then
      raise exception 'Uno de los servicios no existe o está archivado.';
    end if;
    v_pct := public.fn_json_entero(v_item, 'pct', true);
    if v_pct < 0 or v_pct > 100 then
      raise exception 'La comisión va de 0 %% a 100 %%.';
    end if;
    v_ids := v_ids || v_servicio;
    v_filas := v_filas || jsonb_build_array(jsonb_build_object('servicio_id', v_servicio, 'pct', v_pct));
  end loop;

  insert into public.comisiones_barbero (barberia_id, barbero_id, pct)
  values (v_barberia, p_barbero, p_pct)
  on conflict (barbero_id)
  do update set pct = excluded.pct, actualizado_at = now(), registrado_por = auth.uid();

  -- Quita las excepciones de servicios activos que ya no están en la lista (las de archivados se conservan).
  delete from public.comisiones_servicio e
   where e.barberia_id = v_barberia and e.barbero_id = p_barbero
     and e.servicio_id <> all (v_ids)
     and exists (select 1 from public.servicios s
                  where s.barberia_id = e.barberia_id and s.id = e.servicio_id and s.activo);

  insert into public.comisiones_servicio (barberia_id, barbero_id, servicio_id, pct)
  select v_barberia, p_barbero, (f ->> 'servicio_id')::uuid, (f ->> 'pct')::integer
    from jsonb_array_elements(v_filas) f
  on conflict (barbero_id, servicio_id)
  do update set pct = excluded.pct, actualizado_at = now(), registrado_por = auth.uid();

  return jsonb_build_object('id', p_barbero, 'pct', p_pct, 'excepciones', cardinality(v_ids));
end $$;

-- ¿La propina de los cobros que vienen es del barbero (true) o de la barbería (false)? No toca los cobros ya hechos.
create or replace function public.fijar_propina_del_barbero(p_del_barbero boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('comisiones');
begin
  if p_del_barbero is null then
    raise exception 'Indica de quién es la propina.';
  end if;
  update public.barberias set propina_del_barbero = p_del_barbero where id = v_barberia;
  return jsonb_build_object('propina_del_barbero', p_del_barbero);
end $$;

-- Lo de la pantalla de porcentajes: cada barbero con su porcentaje (y si es el de por defecto o uno guardado),
-- sus excepciones por servicio y el ajuste de la propina.
create or replace function public.obtener_comisiones_config()
returns jsonb
language plpgsql
stable
security definer      -- requerir_area solo la pueden llamar las funciones; todo se filtra por la barbería de quien llama
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('comisiones');
begin
  return jsonb_build_object(
    'defecto', public.fn_comision_defecto(),
    'propina_del_barbero', (select b.propina_del_barbero from public.barberias b where b.id = v_barberia),
    'barberos', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', b.id, 'nombre', b.nombre, 'activo', b.activo,
                 'pct', coalesce(c.pct, public.fn_comision_defecto()),
                 'definido', c.pct is not null,
                 'excepciones', coalesce((
                   select jsonb_agg(jsonb_build_object('servicio_id', e.servicio_id, 'servicio', s.nombre, 'pct', e.pct)
                                    order by s.orden, lower(s.nombre))
                     from public.comisiones_servicio e
                     join public.servicios s on s.barberia_id = e.barberia_id and s.id = e.servicio_id
                    where e.barberia_id = b.barberia_id and e.barbero_id = b.id and s.activo), '[]'::jsonb))
               order by b.activo desc, b.orden, lower(b.nombre))
        from public.barberos b
        left join public.comisiones_barbero c on c.barberia_id = b.barberia_id and c.barbero_id = b.id
       where b.barberia_id = v_barberia), '[]'::jsonb));
end $$;

select public.fn_aplicar_permisos();
