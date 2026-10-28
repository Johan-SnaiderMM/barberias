-- =====================================================================
-- BARBERÍAS · 0003 · EQUIPO CON PERMISOS POR ÁREA (desde el inicio, no al final)
--
--   ÁREAS (lista cerrada, fn_areas):
--     agenda      ver y manejar la agenda de TODOS los barberos (crear, mover, cancelar citas)
--     mi_agenda   ver y manejar solo MIS citas, mis cobros y mis comisiones (el barbero)
--     caja        cobrar y anular cobros
--     gastos      registrar y anular gastos
--     cierre      el cierre del día y las cifras de plata (ventas, gastos, ganancia)
--     comisiones  ver y liquidar las comisiones de TODOS los barberos
--     servicios   servicios, precios, barberos y horarios
--     equipo      invitar personas y asignarles roles
--
--   ROLES: cada barbería tiene los suyos y decide qué áreas abre cada uno (al crearse trae Barbero y Recepción).
--   Una persona puede tener VARIOS roles y ve la suma de sus áreas. Sin roles, no entra a ninguna.
--   El dueño tiene todas las áreas siempre (no se le puede quitar nada).
--
--   El candado está en la base, no en los botones:
--     · Escrituras: cada función pide su área con requerir_area(...), nunca solo requerir_barberia().
--     · Lecturas: las tablas de plata se leen con tiene_area(...) en su RLS.
--
--   Pendiente de decidir en 1.9: que el área "equipo" no permita darse a sí mismo más áreas de las que ya tiene.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Áreas
-- ---------------------------------------------------------------------
create or replace function public.fn_areas()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array['agenda', 'mi_agenda', 'caja', 'gastos', 'cierre', 'comisiones', 'servicios', 'equipo']::text[]
$$;

-- Para los mensajes: "No tienes permiso para <esto>."
create or replace function public.fn_texto_area(p_area text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_area
           when 'agenda' then 'manejar la agenda'
           when 'mi_agenda' then 'ver tu agenda'
           when 'caja' then 'cobrar'
           when 'gastos' then 'registrar gastos'
           when 'cierre' then 'ver las cuentas del día'
           when 'comisiones' then 'ver las comisiones'
           when 'servicios' then 'cambiar servicios, precios y horarios'
           when 'equipo' then 'manejar el equipo'
           else 'hacer esto'
         end
$$;

-- ---------------------------------------------------------------------
-- 2. Roles de la barbería y roles de cada persona
-- ---------------------------------------------------------------------
create table if not exists public.roles_equipo (
  id             uuid primary key default gen_random_uuid(),
  barberia_id    uuid not null references public.barberias(id),
  nombre         text not null check (length(btrim(nombre)) between 1 and 30),
  areas          text[] not null default '{}' check (areas <@ public.fn_areas()),
  orden          integer not null default 0,
  activo         boolean not null default true,      -- quitar un rol = activo false (no se borra)
  created_at     timestamptz not null default now(),
  registrado_por uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id)
);
create unique index if not exists ux_roles_equipo_nombre on public.roles_equipo (barberia_id, lower(nombre)) where activo;
comment on table public.roles_equipo is 'Roles del equipo de cada barbería (Barbero, Recepción…) y qué áreas abre cada uno.';

create table if not exists public.perfil_roles (
  barberia_id    uuid not null references public.barberias(id),
  user_id        uuid not null,
  rol_id         uuid not null,
  created_at     timestamptz not null default now(),
  registrado_por uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (user_id, rol_id),
  foreign key (barberia_id, user_id) references public.perfiles (barberia_id, user_id) on delete cascade,
  foreign key (barberia_id, rol_id)  references public.roles_equipo (barberia_id, id)
);
create index if not exists idx_perfil_roles_barberia on public.perfil_roles (barberia_id, rol_id);
comment on table public.perfil_roles is 'Qué roles tiene cada persona del equipo (puede tener varios).';

alter table public.roles_equipo enable row level security;
alter table public.perfil_roles enable row level security;

drop policy if exists roles_equipo_select on public.roles_equipo;
create policy roles_equipo_select on public.roles_equipo
  for select to authenticated using (barberia_id = (select public.mi_barberia()));

drop policy if exists perfil_roles_select on public.perfil_roles;
create policy perfil_roles_select on public.perfil_roles
  for select to authenticated using (barberia_id = (select public.mi_barberia()));

grant select on public.roles_equipo, public.perfil_roles to authenticated;

-- Los roles con los que arranca una barbería (solo si todavía no tiene ninguno).
create or replace function public.fn_roles_iniciales(p_barberia uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.roles_equipo (barberia_id, nombre, areas, orden)
  select p_barberia, r.nombre, r.areas, r.orden
    from (values ('Barbero', array['mi_agenda']::text[], 1),
                 ('Recepción', array['agenda', 'caja', 'gastos']::text[], 2)) as r(nombre, areas, orden)
   where not exists (select 1 from public.roles_equipo where barberia_id = p_barberia)
$$;

create or replace function public.fn_roles_de_barberia_nueva()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fn_roles_iniciales(new.id);
  return new;
end $$;

drop trigger if exists trg_roles_iniciales on public.barberias;
create trigger trg_roles_iniciales
  after insert on public.barberias
  for each row execute function public.fn_roles_de_barberia_nueva();

-- ---------------------------------------------------------------------
-- 3. ¿Qué áreas abre cada quien?
-- ---------------------------------------------------------------------
-- El dueño todas; el resto, la suma de las de sus roles activos (en el orden de fn_areas).
-- null = no pertenece a ninguna barbería.
create or replace function public.fn_areas_de(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when p.rol = 'dueno' then public.fn_areas()
           else (select coalesce(array_agg(s.area order by array_position(public.fn_areas(), s.area)), '{}'::text[])
                   from (select distinct unnest(r.areas) as area
                           from public.perfil_roles pr
                           join public.roles_equipo r on r.barberia_id = pr.barberia_id and r.id = pr.rol_id and r.activo
                          where pr.barberia_id = p.barberia_id and pr.user_id = p.user_id) s)
         end
    from public.perfiles p
   where p.user_id = p_user
$$;

create or replace function public.mis_areas()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select public.fn_areas_de(auth.uid()) $$;

-- ¿La sesión abre ALGUNA de estas áreas? La usan las políticas de lectura y las lecturas que esconden cifras.
create or replace function public.tiene_area(variadic p_areas text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce(public.fn_areas_de(auth.uid()) && p_areas, false) $$;

-- Para las funciones de escritura: la barbería del usuario, si abre ALGUNA de las áreas; si no, un error claro.
create or replace function public.requerir_area(variadic p_areas text[])
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v uuid := public.requerir_barberia();
begin
  if not coalesce(public.fn_areas_de(auth.uid()) && p_areas, false) then
    raise exception 'No tienes permiso para %. Pídeselo al dueño.', public.fn_texto_area(p_areas[1]) using errcode = '42501';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 4. Contexto: la barbería, las áreas y los roles de quien entra (la app arma barra y pantallas con esto)
-- ---------------------------------------------------------------------
create or replace function public.obtener_contexto()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'barberia', (select jsonb_build_object('id', b.id, 'nombre', b.nombre, 'slug', b.slug, 'es_demo', b.es_demo,
                                           'whatsapp', b.whatsapp, 'direccion', b.direccion)
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
