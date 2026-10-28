-- =====================================================================
-- BARBERÍAS · 0006 · BARBEROS Y QUÉ SERVICIOS HACE CADA UNO (tarea 1.2 · SPEC F2)
--
--   * Un barbero es quien atiende: tiene su propia agenda y sus propios horarios (0007). Puede o no tener cuenta
--     en la app (`user_id`, se vincula con la invitación del equipo, tarea 1.9): con cuenta, ve "su" agenda.
--   * barbero_servicios dice QUÉ hace cada barbero, con precio y/o duración propios opcionales (el que tiene
--     más experiencia cobra más, el aprendiz tarda más). Un barbero solo ofrece lo que tiene asignado.
--   * ARCHIVAR en vez de borrar: un barbero inactivo deja de recibir citas, pero su historial queda.
--   * Escritura SOLO por funciones: área "servicios" (catálogo) y "equipo" (vincularlo con una cuenta).
--
-- La comisión por barbero llega en la Fase 3 (F7): no se adelanta aquí.
-- =====================================================================

create table if not exists public.barberos (
  id              uuid primary key default gen_random_uuid(),
  barberia_id     uuid not null references public.barberias(id),
  -- Cuenta del barbero en la app (null = todavía no tiene o no la necesita). Si la persona sale del equipo,
  -- solo se suelta el vínculo: el barbero y su historial se conservan.
  user_id         uuid,
  nombre          text not null check (length(btrim(nombre)) between 1 and 40),
  -- false = no sale en la reserva en línea (sigue en la agenda del personal).
  acepta_reservas boolean not null default true,
  activo          boolean not null default true,
  orden           integer not null default 0,
  created_at      timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  foreign key (barberia_id, user_id) references public.perfiles (barberia_id, user_id) on delete set null (user_id)
);
-- Una persona es, como mucho, un barbero.
create unique index if not exists ux_barberos_user on public.barberos (barberia_id, user_id) where user_id is not null;
-- Dos barberos activos no se llaman igual: el cliente elige por nombre.
create unique index if not exists ux_barberos_nombre on public.barberos (barberia_id, lower(nombre)) where activo;
create index if not exists idx_barberos_barberia on public.barberos (barberia_id, orden);
comment on table public.barberos is 'Quienes atienden en la barbería. Se archivan, no se borran.';

create table if not exists public.barbero_servicios (
  barberia_id     uuid not null references public.barberias(id),
  barbero_id      uuid not null,
  servicio_id     uuid not null,
  -- null = el precio / la duración del catálogo.
  precio_propio   integer check (precio_propio is null or (precio_propio >= 0 and precio_propio <= 10000000)),
  duracion_propia integer check (duracion_propia is null
                                 or (duracion_propia between 5 and 480 and duracion_propia % 5 = 0)),
  created_at      timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (barbero_id, servicio_id),
  foreign key (barberia_id, barbero_id)  references public.barberos (barberia_id, id),
  foreign key (barberia_id, servicio_id) references public.servicios (barberia_id, id)
);
create index if not exists idx_barbero_servicios_servicio on public.barbero_servicios (barberia_id, servicio_id);
comment on table public.barbero_servicios is 'Qué servicios hace cada barbero, con precio/duración propios opcionales.';

alter table public.barberos          enable row level security;
alter table public.barbero_servicios enable row level security;

drop policy if exists barberos_select on public.barberos;
create policy barberos_select on public.barberos
  for select to authenticated using (barberia_id = (select public.mi_barberia()));

drop policy if exists barbero_servicios_select on public.barbero_servicios;
create policy barbero_servicios_select on public.barbero_servicios
  for select to authenticated using (barberia_id = (select public.mi_barberia()));

grant select on public.barberos, public.barbero_servicios to authenticated;

drop trigger if exists trg_bloquear_borrado on public.barberos;
create trigger trg_bloquear_borrado before delete on public.barberos
  for each row execute function public.fn_bloquear_borrado();

-- ---------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------

-- El barbero (activo) que es la persona de la sesión, o null. Lo usan "mi agenda" y las políticas de citas.
create or replace function public.mi_barbero()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.barberos where user_id = auth.uid() and activo
$$;

-- Lee un entero de un objeto jsonb con mensajes en español (sin desbordes ni decimales). null si no viene.
create or replace function public.fn_json_entero(p jsonb, p_clave text, p_requerido boolean default false)
returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v jsonb := p -> p_clave;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_requerido then
      raise exception 'Falta el dato "%".', p_clave;
    end if;
    return null;
  end if;
  if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^-?[0-9]{1,9}$' then
    raise exception 'El dato "%" debe ser un número entero.', p_clave;
  end if;
  return (v #>> '{}')::integer;
end $$;

-- ---------------------------------------------------------------------
-- Escritura (área "servicios"; vincular con una cuenta pide "equipo")
-- ---------------------------------------------------------------------
create or replace function public.crear_barbero(p_nombre text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('servicios');
  v_nombre   text := public.fn_limpiar_texto(p_nombre);
  v_id       uuid;
begin
  if length(v_nombre) = 0 or length(v_nombre) > 40 then
    raise exception 'Escribe el nombre del barbero (máximo 40 caracteres).';
  end if;
  begin
    insert into public.barberos (barberia_id, nombre, orden)
    values (v_barberia, v_nombre,
            coalesce((select max(orden) from public.barberos where barberia_id = v_barberia), 0) + 1)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya tienes un barbero con ese nombre.';
  end;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.actualizar_barbero(p_id uuid, p_nombre text, p_acepta_reservas boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('servicios');
  v_nombre   text := public.fn_limpiar_texto(p_nombre);
begin
  if length(v_nombre) = 0 or length(v_nombre) > 40 then
    raise exception 'Escribe el nombre del barbero (máximo 40 caracteres).';
  end if;
  if p_acepta_reservas is null then
    raise exception 'Indica si recibe reservas en línea.';
  end if;
  begin
    update public.barberos
       set nombre = v_nombre, acepta_reservas = p_acepta_reservas
     where barberia_id = v_barberia and id = p_id;
  exception when unique_violation then
    raise exception 'Ya tienes un barbero con ese nombre.';
  end;
  if not found then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end $$;

-- Archivar (p_activo = false) o restaurar (true).
create or replace function public.fijar_barbero_activo(p_id uuid, p_activo boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('servicios');
begin
  if p_activo is null then
    raise exception 'Indica si el barbero queda activo o archivado.';
  end if;
  begin
    update public.barberos set activo = p_activo where barberia_id = v_barberia and id = p_id;
  exception when unique_violation then
    raise exception 'Ya hay un barbero activo con ese nombre. Cámbiale el nombre a uno de los dos.';
  end;
  if not found then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id, 'activo', p_activo);
end $$;

-- Deja asignados EXACTAMENTE estos servicios activos al barbero (reemplaza lo anterior).
--   p_servicios = [{"servicio_id": "<uuid>", "precio_propio": 20000 | null, "duracion_propia": 45 | null}, …]
-- Las asignaciones a servicios ARCHIVADOS no se tocan (si el servicio se restaura, vuelven solas).
create or replace function public.asignar_servicios_barbero(p_barbero uuid, p_servicios jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('servicios');
  v_item     jsonb;
  v_servicio uuid;
  v_precio   integer;
  v_duracion integer;
  v_ids      uuid[] := '{}';
  v_filas    jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.barberos where barberia_id = v_barberia and id = p_barbero) then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  if p_servicios is null or jsonb_typeof(p_servicios) <> 'array' then
    raise exception 'La lista de servicios no es válida.';
  end if;
  if jsonb_array_length(p_servicios) > 100 then
    raise exception 'Son demasiados servicios.';
  end if;

  for v_item in select e from jsonb_array_elements(p_servicios) e loop
    -- Ojo con los NULL: si falta la clave, jsonb_typeof(...) es NULL y la condición no se cumpliría nunca.
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(jsonb_typeof(v_item -> 'servicio_id'), '') <> 'string'
       or (v_item ->> 'servicio_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'La lista de servicios no es válida.';
    end if;
    v_servicio := (v_item ->> 'servicio_id')::uuid;
    if v_servicio = any (v_ids) then
      raise exception 'Un servicio aparece dos veces en la lista.';
    end if;
    if not exists (select 1 from public.servicios where barberia_id = v_barberia and id = v_servicio and activo) then
      raise exception 'Uno de los servicios no existe o está archivado.';
    end if;
    v_precio := public.fn_json_entero(v_item, 'precio_propio');
    v_duracion := public.fn_json_entero(v_item, 'duracion_propia');
    if v_precio is not null and (v_precio < 0 or v_precio > 10000000) then
      raise exception 'El precio propio debe estar entre $ 0 y $ 10.000.000.';
    end if;
    if v_duracion is not null and (v_duracion < 5 or v_duracion > 480 or v_duracion % 5 <> 0) then
      raise exception 'La duración propia debe ser de 5 a 480 minutos, de 5 en 5.';
    end if;
    v_ids := v_ids || v_servicio;
    v_filas := v_filas || jsonb_build_array(jsonb_build_object(
      'servicio_id', v_servicio, 'precio_propio', v_precio, 'duracion_propia', v_duracion));
  end loop;

  -- Quita los activos que ya no están en la lista (los archivados se conservan).
  delete from public.barbero_servicios bs
   where bs.barberia_id = v_barberia and bs.barbero_id = p_barbero
     and bs.servicio_id <> all (v_ids)
     and exists (select 1 from public.servicios s
                  where s.barberia_id = bs.barberia_id and s.id = bs.servicio_id and s.activo);

  insert into public.barbero_servicios (barberia_id, barbero_id, servicio_id, precio_propio, duracion_propia)
  select v_barberia, p_barbero, (f ->> 'servicio_id')::uuid,
         nullif(f ->> 'precio_propio', '')::integer, nullif(f ->> 'duracion_propia', '')::integer
    from jsonb_array_elements(v_filas) f
  on conflict (barbero_id, servicio_id)
  do update set precio_propio = excluded.precio_propio, duracion_propia = excluded.duracion_propia;

  return jsonb_build_object('id', p_barbero, 'servicios', cardinality(v_ids));
end $$;

-- Vincula al barbero con la cuenta de alguien del equipo (o la suelta con null). Pide el área "equipo".
create or replace function public.vincular_barbero_usuario(p_barbero uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('equipo');
begin
  if p_user_id is not null and not exists (
       select 1 from public.perfiles where barberia_id = v_barberia and user_id = p_user_id) then
    raise exception 'Esa persona no es de tu equipo.';
  end if;
  begin
    update public.barberos set user_id = p_user_id where barberia_id = v_barberia and id = p_barbero;
  exception when unique_violation then
    raise exception 'Esa persona ya está vinculada con otro barbero.';
  end;
  if not found then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_barbero, 'user_id', p_user_id);
end $$;

-- ---------------------------------------------------------------------
-- Lectura (RLS: cada quien ve solo los de su barbería). Activos primero, en el orden en que se crearon.
-- ---------------------------------------------------------------------
create or replace function public.listar_barberos(p_con_archivados boolean default false)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'nombre', b.nombre,
        'user_id', b.user_id,
        'acepta_reservas', b.acepta_reservas,
        'activo', b.activo,
        'orden', b.orden,
        'servicios', coalesce((
          select jsonb_agg(
                   jsonb_build_object('servicio_id', bs.servicio_id, 'precio_propio', bs.precio_propio,
                                      'duracion_propia', bs.duracion_propia)
                   order by s.orden, lower(s.nombre))
            from public.barbero_servicios bs
            join public.servicios s on s.barberia_id = bs.barberia_id and s.id = bs.servicio_id
           where bs.barberia_id = b.barberia_id and bs.barbero_id = b.id), '[]'::jsonb))
      order by b.activo desc, b.orden, lower(b.nombre)),
    '[]'::jsonb)
    from public.barberos b
   where coalesce(p_con_archivados, false) or b.activo
$$;

select public.fn_aplicar_permisos();
