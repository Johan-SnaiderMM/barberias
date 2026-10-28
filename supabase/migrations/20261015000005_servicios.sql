-- =====================================================================
-- BARBERÍAS · 0005 · SERVICIOS Y PRECIOS (tarea 1.1 · SPEC F2)
--
--   * Un servicio es lo que se vende y se agenda: "Corte", "Barba", "Corte + barba" (un combo es un servicio más).
--     Precio en pesos ENTEROS y duración en minutos (de 5 en 5): la duración decide cuánto ocupa la cita.
--   * ARCHIVAR en vez de borrar: un servicio archivado (activo = false) deja de ofrecerse, pero las citas y los
--     cobros viejos lo siguen mostrando. El borrado está bloqueado por trigger.
--   * El nombre es único entre los servicios activos de la barbería (sin distinguir mayúsculas ni espacios de más).
--   * Escritura SOLO por funciones (área "servicios"); lectura para todo el equipo de la barbería.
--
-- Más adelante (1.4) cada cita COPIA el precio y la duración al crearse: cambiar el catálogo no reescribe el pasado.
-- =====================================================================

-- Texto limpio: sin espacios al borde ni repetidos ("  Corte   y barba " -> "Corte y barba").
create or replace function public.fn_limpiar_texto(p_texto text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$ select btrim(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g')) $$;

create table if not exists public.servicios (
  id             uuid primary key default gen_random_uuid(),
  barberia_id    uuid not null references public.barberias(id),
  nombre         text not null check (length(btrim(nombre)) between 1 and 60),
  precio         integer not null check (precio >= 0 and precio <= 10000000),                    -- COP enteros
  duracion_min   integer not null check (duracion_min between 5 and 480 and duracion_min % 5 = 0),
  activo         boolean not null default true,      -- archivado = false (no se borra: hay citas y cobros que lo usan)
  orden          integer not null default 0,
  created_at     timestamptz not null default now(),
  registrado_por uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id)
);
create unique index if not exists ux_servicios_nombre on public.servicios (barberia_id, lower(nombre)) where activo;
create index if not exists idx_servicios_barberia on public.servicios (barberia_id, orden);
comment on table public.servicios is 'Catálogo de servicios de la barbería (precio y duración). Se archiva, no se borra.';

alter table public.servicios enable row level security;

drop policy if exists servicios_select on public.servicios;
create policy servicios_select on public.servicios
  for select to authenticated using (barberia_id = (select public.mi_barberia()));

grant select on public.servicios to authenticated;

drop trigger if exists trg_bloquear_borrado on public.servicios;
create trigger trg_bloquear_borrado before delete on public.servicios
  for each row execute function public.fn_bloquear_borrado();

-- ---------------------------------------------------------------------
-- Validación común (los mismos límites que los check de la tabla, con mensajes en español)
-- ---------------------------------------------------------------------
create or replace function public.fn_validar_servicio(p_nombre text, p_precio integer, p_duracion_min integer)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if length(p_nombre) = 0 or length(p_nombre) > 60 then
    raise exception 'Escribe el nombre del servicio (máximo 60 caracteres).';
  end if;
  if p_precio is null or p_precio < 0 or p_precio > 10000000 then
    raise exception 'El precio debe estar entre $ 0 y $ 10.000.000.';
  end if;
  if p_duracion_min is null or p_duracion_min < 5 or p_duracion_min > 480 or p_duracion_min % 5 <> 0 then
    raise exception 'La duración debe ser de 5 a 480 minutos, de 5 en 5.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Escritura (área "servicios")
-- ---------------------------------------------------------------------
create or replace function public.crear_servicio(p_nombre text, p_precio integer, p_duracion_min integer)
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
  perform public.fn_validar_servicio(v_nombre, p_precio, p_duracion_min);
  begin
    insert into public.servicios (barberia_id, nombre, precio, duracion_min, orden)
    values (v_barberia, v_nombre, p_precio, p_duracion_min,
            coalesce((select max(orden) from public.servicios where barberia_id = v_barberia), 0) + 1)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya tienes un servicio con ese nombre.';
  end;
  return jsonb_build_object('id', v_id);
end $$;

-- Cambiar un servicio NO toca las citas ya hechas: cada una guardó su propio precio y duración al crearse.
create or replace function public.actualizar_servicio(p_id uuid, p_nombre text, p_precio integer, p_duracion_min integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('servicios');
  v_nombre   text := public.fn_limpiar_texto(p_nombre);
begin
  perform public.fn_validar_servicio(v_nombre, p_precio, p_duracion_min);
  begin
    update public.servicios
       set nombre = v_nombre, precio = p_precio, duracion_min = p_duracion_min
     where barberia_id = v_barberia and id = p_id;
  exception when unique_violation then
    raise exception 'Ya tienes un servicio con ese nombre.';
  end;
  if not found then
    raise exception 'No existe ese servicio.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end $$;

-- Archivar (p_activo = false) o restaurar (true). Restaurar falla si ya hay otro activo con el mismo nombre.
create or replace function public.fijar_servicio_activo(p_id uuid, p_activo boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('servicios');
begin
  if p_activo is null then
    raise exception 'Indica si el servicio queda activo o archivado.';
  end if;
  begin
    update public.servicios set activo = p_activo where barberia_id = v_barberia and id = p_id;
  exception when unique_violation then
    raise exception 'Ya hay un servicio activo con ese nombre. Cámbiale el nombre a uno de los dos.';
  end;
  if not found then
    raise exception 'No existe ese servicio.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id, 'activo', p_activo);
end $$;

-- ---------------------------------------------------------------------
-- Lectura (RLS: cada quien ve solo los de su barbería). Activos primero, en el orden en que se crearon.
-- ---------------------------------------------------------------------
create or replace function public.listar_servicios(p_con_archivados boolean default false)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio,
                         'duracion_min', s.duracion_min, 'activo', s.activo)
      order by s.activo desc, s.orden, lower(s.nombre)),
    '[]'::jsonb)
    from public.servicios s
   where coalesce(p_con_archivados, false) or s.activo
$$;

select public.fn_aplicar_permisos();
