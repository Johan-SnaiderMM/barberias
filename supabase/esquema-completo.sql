-- =====================================================================
-- BARBERÍAS · ESQUEMA COMPLETO (generado con `npm run esquema`; NO editar a mano)
-- Es la unión de supabase/migrations/*.sql en orden. Pégalo completo en Supabase > SQL Editor.
-- Después ejecuta supabase/seed.sql para cargar los datos de la demo.
-- =====================================================================

-- >>>>>>>>>> 20261015000001_base.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0001 · BASE: permisos de funciones, fechas de Bogotá, barbería y perfiles
--
-- Reglas de diseño (SPEC.md §7):
--  * MULTI-BARBERÍA desde la primera tabla: toda tabla de negocio lleva barberia_id y RLS (0002).
--    Las llaves foráneas de lo que venga después serán COMPUESTAS (barberia_id, id): ninguna fila puede
--    apuntar a datos de otra barbería, ni siquiera por error de código.
--  * DINERO en pesos colombianos ENTEROS (integer). Nunca numeric/float.
--  * ANULAR con motivo en vez de borrar; created_at y registrado_por en todo lo que se registra.
--  * Zona horaria del negocio: America/Bogota (Colombia no tiene horario de verano).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permisos de funciones
--
-- Supabase le da EXECUTE a anon y authenticated sobre toda función nueva. Aquí se cierra:
--   * anon (sin sesión): ejecuta SOLO las funciones publico_* (la API de la reserva sin cuenta).
--   * authenticated: ejecuta la API del personal (todo lo que NO empiece por fn_ ni requerir_).
--   * fn_* y requerir_*: internas; solo las llaman otras funciones (security definer).
--
-- fn_aplicar_permisos() es idempotente: CORRERLA AL FINAL DE CADA MIGRACIÓN que agregue funciones.
-- (Una prueba verifica esta regla sobre los archivos de migración y otra sobre la base real.)
-- ---------------------------------------------------------------------
create or replace function public.fn_aplicar_permisos()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as firma, p.proname as nombre
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.firma);
    if r.nombre not like 'fn\_%' and r.nombre not like 'requerir\_%' then
      execute format('grant execute on function %s to authenticated', r.firma);
    end if;
    -- API pública (clientes sin cuenta): únicamente las funciones publico_*
    if r.nombre like 'publico\_%' then
      execute format('grant execute on function %s to anon', r.firma);
    end if;
  end loop;
end $$;

-- Lo que se cree después no hereda acceso abierto (ni tablas ni funciones).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------
-- 2. Funciones de fecha (zona horaria de Colombia)
-- ---------------------------------------------------------------------
create or replace function public.fecha_bogota(p timestamptz)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$ select (p at time zone 'America/Bogota')::date $$;

create or replace function public.hoy_bogota()
returns date
language sql
stable
set search_path = public
as $$ select public.fecha_bogota(now()) $$;

-- ---------------------------------------------------------------------
-- 3. Barberías (inquilinos) y perfiles
-- ---------------------------------------------------------------------
create table if not exists public.barberias (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (length(btrim(nombre)) between 1 and 60),
  -- Nombre corto de la dirección pública: /reservar/<slug>. Lo llena un trigger si viene vacío.
  slug       text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 40),
  -- WhatsApp de la barbería en E.164 (+573001234567), para los enlaces wa.me.
  whatsapp   text check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  direccion  text check (direccion is null or length(btrim(direccion)) between 1 and 120),
  es_demo    boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_barberias_slug on public.barberias (slug);
comment on table  public.barberias is 'Una barbería = un inquilino (tenant). Todo lo demás cuelga de aquí.';
comment on column public.barberias.es_demo is 'true = datos ficticios; solo estas permiten reiniciar la demo.';

-- Un usuario pertenece a UNA barbería (por ahora). Sus permisos salen de rol + roles_equipo (0003), no del JWT.
create table if not exists public.perfiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  barberia_id uuid not null references public.barberias(id),
  rol         text not null default 'equipo' check (rol in ('dueno', 'equipo')),
  nombre      text not null check (length(btrim(nombre)) between 1 and 40),
  created_at  timestamptz not null default now(),
  unique (barberia_id, user_id)
);
create index if not exists idx_perfiles_barberia on public.perfiles (barberia_id);

-- RLS activada desde la creación (sin políticas = nadie lee; las políticas llegan en 0002).
alter table public.barberias enable row level security;
alter table public.perfiles  enable row level security;

-- ---------------------------------------------------------------------
-- 4. Slug: "La Barbería de Don Pepe" -> "la-barberia-de-don-pepe"
-- ---------------------------------------------------------------------
create or replace function public.fn_slug(p_texto text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(nullif(
    trim(both '-' from left(
      regexp_replace(
        lower(translate(coalesce(p_texto, ''),
                        'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
                        'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun')),
        '[^a-z0-9]+', '-', 'g'),
      40)),
    ''), 'barberia')
$$;

-- Slug libre: si ya existe (o es una palabra reservada de la app) agrega -2, -3…
-- security definer: ve TODAS las barberías para no repetir.
create or replace function public.fn_slug_unico(p_texto text, p_excluir uuid default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text := public.fn_slug(p_texto);
  v text;
  n int := 1;
  v_reservados constant text[] := array[
    'www', 'app', 'admin', 'api', 'soporte', 'demo', 'entrar', 'unirme', 'salir', 'legal', 'sc',
    'reservar', 'cita', 'inicio', 'agenda', 'caja', 'clientes', 'gastos', 'cierre', 'mas', 'equipo',
    'servicios', 'barberos', 'comisiones', 'barberia', 'barberias'];
begin
  if length(v_base) < 3 then
    v_base := left(v_base, 20) || '-barberia';
  end if;
  v := v_base;
  while v = any (v_reservados)
     or exists (select 1 from public.barberias b where b.slug = v and b.id is distinct from p_excluir)
  loop
    n := n + 1;
    v := trim(both '-' from left(v_base, 40 - length(n::text) - 1)) || '-' || n;
  end loop;
  return v;
end $$;

-- Cualquier barbería nueva (alta real, demo, pruebas) nace con su slug.
create or replace function public.fn_barberia_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := public.fn_slug_unico(new.nombre, new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_barberia_slug on public.barberias;
create trigger trg_barberia_slug
  before insert on public.barberias
  for each row execute function public.fn_barberia_slug();
-- (NOT NULL y el check de slug se verifican DESPUÉS del trigger BEFORE: insertar sin slug es legal.)

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000002_seguridad.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0002 · SEGURIDAD: RLS por barbería, borrado bloqueado, permisos mínimos
--
-- Modelo:
--   * Cada usuario pertenece a UNA barbería (tabla perfiles). mi_barberia() la resuelve.
--   * SELECT: una política por tabla -> barberia_id = mi_barberia().
--   * ESCRITURA: los roles anon/authenticated NO tienen INSERT/UPDATE/DELETE sobre ninguna tabla.
--     Todo se escribe por funciones RPC (security definer) que validan barbería y área.
--     Así no hay forma de saltarse las reglas de dinero ni de agenda desde el cliente.
--   * BORRADO: además de no tener permiso, un trigger (fn_bloquear_borrado) bloquea DELETE en las tablas de
--     negocio; cada migración que cree una tabla de dinero o de agenda se lo agrega.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funciones auxiliares (security definer: leen perfiles saltándose su RLS, sin recursión)
-- ---------------------------------------------------------------------
create or replace function public.mi_barberia()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select barberia_id from public.perfiles where user_id = auth.uid()
$$;

create or replace function public.es_dueno()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select rol = 'dueno' from public.perfiles where user_id = auth.uid()), false)
$$;

-- Para las funciones de escritura: falla con un mensaje claro si el usuario no tiene barbería.
create or replace function public.requerir_barberia()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v uuid := public.mi_barberia();
begin
  if v is null then
    raise exception 'Tu usuario no tiene una barbería asignada.' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function public.requerir_dueno()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v uuid := public.requerir_barberia();
begin
  if not public.es_dueno() then
    raise exception 'Solo el dueño puede hacer esto.' using errcode = '42501';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Políticas de lectura
-- ---------------------------------------------------------------------
drop policy if exists barberias_select on public.barberias;
create policy barberias_select on public.barberias
  for select to authenticated using (id = (select public.mi_barberia()));

drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles
  for select to authenticated using (barberia_id = (select public.mi_barberia()));

-- ---------------------------------------------------------------------
-- Permisos de tablas: solo lectura para usuarios autenticados; nada para anónimos.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select on public.barberias, public.perfiles to authenticated;

-- ---------------------------------------------------------------------
-- Anular en vez de borrar: DELETE bloqueado en las tablas de negocio (incluso para el dueño de la base).
-- Única excepción: el reinicio de la demo activa app.reiniciando_demo durante su transacción.
-- Uso en una migración posterior:
--   create trigger trg_bloquear_borrado before delete on public.<tabla>
--     for each row execute function public.fn_bloquear_borrado();
-- ---------------------------------------------------------------------
create or replace function public.fn_bloquear_borrado()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.reiniciando_demo', true), '') = 'on' then
    return old;
  end if;
  raise exception 'No se puede borrar %: se anula con motivo.', tg_table_name using errcode = '42501';
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000003_areas_y_roles.sql >>>>>>>>>>
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

-- >>>>>>>>>> 20261015000004_alta_barberia.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0004 · DAR DE ALTA una barbería DE VERDAD, con su dueño
--
-- No hay registro abierto: la cuenta del dueño la crea quien administra, a mano y sin service_role.
--   1. Supabase → Authentication → Users → Add user: el correo del dueño y una contraseña temporal, con
--      "Auto Confirm User".
--   2. SQL Editor:  select public.fn_crear_barberia('correo@del-dueno.com', 'Nombre de la barbería', 'Nombre del dueño');
--   3. Se le entrega al dueño su correo y la contraseña temporal: entra en /entrar.
--
-- La barbería nace vacía (sin servicios ni barberos: los arma el dueño), con los roles de siempre y su enlace
-- público listo. Las reservas en línea quedan apagadas hasta que el dueño las encienda (llega en la Fase 2).
-- fn_* = nadie la puede llamar desde la app.
-- =====================================================================

create or replace function public.fn_crear_barberia(p_correo text, p_nombre text, p_dueno text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_correo text := lower(btrim(coalesce(p_correo, '')));
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_dueno  text := btrim(regexp_replace(coalesce(p_dueno, ''), '\s+', ' ', 'g'));
  v_user   uuid;
  v_barb   uuid;
  v_slug   text;
begin
  if length(v_nombre) = 0 or length(v_nombre) > 60 then
    raise exception 'Escribe el nombre de la barbería (máximo 60 caracteres).';
  end if;
  if length(v_dueno) = 0 or length(v_dueno) > 40 then
    raise exception 'Escribe el nombre del dueño (máximo 40 caracteres).';
  end if;

  select id into v_user from auth.users where lower(email) = v_correo;
  if v_user is null then
    raise exception 'No existe el usuario %. Créalo primero en Authentication > Users (con "Auto Confirm User").', v_correo;
  end if;
  if exists (select 1 from public.perfiles where user_id = v_user) then
    raise exception 'El usuario % ya tiene una barbería.', v_correo;
  end if;

  insert into public.barberias (nombre, es_demo)
  values (v_nombre, false)
  returning id, slug into v_barb, v_slug;
  insert into public.perfiles (user_id, barberia_id, rol, nombre) values (v_user, v_barb, 'dueno', v_dueno);

  return jsonb_build_object('barberia_id', v_barb, 'nombre', v_nombre, 'dueno', v_dueno, 'slug', v_slug,
                            'enlace_reservas', '/reservar/' || v_slug);
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000005_servicios.sql >>>>>>>>>>
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

-- >>>>>>>>>> 20261015000006_barberos.sql >>>>>>>>>>
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

-- >>>>>>>>>> 20261015000007_horarios_y_bloqueos.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0007 · HORARIOS, BLOQUEOS Y AJUSTES DE LA AGENDA (tarea 1.3 · SPEC F3)
--
--   * Horario semanal por barbero en FRANJAS (lunes 9:00–13:00 y 14:30–19:00). Las horas se guardan como minutos
--     desde la medianoche, hora de Bogotá (0 a 1440): sin zonas horarias de por medio. Dos franjas del mismo
--     barbero y día no se traslapan (restricción de exclusión); pegadas (13:00 y 13:00) sí se aceptan.
--   * Bloqueos puntuales (día libre, cita médica, almuerzo largo) con motivo: son instantes (timestamptz).
--     Se quitan marcándolos inactivos; nunca se borran.
--   * Ajustes de la barbería que usa la disponibilidad (1.5): paso de la reserva, días hacia adelante,
--     anticipación mínima y colchón entre citas.
--
-- Quedan para la Fase 2: el interruptor "reservas en línea" y el límite para cancelar sin llamar.
-- El aviso de "este bloqueo cae sobre citas ya agendadas" llega con las citas (1.4).
-- =====================================================================

-- La restricción de exclusión necesita btree_gist (igualdad de uuid dentro de un índice gist). Verificado en
-- el spike 0.4 (src/test/spike-btree-gist.test.ts).
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Ajustes de la agenda (en la barbería)
-- ---------------------------------------------------------------------
alter table public.barberias
  add column if not exists paso_min         integer not null default 30
    constraint chk_barberias_paso check (paso_min in (15, 30)),
  add column if not exists dias_adelante    integer not null default 30
    constraint chk_barberias_dias_adelante check (dias_adelante between 1 and 90),
  add column if not exists anticipacion_min integer not null default 60
    constraint chk_barberias_anticipacion check (anticipacion_min between 0 and 1440),
  add column if not exists colchon_min      integer not null default 0
    constraint chk_barberias_colchon check (colchon_min between 0 and 60);

comment on column public.barberias.paso_min is 'Cada cuántos minutos arranca un hueco de reserva (15 o 30).';
comment on column public.barberias.dias_adelante is 'Hasta cuántos días adelante se puede reservar en línea.';
comment on column public.barberias.anticipacion_min is 'Con cuánta anticipación mínima se reserva en línea (minutos).';
comment on column public.barberias.colchon_min is 'Minutos de descanso que se dejan entre una cita y la siguiente.';

create or replace function public.actualizar_parametros_agenda(
  p_paso_min integer, p_dias_adelante integer, p_anticipacion_min integer, p_colchon_min integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('servicios');
begin
  if p_paso_min is null or p_paso_min not in (15, 30) then
    raise exception 'Las horas de reserva arrancan cada 15 o cada 30 minutos.';
  end if;
  if p_dias_adelante is null or p_dias_adelante < 1 or p_dias_adelante > 90 then
    raise exception 'Se puede reservar de 1 a 90 días hacia adelante.';
  end if;
  if p_anticipacion_min is null or p_anticipacion_min < 0 or p_anticipacion_min > 1440 then
    raise exception 'La anticipación mínima va de 0 minutos a 24 horas.';
  end if;
  if p_colchon_min is null or p_colchon_min < 0 or p_colchon_min > 60 then
    raise exception 'El descanso entre citas va de 0 a 60 minutos.';
  end if;
  update public.barberias
     set paso_min = p_paso_min, dias_adelante = p_dias_adelante,
         anticipacion_min = p_anticipacion_min, colchon_min = p_colchon_min
   where id = v_barberia;
  return jsonb_build_object('paso_min', p_paso_min, 'dias_adelante', p_dias_adelante,
                            'anticipacion_min', p_anticipacion_min, 'colchon_min', p_colchon_min);
end $$;

-- ---------------------------------------------------------------------
-- 2. Horario semanal por barbero
-- ---------------------------------------------------------------------
create table if not exists public.horarios_barbero (
  id             uuid primary key default gen_random_uuid(),
  barberia_id    uuid not null references public.barberias(id),
  barbero_id     uuid not null,
  -- 0 = domingo … 6 = sábado (igual que extract(dow …) y que getDay() en JavaScript)
  dia_semana     smallint not null check (dia_semana between 0 and 6),
  -- Minutos desde la medianoche, hora de Bogotá: 9:00 = 540, 13:30 = 810, medianoche final = 1440.
  desde_min      smallint not null check (desde_min between 0 and 1439),
  hasta_min      smallint not null check (hasta_min between 1 and 1440),
  created_at     timestamptz not null default now(),
  registrado_por uuid default auth.uid() references auth.users(id) on delete set null,
  check (hasta_min > desde_min),
  unique (barberia_id, id),
  foreign key (barberia_id, barbero_id) references public.barberos (barberia_id, id),
  -- Dos franjas del mismo barbero y día no se traslapan ([desde, hasta): pegadas sí).
  constraint horarios_sin_traslape exclude using gist (
    barbero_id extensions.gist_uuid_ops with =,
    dia_semana extensions.gist_int2_ops with =,
    int4range(desde_min, hasta_min) with &&
  )
);
create index if not exists idx_horarios_barbero on public.horarios_barbero (barberia_id, barbero_id, dia_semana);
comment on table public.horarios_barbero is 'Franjas de trabajo de cada barbero por día de la semana (minutos desde medianoche, Bogotá).';

alter table public.horarios_barbero enable row level security;

drop policy if exists horarios_barbero_select on public.horarios_barbero;
create policy horarios_barbero_select on public.horarios_barbero
  for select to authenticated using (barberia_id = (select public.mi_barberia()));

grant select on public.horarios_barbero to authenticated;

-- Deja el horario del barbero EXACTAMENTE con estas franjas (reemplaza todo).
--   p_franjas = [{"dia": 1, "desde": 540, "hasta": 780}, {"dia": 1, "desde": 870, "hasta": 1140}, …]
create or replace function public.guardar_horario_barbero(p_barbero uuid, p_franjas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('servicios');
  v_dias     constant text[] := array['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  v_item     jsonb;
  v_dia      integer;
  v_desde    integer;
  v_hasta    integer;
  v_norm     jsonb := '[]'::jsonb;
  v_i        integer := 0;
  v_cruce    integer;
  v_exceso   integer;
begin
  if not exists (select 1 from public.barberos where barberia_id = v_barberia and id = p_barbero) then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  if p_franjas is null or jsonb_typeof(p_franjas) <> 'array' then
    raise exception 'El horario no es válido.';
  end if;
  if jsonb_array_length(p_franjas) > 28 then
    raise exception 'Son demasiadas franjas.';
  end if;

  for v_item in select e from jsonb_array_elements(p_franjas) e loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'El horario no es válido.';
    end if;
    v_dia   := public.fn_json_entero(v_item, 'dia', true);
    v_desde := public.fn_json_entero(v_item, 'desde', true);
    v_hasta := public.fn_json_entero(v_item, 'hasta', true);
    if v_dia < 0 or v_dia > 6 then
      raise exception 'El día de la semana no es válido.';
    end if;
    if v_desde < 0 or v_desde > 1439 or v_hasta < 1 or v_hasta > 1440 then
      raise exception 'Las horas deben estar entre las 12:00 a. m. y las 12:00 a. m. del día siguiente.';
    end if;
    if v_hasta <= v_desde then
      raise exception 'La franja del % termina antes de empezar.', v_dias[v_dia + 1];
    end if;
    v_i := v_i + 1;
    v_norm := v_norm || jsonb_build_array(jsonb_build_object('i', v_i, 'dia', v_dia, 'desde', v_desde, 'hasta', v_hasta));
  end loop;

  -- Demasiadas franjas en un mismo día (más de 4 no es un horario, es un error)
  select max(c) into v_exceso
    from (select count(*) as c from jsonb_to_recordset(v_norm) as f(i int, dia int, desde int, hasta int) group by dia) t;
  if coalesce(v_exceso, 0) > 4 then
    raise exception 'Un día no puede tener más de 4 franjas.';
  end if;

  -- Traslapes (pegadas, no): mensaje claro antes de que lo rechace la restricción de la tabla.
  select a.dia into v_cruce
    from jsonb_to_recordset(v_norm) as a(i int, dia int, desde int, hasta int)
    join jsonb_to_recordset(v_norm) as b(i int, dia int, desde int, hasta int)
      on a.dia = b.dia and a.i < b.i and a.desde < b.hasta and b.desde < a.hasta
   limit 1;
  if v_cruce is not null then
    raise exception 'Las franjas del % se cruzan.', v_dias[v_cruce + 1];
  end if;

  delete from public.horarios_barbero where barberia_id = v_barberia and barbero_id = p_barbero;
  insert into public.horarios_barbero (barberia_id, barbero_id, dia_semana, desde_min, hasta_min)
  select v_barberia, p_barbero, f.dia, f.desde, f.hasta
    from jsonb_to_recordset(v_norm) as f(i int, dia int, desde int, hasta int);

  return jsonb_build_object('id', p_barbero, 'franjas', v_i);
end $$;

-- ---------------------------------------------------------------------
-- 3. Bloqueos puntuales
-- ---------------------------------------------------------------------
create table if not exists public.bloqueos (
  id             uuid primary key default gen_random_uuid(),
  barberia_id    uuid not null references public.barberias(id),
  barbero_id     uuid not null,
  inicio         timestamptz not null,
  fin            timestamptz not null,
  motivo         text check (motivo is null or length(btrim(motivo)) between 1 and 100),
  activo         boolean not null default true,       -- quitar un bloqueo = activo false (no se borra)
  created_at     timestamptz not null default now(),
  registrado_por uuid default auth.uid() references auth.users(id) on delete set null,
  check (fin > inicio),
  unique (barberia_id, id),
  foreign key (barberia_id, barbero_id) references public.barberos (barberia_id, id)
);
create index if not exists idx_bloqueos_barbero on public.bloqueos (barberia_id, barbero_id, inicio) where activo;
comment on table public.bloqueos is 'Ratos en que un barbero NO atiende (día libre, cita médica…). Se quitan, no se borran.';

alter table public.bloqueos enable row level security;

drop policy if exists bloqueos_select on public.bloqueos;
create policy bloqueos_select on public.bloqueos
  for select to authenticated using (barberia_id = (select public.mi_barberia()));

grant select on public.bloqueos to authenticated;

drop trigger if exists trg_bloquear_borrado on public.bloqueos;
create trigger trg_bloquear_borrado before delete on public.bloqueos
  for each row execute function public.fn_bloquear_borrado();

-- Quien tiene "agenda" bloquea a cualquiera; quien solo tiene "mi_agenda" (el barbero), solo su propio tiempo.
create or replace function public.fn_requerir_agenda_de(p_barbero uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda');
begin
  if not public.tiene_area('agenda') and p_barbero is distinct from public.mi_barbero() then
    raise exception 'Solo puedes cambiar tu propio horario.' using errcode = '42501';
  end if;
  return v_barberia;
end $$;

create or replace function public.crear_bloqueo(p_barbero uuid, p_inicio timestamptz, p_fin timestamptz,
                                                p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.fn_requerir_agenda_de(p_barbero);
  v_motivo   text := nullif(public.fn_limpiar_texto(p_motivo), '');
  v_id       uuid;
begin
  if not exists (select 1 from public.barberos where barberia_id = v_barberia and id = p_barbero and activo) then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  if p_inicio is null or p_fin is null or p_fin <= p_inicio then
    raise exception 'El bloqueo debe terminar después de empezar.';
  end if;
  if p_fin <= now() then
    raise exception 'Ese bloqueo ya terminó.';
  end if;
  if p_fin - p_inicio > interval '90 days' then
    raise exception 'Un bloqueo no puede durar más de 90 días.';
  end if;
  if v_motivo is not null and length(v_motivo) > 100 then
    raise exception 'El motivo es muy largo (máximo 100 letras).';
  end if;

  insert into public.bloqueos (barberia_id, barbero_id, inicio, fin, motivo)
  values (v_barberia, p_barbero, p_inicio, p_fin, v_motivo)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.quitar_bloqueo(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_barbero  uuid;
begin
  select barbero_id into v_barbero from public.bloqueos where barberia_id = v_barberia and id = p_id;
  if v_barbero is null then
    raise exception 'No existe ese bloqueo.' using errcode = 'P0002';
  end if;
  -- El permiso real: "agenda" para cualquiera, o "mi_agenda" y que el bloqueo sea del propio barbero.
  perform public.fn_requerir_agenda_de(v_barbero);
  update public.bloqueos set activo = false where barberia_id = v_barberia and id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- Bloqueos que todavía no terminan (RLS: solo los de la propia barbería), en orden de fecha.
create or replace function public.listar_bloqueos(p_barbero uuid default null, p_desde timestamptz default now())
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('id', b.id, 'barbero_id', b.barbero_id, 'inicio', b.inicio, 'fin', b.fin,
                                 'motivo', b.motivo)
              order by b.inicio, b.id),
    '[]'::jsonb)
    from public.bloqueos b
   where b.activo and b.fin > p_desde and (p_barbero is null or b.barbero_id = p_barbero)
$$;

-- ---------------------------------------------------------------------
-- 4. Lo que ya existía, ahora con horario y ajustes (copia de la ÚLTIMA versión: 0006 y 0003)
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
           where bs.barberia_id = b.barberia_id and bs.barbero_id = b.id), '[]'::jsonb),
        'horario', coalesce((
          select jsonb_agg(
                   jsonb_build_object('dia', h.dia_semana, 'desde', h.desde_min, 'hasta', h.hasta_min)
                   order by h.dia_semana, h.desde_min)
            from public.horarios_barbero h
           where h.barberia_id = b.barberia_id and h.barbero_id = b.id), '[]'::jsonb))
      order by b.activo desc, b.orden, lower(b.nombre)),
    '[]'::jsonb)
    from public.barberos b
   where coalesce(p_con_archivados, false) or b.activo
$$;

create or replace function public.obtener_contexto()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'barberia', (select jsonb_build_object('id', b.id, 'nombre', b.nombre, 'slug', b.slug, 'es_demo', b.es_demo,
                                           'whatsapp', b.whatsapp, 'direccion', b.direccion,
                                           'agenda', jsonb_build_object(
                                             'paso_min', b.paso_min, 'dias_adelante', b.dias_adelante,
                                             'anticipacion_min', b.anticipacion_min, 'colchon_min', b.colchon_min))
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

-- >>>>>>>>>> 20261015000008_citas.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0008 · CITAS Y LA RESTRICCIÓN ANTI-DOBLE-RESERVA (tarea 1.4 · SPEC F4)
--
--   * UNA CITA es "este cliente viene con este barbero a esta hora para este servicio". Guarda su PROPIO precio y
--     duración, copiados del catálogo al crearse (trigger): cambiar el catálogo no reescribe el pasado.
--   * La HORA FINAL es una columna generada (inicio + duración): mover una cita es cambiar solo `inicio`.
--   * NUNCA dos citas vigentes se traslapan para el mismo barbero. Lo garantiza la BASE con una restricción de
--     exclusión (gist), no la pantalla: dos personas que reservan a la vez, una gana y la otra recibe error.
--     Ocupan la hora las citas confirmadas, en atención y atendidas; las canceladas y las "no asistió" la liberan.
--   * Estados: confirmada -> en_atencion -> atendida, o cancelada (con motivo) / no_asistio. No se borra nada.
--   * También llega `clientes` (la cita lo necesita para su llave foránea). Sus pantallas y la alta automática
--     por celular son de la tarea 1.8.
--   * Lee: "agenda" y "caja" ven todas las citas; "mi_agenda" (el barbero) solo las suyas.
--   * Escribe: las funciones de crear / mover / cancelar son de la tarea 1.6 (y la reserva pública, Fase 2).
--
-- Además: `crear_bloqueo` ahora AVISA qué citas caen sobre el bloqueo (sin cancelarlas) y pide confirmar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Suma de minutos a un instante, inmutable (para la columna generada `fin`)
--    `timestamptz + interval` es "stable" porque un intervalo con días o meses depende de la zona horaria; con
--    SOLO minutos el resultado no depende de nada, así que es seguro declararla inmutable.
-- ---------------------------------------------------------------------
create or replace function public.fn_sumar_minutos(p timestamptz, p_minutos integer)
returns timestamptz
language sql
immutable
parallel safe
set search_path = ''
as $$ select p + p_minutos * interval '1 minute' $$;

-- ---------------------------------------------------------------------
-- 2. Clientes
-- ---------------------------------------------------------------------
create table if not exists public.clientes (
  id             uuid primary key default gen_random_uuid(),
  barberia_id    uuid not null references public.barberias(id),
  nombre         text not null check (length(btrim(nombre)) between 1 and 60),
  -- WhatsApp en E.164 (+573001234567): sirve para el recordatorio de un toque con wa.me y para reconocerlo.
  telefono       text check (telefono is null or telefono ~ '^\+[1-9][0-9]{7,14}$'),
  nota           text check (nota is null or length(nota) <= 300),   -- "degradé 2 a los lados"
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  registrado_por uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id)
);
-- Un celular es un cliente dentro de la barbería (un cliente puede no tener celular: llegó sin cita).
create unique index if not exists ux_clientes_telefono on public.clientes (barberia_id, telefono) where telefono is not null;
create index if not exists idx_clientes_nombre on public.clientes (barberia_id, lower(nombre));
comment on table public.clientes is 'Clientes de la barbería. Se identifican por celular dentro de cada barbería.';

alter table public.clientes enable row level security;

drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
  for select to authenticated
  using (barberia_id = (select public.mi_barberia()) and (select public.tiene_area('agenda', 'mi_agenda', 'caja')));

grant select on public.clientes to authenticated;

drop trigger if exists trg_bloquear_borrado on public.clientes;
create trigger trg_bloquear_borrado before delete on public.clientes
  for each row execute function public.fn_bloquear_borrado();

-- ---------------------------------------------------------------------
-- 3. Citas
-- ---------------------------------------------------------------------
create table if not exists public.citas (
  id                      uuid primary key default gen_random_uuid(),
  barberia_id             uuid not null references public.barberias(id),
  barbero_id              uuid not null,
  cliente_id              uuid not null,
  servicio_id             uuid not null,
  -- Instante exacto (la app lo muestra siempre en hora de Bogotá), a minuto cerrado.
  inicio                  timestamptz not null check (date_trunc('minute', inicio) = inicio),
  -- COPIADOS del catálogo por el trigger al crear: lo que se pida en el insert se ignora.
  duracion_min            integer not null check (duracion_min between 5 and 480 and duracion_min % 5 = 0),
  precio                  integer not null check (precio >= 0 and precio <= 10000000),
  fin                     timestamptz generated always as (public.fn_sumar_minutos(inicio, duracion_min)) stored,
  estado                  text not null default 'confirmada'
                          check (estado in ('confirmada', 'en_atencion', 'atendida', 'cancelada', 'no_asistio')),
  -- personal = la creó alguien del equipo; cliente = la reservó el cliente en línea (Fase 2).
  origen                  text not null default 'personal' check (origen in ('personal', 'cliente')),
  -- Código secreto con el que el cliente consulta SU cita (/cita/<token>, Fase 2). No adivinable.
  token                   uuid not null default gen_random_uuid(),
  notas                   text check (notas is null or length(btrim(notas)) between 1 and 300),
  -- Se llena al tocar el botón de WhatsApp: el equipo sabe a quién ya se le recordó.
  recordatorio_enviado_at timestamptz,
  cancelada_motivo        text check (cancelada_motivo is null or length(btrim(cancelada_motivo)) between 1 and 200),
  cancelada_por           uuid references auth.users(id) on delete set null,
  cancelada_at            timestamptz,
  created_at              timestamptz not null default now(),
  registrado_por          uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  unique (token),
  foreign key (barberia_id, barbero_id)  references public.barberos (barberia_id, id),
  foreign key (barberia_id, cliente_id)  references public.clientes (barberia_id, id),
  foreign key (barberia_id, servicio_id) references public.servicios (barberia_id, id),
  -- Anular con motivo: una cita cancelada siempre dice por qué y cuándo.
  constraint chk_cita_cancelacion check (
    estado <> 'cancelada' or (cancelada_motivo is not null and cancelada_at is not null)
  ),
  -- LA REGLA CENTRAL: un barbero no tiene dos citas vigentes que se traslapen ([inicio, fin): pegadas sí).
  constraint citas_sin_traslape exclude using gist (
    barbero_id extensions.gist_uuid_ops with =,
    tstzrange(inicio, fin, '[)') with &&
  ) where (estado in ('confirmada', 'en_atencion', 'atendida'))
);
create index if not exists idx_citas_barbero on public.citas (barberia_id, barbero_id, inicio);
create index if not exists idx_citas_dia on public.citas (barberia_id, inicio);
create index if not exists idx_citas_cliente on public.citas (barberia_id, cliente_id, inicio desc);
comment on table public.citas is 'Citas: barbero, cliente, servicio y hora. Precio y duración copiados del catálogo al crearse.';
comment on constraint citas_sin_traslape on public.citas is
  'Un barbero no puede tener dos citas vigentes (confirmada, en_atencion, atendida) que se traslapen.';

alter table public.citas enable row level security;

-- "agenda" y "caja" ven todas las citas; "mi_agenda" (el barbero) solo las suyas.
drop policy if exists citas_select on public.citas;
create policy citas_select on public.citas
  for select to authenticated
  using (
    barberia_id = (select public.mi_barberia())
    and (
      (select public.tiene_area('agenda', 'caja'))
      or ((select public.tiene_area('mi_agenda')) and barbero_id = (select public.mi_barbero()))
    )
  );

grant select on public.citas to authenticated;

drop trigger if exists trg_bloquear_borrado on public.citas;
create trigger trg_bloquear_borrado before delete on public.citas
  for each row execute function public.fn_bloquear_borrado();

-- ---------------------------------------------------------------------
-- 4. Al CREAR una cita: validar que el barbero hace ese servicio y copiar su precio y duración
-- ---------------------------------------------------------------------
create or replace function public.fn_cita_preparar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barbero  record;
  v_servicio record;
  v_asignado record;
begin
  select nombre, activo into v_barbero
    from public.barberos where barberia_id = new.barberia_id and id = new.barbero_id;
  if not found then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  if not v_barbero.activo then
    raise exception '% ya no está activo.', v_barbero.nombre;
  end if;

  select nombre, activo, precio, duracion_min into v_servicio
    from public.servicios where barberia_id = new.barberia_id and id = new.servicio_id;
  if not found then
    raise exception 'No existe ese servicio.' using errcode = 'P0002';
  end if;
  if not v_servicio.activo then
    raise exception 'El servicio % está archivado.', v_servicio.nombre;
  end if;

  select precio_propio, duracion_propia into v_asignado
    from public.barbero_servicios where barbero_id = new.barbero_id and servicio_id = new.servicio_id;
  if not found then
    raise exception '% no hace el servicio %.', v_barbero.nombre, v_servicio.nombre;
  end if;

  -- Copia: lo que traiga el insert se descarta. La hora final sale sola (columna generada).
  new.precio := coalesce(v_asignado.precio_propio, v_servicio.precio);
  new.duracion_min := coalesce(v_asignado.duracion_propia, v_servicio.duracion_min);
  return new;
end $$;

drop trigger if exists trg_cita_preparar on public.citas;
create trigger trg_cita_preparar before insert on public.citas
  for each row execute function public.fn_cita_preparar();

-- ---------------------------------------------------------------------
-- 5. Al CAMBIAR una cita: solo se mueven la hora, el estado, las notas y el recordatorio
-- ---------------------------------------------------------------------
create or replace function public.fn_cita_inmutables()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.barberia_id is distinct from old.barberia_id
     or new.barbero_id is distinct from old.barbero_id
     or new.cliente_id is distinct from old.cliente_id
     or new.servicio_id is distinct from old.servicio_id
     or new.duracion_min is distinct from old.duracion_min
     or new.precio is distinct from old.precio
     or new.origen is distinct from old.origen
     or new.token is distinct from old.token
     or new.created_at is distinct from old.created_at then
    raise exception 'El barbero, el cliente, el servicio y el precio de una cita no se cambian. Cancela la cita y crea otra.';
  end if;
  return new;
end $$;

drop trigger if exists trg_cita_inmutables on public.citas;
create trigger trg_cita_inmutables before update on public.citas
  for each row execute function public.fn_cita_inmutables();

-- ---------------------------------------------------------------------
-- 6. Bloqueos: ahora avisan qué citas caen encima (y no las cancelan)
-- ---------------------------------------------------------------------

-- Citas por venir de un barbero que se cruzan con un rango (confirmadas o ya en atención).
create or replace function public.fn_citas_en_rango(p_barberia uuid, p_barbero uuid, p_inicio timestamptz, p_fin timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', c.id, 'inicio', c.inicio, 'fin', c.fin, 'estado', c.estado,
                         'cliente', cl.nombre, 'servicio', s.nombre)
      order by c.inicio, c.id),
    '[]'::jsonb)
    from public.citas c
    join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
    join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
   where c.barberia_id = p_barberia and c.barbero_id = p_barbero
     and c.estado in ('confirmada', 'en_atencion')
     and c.inicio < p_fin and c.fin > p_inicio
$$;

-- La firma cambia (se agrega p_confirmar): se reemplaza la de 0007, no se deja una sobrecarga.
drop function if exists public.crear_bloqueo(uuid, timestamptz, timestamptz, text);

-- Si el bloqueo cae sobre citas y no se confirma, NO se guarda y se devuelven las citas:
--   {"ok": false, "motivo": "hay_citas", "citas": [...]}
-- Con p_confirmar = true se guarda y las citas quedan como están (alguien las mueve o las cancela):
--   {"ok": true, "id": "...", "citas": [...]}
create or replace function public.crear_bloqueo(p_barbero uuid, p_inicio timestamptz, p_fin timestamptz,
                                                p_motivo text default null, p_confirmar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.fn_requerir_agenda_de(p_barbero);
  v_motivo   text := nullif(public.fn_limpiar_texto(p_motivo), '');
  v_citas    jsonb;
  v_id       uuid;
begin
  if not exists (select 1 from public.barberos where barberia_id = v_barberia and id = p_barbero and activo) then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  if p_inicio is null or p_fin is null or p_fin <= p_inicio then
    raise exception 'El bloqueo debe terminar después de empezar.';
  end if;
  if p_fin <= now() then
    raise exception 'Ese bloqueo ya terminó.';
  end if;
  if p_fin - p_inicio > interval '90 days' then
    raise exception 'Un bloqueo no puede durar más de 90 días.';
  end if;
  if v_motivo is not null and length(v_motivo) > 100 then
    raise exception 'El motivo es muy largo (máximo 100 letras).';
  end if;

  v_citas := public.fn_citas_en_rango(v_barberia, p_barbero, p_inicio, p_fin);
  if jsonb_array_length(v_citas) > 0 and not coalesce(p_confirmar, false) then
    return jsonb_build_object('ok', false, 'motivo', 'hay_citas', 'citas', v_citas);
  end if;

  insert into public.bloqueos (barberia_id, barbero_id, inicio, fin, motivo)
  values (v_barberia, p_barbero, p_inicio, p_fin, v_motivo)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'citas', v_citas);
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000009_disponibilidad.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0009 · DISPONIBILIDAD: LAS HORAS LIBRES (tarea 1.5 · SPEC F5)
--
-- UNA sola función SQL calcula las horas libres; no hay otra versión en TypeScript. La usan la reserva pública
-- (Fase 2) y la agenda del personal (1.6/1.7), así que nunca se contradicen.
--
--   fn_huecos(...)            las horas libres de uno o de todos los barberos que hacen un servicio.
--   fn_huecos_cualquiera(...) "la primera disponible": una sola hora por instante, con el barbero que ese día tiene
--                             menos citas (a igual carga, el de menor orden).
--
-- REGLAS (la tabla de casos de borde está en src/test/disponibilidad.test.ts):
--   * Las horas posibles arrancan en la hora de inicio de cada franja y avanzan de `paso_min` en `paso_min`.
--     Las franjas pegadas (13:00 y 13:00) se unen en una sola.
--   * Una hora vale si el servicio ENTRA completo en la franja. La duración es la del barbero si la tiene propia.
--   * Se descartan las que se cruzan con una cita vigente (confirmada, en atención o atendida) o con un bloqueo
--     activo. Entre dos citas debe quedar el descanso `colchon_min` (no se pide contra un bloqueo ni contra el
--     cierre de la franja).
--   * Público (p_publico = true): respeta `anticipacion_min` y `dias_adelante` y solo ofrece a quien acepta reservas
--     en línea. Personal (false): sin esos límites. En ambos casos nunca ofrece una hora que ya pasó.
--   * Las fechas y las horas de las franjas son de Bogotá (sin horario de verano).
--
-- Son internas (fn_*): las llaman las funciones públicas y de personal, que validan permisos.
-- p_ahora existe para que las pruebas usen un "ahora" fijo.
-- =====================================================================

create or replace function public.fn_huecos(
  p_barberia     uuid,
  p_servicio     uuid,
  p_barbero      uuid default null,
  p_desde        date default null,
  p_hasta        date default null,
  p_ahora        timestamptz default now(),
  p_publico      boolean default true,
  p_ignorar_cita uuid default null
)
returns table (barbero_id uuid, inicio timestamptz, fin timestamptz, carga_dia integer, orden_barbero integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_hoy      date := public.fecha_bogota(p_ahora);
  v_desde    date := coalesce(p_desde, public.fecha_bogota(p_ahora));
  v_hasta    date;
  v_paso     integer;
  v_dias     integer;
  v_antic    integer;
  v_colchon  integer;
begin
  v_hasta := coalesce(p_hasta, v_desde);
  if v_hasta < v_desde or v_hasta - v_desde > 62 then
    raise exception 'El rango de fechas no es válido (máximo 62 días).';
  end if;

  select b.paso_min, b.dias_adelante, b.anticipacion_min, b.colchon_min
    into v_paso, v_dias, v_antic, v_colchon
    from public.barberias b
   where b.id = p_barberia;
  if not found then
    return;
  end if;

  return query
  with
  serv as (
    select s.id, s.duracion_min
      from public.servicios s
     where s.barberia_id = p_barberia and s.id = p_servicio and s.activo
  ),
  -- Barberos que pueden: activos, que hacen ESE servicio (con su duración propia si la tienen).
  barb as (
    select b.id as bid, b.orden as orden, coalesce(bs.duracion_propia, serv.duracion_min) as dur
      from public.barberos b
      join serv on true
      join public.barbero_servicios bs
        on bs.barberia_id = b.barberia_id and bs.barbero_id = b.id and bs.servicio_id = serv.id
     where b.barberia_id = p_barberia and b.activo
       and (p_barbero is null or b.id = p_barbero)
       and (not p_publico or b.acepta_reservas)
  ),
  dias as (
    select g::date as dia
      from generate_series(v_desde::timestamp, v_hasta::timestamp, interval '1 day') g
  ),
  -- Franjas pegadas (13:00 y 13:00) se unen: "islas" de minutos por barbero y día de la semana.
  fr as (
    select h.barbero_id as bid, h.dia_semana, h.desde_min, h.hasta_min,
           case when h.desde_min <= max(h.hasta_min) over (
                       partition by h.barbero_id, h.dia_semana
                       order by h.desde_min, h.hasta_min
                       rows between unbounded preceding and 1 preceding)
                then 0 else 1 end as nueva
      from public.horarios_barbero h
     where h.barberia_id = p_barberia and h.barbero_id in (select bid from barb)
  ),
  grp as (
    select fr.bid, fr.dia_semana, fr.desde_min, fr.hasta_min,
           sum(fr.nueva) over (partition by fr.bid, fr.dia_semana order by fr.desde_min, fr.hasta_min) as g
      from fr
  ),
  islas as (
    select grp.bid, grp.dia_semana, min(grp.desde_min) as desde_min, max(grp.hasta_min) as hasta_min
      from grp
     group by grp.bid, grp.dia_semana, grp.g
  ),
  -- Cada isla en cada día pedido, como instantes (las horas de la franja son de Bogotá).
  ventanas as (
    select b.bid, b.orden, b.dur, d.dia,
           ((d.dia + i.desde_min * interval '1 minute') at time zone 'America/Bogota') as v_ini,
           ((d.dia + i.hasta_min * interval '1 minute') at time zone 'America/Bogota') as v_fin
      from barb b
      join islas i on i.bid = b.bid
      join dias d on i.dia_semana = extract(dow from d.dia)::integer
  ),
  -- Horas posibles: de paso en paso desde el inicio de la isla, mientras el servicio entre completo.
  candidatas as (
    select v.bid, v.orden, v.dia, g as c_ini, g + v.dur * interval '1 minute' as c_fin
      from ventanas v
     cross join lateral generate_series(
            v.v_ini, v.v_fin - v.dur * interval '1 minute', v_paso * interval '1 minute') g
  )
  select c.bid, c.c_ini, c.c_fin,
         (select count(*)::integer
            from public.citas k
           where k.barberia_id = p_barberia and k.barbero_id = c.bid
             and k.estado in ('confirmada', 'en_atencion', 'atendida')
             and k.id is distinct from p_ignorar_cita
             and public.fecha_bogota(k.inicio) = c.dia) as carga_dia,
         c.orden
    from candidatas c
   where c.c_ini >= p_ahora
     and (not p_publico or c.c_ini >= p_ahora + v_antic * interval '1 minute')
     and (not p_publico or c.dia <= v_hoy + v_dias)
     -- Contra otras citas: debe quedar el descanso entre ambas.
     and not exists (
           select 1 from public.citas k
            where k.barberia_id = p_barberia and k.barbero_id = c.bid
              and k.estado in ('confirmada', 'en_atencion', 'atendida')
              and k.id is distinct from p_ignorar_cita
              and c.c_ini < k.fin + v_colchon * interval '1 minute'
              and c.c_fin + v_colchon * interval '1 minute' > k.inicio)
     -- Contra bloqueos: se cruzan o no (sin descanso).
     and not exists (
           select 1 from public.bloqueos x
            where x.barberia_id = p_barberia and x.barbero_id = c.bid and x.activo
              and c.c_ini < x.fin and c.c_fin > x.inicio)
   order by c.c_ini, c.orden;
end $$;

-- "La primera disponible": para cada hora, UN barbero: el que ese día tiene menos citas; si empatan, el de menor orden.
create or replace function public.fn_huecos_cualquiera(
  p_barberia     uuid,
  p_servicio     uuid,
  p_desde        date default null,
  p_hasta        date default null,
  p_ahora        timestamptz default now(),
  p_publico      boolean default true,
  p_ignorar_cita uuid default null
)
returns table (barbero_id uuid, inicio timestamptz, fin timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (h.inicio) h.barbero_id, h.inicio, h.fin
    from public.fn_huecos(p_barberia, p_servicio, null, p_desde, p_hasta, p_ahora, p_publico, p_ignorar_cita) h
   order by h.inicio, h.carga_dia, h.orden_barbero
$$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000010_citas_funciones.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0010 · CREAR, MOVER Y CANCELAR CITAS A MANO (tarea 1.6 · SPEC F4)
--
--   crear_cita(...)              agenda una cita (cliente existente o nuevo por celular).
--   crear_cita_sin_reserva(...)  "llegó sin cita": empieza AHORA, en atención.
--   mover_cita(...)              cambia SOLO la hora (mismo barbero); la hora final se recalcula sola.
--   cancelar_cita(...)           cancela con motivo (la hora queda libre).
--   cambiar_estado_cita(...)     empezar, terminar, no llegó, deshacer y reactivar.
--
-- REGLAS
--   * Permiso: "agenda" (de cualquiera) o "mi_agenda" (solo el propio barbero): fn_requerir_agenda_de.
--   * NUNCA dos citas vigentes se traslapan: lo garantiza la restricción de la tabla (0008). Si la hora está ocupada
--     la función FALLA con un mensaje claro (quién la tiene y de qué hora a qué hora) y NO cambia nada.
--   * AVISOS que se pueden confirmar (el personal sabe más que la regla): hora que ya pasó, fuera del horario del
--     barbero, o sobre un bloqueo. Sin confirmar no se guarda y se devuelven los avisos:
--       {"ok": false, "motivo": "avisos", "avisos": [{"tipo": "...", "mensaje": "..."}]}
--     Una hora OCUPADA no es un aviso: no se puede forzar.
--   * Precio y duración los copia el trigger de 0008; el cliente se resuelve por celular dentro de la barbería.
--   * Mover una cita borra su recordatorio (el aviso que se mandó era de otra hora).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ayudantes (internos)
-- ---------------------------------------------------------------------

-- Celular -> E.164. Un celular colombiano de 10 dígitos que empieza en 3 recibe +57; con "+" o "00" se respeta el país.
-- Vacío -> null. Si no se entiende, falla con un mensaje claro. (Espejo en src/lib/telefono.ts: una prueba los compara.)
create or replace function public.fn_normalizar_telefono(p_texto text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_txt text := btrim(coalesce(p_texto, ''));
  v_dig text;
begin
  if v_txt = '' then
    return null;
  end if;
  v_dig := regexp_replace(v_txt, '\D', '', 'g');
  if left(v_txt, 1) = '+' or left(v_dig, 2) = '00' then
    v_dig := regexp_replace(v_dig, '^00', '');
    if v_dig ~ '^[1-9][0-9]{7,14}$' then
      return '+' || v_dig;
    end if;
  elsif v_dig ~ '^3[0-9]{9}$' then
    return '+57' || v_dig;
  elsif v_dig ~ '^573[0-9]{9}$' then
    return '+' || v_dig;
  end if;
  raise exception 'El celular no es válido. Escríbelo con 10 dígitos, por ejemplo 300 123 4567.';
end $$;

-- "10:05 a. m." (hora de Bogotá). Espejo de horaCorta en src/lib/fechas.ts.
create or replace function public.fn_hora_texto(p timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p at time zone 'America/Bogota', 'FMHH12:MI')
         || case when extract(hour from (p at time zone 'America/Bogota')) < 12 then ' a. m.' else ' p. m.' end
$$;

create or replace function public.fn_texto_estado(p_estado text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_estado
           when 'confirmada' then 'confirmada'
           when 'en_atencion' then 'en atención'
           when 'atendida' then 'atendida'
           when 'cancelada' then 'cancelada'
           when 'no_asistio' then 'no asistió'
           else p_estado
         end
$$;

-- ¿La cita [inicio, fin) cabe entera dentro de una franja del barbero ese día? (franjas pegadas cuentan como una)
create or replace function public.fn_dentro_de_horario(p_barberia uuid, p_barbero uuid, p_inicio timestamptz, p_fin timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_local timestamp := p_inicio at time zone 'America/Bogota';
  v_m_ini integer;
  v_m_fin integer;
  v_dow   integer;
begin
  v_m_ini := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_m_fin := v_m_ini + (extract(epoch from (p_fin - p_inicio)) / 60)::integer;
  if v_m_fin > 1440 then
    return false;   -- cruza la medianoche
  end if;
  v_dow := extract(dow from v_local)::integer;
  return exists (
    with fr as (
      select h.desde_min, h.hasta_min,
             case when h.desde_min <= max(h.hasta_min) over (
                         order by h.desde_min, h.hasta_min rows between unbounded preceding and 1 preceding)
                  then 0 else 1 end as nueva
        from public.horarios_barbero h
       where h.barberia_id = p_barberia and h.barbero_id = p_barbero and h.dia_semana = v_dow),
    grp as (
      select fr.desde_min, fr.hasta_min, sum(fr.nueva) over (order by fr.desde_min, fr.hasta_min) as g from fr),
    islas as (
      select min(grp.desde_min) as d, max(grp.hasta_min) as h from grp group by grp.g)
    select 1 from islas where islas.d <= v_m_ini and v_m_fin <= islas.h);
end $$;

-- Avisos que se pueden confirmar: hora pasada, fuera del horario del barbero, sobre un bloqueo.
create or replace function public.fn_avisos_cita(p_barberia uuid, p_barbero uuid, p_inicio timestamptz,
                                                 p_fin timestamptz, p_nombre_barbero text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_avisos jsonb := '[]'::jsonb;
  v_b      record;
begin
  if p_inicio < now() - interval '15 minutes' then
    v_avisos := v_avisos || jsonb_build_array(jsonb_build_object('tipo', 'pasado', 'mensaje', 'Esa hora ya pasó.'));
  end if;
  if not public.fn_dentro_de_horario(p_barberia, p_barbero, p_inicio, p_fin) then
    v_avisos := v_avisos || jsonb_build_array(jsonb_build_object(
      'tipo', 'fuera_de_horario', 'mensaje', p_nombre_barbero || ' no trabaja a esa hora.'));
  end if;
  for v_b in
    select x.motivo from public.bloqueos x
     where x.barberia_id = p_barberia and x.barbero_id = p_barbero and x.activo
       and x.inicio < p_fin and x.fin > p_inicio
     order by x.inicio
  loop
    v_avisos := v_avisos || jsonb_build_array(jsonb_build_object(
      'tipo', 'bloqueo',
      'mensaje', p_nombre_barbero || ' tiene un bloqueo' || coalesce(' (' || v_b.motivo || ')', '')
                 || ' que se cruza con esa hora.'));
  end loop;
  return v_avisos;
end $$;

-- El cliente de una cita: uno existente (p_cliente) o, por celular, el que ya existe o uno nuevo.
-- Sin celular siempre es uno nuevo (no se unen por nombre: dos "Juan" no son la misma persona).
create or replace function public.fn_cliente_resolver(p_barberia uuid, p_cliente uuid, p_nombre text, p_telefono text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nombre   text := public.fn_limpiar_texto(p_nombre);
  v_telefono text := public.fn_normalizar_telefono(p_telefono);
  v_id       uuid;
begin
  if p_cliente is not null then
    select id into v_id from public.clientes where barberia_id = p_barberia and id = p_cliente and activo;
    if v_id is null then
      raise exception 'No existe ese cliente.' using errcode = 'P0002';
    end if;
    return v_id;
  end if;

  if length(v_nombre) = 0 or length(v_nombre) > 60 then
    raise exception 'Escribe el nombre del cliente (máximo 60 caracteres).';
  end if;

  if v_telefono is not null then
    select id into v_id from public.clientes where barberia_id = p_barberia and telefono = v_telefono;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  begin
    insert into public.clientes (barberia_id, nombre, telefono)
    values (p_barberia, v_nombre, v_telefono)
    returning id into v_id;
  exception when unique_violation then
    -- Otro lo creó justo ahora con el mismo celular: se usa ese.
    select id into v_id from public.clientes where barberia_id = p_barberia and telefono = v_telefono;
  end;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Insertar una cita (lo comparten crear_cita y crear_cita_sin_reserva)
-- ---------------------------------------------------------------------
create or replace function public.fn_crear_cita(
  p_barberia uuid, p_barbero uuid, p_servicio uuid, p_inicio timestamptz,
  p_cliente uuid, p_cliente_nombre text, p_cliente_telefono text, p_notas text,
  p_estado text, p_avisar boolean, p_confirmar boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inicio  timestamptz := date_trunc('minute', p_inicio);
  v_notas   text := nullif(public.fn_limpiar_texto(p_notas), '');
  v_barbero record;
  v_serv    record;
  v_asig    record;
  v_fin     timestamptz;
  v_avisos  jsonb;
  v_cliente uuid;
  v_id      uuid;
  v_token   uuid;
  v_precio  integer;
  v_choque  record;
begin
  if p_inicio is null then
    raise exception 'Elige la fecha y la hora de la cita.';
  end if;
  if v_notas is not null and length(v_notas) > 300 then
    raise exception 'La nota es muy larga (máximo 300 letras).';
  end if;

  select nombre, activo into v_barbero
    from public.barberos where barberia_id = p_barberia and id = p_barbero;
  if not found then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  if not v_barbero.activo then
    raise exception '% ya no está activo.', v_barbero.nombre;
  end if;

  select nombre, activo, duracion_min into v_serv
    from public.servicios where barberia_id = p_barberia and id = p_servicio;
  if not found then
    raise exception 'No existe ese servicio.' using errcode = 'P0002';
  end if;
  if not v_serv.activo then
    raise exception 'El servicio % está archivado.', v_serv.nombre;
  end if;

  select duracion_propia into v_asig
    from public.barbero_servicios where barbero_id = p_barbero and servicio_id = p_servicio;
  if not found then
    raise exception '% no hace el servicio %.', v_barbero.nombre, v_serv.nombre;
  end if;

  v_fin := public.fn_sumar_minutos(v_inicio, coalesce(v_asig.duracion_propia, v_serv.duracion_min));

  if p_avisar and not coalesce(p_confirmar, false) then
    v_avisos := public.fn_avisos_cita(p_barberia, p_barbero, v_inicio, v_fin, v_barbero.nombre);
    if jsonb_array_length(v_avisos) > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'avisos', 'avisos', v_avisos);
    end if;
  end if;

  v_cliente := public.fn_cliente_resolver(p_barberia, p_cliente, p_cliente_nombre, p_cliente_telefono);

  begin
    insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio, estado, notas)
    values (p_barberia, p_barbero, v_cliente, p_servicio, v_inicio, p_estado, v_notas)
    returning id, token, precio into v_id, v_token, v_precio;
  exception when exclusion_violation then
    select c.inicio, c.fin, cl.nombre as cliente into v_choque
      from public.citas c
      join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
     where c.barberia_id = p_barberia and c.barbero_id = p_barbero
       and c.estado in ('confirmada', 'en_atencion', 'atendida')
       and tstzrange(c.inicio, c.fin, '[)') && tstzrange(v_inicio, v_fin, '[)')
     order by c.inicio
     limit 1;
    if v_choque.cliente is null then
      raise exception '% ya tiene una cita a esa hora.', v_barbero.nombre;
    end if;
    raise exception '% ya tiene a % de % a % (elige otra hora).',
      v_barbero.nombre, v_choque.cliente, public.fn_hora_texto(v_choque.inicio), public.fn_hora_texto(v_choque.fin);
  end;

  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token, 'inicio', v_inicio, 'fin', v_fin,
                            'precio', v_precio, 'cliente_id', v_cliente);
end $$;

-- ---------------------------------------------------------------------
-- 3. API del personal
-- ---------------------------------------------------------------------

-- Agenda una cita. Cliente: `p_cliente` (existente) o `p_cliente_nombre` (+ celular opcional, que lo reconoce si ya existe).
create or replace function public.crear_cita(
  p_barbero uuid, p_servicio uuid, p_inicio timestamptz,
  p_cliente uuid default null, p_cliente_nombre text default null, p_cliente_telefono text default null,
  p_notas text default null, p_confirmar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.fn_requerir_agenda_de(p_barbero);
begin
  return public.fn_crear_cita(v_barberia, p_barbero, p_servicio, p_inicio, p_cliente, p_cliente_nombre,
                              p_cliente_telefono, p_notas, 'confirmada', true, p_confirmar);
end $$;

-- "Llegó sin cita": la cita empieza AHORA (en atención). Si el barbero está ocupado, falla con quién lo tiene.
create or replace function public.crear_cita_sin_reserva(
  p_barbero uuid, p_servicio uuid,
  p_cliente uuid default null, p_cliente_nombre text default null, p_cliente_telefono text default null,
  p_notas text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.fn_requerir_agenda_de(p_barbero);
begin
  return public.fn_crear_cita(v_barberia, p_barbero, p_servicio, now(), p_cliente, p_cliente_nombre,
                              p_cliente_telefono, p_notas, 'en_atencion', false, true);
end $$;

-- Cambia SOLO la hora de una cita confirmada. Ocupada -> falla y la deja donde estaba.
create or replace function public.mover_cita(p_id uuid, p_inicio timestamptz, p_confirmar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_inicio   timestamptz := date_trunc('minute', p_inicio);
  v_c        record;
  v_nombre   text;
  v_fin      timestamptz;
  v_avisos   jsonb;
  v_choque   record;
begin
  if p_inicio is null then
    raise exception 'Elige la nueva fecha y hora.';
  end if;

  select c.barbero_id, c.estado, c.inicio, c.duracion_min into v_c
    from public.citas c where c.barberia_id = v_barberia and c.id = p_id
     for update;
  if not found then
    raise exception 'No existe esa cita.' using errcode = 'P0002';
  end if;
  perform public.fn_requerir_agenda_de(v_c.barbero_id);

  if v_c.estado <> 'confirmada' then
    raise exception 'Solo se pueden mover las citas confirmadas (esta está %).', public.fn_texto_estado(v_c.estado);
  end if;

  v_fin := public.fn_sumar_minutos(v_inicio, v_c.duracion_min);
  if v_inicio = v_c.inicio then
    return jsonb_build_object('ok', true, 'id', p_id, 'inicio', v_inicio, 'fin', v_fin);
  end if;

  select nombre into v_nombre from public.barberos where barberia_id = v_barberia and id = v_c.barbero_id;

  if not coalesce(p_confirmar, false) then
    v_avisos := public.fn_avisos_cita(v_barberia, v_c.barbero_id, v_inicio, v_fin, v_nombre);
    if jsonb_array_length(v_avisos) > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'avisos', 'avisos', v_avisos);
    end if;
  end if;

  begin
    update public.citas
       set inicio = v_inicio, recordatorio_enviado_at = null
     where barberia_id = v_barberia and id = p_id;
  exception when exclusion_violation then
    select c.inicio, c.fin, cl.nombre as cliente into v_choque
      from public.citas c
      join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
     where c.barberia_id = v_barberia and c.barbero_id = v_c.barbero_id and c.id <> p_id
       and c.estado in ('confirmada', 'en_atencion', 'atendida')
       and tstzrange(c.inicio, c.fin, '[)') && tstzrange(v_inicio, v_fin, '[)')
     order by c.inicio
     limit 1;
    if v_choque.cliente is null then
      raise exception '% ya tiene una cita a esa hora.', v_nombre;
    end if;
    raise exception '% ya tiene a % de % a % (elige otra hora).',
      v_nombre, v_choque.cliente, public.fn_hora_texto(v_choque.inicio), public.fn_hora_texto(v_choque.fin);
  end;

  return jsonb_build_object('ok', true, 'id', p_id, 'inicio', v_inicio, 'fin', v_fin);
end $$;

-- Cancela una cita confirmada. El motivo es obligatorio y la hora queda libre.
create or replace function public.cancelar_cita(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_motivo   text := public.fn_limpiar_texto(p_motivo);
  v_c        record;
begin
  if length(v_motivo) = 0 then
    raise exception 'Escribe por qué se cancela la cita.';
  end if;
  if length(v_motivo) > 200 then
    raise exception 'El motivo es muy largo (máximo 200 letras).';
  end if;

  select c.barbero_id, c.estado into v_c
    from public.citas c where c.barberia_id = v_barberia and c.id = p_id
     for update;
  if not found then
    raise exception 'No existe esa cita.' using errcode = 'P0002';
  end if;
  perform public.fn_requerir_agenda_de(v_c.barbero_id);

  if v_c.estado <> 'confirmada' then
    raise exception 'Solo se pueden cancelar las citas confirmadas (esta está %).', public.fn_texto_estado(v_c.estado);
  end if;

  update public.citas
     set estado = 'cancelada', cancelada_motivo = v_motivo, cancelada_por = auth.uid(), cancelada_at = now()
   where barberia_id = v_barberia and id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'estado', 'cancelada');
end $$;

-- Cambios de estado (la cancelación va por cancelar_cita):
--   confirmada  -> en_atencion (empezar) · no_asistio (no llegó; solo cuando ya es la hora)
--   en_atencion -> atendida (terminar) · confirmada (deshacer)
--   atendida    -> en_atencion (reabrir)
--   no_asistio  -> confirmada (deshacer)
--   cancelada   -> confirmada (reactivar; falla si otra cita ya tomó la hora)
create or replace function public.cambiar_estado_cita(p_id uuid, p_estado text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_c        record;
  v_ok       boolean;
  v_nombre   text;
  v_choque   record;
begin
  if p_estado is null or p_estado not in ('confirmada', 'en_atencion', 'atendida', 'no_asistio') then
    raise exception 'Ese estado no es válido (para cancelar se usa «cancelar la cita»).';
  end if;

  select c.barbero_id, c.estado, c.inicio, c.fin into v_c
    from public.citas c where c.barberia_id = v_barberia and c.id = p_id
     for update;
  if not found then
    raise exception 'No existe esa cita.' using errcode = 'P0002';
  end if;
  perform public.fn_requerir_agenda_de(v_c.barbero_id);

  v_ok := case v_c.estado
            when 'confirmada'  then p_estado in ('en_atencion', 'no_asistio')
            when 'en_atencion' then p_estado in ('atendida', 'confirmada')
            when 'atendida'    then p_estado = 'en_atencion'
            when 'no_asistio'  then p_estado = 'confirmada'
            when 'cancelada'   then p_estado = 'confirmada'
            else false
          end;
  if not v_ok then
    raise exception 'Una cita % no se puede pasar a %.',
      public.fn_texto_estado(v_c.estado), public.fn_texto_estado(p_estado);
  end if;
  if p_estado = 'no_asistio' and now() < v_c.inicio then
    raise exception 'Todavía no es la hora de la cita.';
  end if;

  begin
    update public.citas
       set estado = p_estado,
           cancelada_motivo = case when p_estado = 'confirmada' then null else cancelada_motivo end,
           cancelada_por    = case when p_estado = 'confirmada' then null else cancelada_por end,
           cancelada_at     = case when p_estado = 'confirmada' then null else cancelada_at end
     where barberia_id = v_barberia and id = p_id;
  exception when exclusion_violation then
    select nombre into v_nombre from public.barberos where barberia_id = v_barberia and id = v_c.barbero_id;
    select c.inicio, c.fin, cl.nombre as cliente into v_choque
      from public.citas c
      join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
     where c.barberia_id = v_barberia and c.barbero_id = v_c.barbero_id and c.id <> p_id
       and c.estado in ('confirmada', 'en_atencion', 'atendida')
       and tstzrange(c.inicio, c.fin, '[)') && tstzrange(v_c.inicio, v_c.fin, '[)')
     order by c.inicio
     limit 1;
    raise exception 'No se puede reactivar: % ya tiene a % de % a % (esa hora ya la tomaron).',
      v_nombre, coalesce(v_choque.cliente, 'otra persona'),
      coalesce(public.fn_hora_texto(v_choque.inicio), public.fn_hora_texto(v_c.inicio)),
      coalesce(public.fn_hora_texto(v_choque.fin), public.fn_hora_texto(v_c.fin));
  end;

  return jsonb_build_object('ok', true, 'id', p_id, 'estado', p_estado);
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000011_agenda_lecturas.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0011 · LECTURAS DE LA AGENDA (tarea 1.7 · SPEC F4)
--
--   listar_citas(...)    las citas de un rango de días (hora de Bogotá), con cliente, servicio y barbero.
--   obtener_huecos(...)  las horas libres para el PERSONAL (sin anticipación ni "acepta reservas"; nunca las pasadas).
--   buscar_clientes(...) clientes por nombre o celular, con visitas, última visita y "no asistió".
--
-- Quién ve qué lo decide la base: "agenda" y "caja" ven todas las citas; "mi_agenda" (el barbero) solo las suyas
-- (RLS de 0008). obtener_huecos a quien solo tiene "mi_agenda" le responde únicamente por su propio tiempo.
-- =====================================================================

-- Citas de un rango de días de Bogotá [p_desde, p_hasta] (por defecto hoy), en orden de hora.
-- Las canceladas no salen salvo que se pidan. Lee con los permisos de quien llama (RLS).
create or replace function public.listar_citas(p_desde date default null, p_hasta date default null,
                                               p_barbero uuid default null, p_con_canceladas boolean default false)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_desde date := coalesce(p_desde, public.hoy_bogota());
  v_hasta date := coalesce(p_hasta, coalesce(p_desde, public.hoy_bogota()));
begin
  if v_hasta < v_desde or v_hasta - v_desde > 62 then
    raise exception 'El rango de fechas no es válido (máximo 62 días).';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'barbero_id', c.barbero_id, 'barbero', b.nombre,
          'cliente_id', c.cliente_id, 'cliente', cl.nombre, 'telefono', cl.telefono,
          'servicio_id', c.servicio_id, 'servicio', s.nombre,
          'inicio', c.inicio, 'fin', c.fin, 'duracion_min', c.duracion_min, 'precio', c.precio,
          'estado', c.estado, 'origen', c.origen, 'notas', c.notas,
          'recordatorio_enviado_at', c.recordatorio_enviado_at, 'cancelada_motivo', c.cancelada_motivo)
        order by c.inicio, b.orden, c.id),
      '[]'::jsonb)
      from public.citas c
      join public.barberos b  on b.barberia_id = c.barberia_id and b.id = c.barbero_id
      join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
      join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
     where c.inicio >= (v_desde::timestamp at time zone 'America/Bogota')
       and c.inicio <  ((v_hasta + 1)::timestamp at time zone 'America/Bogota')
       and (p_barbero is null or c.barbero_id = p_barbero)
       and (coalesce(p_con_canceladas, false) or c.estado <> 'cancelada')
  );
end $$;

-- Una cita con los mismos datos que listar_citas (null si no existe o no la puede ver quien pregunta).
create or replace function public.obtener_cita(p_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'id', c.id,
           'barbero_id', c.barbero_id, 'barbero', b.nombre,
           'cliente_id', c.cliente_id, 'cliente', cl.nombre, 'telefono', cl.telefono,
           'servicio_id', c.servicio_id, 'servicio', s.nombre,
           'inicio', c.inicio, 'fin', c.fin, 'duracion_min', c.duracion_min, 'precio', c.precio,
           'estado', c.estado, 'origen', c.origen, 'notas', c.notas,
           'recordatorio_enviado_at', c.recordatorio_enviado_at, 'cancelada_motivo', c.cancelada_motivo)
    from public.citas c
    join public.barberos b  on b.barberia_id = c.barberia_id and b.id = c.barbero_id
    join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
    join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
   where c.id = p_id
$$;

-- Horas libres para el personal: [{"barbero_id", "inicio", "fin"}, …].
--   * Con p_barbero: las de ese barbero. Sin p_barbero: "la primera disponible" (una hora por instante, con el
--     barbero que ese día tiene menos citas).
--   * p_ignorar_cita: al mover una cita, la propia no cuenta contra sí misma.
create or replace function public.obtener_huecos(p_servicio uuid, p_barbero uuid default null,
                                                 p_desde date default null, p_hasta date default null,
                                                 p_ignorar_cita uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda');
  v_barbero  uuid := p_barbero;
begin
  if not public.tiene_area('agenda') then
    -- Solo "mi_agenda": únicamente su propio tiempo.
    v_barbero := public.mi_barbero();
    if v_barbero is null or (p_barbero is not null and p_barbero <> v_barbero) then
      raise exception 'Solo puedes ver tu propia agenda.' using errcode = '42501';
    end if;
  end if;

  if v_barbero is null then
    return coalesce((
      select jsonb_agg(jsonb_build_object('barbero_id', h.barbero_id, 'inicio', h.inicio, 'fin', h.fin)
                       order by h.inicio, h.barbero_id)
        from public.fn_huecos_cualquiera(v_barberia, p_servicio, p_desde, p_hasta, now(), false, p_ignorar_cita) h
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('barbero_id', h.barbero_id, 'inicio', h.inicio, 'fin', h.fin)
                     order by h.inicio, h.barbero_id)
      from public.fn_huecos(v_barberia, p_servicio, v_barbero, p_desde, p_hasta, now(), false, p_ignorar_cita) h
  ), '[]'::jsonb);
end $$;

-- Clientes por nombre (parte, sin importar mayúsculas) o por celular (dígitos). Sin texto: los más recientes.
-- visitas = citas atendidas; no_asistio = veces que no llegó; ultima_visita = su última cita atendida.
create or replace function public.buscar_clientes(p_texto text default null, p_limite integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda', 'caja');
  v_texto    text := nullif(public.fn_limpiar_texto(p_texto), '');
  v_digitos  text := regexp_replace(coalesce(p_texto, ''), '\D', '', 'g');
  v_limite   integer := least(greatest(coalesce(p_limite, 20), 1), 50);
begin
  return (
    select coalesce(jsonb_agg(f.fila order by f.ultima desc nulls last, f.orden_nombre), '[]'::jsonb)
      from (
        select jsonb_build_object(
                 'id', t.id, 'nombre', t.nombre, 'telefono', t.telefono, 'nota', t.nota,
                 'visitas', t.visitas, 'no_asistio', t.no_asistio, 'ultima_visita', t.ultima) as fila,
               t.ultima, lower(t.nombre) as orden_nombre
          from (
            select cl.id, cl.nombre, cl.telefono, cl.nota,
                   (select count(*) from public.citas c
                     where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id and c.estado = 'atendida')::integer as visitas,
                   (select count(*) from public.citas c
                     where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id and c.estado = 'no_asistio')::integer as no_asistio,
                   (select max(c.inicio) from public.citas c
                     where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id and c.estado = 'atendida') as ultima
              from public.clientes cl
             where cl.barberia_id = v_barberia and cl.activo
               and (v_texto is null
                    or cl.nombre ilike '%' || replace(replace(v_texto, '%', ''), '_', '') || '%'
                    or (length(v_digitos) >= 3 and cl.telefono like '%' || v_digitos || '%'))
          ) t
         order by t.ultima desc nulls last, lower(t.nombre)
         limit v_limite
      ) f
  );
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000012_clientes_funciones.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0012 · CLIENTES: ALTA, FICHA Y NOTA DEL CORTE (tarea 1.8 · SPEC F10)
--
--   * El alta AUTOMÁTICA por celular ya existe: crear_cita une o crea el cliente (fn_cliente_resolver, 0010).
--     Un celular es un cliente dentro de la barbería (índice único, 0008).
--   * crear_cliente(...)         alta manual (p. ej. pasar la libreta). Un celular repetido dice de quién es.
--   * actualizar_cliente(...)    nombre y celular (recepción: área "agenda").
--   * guardar_nota_cliente(...)  la nota del corte ("degradé 2 a los lados"): también la escribe el barbero.
--   * obtener_cliente(...)       la ficha: datos, visitas, no asistió, última visita y las últimas 20 citas.
--                                El barbero (solo "mi_agenda") ve en el historial únicamente SUS citas.
--
-- No se borra a nadie. (La supresión de datos personales a pedido del titular, Ley 1581, se resuelve con una
-- función propia en la Fase 4: no es un DELETE.)
-- =====================================================================

create or replace function public.crear_cliente(p_nombre text, p_telefono text default null, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda');
  v_nombre   text := public.fn_limpiar_texto(p_nombre);
  v_telefono text := public.fn_normalizar_telefono(p_telefono);
  v_nota     text := nullif(public.fn_limpiar_texto(p_nota), '');
  v_id       uuid;
  v_dueno    text;
begin
  if length(v_nombre) = 0 or length(v_nombre) > 60 then
    raise exception 'Escribe el nombre del cliente (máximo 60 caracteres).';
  end if;
  if v_nota is not null and length(v_nota) > 300 then
    raise exception 'La nota es muy larga (máximo 300 letras).';
  end if;

  if v_telefono is not null then
    select nombre into v_dueno from public.clientes where barberia_id = v_barberia and telefono = v_telefono;
    if found then
      raise exception 'Ese celular ya es de %.', v_dueno;
    end if;
  end if;

  begin
    insert into public.clientes (barberia_id, nombre, telefono, nota)
    values (v_barberia, v_nombre, v_telefono, v_nota)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ese celular ya es de otro cliente.';
  end;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.actualizar_cliente(p_id uuid, p_nombre text, p_telefono text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda');
  v_nombre   text := public.fn_limpiar_texto(p_nombre);
  v_telefono text := public.fn_normalizar_telefono(p_telefono);
  v_dueno    text;
begin
  if length(v_nombre) = 0 or length(v_nombre) > 60 then
    raise exception 'Escribe el nombre del cliente (máximo 60 caracteres).';
  end if;

  if v_telefono is not null then
    select nombre into v_dueno
      from public.clientes where barberia_id = v_barberia and telefono = v_telefono and id <> p_id;
    if found then
      raise exception 'Ese celular ya es de %.', v_dueno;
    end if;
  end if;

  begin
    update public.clientes set nombre = v_nombre, telefono = v_telefono
     where barberia_id = v_barberia and id = p_id;
  exception when unique_violation then
    raise exception 'Ese celular ya es de otro cliente.';
  end;
  if not found then
    raise exception 'No existe ese cliente.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end $$;

-- La nota del corte. Vacía = sin nota.
create or replace function public.guardar_nota_cliente(p_id uuid, p_nota text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda');
  v_nota     text := nullif(public.fn_limpiar_texto(p_nota), '');
begin
  if v_nota is not null and length(v_nota) > 300 then
    raise exception 'La nota es muy larga (máximo 300 letras).';
  end if;
  update public.clientes set nota = v_nota where barberia_id = v_barberia and id = p_id;
  if not found then
    raise exception 'No existe ese cliente.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end $$;

-- La ficha del cliente (null si no existe). Quien solo abre "mi_agenda" ve en el historial únicamente sus citas.
create or replace function public.obtener_cliente(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda', 'caja');
  v_todas    boolean := public.tiene_area('agenda', 'caja');
  v_mio      uuid := public.mi_barbero();
  v          jsonb;
begin
  select jsonb_build_object(
           'id', cl.id, 'nombre', cl.nombre, 'telefono', cl.telefono, 'nota', cl.nota, 'creado', cl.created_at,
           'visitas', (select count(*) from public.citas c
                        where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id and c.estado = 'atendida'),
           'no_asistio', (select count(*) from public.citas c
                           where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id and c.estado = 'no_asistio'),
           'ultima_visita', (select max(c.inicio) from public.citas c
                              where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id and c.estado = 'atendida'),
           'citas', coalesce((
             select jsonb_agg(to_jsonb(h) order by h.inicio desc)
               from (
                 select c.id, c.inicio, c.fin, c.estado, c.precio, s.nombre as servicio, b.nombre as barbero
                   from public.citas c
                   join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
                   join public.barberos b on b.barberia_id = c.barberia_id and b.id = c.barbero_id
                  where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id
                    and (v_todas or c.barbero_id = v_mio)
                  order by c.inicio desc
                  limit 20
               ) h), '[]'::jsonb))
    into v
    from public.clientes cl
   where cl.barberia_id = v_barberia and cl.id = p_id;
  return v;
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000013_invitaciones_equipo.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0013 · EL EQUIPO ENTRA CON UN CÓDIGO (tarea 1.9 · SPEC F1)
--
--   1. INVITACIÓN: quien administra el equipo (área "equipo") escribe el nombre de la persona, le elige roles y
--      (si es barbero) a qué barbero corresponde. La base le da un código de 8 letras y números (sin 0/O/1/I, para que
--      no se confundan) que sirve UNA vez y por 3 días. En el celular de esa persona se abre /unirme (con el enlace o
--      escribiendo el código): la app abre una sesión anónima de Supabase en ese celular y canjea el código, que
--      crea su perfil en la barbería con esos roles y la vincula con su barbero. Sin correo ni contraseña.
--      El código se guarda tal cual (para volver a mostrarlo mientras esté vigente); nadie lee la tabla directamente:
--      solo listar_equipo, para quien administra el equipo.
--   2. QUITAR DEL EQUIPO: esa persona pierde el acceso al instante (su perfil y sus roles se van; el barbero que
--      tenía vinculado se conserva, solo queda sin cuenta).
--   3. SIN ESCALAR PERMISOS: nadie le da a otro más áreas de las que ya tiene. Quien administra el equipo solo
--      asigna roles cuyas áreas ya abre, y no toca a quien tiene más poder que él. El dueño lo abre todo.
--
-- No hay (todavía) pantalla para crear o editar roles: la barbería arranca con Barbero y Recepción.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Invitaciones
-- ---------------------------------------------------------------------
create table if not exists public.invitaciones (
  id             uuid primary key default gen_random_uuid(),
  barberia_id    uuid not null references public.barberias(id),
  codigo         text not null check (codigo ~ '^[A-HJ-NP-Z2-9]{8}$'),
  nombre         text not null check (length(btrim(nombre)) between 1 and 40),
  roles          uuid[] not null default '{}',      -- ids de roles_equipo de esta barbería (se revisan al canjear)
  barbero_id     uuid,                              -- el barbero que esta persona será (opcional)
  expira_at      timestamptz not null,
  usada_at       timestamptz,
  usada_por      uuid references auth.users(id) on delete set null,
  anulada_at     timestamptz,
  created_at     timestamptz not null default now(),
  registrado_por uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  constraint ux_invitaciones_codigo unique (codigo),
  foreign key (barberia_id, barbero_id) references public.barberos (barberia_id, id)
);
create index if not exists idx_invitaciones_barberia on public.invitaciones (barberia_id, created_at);
comment on table public.invitaciones is 'Códigos para que una persona entre al equipo desde su celular (un uso, 3 días).';

alter table public.invitaciones enable row level security;
-- Sin políticas y sin privilegios: el código es una llave. Solo las funciones de abajo la leen.

-- 8 caracteres de 32 posibles (2^40 combinaciones), con bytes aleatorios de un uuid v4 (los que no llevan la
-- versión ni la variante).
create or replace function public.fn_codigo_invitacion()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_letras constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes  bytea := uuid_send(gen_random_uuid());
  v_codigo text := '';
  i        integer;
begin
  foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
    v_codigo := v_codigo || substr(v_letras, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_codigo;
end $$;

-- Roles activos de la barbería a partir de un arreglo jsonb de ids. Si alguno no existe (o es de otra barbería), error.
create or replace function public.fn_roles_validos(p_barberia uuid, p_roles jsonb)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_roles uuid[];
begin
  if p_roles is null or jsonb_typeof(p_roles) <> 'array' then
    raise exception 'Elige los roles de esta persona.';
  end if;
  begin
    select coalesce(array_agg(distinct x.valor::uuid), '{}'::uuid[]) into v_roles
      from jsonb_array_elements_text(p_roles) as x(valor);
  exception when invalid_text_representation then
    raise exception 'El rol no existe.' using errcode = 'P0002';
  end;
  if (select count(*) from public.roles_equipo
       where barberia_id = p_barberia and activo and id = any (v_roles)) <> cardinality(v_roles) then
    raise exception 'El rol no existe.' using errcode = 'P0002';
  end if;
  return v_roles;
end $$;

-- Nadie da más áreas de las que tiene: las áreas de esos roles deben estar TODAS entre las de quien llama.
create or replace function public.fn_exigir_roles_asignables(p_barberia uuid, p_roles uuid[])
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedidas text[];
begin
  select coalesce(array_agg(distinct a), '{}'::text[]) into v_pedidas
    from public.roles_equipo r, unnest(r.areas) a
   where r.barberia_id = p_barberia and r.id = any (p_roles);
  if not (v_pedidas <@ coalesce(public.fn_areas_de(auth.uid()), '{}'::text[])) then
    raise exception 'No puedes dar permisos que tú no tienes.' using errcode = '42501';
  end if;
end $$;

-- ¿Las áreas de esa persona caben entre las de quien llama? (para no tocar a alguien con más poder)
create or replace function public.fn_exigir_poder_sobre(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (coalesce(public.fn_areas_de(p_user), '{}'::text[]) <@ coalesce(public.fn_areas_de(auth.uid()), '{}'::text[])) then
    raise exception 'No puedes cambiar a alguien con más permisos que tú.' using errcode = '42501';
  end if;
end $$;

-- Invita a alguien: nombre, roles y (si es barbero) cuál. Devuelve el código y hasta cuándo sirve.
create or replace function public.crear_invitacion(p_nombre text, p_roles jsonb, p_barbero uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('equipo');
  v_nombre   text := left(public.fn_limpiar_texto(p_nombre), 40);
  v_roles    uuid[];
  v_codigo   text;
  v_id       uuid;
  v_expira   timestamptz := now() + interval '72 hours';
begin
  if length(v_nombre) = 0 then
    raise exception 'Escribe el nombre de la persona.';
  end if;
  v_roles := public.fn_roles_validos(v_barberia, p_roles);
  if cardinality(v_roles) = 0 then
    raise exception 'Elige al menos un rol: sin roles no podría hacer nada.';
  end if;
  perform public.fn_exigir_roles_asignables(v_barberia, v_roles);

  if p_barbero is not null then
    if not exists (select 1 from public.barberos where barberia_id = v_barberia and id = p_barbero and activo) then
      raise exception 'No existe ese barbero.' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.barberos where barberia_id = v_barberia and id = p_barbero and user_id is not null) then
      raise exception 'Ese barbero ya tiene una cuenta.';
    end if;
  end if;

  if (select count(*) from public.perfiles where barberia_id = v_barberia) >= 30 then
    raise exception 'El equipo ya tiene 30 personas. Quita a alguien que ya no trabaje contigo.';
  end if;
  if (select count(*) from public.invitaciones
       where barberia_id = v_barberia and usada_at is null and anulada_at is null and expira_at > now()) >= 10 then
    raise exception 'Hay muchas invitaciones sin usar. Anula alguna antes de crear otra.';
  end if;

  -- Limpieza oportunista: lo que ya no sirve y tiene más de 30 días.
  delete from public.invitaciones
   where barberia_id = v_barberia and created_at < now() - interval '30 days'
     and (usada_at is not null or anulada_at is not null or expira_at < now());

  loop
    v_codigo := public.fn_codigo_invitacion();
    exit when not exists (select 1 from public.invitaciones where codigo = v_codigo);
  end loop;

  insert into public.invitaciones (barberia_id, codigo, nombre, roles, barbero_id, expira_at)
  values (v_barberia, v_codigo, v_nombre, v_roles, p_barbero, v_expira)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'codigo', v_codigo, 'nombre', v_nombre, 'expira_at', v_expira);
end $$;

create or replace function public.anular_invitacion(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('equipo');
begin
  update public.invitaciones set anulada_at = now()
   where id = p_id and barberia_id = v_barberia and usada_at is null and anulada_at is null;
  if not found then
    raise exception 'La invitación no existe o ya se usó.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end $$;

-- En el celular de la persona invitada (ya con su sesión anónima): el código la vuelve parte del equipo.
create or replace function public.canjear_invitacion(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_codigo  text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
  v_inv     public.invitaciones%rowtype;
  v_de      text;
  v_vinculado boolean := false;
begin
  if v_uid is null then
    raise exception 'Abre la invitación en el celular que vas a usar.' using errcode = '42501';
  end if;
  select b.nombre into v_de
    from public.perfiles p join public.barberias b on b.id = p.barberia_id
   where p.user_id = v_uid;
  if found then
    raise exception 'Este celular ya está en el equipo de %. Para unirte con otro código, sal de la app primero.', v_de;
  end if;

  select * into v_inv from public.invitaciones
   where codigo = v_codigo and usada_at is null and anulada_at is null and expira_at > now()
   for update;
  if not found then
    raise exception 'Ese código no sirve: revisa que esté bien escrito, o pide uno nuevo (cada código sirve una sola vez y por 3 días).'
      using errcode = 'P0002';
  end if;

  insert into public.perfiles (user_id, barberia_id, rol, nombre)
  values (v_uid, v_inv.barberia_id, 'equipo', v_inv.nombre);

  insert into public.perfil_roles (barberia_id, user_id, rol_id, registrado_por)
  select v_inv.barberia_id, v_uid, r.id, v_inv.registrado_por
    from public.roles_equipo r
   where r.barberia_id = v_inv.barberia_id and r.activo and r.id = any (v_inv.roles);

  -- Si la invitación era para un barbero y todavía no tiene cuenta, esta persona pasa a serlo.
  if v_inv.barbero_id is not null then
    update public.barberos set user_id = v_uid
     where barberia_id = v_inv.barberia_id and id = v_inv.barbero_id and user_id is null and activo;
    v_vinculado := found;
  end if;

  update public.invitaciones set usada_at = now(), usada_por = v_uid where id = v_inv.id;

  return jsonb_build_object(
    'barberia', (select nombre from public.barberias where id = v_inv.barberia_id),
    'nombre', v_inv.nombre,
    'areas', to_jsonb(public.fn_areas_de(v_uid)),
    'barbero_vinculado', v_vinculado
  );
end $$;

-- ---------------------------------------------------------------------
-- 2. Administrar el equipo
-- ---------------------------------------------------------------------

-- Quita a alguien: su celular pierde el acceso al instante (su perfil y sus roles se van; el barbero se conserva).
create or replace function public.quitar_del_equipo(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('equipo');
  v_p        public.perfiles%rowtype;
begin
  select * into v_p from public.perfiles where user_id = p_user_id and barberia_id = v_barberia for update;
  if not found then
    raise exception 'Esa persona no es de tu equipo.' using errcode = 'P0002';
  end if;
  if v_p.rol = 'dueno' then
    raise exception 'Al dueño no se le puede quitar del equipo.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'No puedes quitarte a ti mismo del equipo.';
  end if;
  perform public.fn_exigir_poder_sobre(p_user_id);

  delete from public.perfiles where user_id = p_user_id and barberia_id = v_barberia;  -- sus roles se van con él
  return jsonb_build_object('user_id', p_user_id, 'nombre', v_p.nombre);
end $$;

-- Deja a la persona con exactamente estos roles.
create or replace function public.cambiar_roles_miembro(p_user_id uuid, p_roles jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('equipo');
  v_p        public.perfiles%rowtype;
  v_roles    uuid[];
begin
  select * into v_p from public.perfiles where user_id = p_user_id and barberia_id = v_barberia for update;
  if not found then
    raise exception 'Esa persona no es de tu equipo.' using errcode = 'P0002';
  end if;
  if v_p.rol = 'dueno' then
    raise exception 'El dueño ya tiene todos los permisos.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'No puedes cambiar tus propios roles.';
  end if;

  v_roles := public.fn_roles_validos(v_barberia, p_roles);
  if cardinality(v_roles) = 0 then
    raise exception 'Elige al menos un rol: sin roles no podría hacer nada.';
  end if;
  perform public.fn_exigir_poder_sobre(p_user_id);
  perform public.fn_exigir_roles_asignables(v_barberia, v_roles);

  delete from public.perfil_roles where barberia_id = v_barberia and user_id = p_user_id;
  insert into public.perfil_roles (barberia_id, user_id, rol_id)
  select v_barberia, p_user_id, r from unnest(v_roles) r;
  return jsonb_build_object('user_id', p_user_id, 'areas', to_jsonb(public.fn_areas_de(p_user_id)));
end $$;

-- El equipo: roles (con sus áreas), personas (con roles y barbero) e invitaciones pendientes (con su código).
-- Solo para quien administra el equipo.
create or replace function public.listar_equipo()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('equipo');
begin
  return jsonb_build_object(
    'areas', to_jsonb(public.fn_areas()),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'nombre', r.nombre, 'areas', to_jsonb(r.areas),
               'personas', (select count(*) from public.perfil_roles pr
                             where pr.barberia_id = v_barberia and pr.rol_id = r.id)
             ) order by r.orden, r.nombre)
        from public.roles_equipo r
       where r.barberia_id = v_barberia and r.activo), '[]'::jsonb),
    'personas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'nombre', p.nombre, 'rol', p.rol, 'yo', p.user_id = auth.uid(),
               'roles', coalesce((select jsonb_agg(pr.rol_id order by r.orden, r.nombre)
                                    from public.perfil_roles pr
                                    join public.roles_equipo r
                                      on r.barberia_id = pr.barberia_id and r.id = pr.rol_id and r.activo
                                   where pr.barberia_id = v_barberia and pr.user_id = p.user_id), '[]'::jsonb),
               'areas', to_jsonb(public.fn_areas_de(p.user_id)),
               'barbero', (select jsonb_build_object('id', b.id, 'nombre', b.nombre)
                             from public.barberos b
                            where b.barberia_id = v_barberia and b.user_id = p.user_id)
             ) order by p.rol = 'dueno' desc, p.created_at, p.nombre)
        from public.perfiles p
       where p.barberia_id = v_barberia), '[]'::jsonb),
    'invitaciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'nombre', i.nombre, 'codigo', i.codigo, 'expira_at', i.expira_at,
               'roles', coalesce((select jsonb_agg(r.id order by r.orden, r.nombre)
                                    from public.roles_equipo r
                                   where r.barberia_id = v_barberia and r.activo and r.id = any (i.roles)), '[]'::jsonb),
               'barbero', (select jsonb_build_object('id', b.id, 'nombre', b.nombre)
                             from public.barberos b
                            where b.barberia_id = v_barberia and b.id = i.barbero_id)
             ) order by i.created_at desc)
        from public.invitaciones i
       where i.barberia_id = v_barberia and i.usada_at is null and i.anulada_at is null and i.expira_at > now()),
      '[]'::jsonb)
  );
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000014_recordatorio_cita.sql >>>>>>>>>>
-- Migración 0014 · Recordatorio de cita por WhatsApp (tarea 1.10, SPEC F4).
--
-- La app NO manda mensajes sola: el personal abre WhatsApp con el mensaje ya armado (enlace wa.me) y lo envía
-- él. Esta función solo deja constancia de que ese recordatorio se abrió: `citas.recordatorio_enviado_at`.
--
--   * Solo citas confirmadas: las demás (en atención, atendidas, canceladas, no llegó) ya no lo necesitan.
--   * Hace falta el celular del cliente: sin él no hay a dónde mandarlo.
--   * Permiso: el de la agenda de ese barbero (fn_requerir_agenda_de): "agenda" de cualquiera, o "mi_agenda"
--     para las citas propias.
--   * Registrarlo otra vez es válido ("se lo volví a mandar"): solo cambia la hora.
--   * Mover la cita borra la marca (migración 0010): el aviso que se mandó era de otra hora.

create or replace function public.registrar_recordatorio_cita(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_ahora    timestamptz := now();
  v_c        record;
begin
  select c.barbero_id, c.estado, cl.telefono into v_c
    from public.citas c
    join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
   where c.barberia_id = v_barberia and c.id = p_id
     for update of c;
  if not found then
    raise exception 'No existe esa cita.' using errcode = 'P0002';
  end if;
  perform public.fn_requerir_agenda_de(v_c.barbero_id);

  if v_c.estado <> 'confirmada' then
    raise exception 'Solo se recuerdan las citas confirmadas (esta está %).', public.fn_texto_estado(v_c.estado);
  end if;
  if v_c.telefono is null then
    raise exception 'El cliente no tiene celular: agrégalo en su ficha para poder recordarle la cita.';
  end if;

  update public.citas set recordatorio_enviado_at = v_ahora
   where barberia_id = v_barberia and id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'recordatorio_enviado_at', v_ahora);
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000015_reserva_publica.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0015 · RESERVA PÚBLICA, LA API SIN CUENTA (tarea 2.1 · SPEC F5)
--
-- Lo ÚNICO que un visitante sin cuenta (rol anon) puede ejecutar. Nada de tablas: solo estas funciones.
--
--   publico_catalogo(slug)                      barbería, servicios y barberos que aceptan reservas.
--   publico_huecos(slug, servicio, barbero?, desde, hasta)   horas libres (UNA sola función SQL: fn_huecos).
--   publico_reservar(slug, servicio, barbero?, inicio, nombre, celular, consentimiento, web)
--   publico_consultar_cita(token)               la cita de quien tiene el enlace secreto.
--   publico_cancelar_cita(token, motivo?)       hasta el límite de la barbería.
--   publico_huecos_cita(token, desde, hasta)    horas a las que ESA cita se puede mover.
--   publico_reprogramar_cita(token, inicio)     mismo barbero y servicio, otra hora, hasta el límite.
--
-- REGLAS
--   * Cada una es un envoltorio de una fn_publico_* que recibe `p_ahora`: las pruebas usan un "ahora" fijo.
--   * Nunca devuelven nombres ni celulares de OTROS clientes: ni en los errores. Una hora que no está libre es
--     siempre {"ok": false, "motivo": "hora_ocupada"}, sin decir quién la tiene.
--   * Reservar revisa que la hora esté entre las libres PÚBLICAS (anticipación, días hacia adelante, horario,
--     bloqueos) y, aun así, la restricción de la tabla decide si dos llegan a la vez.
--   * El campo trampa (`p_web`) lo llenan los robots, no las personas. Los topes (2.2) viven en fn_publico_topes.
--   * La cita nace `confirmada`, con origen `cliente`, y deja constancia del consentimiento (Ley 1581).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columnas nuevas
-- ---------------------------------------------------------------------
alter table public.barberias
  add column if not exists reservas_en_linea boolean not null default true,
  add column if not exists cancelar_hasta_horas integer not null default 2
    constraint chk_barberias_cancelar_hasta check (cancelar_hasta_horas between 0 and 168);
comment on column public.barberias.reservas_en_linea is 'Si apagada, el cliente ve el catálogo pero no puede reservar.';
comment on column public.barberias.cancelar_hasta_horas is 'Hasta cuántas horas antes puede cancelar o mover el cliente su cita.';

alter table public.citas add column if not exists consentimiento_at timestamptz;
comment on column public.citas.consentimiento_at is 'Cuándo el cliente aceptó el tratamiento de sus datos al reservar en línea (Ley 1581).';

-- ---------------------------------------------------------------------
-- 2. fn_crear_cita ahora sabe el origen (personal | cliente). La firma cambia: se reemplaza la de 0010.
-- ---------------------------------------------------------------------
drop function if exists public.fn_crear_cita(uuid, uuid, uuid, timestamptz, uuid, text, text, text, text, boolean, boolean);

create or replace function public.fn_crear_cita(
  p_barberia uuid, p_barbero uuid, p_servicio uuid, p_inicio timestamptz,
  p_cliente uuid, p_cliente_nombre text, p_cliente_telefono text, p_notas text,
  p_estado text, p_avisar boolean, p_confirmar boolean, p_origen text default 'personal')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inicio  timestamptz := date_trunc('minute', p_inicio);
  v_notas   text := nullif(public.fn_limpiar_texto(p_notas), '');
  v_barbero record;
  v_serv    record;
  v_asig    record;
  v_fin     timestamptz;
  v_avisos  jsonb;
  v_cliente uuid;
  v_id      uuid;
  v_token   uuid;
  v_precio  integer;
  v_choque  record;
begin
  if p_inicio is null then
    raise exception 'Elige la fecha y la hora de la cita.';
  end if;
  if v_notas is not null and length(v_notas) > 300 then
    raise exception 'La nota es muy larga (máximo 300 letras).';
  end if;

  select nombre, activo into v_barbero
    from public.barberos where barberia_id = p_barberia and id = p_barbero;
  if not found then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  if not v_barbero.activo then
    raise exception '% ya no está activo.', v_barbero.nombre;
  end if;

  select nombre, activo, duracion_min into v_serv
    from public.servicios where barberia_id = p_barberia and id = p_servicio;
  if not found then
    raise exception 'No existe ese servicio.' using errcode = 'P0002';
  end if;
  if not v_serv.activo then
    raise exception 'El servicio % está archivado.', v_serv.nombre;
  end if;

  select duracion_propia into v_asig
    from public.barbero_servicios where barbero_id = p_barbero and servicio_id = p_servicio;
  if not found then
    raise exception '% no hace el servicio %.', v_barbero.nombre, v_serv.nombre;
  end if;

  v_fin := public.fn_sumar_minutos(v_inicio, coalesce(v_asig.duracion_propia, v_serv.duracion_min));

  if p_avisar and not coalesce(p_confirmar, false) then
    v_avisos := public.fn_avisos_cita(p_barberia, p_barbero, v_inicio, v_fin, v_barbero.nombre);
    if jsonb_array_length(v_avisos) > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'avisos', 'avisos', v_avisos);
    end if;
  end if;

  v_cliente := public.fn_cliente_resolver(p_barberia, p_cliente, p_cliente_nombre, p_cliente_telefono);

  begin
    insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio, estado, notas, origen)
    values (p_barberia, p_barbero, v_cliente, p_servicio, v_inicio, p_estado, v_notas, coalesce(p_origen, 'personal'))
    returning id, token, precio into v_id, v_token, v_precio;
  exception when exclusion_violation then
    select c.inicio, c.fin, cl.nombre as cliente into v_choque
      from public.citas c
      join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
     where c.barberia_id = p_barberia and c.barbero_id = p_barbero
       and c.estado in ('confirmada', 'en_atencion', 'atendida')
       and tstzrange(c.inicio, c.fin, '[)') && tstzrange(v_inicio, v_fin, '[)')
     order by c.inicio
     limit 1;
    if v_choque.cliente is null then
      raise exception '% ya tiene una cita a esa hora.', v_barbero.nombre;
    end if;
    raise exception '% ya tiene a % de % a % (elige otra hora).',
      v_barbero.nombre, v_choque.cliente, public.fn_hora_texto(v_choque.inicio), public.fn_hora_texto(v_choque.fin);
  end;

  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token, 'inicio', v_inicio, 'fin', v_fin,
                            'precio', v_precio, 'cliente_id', v_cliente);
end $$;

-- ---------------------------------------------------------------------
-- 3. Ayudantes internos
-- ---------------------------------------------------------------------

-- Los topes anti-abuso (tarea 2.2). Devuelve el motivo del rechazo o null si pasa. Aquí todavía no hay topes.
create or replace function public.fn_publico_topes(p_barberia uuid, p_telefono text, p_ahora timestamptz)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select null::text $$;

-- Una respuesta de rechazo: el motivo (para la pantalla) y un mensaje ya listo, en español.
create or replace function public.fn_publico_no(p_motivo text, p_mensaje text)
returns jsonb
language sql
immutable
set search_path = ''
as $$ select jsonb_build_object('ok', false, 'motivo', p_motivo, 'mensaje', p_mensaje) $$;

-- ---------------------------------------------------------------------
-- 4. Catálogo y horas libres
-- ---------------------------------------------------------------------

-- La barbería, sus servicios (los que algún barbero que acepta reservas hace) y esos barberos con su precio y
-- duración efectivos. No hay nada del equipo ni de los clientes. Slug desconocido: {"existe": false}.
create or replace function public.publico_catalogo(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_b record;
begin
  select b.id, b.nombre, b.slug, b.whatsapp, b.direccion, b.reservas_en_linea, b.dias_adelante,
         b.anticipacion_min, b.cancelar_hasta_horas
    into v_b
    from public.barberias b
   where b.slug = lower(btrim(coalesce(p_slug, '')));
  if not found then
    return jsonb_build_object('existe', false);
  end if;

  return jsonb_build_object(
    'existe', true,
    'barberia', jsonb_build_object(
      'nombre', v_b.nombre, 'slug', v_b.slug, 'whatsapp', v_b.whatsapp, 'direccion', v_b.direccion,
      'reservas_en_linea', v_b.reservas_en_linea, 'dias_adelante', v_b.dias_adelante,
      'anticipacion_min', v_b.anticipacion_min, 'cancelar_hasta_horas', v_b.cancelar_hasta_horas),
    'servicios', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio,
                                          'duracion_min', s.duracion_min) order by s.orden, s.nombre)
        from public.servicios s
       where s.barberia_id = v_b.id and s.activo
         and exists (
               select 1 from public.barbero_servicios bs
                 join public.barberos x on x.barberia_id = bs.barberia_id and x.id = bs.barbero_id
                where bs.barberia_id = v_b.id and bs.servicio_id = s.id and x.activo and x.acepta_reservas)
    ), '[]'::jsonb),
    'barberos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'nombre', x.nombre,
               'servicios', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'servicio_id', s.id,
                          'precio', coalesce(bs.precio_propio, s.precio),
                          'duracion_min', coalesce(bs.duracion_propia, s.duracion_min)) order by s.orden, s.nombre),
                        '[]'::jsonb)
                   from public.barbero_servicios bs
                   join public.servicios s on s.barberia_id = bs.barberia_id and s.id = bs.servicio_id
                  where bs.barberia_id = v_b.id and bs.barbero_id = x.id and s.activo)
             ) order by x.orden, x.nombre)
        from public.barberos x
       where x.barberia_id = v_b.id and x.activo and x.acepta_reservas
         and exists (
               select 1 from public.barbero_servicios bs
                 join public.servicios s on s.barberia_id = bs.barberia_id and s.id = bs.servicio_id
                where bs.barberia_id = v_b.id and bs.barbero_id = x.id and s.activo)
    ), '[]'::jsonb)
  );
end $$;

-- Horas libres de un servicio entre dos días (máximo 62), con un barbero o "la primera disponible" (p_barbero nulo).
-- Cerrado (reservas apagadas) o slug desconocido: lista vacía.
create or replace function public.fn_publico_huecos(
  p_slug text, p_servicio uuid, p_barbero uuid, p_desde date, p_hasta date, p_ahora timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_b record;
begin
  select b.id, b.reservas_en_linea into v_b
    from public.barberias b where b.slug = lower(btrim(coalesce(p_slug, '')));
  if not found or not v_b.reservas_en_linea or p_servicio is null then
    return '[]'::jsonb;
  end if;

  if p_barbero is null then
    return coalesce((
      select jsonb_agg(jsonb_build_object('barbero_id', h.barbero_id, 'inicio', h.inicio, 'fin', h.fin)
                       order by h.inicio)
        from public.fn_huecos_cualquiera(v_b.id, p_servicio, p_desde, p_hasta, p_ahora, true, null) h
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('barbero_id', h.barbero_id, 'inicio', h.inicio, 'fin', h.fin)
                     order by h.inicio)
      from public.fn_huecos(v_b.id, p_servicio, p_barbero, p_desde, p_hasta, p_ahora, true, null) h
  ), '[]'::jsonb);
end $$;

create or replace function public.publico_huecos(
  p_slug text, p_servicio uuid, p_barbero uuid default null, p_desde date default null, p_hasta date default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.fn_publico_huecos(p_slug, p_servicio, p_barbero, p_desde, p_hasta, now())
$$;

-- ---------------------------------------------------------------------
-- 5. Reservar
-- ---------------------------------------------------------------------
create or replace function public.fn_publico_reservar(
  p_slug text, p_servicio uuid, p_barbero uuid, p_inicio timestamptz,
  p_nombre text, p_telefono text, p_consentimiento boolean, p_web text, p_ahora timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b       record;
  v_nombre  text := coalesce(public.fn_limpiar_texto(p_nombre), '');
  v_tel     text;
  v_inicio  timestamptz;
  v_fecha   date;
  v_barbero uuid;
  v_motivo  text;
  v_r       jsonb;
  v_resumen record;
begin
  -- Campo trampa: una persona no lo ve ni lo llena.
  if btrim(coalesce(p_web, '')) <> '' then
    return public.fn_publico_no('rechazada', 'No pudimos procesar la reserva.');
  end if;

  select b.id, b.nombre, b.reservas_en_linea into v_b
    from public.barberias b where b.slug = lower(btrim(coalesce(p_slug, '')));
  if not found then
    return public.fn_publico_no('no_existe', 'Esa barbería no existe.');
  end if;
  if not v_b.reservas_en_linea then
    return public.fn_publico_no('cerrado', 'Hoy no recibimos reservas en línea.');
  end if;
  if p_consentimiento is distinct from true then
    return public.fn_publico_no('consentimiento', 'Para reservar tienes que aceptar el tratamiento de tus datos.');
  end if;
  if length(v_nombre) = 0 or length(v_nombre) > 60 then
    return public.fn_publico_no('datos', 'Escribe tu nombre (máximo 60 letras).');
  end if;

  begin
    v_tel := public.fn_normalizar_telefono(p_telefono);
  exception when raise_exception then
    v_tel := null;
  end;
  if v_tel is null then
    return public.fn_publico_no('celular_invalido', 'Escribe tu celular con 10 dígitos, por ejemplo 300 123 4567.');
  end if;

  if p_inicio is null or p_servicio is null then
    return public.fn_publico_no('hora_ocupada', 'Esa hora ya no está disponible. Elige otra.');
  end if;
  v_inicio := date_trunc('minute', p_inicio);
  v_fecha := public.fecha_bogota(v_inicio);

  v_motivo := public.fn_publico_topes(v_b.id, v_tel, p_ahora);
  if v_motivo is not null then
    return public.fn_publico_no(v_motivo, 'No pudimos agendar esta reserva ahora. Llámanos o escríbenos por WhatsApp.');
  end if;

  -- La hora tiene que estar entre las libres PÚBLICAS (anticipación, días hacia adelante, horario, bloqueos).
  if p_barbero is null then
    select h.barbero_id into v_barbero
      from public.fn_huecos_cualquiera(v_b.id, p_servicio, v_fecha, v_fecha, p_ahora, true, null) h
     where h.inicio = v_inicio
     limit 1;
  else
    select h.barbero_id into v_barbero
      from public.fn_huecos(v_b.id, p_servicio, p_barbero, v_fecha, v_fecha, p_ahora, true, null) h
     where h.inicio = v_inicio
     limit 1;
  end if;
  if v_barbero is null then
    return public.fn_publico_no('hora_ocupada', 'Esa hora ya no está disponible. Elige otra.');
  end if;

  begin
    v_r := public.fn_crear_cita(v_b.id, v_barbero, p_servicio, v_inicio, null, v_nombre, v_tel, null,
                                'confirmada', false, true, 'cliente');
  exception when raise_exception or exclusion_violation then
    -- Alguien la tomó justo antes (el único error que queda después de validar todo lo demás).
    return public.fn_publico_no('hora_ocupada', 'Esa hora ya la tomaron. Elige otra.');
  end;

  update public.citas set consentimiento_at = p_ahora
   where barberia_id = v_b.id and id = (v_r ->> 'id')::uuid;

  select s.nombre as servicio, x.nombre as barbero into v_resumen
    from public.servicios s, public.barberos x
   where s.barberia_id = v_b.id and s.id = p_servicio and x.barberia_id = v_b.id and x.id = v_barbero;

  return jsonb_build_object(
    'ok', true, 'token', v_r -> 'token', 'inicio', v_r -> 'inicio', 'fin', v_r -> 'fin', 'precio', v_r -> 'precio',
    'servicio', v_resumen.servicio, 'barbero', v_resumen.barbero, 'barberia', v_b.nombre);
end $$;

create or replace function public.publico_reservar(
  p_slug text, p_servicio uuid, p_barbero uuid, p_inicio timestamptz,
  p_nombre text, p_telefono text, p_consentimiento boolean, p_web text default null)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.fn_publico_reservar(p_slug, p_servicio, p_barbero, p_inicio, p_nombre, p_telefono,
                                    p_consentimiento, p_web, now())
$$;

-- ---------------------------------------------------------------------
-- 6. La cita de quien tiene el enlace secreto
-- ---------------------------------------------------------------------

-- ¿Hasta cuándo se puede cancelar o mover? (instante). Una cita ya empezada no.
create or replace function public.fn_publico_limite(p_inicio timestamptz, p_horas integer)
returns timestamptz
language sql
immutable
set search_path = ''
as $$ select p_inicio - make_interval(hours => p_horas) $$;

create or replace function public.fn_publico_consultar(p_token uuid, p_ahora timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_c      record;
  v_limite timestamptz;
  v_ok     boolean;
begin
  select c.id, c.inicio, c.fin, c.estado, c.precio, c.duracion_min,
         s.nombre as servicio, x.nombre as barbero, cl.nombre as cliente,
         b.nombre as barberia, b.slug, b.whatsapp, b.direccion, b.cancelar_hasta_horas, b.dias_adelante
    into v_c
    from public.citas c
    join public.barberias b on b.id = c.barberia_id
    join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
    join public.barberos x on x.barberia_id = c.barberia_id and x.id = c.barbero_id
    join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
   where c.token = p_token;
  if not found then
    return jsonb_build_object('existe', false);
  end if;

  v_limite := public.fn_publico_limite(v_c.inicio, v_c.cancelar_hasta_horas);
  v_ok := v_c.estado = 'confirmada' and p_ahora <= v_limite;

  return jsonb_build_object(
    'existe', true,
    'barberia', jsonb_build_object('nombre', v_c.barberia, 'slug', v_c.slug, 'whatsapp', v_c.whatsapp,
                                   'direccion', v_c.direccion, 'cancelar_hasta_horas', v_c.cancelar_hasta_horas,
                                   'dias_adelante', v_c.dias_adelante),
    'cita', jsonb_build_object(
      'inicio', v_c.inicio, 'fin', v_c.fin, 'estado', v_c.estado, 'servicio', v_c.servicio,
      'barbero', v_c.barbero, 'cliente', v_c.cliente, 'precio', v_c.precio, 'duracion_min', v_c.duracion_min,
      'puede_cambiar', v_ok, 'limite', v_limite));
end $$;

create or replace function public.publico_consultar_cita(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select public.fn_publico_consultar(p_token, now()) $$;

-- Cancela (con motivo opcional). Fuera de plazo o ya no confirmada: no cambia nada.
create or replace function public.fn_publico_cancelar(p_token uuid, p_motivo text, p_ahora timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c      record;
  v_motivo text := nullif(btrim(coalesce(public.fn_limpiar_texto(p_motivo), '')), '');
  v_limite timestamptz;
begin
  select c.id, c.barberia_id, c.inicio, c.estado, b.cancelar_hasta_horas into v_c
    from public.citas c join public.barberias b on b.id = c.barberia_id
   where c.token = p_token
     for update of c;
  if not found then
    return public.fn_publico_no('no_existe', 'No encontramos esa cita.');
  end if;
  if v_c.estado <> 'confirmada' then
    return public.fn_publico_no('no_se_puede', 'Esta cita ya no se puede cancelar.');
  end if;
  v_limite := public.fn_publico_limite(v_c.inicio, v_c.cancelar_hasta_horas);
  if p_ahora > v_limite then
    return public.fn_publico_no('fuera_de_plazo',
      'Ya pasó el plazo para cancelar por aquí. Escríbenos por WhatsApp.');
  end if;
  if v_motivo is not null and length(v_motivo) > 200 then
    v_motivo := left(v_motivo, 200);
  end if;

  update public.citas
     set estado = 'cancelada',
         cancelada_motivo = coalesce(v_motivo, 'Canceló el cliente'),
         cancelada_por = null,
         cancelada_at = p_ahora
   where barberia_id = v_c.barberia_id and id = v_c.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.publico_cancelar_cita(p_token uuid, p_motivo text default null)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$ select public.fn_publico_cancelar(p_token, p_motivo, now()) $$;

-- Horas a las que esa cita se puede mover (mismo barbero y servicio; ignora a la propia cita).
create or replace function public.fn_publico_huecos_cita(p_token uuid, p_desde date, p_hasta date, p_ahora timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_c record;
begin
  select c.id, c.barberia_id, c.barbero_id, c.servicio_id, c.inicio, c.estado,
         b.cancelar_hasta_horas, b.reservas_en_linea
    into v_c
    from public.citas c join public.barberias b on b.id = c.barberia_id
   where c.token = p_token;
  if not found or v_c.estado <> 'confirmada' or not v_c.reservas_en_linea
     or p_ahora > public.fn_publico_limite(v_c.inicio, v_c.cancelar_hasta_horas) then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('barbero_id', h.barbero_id, 'inicio', h.inicio, 'fin', h.fin)
                     order by h.inicio)
      from public.fn_huecos(v_c.barberia_id, v_c.servicio_id, v_c.barbero_id, p_desde, p_hasta, p_ahora, true, v_c.id) h
  ), '[]'::jsonb);
end $$;

create or replace function public.publico_huecos_cita(p_token uuid, p_desde date default null, p_hasta date default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select public.fn_publico_huecos_cita(p_token, p_desde, p_hasta, now()) $$;

-- Cambia solo la hora. Si la nueva no está libre, la cita se queda donde estaba.
create or replace function public.fn_publico_reprogramar(p_token uuid, p_inicio timestamptz, p_ahora timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c      record;
  v_inicio timestamptz := date_trunc('minute', p_inicio);
  v_fecha  date;
  v_fin    timestamptz;
  v_libre  boolean;
begin
  select c.id, c.barberia_id, c.barbero_id, c.servicio_id, c.inicio, c.estado, c.duracion_min,
         b.cancelar_hasta_horas, b.reservas_en_linea
    into v_c
    from public.citas c join public.barberias b on b.id = c.barberia_id
   where c.token = p_token
     for update of c;
  if not found then
    return public.fn_publico_no('no_existe', 'No encontramos esa cita.');
  end if;
  if v_c.estado <> 'confirmada' then
    return public.fn_publico_no('no_se_puede', 'Esta cita ya no se puede mover.');
  end if;
  if p_ahora > public.fn_publico_limite(v_c.inicio, v_c.cancelar_hasta_horas) then
    return public.fn_publico_no('fuera_de_plazo', 'Ya pasó el plazo para mover la cita por aquí. Escríbenos por WhatsApp.');
  end if;
  if not v_c.reservas_en_linea then
    return public.fn_publico_no('cerrado', 'Hoy no recibimos cambios en línea. Escríbenos por WhatsApp.');
  end if;
  if p_inicio is null then
    return public.fn_publico_no('hora_ocupada', 'Esa hora ya no está disponible. Elige otra.');
  end if;
  v_fecha := public.fecha_bogota(v_inicio);

  select exists (
    select 1 from public.fn_huecos(v_c.barberia_id, v_c.servicio_id, v_c.barbero_id, v_fecha, v_fecha, p_ahora, true, v_c.id) h
     where h.inicio = v_inicio) into v_libre;
  if not v_libre then
    return public.fn_publico_no('hora_ocupada', 'Esa hora ya no está disponible. Elige otra.');
  end if;

  begin
    update public.citas set inicio = v_inicio, recordatorio_enviado_at = null
     where barberia_id = v_c.barberia_id and id = v_c.id
     returning fin into v_fin;
  exception when exclusion_violation then
    return public.fn_publico_no('hora_ocupada', 'Esa hora ya la tomaron. Elige otra.');
  end;

  return jsonb_build_object('ok', true, 'inicio', v_inicio, 'fin', v_fin);
end $$;

create or replace function public.publico_reprogramar_cita(p_token uuid, p_inicio timestamptz)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$ select public.fn_publico_reprogramar(p_token, p_inicio, now()) $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000016_reserva_topes.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0016 · ANTI-ABUSO DE LA RESERVA PÚBLICA (tarea 2.2 · SPEC F5)
--
-- El enlace de reservas lo puede abrir cualquiera: los topes viven en la base, no en la pantalla.
--   * Campo trampa: ya lo revisa fn_publico_reservar (0015): quien lo llena es un robot.
--   * Por celular: máximo 3 citas confirmadas por venir (de la misma barbería). Cancelar una libera el cupo.
--   * Por barbería: máximo 10 reservas en línea por minuto (cuenta las creadas en el último minuto REAL).
-- Los topes se miden sobre las mismas citas: no hay una tabla de intentos aparte. Un robot puede ocupar 10 horas
-- por minuto como mucho, y el personal las cancela con motivo; el tope por celular lo frena apenas repite el número.
--
-- Devuelve el motivo del rechazo ('tope_celular' | 'tope_minuto') o null si pasa. Es el que llama fn_publico_reservar.
-- =====================================================================

create or replace function public.fn_publico_topes(p_barberia uuid, p_telefono text, p_ahora timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_max_celular constant integer := 3;
  v_max_minuto  constant integer := 10;
  v_n           integer;
begin
  select count(*)::integer into v_n
    from public.citas c
    join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
   where c.barberia_id = p_barberia and cl.telefono = p_telefono
     and c.estado = 'confirmada' and c.inicio >= p_ahora;
  if v_n >= v_max_celular then
    return 'tope_celular';
  end if;

  select count(*)::integer into v_n
    from public.citas c
   where c.barberia_id = p_barberia and c.origen = 'cliente'
     and c.created_at > now() - interval '1 minute';
  if v_n >= v_max_minuto then
    return 'tope_minuto';
  end if;

  return null;
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000017_ajustes_reservas.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0017 · INTERRUPTOR DE RESERVAS EN LÍNEA Y LÍMITE PARA CANCELAR (tarea 2.6 · SPEC F5)
--
--   * `reservas_en_linea` y `cancelar_hasta_horas` (columnas de 0015) se cambian desde los ajustes de la agenda,
--     junto con paso, días adelante, anticipación y descanso. Área "servicios", como el resto de los ajustes.
--   * Los dos parámetros nuevos son opcionales (null = dejar como está): las llamadas de 4 argumentos siguen igual.
--   * `obtener_contexto` los incluye en `agenda` para que la pantalla de ajustes los muestre.
-- =====================================================================

-- La firma cambia (se agregan dos parámetros): se reemplaza la de 0007, no se deja una sobrecarga.
drop function if exists public.actualizar_parametros_agenda(integer, integer, integer, integer);

create or replace function public.actualizar_parametros_agenda(
  p_paso_min integer, p_dias_adelante integer, p_anticipacion_min integer, p_colchon_min integer,
  p_reservas_en_linea boolean default null, p_cancelar_hasta_horas integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('servicios');
  v_b        record;
begin
  if p_paso_min is null or p_paso_min not in (15, 30) then
    raise exception 'Las horas de reserva arrancan cada 15 o cada 30 minutos.';
  end if;
  if p_dias_adelante is null or p_dias_adelante < 1 or p_dias_adelante > 90 then
    raise exception 'Se puede reservar de 1 a 90 días hacia adelante.';
  end if;
  if p_anticipacion_min is null or p_anticipacion_min < 0 or p_anticipacion_min > 1440 then
    raise exception 'La anticipación mínima va de 0 minutos a 24 horas.';
  end if;
  if p_colchon_min is null or p_colchon_min < 0 or p_colchon_min > 60 then
    raise exception 'El descanso entre citas va de 0 a 60 minutos.';
  end if;
  if p_cancelar_hasta_horas is not null and (p_cancelar_hasta_horas < 0 or p_cancelar_hasta_horas > 168) then
    raise exception 'El cliente puede cancelar o mover hasta 0 a 168 horas antes de la cita.';
  end if;

  update public.barberias
     set paso_min = p_paso_min, dias_adelante = p_dias_adelante,
         anticipacion_min = p_anticipacion_min, colchon_min = p_colchon_min,
         reservas_en_linea = coalesce(p_reservas_en_linea, reservas_en_linea),
         cancelar_hasta_horas = coalesce(p_cancelar_hasta_horas, cancelar_hasta_horas)
   where id = v_barberia
   returning paso_min, dias_adelante, anticipacion_min, colchon_min, reservas_en_linea, cancelar_hasta_horas
        into v_b;

  return jsonb_build_object('paso_min', v_b.paso_min, 'dias_adelante', v_b.dias_adelante,
                            'anticipacion_min', v_b.anticipacion_min, 'colchon_min', v_b.colchon_min,
                            'reservas_en_linea', v_b.reservas_en_linea,
                            'cancelar_hasta_horas', v_b.cancelar_hasta_horas);
end $$;

-- Igual que la de 0007, con los dos ajustes nuevos dentro de `agenda`.
create or replace function public.obtener_contexto()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'barberia', (select jsonb_build_object('id', b.id, 'nombre', b.nombre, 'slug', b.slug, 'es_demo', b.es_demo,
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

-- >>>>>>>>>> 20261015000018_avisos_push.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0018 · AVISOS PUSH AL PERSONAL (tarea 2.7 · SPEC F11)
--
-- Cuando un cliente reserva o cancela desde su enlace, el personal recibe un aviso en el celular (Web Push). La app
-- no usa `service_role`, así que el servidor de la app lee las suscripciones por la única puerta pública que hay:
--
--   publico_tomar_aviso(token, tipo)   con el token de la cita (el permiso del cliente), UNA sola vez, y solo si la
--                                      reserva o la cancelación es de los últimos 10 minutos. Devuelve los datos de
--                                      la cita y las suscripciones de quienes deben enterarse.
--   publico_olvidar_suscripcion_push(endpoint)   borra una suscripción que el servicio de push dio por muerta.
--
-- Quién recibe: el dueño y quien abre "agenda" (todas las citas), y el barbero de ESA cita si abre "mi_agenda".
-- Una suscripción por sí sola no sirve para mandar avisos: hace falta la llave privada VAPID, que vive solo en el
-- servidor de la app. Sin esas llaves la app funciona igual (no se manda nada).
--
--   guardar_suscripcion_push(...)  y  quitar_suscripcion_push(...)   las llama cada persona desde su celular.
-- =====================================================================

create table if not exists public.suscripciones_push (
  id             uuid primary key default gen_random_uuid(),
  barberia_id    uuid not null references public.barberias(id),
  user_id        uuid not null,
  endpoint       text not null check (endpoint ~ '^https://' and length(endpoint) between 20 and 1000),
  p256dh         text not null check (length(p256dh) between 20 and 200),
  auth           text not null check (length(auth) between 8 and 100),
  created_at     timestamptz not null default now(),
  registrado_por uuid default auth.uid() references auth.users(id) on delete set null,
  unique (endpoint),
  foreign key (barberia_id, user_id) references public.perfiles (barberia_id, user_id) on delete cascade
);
create index if not exists idx_suscripciones_push_barberia on public.suscripciones_push (barberia_id);
comment on table public.suscripciones_push is 'Celulares del equipo que quieren recibir avisos de reservas y cancelaciones (Web Push).';

alter table public.suscripciones_push enable row level security;
-- Sin políticas y sin privilegios: son llaves de cifrado. Solo las funciones de abajo las tocan.

-- Cada aviso se manda una sola vez por cita.
alter table public.citas
  add column if not exists aviso_reserva_at timestamptz,
  add column if not exists aviso_cancelacion_at timestamptz;

-- ---------------------------------------------------------------------
-- 1. Del equipo: activar y apagar los avisos en SU celular
-- ---------------------------------------------------------------------
create or replace function public.guardar_suscripcion_push(p_endpoint text, p_p256dh text, p_auth text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda');
begin
  -- Si ese celular ya estaba (otra persona lo usaba antes), pasa a esta.
  insert into public.suscripciones_push (barberia_id, user_id, endpoint, p256dh, auth)
  values (v_barberia, auth.uid(), btrim(coalesce(p_endpoint, '')), btrim(coalesce(p_p256dh, '')), btrim(coalesce(p_auth, '')))
  on conflict (endpoint) do update
     set barberia_id = excluded.barberia_id, user_id = excluded.user_id,
         p256dh = excluded.p256dh, auth = excluded.auth;
  return jsonb_build_object('ok', true);
exception when check_violation then
  raise exception 'Ese celular no pudo activar los avisos. Intenta de nuevo.';
end $$;

create or replace function public.quitar_suscripcion_push(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda');
begin
  delete from public.suscripciones_push
   where barberia_id = v_barberia and user_id = auth.uid() and endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 2. Del servidor de la app, con el token de la cita
-- ---------------------------------------------------------------------
create or replace function public.publico_tomar_aviso(p_token uuid, p_tipo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c        record;
  v_subs     jsonb;
  v_ahora    timestamptz := now();
begin
  if p_tipo is null or p_tipo not in ('reserva', 'cancelacion') then
    return jsonb_build_object('ok', false);
  end if;

  select c.id, c.barberia_id, c.barbero_id, c.inicio, c.estado, c.origen, c.created_at, c.cancelada_por,
         c.cancelada_at, c.aviso_reserva_at, c.aviso_cancelacion_at,
         cl.nombre as cliente, s.nombre as servicio, b.nombre as barbero
    into v_c
    from public.citas c
    join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
    join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
    join public.barberos b on b.barberia_id = c.barberia_id and b.id = c.barbero_id
   where c.token = p_token
     for update of c;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  -- Solo la reserva o la cancelación que el CLIENTE acaba de hacer, y una sola vez.
  if p_tipo = 'reserva' then
    if v_c.origen <> 'cliente' or v_c.aviso_reserva_at is not null or v_c.created_at < v_ahora - interval '10 minutes' then
      return jsonb_build_object('ok', false);
    end if;
    update public.citas set aviso_reserva_at = v_ahora where barberia_id = v_c.barberia_id and id = v_c.id;
  else
    if v_c.estado <> 'cancelada' or v_c.cancelada_por is not null or v_c.aviso_cancelacion_at is not null
       or v_c.cancelada_at < v_ahora - interval '10 minutes' then
      return jsonb_build_object('ok', false);
    end if;
    update public.citas set aviso_cancelacion_at = v_ahora where barberia_id = v_c.barberia_id and id = v_c.id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('endpoint', sp.endpoint, 'p256dh', sp.p256dh, 'auth', sp.auth)), '[]'::jsonb)
    into v_subs
    from public.suscripciones_push sp
   where sp.barberia_id = v_c.barberia_id
     and (
       public.fn_areas_de(sp.user_id) @> array['agenda']::text[]
       or (public.fn_areas_de(sp.user_id) @> array['mi_agenda']::text[]
           and exists (select 1 from public.barberos x
                        where x.barberia_id = v_c.barberia_id and x.id = v_c.barbero_id and x.user_id = sp.user_id))
     );

  return jsonb_build_object(
    'ok', true, 'tipo', p_tipo,
    'cita', jsonb_build_object('id', v_c.id, 'cliente', v_c.cliente, 'servicio', v_c.servicio,
                               'barbero', v_c.barbero, 'inicio', v_c.inicio),
    'suscripciones', v_subs);
end $$;

create or replace function public.publico_olvidar_suscripcion_push(p_endpoint text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  with borradas as (
    delete from public.suscripciones_push where endpoint = p_endpoint returning 1
  )
  select jsonb_build_object('ok', true, 'borradas', (select count(*) from borradas))
$$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000019_cobros.sql >>>>>>>>>>
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

-- >>>>>>>>>> 20261015000020_caja_lecturas.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0020 · LECTURAS DE LA CAJA (tarea 3.2 · SPEC F6)
--
--   obtener_caja(fecha)   lo de un día en la caja: las citas por cobrar, los cobros hechos y cuánto entró por medio.
--   datos_cobro(cita)     lo que necesita la pantalla de Cobrar: la cita (si hay), su cobro vigente (si ya se cobró),
--                         los barberos con el precio que cobra cada uno y el catálogo de servicios.
--
-- Se leen con los permisos de quien llama (RLS): "caja" ve todo; el barbero (mi_agenda), solo lo suyo.
-- =====================================================================

create or replace function public.obtener_caja(p_fecha date default null)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_fecha date := coalesce(p_fecha, public.hoy_bogota());
  v_ini   timestamptz := v_fecha::timestamp at time zone 'America/Bogota';
begin
  return jsonb_build_object(
    'fecha', v_fecha,

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
       where k.fecha = v_fecha
    ), '[]'::jsonb),

    -- Cuánto entró ese día (sin contar los anulados): lo cobrado por servicios, las propinas y por qué medio.
    'totales', jsonb_build_object(
      'cobros', (select count(*) from public.cobros k where k.fecha = v_fecha and not k.anulado),
      'servicios', (select coalesce(sum(k.total), 0) from public.cobros k where k.fecha = v_fecha and not k.anulado),
      'propinas', (select coalesce(sum(k.propina), 0) from public.cobros k where k.fecha = v_fecha and not k.anulado),
      'efectivo', (select coalesce(sum(p.monto), 0)
                     from public.cobro_pagos p join public.cobros k on k.barberia_id = p.barberia_id and k.id = p.cobro_id
                    where k.fecha = v_fecha and not k.anulado and p.medio = 'efectivo'),
      'transferencia', (select coalesce(sum(p.monto), 0)
                          from public.cobro_pagos p join public.cobros k on k.barberia_id = p.barberia_id and k.id = p.cobro_id
                         where k.fecha = v_fecha and not k.anulado and p.medio = 'transferencia')
    )
  );
end $$;

-- Todo lo de la pantalla de Cobrar. Sin p_cita es una venta sin cita (solo barberos y catálogo).
create or replace function public.datos_cobro(p_cita uuid default null)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cita', (select jsonb_build_object(
                      'id', c.id, 'inicio', c.inicio, 'fin', c.fin, 'estado', c.estado, 'precio', c.precio,
                      'servicio_id', c.servicio_id, 'servicio', s.nombre,
                      'cliente_id', c.cliente_id, 'cliente', cl.nombre, 'telefono', cl.telefono,
                      'barbero_id', c.barbero_id, 'barbero', b.nombre)
               from public.citas c
               join public.barberos b  on b.barberia_id = c.barberia_id and b.id = c.barbero_id
               join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
               join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
              where c.id = p_cita),
    -- El cobro vigente de esa cita (null si todavía no se cobra).
    'cobro_id', (select k.id from public.cobros k where k.cita_id = p_cita and not k.anulado),
    -- Barberos activos con el precio que cobra cada uno por cada servicio activo.
    'barberos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'nombre', b.nombre,
               'precios', coalesce((
                  select jsonb_object_agg(s.id::text, coalesce(bs.precio_propio, s.precio))
                    from public.servicios s
                    left join public.barbero_servicios bs
                           on bs.barberia_id = s.barberia_id and bs.barbero_id = b.id and bs.servicio_id = s.id
                   where s.barberia_id = b.barberia_id and s.activo), '{}'::jsonb))
             order by b.orden, b.nombre)
        from public.barberos b where b.activo), '[]'::jsonb),
    'servicios', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio) order by s.orden, s.nombre)
        from public.servicios s where s.activo), '[]'::jsonb)
  )
$$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000021_anular_cobro.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0021 · ANULAR UN COBRO (tarea 3.3 · SPEC F6)
--
--   anular_cobro(cobro, motivo)   anula un cobro con motivo y reabre su cita para corregirla.
--
-- REGLAS
--   * Un cobro no se edita ni se borra: se anula con motivo (obligatorio). Quedan sus líneas, sus pagos, quién lo
--     anuló y cuándo. Un cobro anulado ya no cuenta en la caja ni en las comisiones.
--   * Anular un cobro de cita la reabre: `atendida` -> `en_atencion`, para volver a cobrarla bien (con otra clave).
--   * No quedan huérfanos: una cita con un cobro VIGENTE no sale de `atendida` (ni por la API ni escribiendo directo).
--     Para reabrirla hay que anular el cobro; al anularlo, la cita se reabre sola.
--   * Repetir la clave de un cobro que ya se anuló NO devuelve ese cobro como si estuviera hecho: avisa que se anuló.
--   * Permiso: área "caja" (la misma que cobra).
--   * Más adelante se le suman dos frenos: un cobro liquidado al barbero (3.5) y un día ya cerrado (3.7) no se anulan
--     sin deshacer antes la liquidación o el cierre.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Repetir la clave de un cobro anulado
-- ---------------------------------------------------------------------
-- Antes devolvía siempre el cobro; si alguien lo anuló y la pantalla vieja vuelve a mandar la misma clave, el
-- "Este cobro ya estaba hecho" sería mentira (la cita quedó sin cobrar). Ahora lo dice.
create or replace function public.fn_resultado_cobro(p_barberia uuid, p_id uuid, p_ya boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_res jsonb;
begin
  select jsonb_build_object(
           'ok', true, 'ya_existia', p_ya, 'id', c.id, 'cita_id', c.cita_id,
           'subtotal', c.subtotal, 'descuento', c.descuento, 'total', c.total, 'propina', c.propina,
           'cobrado', c.total + c.propina,
           'vuelto', coalesce((select sum(p.vuelto) from public.cobro_pagos p where p.barberia_id = c.barberia_id and p.cobro_id = c.id), 0),
           'comision', c.comision, 'fecha', c.fecha, 'anulado', c.anulado)
    into v_res
    from public.cobros c
   where c.barberia_id = p_barberia and c.id = p_id;

  if p_ya and coalesce((v_res ->> 'anulado')::boolean, false) then
    raise exception 'Ese cobro ya se anuló. Abre Cobrar de nuevo para cobrar otra vez.';
  end if;
  return v_res;
end $$;

-- ---------------------------------------------------------------------
-- 2. Una cita cobrada se queda atendida
-- ---------------------------------------------------------------------
create or replace function public.fn_cita_cobrada_se_queda()
returns trigger
language plpgsql
security definer      -- ve todos los cobros, sin importar los permisos de quien cambia la cita
set search_path = public, pg_temp
as $$
begin
  if old.estado = 'atendida' and new.estado <> 'atendida'
     and exists (select 1 from public.cobros k
                  where k.barberia_id = old.barberia_id and k.cita_id = old.id and not k.anulado) then
    raise exception 'Esta cita ya está cobrada. Para reabrirla, anula el cobro (se reabre sola).';
  end if;
  return new;
end $$;

drop trigger if exists trg_cita_cobrada_se_queda on public.citas;
create trigger trg_cita_cobrada_se_queda before update of estado on public.citas
  for each row execute function public.fn_cita_cobrada_se_queda();

-- ---------------------------------------------------------------------
-- 3. Anular
-- ---------------------------------------------------------------------
create or replace function public.anular_cobro(p_cobro uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('caja');
  v_motivo   text := public.fn_motivo(p_motivo);
  v_cita      uuid;
  v_anulado   boolean;
  v_reabierta boolean := false;
begin
  -- Mismo orden de bloqueo que al cobrar (primero la cita, después el cobro), para que no se crucen.
  select k.cita_id into v_cita from public.cobros k where k.barberia_id = v_barberia and k.id = p_cobro;
  if not found then
    raise exception 'No existe ese cobro.' using errcode = 'P0002';
  end if;
  if v_cita is not null then
    perform 1 from public.citas c where c.barberia_id = v_barberia and c.id = v_cita for update;
  end if;

  select k.anulado into v_anulado from public.cobros k where k.barberia_id = v_barberia and k.id = p_cobro for update;
  if v_anulado then
    raise exception 'Este cobro ya está anulado.';
  end if;

  update public.cobros
     set anulado = true, anulado_motivo = v_motivo, anulado_por = auth.uid(), anulado_at = now()
   where barberia_id = v_barberia and id = p_cobro;

  -- Reabrir la cita para corregirla (primero se anula el cobro: mientras estaba vigente, la cita no podía salir de atendida).
  if v_cita is not null then
    update public.citas set estado = 'en_atencion'
     where barberia_id = v_barberia and id = v_cita and estado = 'atendida';
    v_reabierta := found;
  end if;

  return jsonb_build_object('ok', true, 'id', p_cobro, 'cita_id', v_cita, 'cita_reabierta', v_reabierta);
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000022_comisiones.sql >>>>>>>>>>
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

-- >>>>>>>>>> 20261015000023_liquidaciones.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0023 · LIQUIDAR COMISIONES (tarea 3.5 · SPEC F7)
--
--   liquidar_comisiones(...)             le paga a un barbero todo lo que se le debe hasta un día.
--   anular_liquidacion(id, motivo)       deshace una liquidación: sus cobros vuelven a quedar pendientes.
--   obtener_resumen_comisiones(d, h)     por barbero: lo generado en el periodo y lo que falta por pagarle.
--   obtener_comisiones_de_barbero(...)   los cobros pendientes de un barbero y sus liquidaciones.
--   obtener_liquidacion(id)              una liquidación con los cobros que pagó.
--   obtener_cobro(id)                    (redefinida) ahora dice si el cobro ya está liquidado.
--
-- REGLAS
--   * Lo que se le debe a un barbero por un cobro es su comisión más la parte de la propina que es suya: las dos se
--     guardaron al cobrar (0022), así que liquidar no recalcula nada.
--   * Liquidar paga TODO lo pendiente hasta un día, no solo el periodo que se esté mirando: nada viejo se olvida y el
--     monto que se ve es el que se paga. Cada cobro entra en UNA sola liquidación vigente (índice único parcial):
--     una liquidación no se puede aplicar dos veces al mismo cobro, ni escribiendo directo en la tabla.
--   * Idempotente: la pantalla crea una clave al abrirse; repetirla devuelve la misma liquidación. Sin nada
--     pendiente no se crea nada.
--   * Se anula con motivo; sus cobros vuelven a estar pendientes y la liquidación queda en el historial. No se borra nada.
--   * Un cobro liquidado no se anula mientras la liquidación esté vigente (si no, al barbero se le pagaría de más).
--   * `fecha` es el día en que se pagó (lo pone fn_jornada): el cierre del día descuenta de la caja lo pagado en efectivo.
--   * Permiso: área "comisiones" para todos los barberos; el barbero (mi_agenda) solo ve lo suyo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------
create table if not exists public.liquidaciones (
  id              uuid primary key default gen_random_uuid(),
  barberia_id     uuid not null references public.barberias(id),
  barbero_id      uuid not null,
  clave           uuid not null,                          -- idempotencia: la crea la pantalla al abrirse
  hasta           date not null,                          -- se pagó todo lo pendiente hasta este día
  medio           text not null check (medio in ('efectivo', 'transferencia')),
  cobros          integer not null check (cobros > 0),    -- cuántos cobros cubre
  comision        integer not null check (comision >= 0),
  propina         integer not null check (propina >= 0),  -- la parte de la propina que era del barbero
  total           integer not null,                       -- lo que se le pagó: comisión + propina
  nota            text check (nota is null or length(btrim(nota)) between 1 and 200),
  fecha           date not null,                          -- el día en que se pagó (lo pone fn_jornada)
  anulada         boolean not null default false,
  anulada_motivo  text,
  anulada_por     uuid references auth.users(id) on delete set null,
  anulada_at      timestamptz,
  created_at      timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  constraint ux_liquidaciones_clave unique (barberia_id, clave),
  foreign key (barberia_id, barbero_id) references public.barberos (barberia_id, id),
  constraint chk_liquidacion_total check (total = comision + propina),
  constraint chk_liquidacion_anulacion check (
    (anulada = false and anulada_motivo is null and anulada_at is null)
    or (anulada = true and length(btrim(coalesce(anulada_motivo, ''))) > 0 and anulada_at is not null)
  )
);
create index if not exists idx_liquidaciones_barbero on public.liquidaciones (barberia_id, barbero_id, created_at desc);
create index if not exists idx_liquidaciones_fecha on public.liquidaciones (barberia_id, fecha) where not anulada;
comment on table public.liquidaciones is 'Pagos de comisión a un barbero. No se editan ni se borran: se anulan con motivo.';

-- Qué cobros cubre cada liquidación (con lo que valía cada uno al liquidar). `vigente` pasa a false al anular la
-- liquidación; el índice único parcial es la garantía de que un cobro no se liquida dos veces.
create table if not exists public.liquidacion_cobros (
  liquidacion_id  uuid not null,
  cobro_id        uuid not null,
  barberia_id     uuid not null references public.barberias(id),
  comision        integer not null check (comision >= 0),
  propina_barbero integer not null check (propina_barbero >= 0),
  vigente         boolean not null default true,
  created_at      timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (liquidacion_id, cobro_id),
  foreign key (barberia_id, liquidacion_id) references public.liquidaciones (barberia_id, id),
  foreign key (barberia_id, cobro_id)       references public.cobros (barberia_id, id)
);
create unique index if not exists ux_liquidacion_cobro_vigente on public.liquidacion_cobros (cobro_id) where vigente;
create index if not exists idx_liquidacion_cobros_cobro on public.liquidacion_cobros (barberia_id, cobro_id);
comment on table public.liquidacion_cobros is 'Los cobros que paga cada liquidación. Un cobro solo está en una liquidación vigente.';

-- ---------------------------------------------------------------------
-- 2. Triggers: nada se edita ni se borra
-- ---------------------------------------------------------------------
-- De una liquidación solo cambia la anulación; una anulada no se reactiva.
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
     or new.fecha is distinct from old.fecha
     or new.created_at is distinct from old.created_at then
    raise exception 'Lo que ya se liquidó no se edita: anula la liquidación con motivo y vuelve a liquidar.' using errcode = '42501';
  end if;
  if old.anulada and not new.anulada then
    raise exception 'Una liquidación anulada no se reactiva: se liquida de nuevo.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_liquidacion_inmutables on public.liquidaciones;
create trigger trg_liquidacion_inmutables before update on public.liquidaciones
  for each row execute function public.fn_liquidacion_inmutables();

-- Al anular una liquidación, sus cobros dejan de estar liquidados (vuelven a ser pendientes).
create or replace function public.fn_liquidacion_anulada()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.anulada and not old.anulada then
    update public.liquidacion_cobros set vigente = false where liquidacion_id = new.id and vigente;
  end if;
  return null;
end $$;

drop trigger if exists trg_liquidacion_anulada on public.liquidaciones;
create trigger trg_liquidacion_anulada after update of anulada on public.liquidaciones
  for each row execute function public.fn_liquidacion_anulada();

-- Un renglón solo se puede crear si el cobro es del barbero de la liquidación, está vigente y vale lo que se anota.
create or replace function public.fn_liquidacion_cobro_validar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ok boolean;
begin
  select exists (
           select 1
             from public.cobros c
             join public.liquidaciones l on l.barberia_id = c.barberia_id and l.barbero_id = c.barbero_id
            where c.barberia_id = new.barberia_id and c.id = new.cobro_id and l.id = new.liquidacion_id
              and not c.anulado and not l.anulada
              and c.comision = new.comision and c.propina_barbero = new.propina_barbero)
    into v_ok;
  if not v_ok then
    raise exception 'Ese cobro no se puede liquidar en esta liquidación (otro barbero, anulado o con otros valores).';
  end if;
  return new;
end $$;

drop trigger if exists trg_liquidacion_cobro_validar on public.liquidacion_cobros;
create trigger trg_liquidacion_cobro_validar before insert on public.liquidacion_cobros
  for each row execute function public.fn_liquidacion_cobro_validar();

-- De un renglón solo cambia `vigente`, y solo de true a false.
create or replace function public.fn_liquidacion_cobro_inmutables()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.liquidacion_id is distinct from old.liquidacion_id
     or new.cobro_id is distinct from old.cobro_id
     or new.barberia_id is distinct from old.barberia_id
     or new.comision is distinct from old.comision
     or new.propina_barbero is distinct from old.propina_barbero
     or new.created_at is distinct from old.created_at then
    raise exception 'Lo que ya se liquidó no se edita: anula la liquidación con motivo y vuelve a liquidar.' using errcode = '42501';
  end if;
  if new.vigente and not old.vigente then
    raise exception 'Una liquidación anulada no se reactiva: se liquida de nuevo.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_liquidacion_cobro_inmutables on public.liquidacion_cobros;
create trigger trg_liquidacion_cobro_inmutables before update on public.liquidacion_cobros
  for each row execute function public.fn_liquidacion_cobro_inmutables();

drop trigger if exists trg_bloquear_borrado on public.liquidaciones;
create trigger trg_bloquear_borrado before delete on public.liquidaciones
  for each row execute function public.fn_bloquear_borrado();
drop trigger if exists trg_bloquear_borrado on public.liquidacion_cobros;
create trigger trg_bloquear_borrado before delete on public.liquidacion_cobros
  for each row execute function public.fn_bloquear_borrado();

-- Un cobro que ya se le pagó al barbero no se anula: primero hay que anular la liquidación.
create or replace function public.fn_cobro_liquidado_no_se_anula()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if new.anulado and not old.anulado then
    select b.nombre as barbero, l.fecha
      into v
      from public.liquidacion_cobros lc
      join public.liquidaciones l on l.barberia_id = lc.barberia_id and l.id = lc.liquidacion_id
      join public.barberos b on b.barberia_id = l.barberia_id and b.id = l.barbero_id
     where lc.barberia_id = old.barberia_id and lc.cobro_id = old.id and lc.vigente;
    if found then
      raise exception 'Este cobro ya se le liquidó a % el %. Anula primero esa liquidación.', v.barbero, to_char(v.fecha, 'DD/MM/YYYY');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_cobro_liquidado_no_se_anula on public.cobros;
create trigger trg_cobro_liquidado_no_se_anula before update of anulado on public.cobros
  for each row execute function public.fn_cobro_liquidado_no_se_anula();

-- ---------------------------------------------------------------------
-- 3. Lectura (RLS): «comisiones» ve todas; el barbero, las suyas
-- ---------------------------------------------------------------------
alter table public.liquidaciones enable row level security;
alter table public.liquidacion_cobros enable row level security;

drop policy if exists liquidaciones_select on public.liquidaciones;
create policy liquidaciones_select on public.liquidaciones
  for select to authenticated
  using (
    barberia_id = (select public.mi_barberia())
    and (
      (select public.tiene_area('comisiones'))
      or ((select public.tiene_area('mi_agenda')) and barbero_id = (select public.mi_barbero()))
    )
  );

drop policy if exists liquidacion_cobros_select on public.liquidacion_cobros;
create policy liquidacion_cobros_select on public.liquidacion_cobros
  for select to authenticated
  using (
    barberia_id = (select public.mi_barberia())
    and exists (select 1 from public.liquidaciones l
                 where l.barberia_id = liquidacion_cobros.barberia_id and l.id = liquidacion_cobros.liquidacion_id)
  );

grant select on public.liquidaciones, public.liquidacion_cobros to authenticated;

-- ---------------------------------------------------------------------
-- 4. Liquidar y anular
-- ---------------------------------------------------------------------
create or replace function public.fn_resultado_liquidacion(p_barberia uuid, p_id uuid, p_ya boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_res     jsonb;
  v_anulada boolean;
begin
  select jsonb_build_object(
           'ok', true, 'ya_existia', p_ya, 'id', l.id, 'barbero_id', l.barbero_id, 'barbero', b.nombre,
           'cobros', l.cobros, 'comision', l.comision, 'propina', l.propina, 'total', l.total,
           'medio', l.medio, 'hasta', l.hasta, 'fecha', l.fecha, 'anulada', l.anulada),
         l.anulada
    into v_res, v_anulada
    from public.liquidaciones l
    join public.barberos b on b.barberia_id = l.barberia_id and b.id = l.barbero_id
   where l.barberia_id = p_barberia and l.id = p_id;

  -- Repetir la clave de una liquidación que ya se anuló no la da por hecha.
  if p_ya and coalesce(v_anulada, false) then
    raise exception 'Esa liquidación ya se anuló. Abre Liquidar de nuevo para pagar otra vez.';
  end if;
  return v_res;
end $$;

-- Le paga a un barbero todo lo pendiente (cobros vigentes que no están en otra liquidación vigente) hasta p_hasta.
create or replace function public.liquidar_comisiones(
  p_barbero uuid, p_hasta date, p_medio text, p_clave uuid, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('comisiones');
  v_prev     uuid;
  v_nombre   text;
  v_ids      uuid[];
  v_n        integer;
  v_com      integer;
  v_prop     integer;
  v_nota     text := nullif(left(public.fn_limpiar_texto(p_nota), 200), '');
  v_id       uuid := gen_random_uuid();
begin
  if p_clave is null then
    raise exception 'Falta la clave de la liquidación. Recarga la pantalla e intenta de nuevo.';
  end if;

  -- Repetir la misma clave (doble toque, mala señal, reintento) devuelve la liquidación que ya se hizo.
  select l.id into v_prev from public.liquidaciones l where l.barberia_id = v_barberia and l.clave = p_clave;
  if found then
    return public.fn_resultado_liquidacion(v_barberia, v_prev, true);
  end if;

  if p_medio is null or p_medio not in ('efectivo', 'transferencia') then
    raise exception 'Elige cómo se le paga: efectivo o transferencia.';
  end if;
  if p_hasta is null then
    raise exception 'Elige hasta qué día se liquida.';
  end if;

  -- Un barbero a la vez: dos liquidaciones simultáneas del mismo barbero se ponen en fila.
  select b.nombre into v_nombre from public.barberos b
   where b.barberia_id = v_barberia and b.id = p_barbero
     for no key update;
  if not found then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;

  -- Lo pendiente, con los cobros bloqueados: si alguien los anula a la vez, o se espera o se descartan.
  select array_agg(x.id order by x.fecha, x.created_at, x.id),
         count(*)::integer, coalesce(sum(x.comision), 0)::integer, coalesce(sum(x.propina_barbero), 0)::integer
    into v_ids, v_n, v_com, v_prop
    from (select c.id, c.fecha, c.created_at, c.comision, c.propina_barbero
            from public.cobros c
           where c.barberia_id = v_barberia and c.barbero_id = p_barbero and not c.anulado and c.fecha <= p_hasta
             and not exists (select 1 from public.liquidacion_cobros lc where lc.cobro_id = c.id and lc.vigente)
             for update of c) x;

  if v_n = 0 then
    raise exception 'No hay nada por liquidar de % hasta el %.', v_nombre, to_char(p_hasta, 'DD/MM/YYYY');
  end if;

  begin
    insert into public.liquidaciones (id, barberia_id, barbero_id, clave, hasta, medio, cobros, comision, propina, total,
                                      nota, fecha)
    values (v_id, v_barberia, p_barbero, p_clave, p_hasta, p_medio, v_n, v_com, v_prop, v_com + v_prop,
            v_nota, public.fn_jornada(v_barberia, now()));
  exception when unique_violation then
    -- Dos toques a la vez con la misma clave.
    select l.id into v_prev from public.liquidaciones l where l.barberia_id = v_barberia and l.clave = p_clave;
    if found then
      return public.fn_resultado_liquidacion(v_barberia, v_prev, true);
    end if;
    raise;
  end;

  insert into public.liquidacion_cobros (barberia_id, liquidacion_id, cobro_id, comision, propina_barbero)
  select v_barberia, v_id, c.id, c.comision, c.propina_barbero
    from public.cobros c
   where c.barberia_id = v_barberia and c.id = any (v_ids);

  return public.fn_resultado_liquidacion(v_barberia, v_id, false);
end $$;

-- Anula una liquidación con motivo: sus cobros vuelven a estar pendientes.
create or replace function public.anular_liquidacion(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('comisiones');
  v_motivo   text := public.fn_motivo(p_motivo);
  v_anulada  boolean;
  v_cobros   integer;
begin
  select l.anulada, l.cobros into v_anulada, v_cobros
    from public.liquidaciones l where l.barberia_id = v_barberia and l.id = p_id
     for update;
  if not found then
    raise exception 'No existe esa liquidación.' using errcode = 'P0002';
  end if;
  if v_anulada then
    raise exception 'Esta liquidación ya está anulada.';
  end if;

  update public.liquidaciones
     set anulada = true, anulada_motivo = v_motivo, anulada_por = auth.uid(), anulada_at = now()
   where barberia_id = v_barberia and id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id, 'cobros', v_cobros);
end $$;

-- ---------------------------------------------------------------------
-- 5. Lecturas
-- ---------------------------------------------------------------------

-- Por barbero: lo que generó en el periodo (cobros, servicios, comisión, propina, cuánto de eso ya se liquidó) y lo
-- que falta por pagarle hasta p_hasta (incluye lo de periodos anteriores). «comisiones» ve a todos; el barbero, lo suyo.
create or replace function public.obtener_resumen_comisiones(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_todos    boolean := public.tiene_area('comisiones');
  v_mio      uuid := public.mi_barbero();
begin
  if not v_todos and not (public.tiene_area('mi_agenda') and v_mio is not null) then
    raise exception 'No tienes permiso para ver las comisiones. Pídeselo al dueño.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'El periodo no es válido.';
  end if;

  return jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'todos', v_todos,
    'barberos', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', b.id, 'nombre', b.nombre, 'activo', b.activo,
                 'cobros', coalesce(p.cobros, 0), 'servicios', coalesce(p.servicios, 0),
                 'comision', coalesce(p.comision, 0), 'propina', coalesce(p.propina, 0),
                 'liquidado', coalesce(p.liquidado, 0),
                 'pendiente_cobros', coalesce(q.cobros, 0),
                 'pendiente', coalesce(q.comision, 0) + coalesce(q.propina, 0),
                 'pendiente_desde', q.desde)
               order by b.activo desc, b.orden, lower(b.nombre))
        from public.barberos b
        left join lateral (
          select count(*)::integer as cobros, sum(c.total)::integer as servicios,
                 sum(c.comision)::integer as comision, sum(c.propina_barbero)::integer as propina,
                 sum(case when exists (select 1 from public.liquidacion_cobros lc where lc.cobro_id = c.id and lc.vigente)
                          then c.comision + c.propina_barbero else 0 end)::integer as liquidado
            from public.cobros c
           where c.barberia_id = b.barberia_id and c.barbero_id = b.id and not c.anulado
             and c.fecha between p_desde and p_hasta) p on true
        left join lateral (
          select count(*)::integer as cobros, sum(c.comision)::integer as comision,
                 sum(c.propina_barbero)::integer as propina, min(c.fecha) as desde
            from public.cobros c
           where c.barberia_id = b.barberia_id and c.barbero_id = b.id and not c.anulado and c.fecha <= p_hasta
             and not exists (select 1 from public.liquidacion_cobros lc where lc.cobro_id = c.id and lc.vigente)) q on true
       where b.barberia_id = v_barberia and (v_todos or b.id = v_mio)
         and (b.activo or coalesce(p.cobros, 0) > 0 or coalesce(q.cobros, 0) > 0)), '[]'::jsonb));
end $$;

-- Un barbero: lo que se le debe hasta p_hasta (con los cobros, los 200 más recientes) y sus últimas liquidaciones.
create or replace function public.obtener_comisiones_de_barbero(p_barbero uuid, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_todos    boolean := public.tiene_area('comisiones');
  v_mio      uuid := public.mi_barbero();
  v_b        record;
begin
  if not v_todos and not (public.tiene_area('mi_agenda') and v_mio is not null and v_mio = p_barbero) then
    raise exception 'No tienes permiso para ver las comisiones de otro barbero.' using errcode = '42501';
  end if;
  if p_hasta is null then
    raise exception 'Elige hasta qué día se mira.';
  end if;
  select b.id, b.nombre, b.activo into v_b from public.barberos b where b.barberia_id = v_barberia and b.id = p_barbero;
  if not found then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'barbero', jsonb_build_object('id', v_b.id, 'nombre', v_b.nombre, 'activo', v_b.activo),
    'hasta', p_hasta,
    'pendiente', (
      select jsonb_build_object(
               'cobros', count(*)::integer, 'comision', coalesce(sum(c.comision), 0)::integer,
               'propina', coalesce(sum(c.propina_barbero), 0)::integer,
               'total', (coalesce(sum(c.comision), 0) + coalesce(sum(c.propina_barbero), 0))::integer,
               'desde', min(c.fecha))
        from public.cobros c
       where c.barberia_id = v_barberia and c.barbero_id = p_barbero and not c.anulado and c.fecha <= p_hasta
         and not exists (select 1 from public.liquidacion_cobros lc where lc.cobro_id = c.id and lc.vigente)),
    'cobros', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'fecha', k.fecha, 'created_at', k.created_at, 'cliente', k.cliente, 'servicios', k.servicios,
               'total', k.total, 'comision', k.comision, 'propina_barbero', k.propina_barbero)
             order by k.fecha desc, k.created_at desc, k.id)
        from (select c.id, c.fecha, c.created_at, cl.nombre as cliente, c.total, c.comision, c.propina_barbero,
                     (select string_agg(i.nombre, ', ' order by i.orden)
                        from public.cobro_items i where i.barberia_id = c.barberia_id and i.cobro_id = c.id) as servicios
                from public.cobros c
                left join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
               where c.barberia_id = v_barberia and c.barbero_id = p_barbero and not c.anulado and c.fecha <= p_hasta
                 and not exists (select 1 from public.liquidacion_cobros lc where lc.cobro_id = c.id and lc.vigente)
               order by c.fecha desc, c.created_at desc, c.id
               limit 200) k), '[]'::jsonb),
    'liquidaciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'created_at', l.created_at, 'fecha', l.fecha, 'hasta', l.hasta, 'total', l.total,
               'cobros', l.cobros, 'medio', l.medio, 'anulada', l.anulada)
             order by l.created_at desc, l.id)
        from (select * from public.liquidaciones x
               where x.barberia_id = v_barberia and x.barbero_id = p_barbero
               order by x.created_at desc, x.id
               limit 20) l), '[]'::jsonb));
end $$;

-- Una liquidación con los cobros que pagó (null si no existe o quien pregunta no la puede ver).
create or replace function public.obtener_liquidacion(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_todos    boolean := public.tiene_area('comisiones');
  v_mio      uuid := public.mi_barbero();
  v_res      jsonb;
begin
  select jsonb_build_object(
           'id', l.id, 'barbero_id', l.barbero_id, 'barbero', b.nombre,
           'hasta', l.hasta, 'fecha', l.fecha, 'medio', l.medio, 'cobros', l.cobros,
           'comision', l.comision, 'propina', l.propina, 'total', l.total, 'nota', l.nota, 'created_at', l.created_at,
           'anulada', l.anulada, 'anulada_motivo', l.anulada_motivo, 'anulada_at', l.anulada_at,
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'cobro_id', c.id, 'fecha', c.fecha, 'created_at', c.created_at, 'cliente', cl.nombre,
                      'servicios', (select string_agg(i.nombre, ', ' order by i.orden)
                                      from public.cobro_items i where i.barberia_id = c.barberia_id and i.cobro_id = c.id),
                      'total', c.total, 'comision', lc.comision, 'propina_barbero', lc.propina_barbero)
                    order by c.fecha, c.created_at, c.id)
               from public.liquidacion_cobros lc
               join public.cobros c on c.barberia_id = lc.barberia_id and c.id = lc.cobro_id
               left join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
              where lc.barberia_id = l.barberia_id and lc.liquidacion_id = l.id), '[]'::jsonb))
    into v_res
    from public.liquidaciones l
    join public.barberos b on b.barberia_id = l.barberia_id and b.id = l.barbero_id
   where l.barberia_id = v_barberia and l.id = p_id
     and (v_todos or (public.tiene_area('mi_agenda') and v_mio is not null and l.barbero_id = v_mio));
  return v_res;
end $$;

-- ---------------------------------------------------------------------
-- 6. Un cobro (copia de la ÚLTIMA versión, la de 0019) con un dato más: la liquidación que lo paga, si hay una vigente
--    (solo la ve quien puede ver liquidaciones)
-- ---------------------------------------------------------------------
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
           'liquidacion_id', (select lc.liquidacion_id from public.liquidacion_cobros lc
                               where lc.barberia_id = c.barberia_id and lc.cobro_id = c.id and lc.vigente),
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

-- >>>>>>>>>> 20261015000024_gastos.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0024 · GASTOS CON FOTO PRIVADA (tarea 3.6 · SPEC F8)
--
--   registrar_gasto(...)    registra un gasto: monto, categoría, cómo se pagó, nota y foto opcional.
--   anular_gasto(id, motivo) lo anula con motivo (no se borra ni se edita).
--   obtener_gastos(fecha)   los gastos de un día con sus totales (por medio y por categoría).
--   obtener_gasto(id)       un gasto con su foto y quién lo registró.
--
-- REGLAS
--   * Pesos enteros. Categorías fijas: arriendo, insumos, servicios públicos, comisiones y otros. El medio (efectivo o
--     transferencia) importa para el cierre: el efectivo esperado resta los gastos pagados en efectivo.
--   * Un gasto no se edita ni se borra: se anula con motivo. Quién lo registró y cuándo quedan guardados.
--   * Idempotente: la pantalla crea una clave al abrirse; repetirla devuelve el mismo gasto (un doble toque no duplica).
--   * La foto (el recibo) es PRIVADA: vive en el bucket `gastos-fotos` bajo la carpeta de la barbería
--     (<barberia_id>/<clave>.jpg). Nadie la ve con un enlace público: la app la sirve solo a quien tiene permiso.
--   * `fecha` es el día al que pertenece (lo pone fn_jornada, como en los cobros).
--   * Permiso: área "gastos" para registrar y anular; "gastos" y "cierre" ven los gastos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Categorías
-- ---------------------------------------------------------------------
create or replace function public.fn_categorias_gasto()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$ select array['arriendo', 'insumos', 'servicios_publicos', 'comisiones', 'otros'] $$;

-- ---------------------------------------------------------------------
-- 2. Tabla
-- ---------------------------------------------------------------------
create table if not exists public.gastos (
  id              uuid primary key default gen_random_uuid(),
  barberia_id     uuid not null references public.barberias(id),
  clave           uuid not null,                          -- idempotencia: la crea la pantalla al abrirse
  monto           integer not null check (monto > 0 and monto <= 50000000),
  categoria       text not null check (categoria = any (public.fn_categorias_gasto())),
  medio           text not null check (medio in ('efectivo', 'transferencia')),
  nota            text check (nota is null or length(btrim(nota)) between 1 and 120),
  foto_ruta       text check (foto_ruta is null or foto_ruta ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  fecha           date not null,                          -- el día al que pertenece (lo pone fn_jornada)
  anulado         boolean not null default false,
  anulado_motivo  text,
  anulado_por     uuid references auth.users(id) on delete set null,
  anulado_at      timestamptz,
  created_at      timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  constraint ux_gastos_clave unique (barberia_id, clave),
  constraint chk_gasto_foto_de_la_barberia check (foto_ruta is null or foto_ruta like barberia_id::text || '/%'),
  constraint chk_gasto_anulacion check (
    (anulado = false and anulado_motivo is null and anulado_at is null)
    or (anulado = true and length(btrim(coalesce(anulado_motivo, ''))) > 0 and anulado_at is not null)
  )
);
create index if not exists idx_gastos_fecha on public.gastos (barberia_id, fecha) where not anulado;
create index if not exists idx_gastos_creado on public.gastos (barberia_id, created_at desc);
comment on table public.gastos is 'Gastos de la barbería. No se editan ni se borran: se anulan con motivo.';

-- El día del gasto al insertarlo.
create or replace function public.fn_gasto_fecha()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.fecha := public.fn_jornada(new.barberia_id, coalesce(new.created_at, now()));
  return new;
end $$;

drop trigger if exists trg_gasto_fecha on public.gastos;
create trigger trg_gasto_fecha before insert on public.gastos
  for each row execute function public.fn_gasto_fecha();

-- De un gasto solo cambia la anulación (y, en el cierre del día, su `fecha`); un gasto anulado no se reactiva.
create or replace function public.fn_gasto_inmutables()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.barberia_id is distinct from old.barberia_id
     or new.clave is distinct from old.clave
     or new.monto is distinct from old.monto
     or new.categoria is distinct from old.categoria
     or new.medio is distinct from old.medio
     or new.nota is distinct from old.nota
     or new.foto_ruta is distinct from old.foto_ruta
     or new.created_at is distinct from old.created_at then
    raise exception 'Lo que ya se registró no se edita: anula el gasto con motivo y regístralo de nuevo.' using errcode = '42501';
  end if;
  if old.anulado and not new.anulado then
    raise exception 'Un gasto anulado no se reactiva: se registra de nuevo.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_gasto_inmutables on public.gastos;
create trigger trg_gasto_inmutables before update on public.gastos
  for each row execute function public.fn_gasto_inmutables();

drop trigger if exists trg_bloquear_borrado on public.gastos;
create trigger trg_bloquear_borrado before delete on public.gastos
  for each row execute function public.fn_bloquear_borrado();

-- Lectura (RLS): «gastos» y «cierre» ven los gastos de la barbería. Se escribe solo por funciones.
alter table public.gastos enable row level security;

drop policy if exists gastos_select on public.gastos;
create policy gastos_select on public.gastos
  for select to authenticated
  using (barberia_id = (select public.mi_barberia()) and (select public.tiene_area('gastos', 'cierre')));

grant select on public.gastos to authenticated;

-- ---------------------------------------------------------------------
-- 3. Registrar y anular
-- ---------------------------------------------------------------------
create or replace function public.fn_resultado_gasto(p_barberia uuid, p_id uuid, p_ya boolean)
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
           'ok', true, 'ya_existia', p_ya, 'id', g.id, 'monto', g.monto, 'categoria', g.categoria,
           'medio', g.medio, 'fecha', g.fecha, 'con_foto', g.foto_ruta is not null, 'anulado', g.anulado),
         g.anulado
    into v_res, v_anulado
    from public.gastos g
   where g.barberia_id = p_barberia and g.id = p_id;

  -- Repetir la clave de un gasto que ya se anuló no lo da por hecho.
  if p_ya and coalesce(v_anulado, false) then
    raise exception 'Ese gasto ya se anuló. Abre Gastos de nuevo para registrarlo otra vez.';
  end if;
  return v_res;
end $$;

-- Registra un gasto. `p_foto_ruta` es la ruta de la foto ya subida al bucket privado (<barberia_id>/<archivo>).
create or replace function public.registrar_gasto(
  p_clave uuid, p_monto integer, p_categoria text, p_medio text, p_nota text default null, p_foto_ruta text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('gastos');
  v_prev     uuid;
  v_nota     text := nullif(left(public.fn_limpiar_texto(p_nota), 120), '');
  v_ruta     text := nullif(btrim(coalesce(p_foto_ruta, '')), '');
  v_id       uuid := gen_random_uuid();
begin
  if p_clave is null then
    raise exception 'Falta la clave del gasto. Recarga la pantalla e intenta de nuevo.';
  end if;

  -- Repetir la misma clave (doble toque, mala señal, reintento) devuelve el gasto que ya se registró.
  select g.id into v_prev from public.gastos g where g.barberia_id = v_barberia and g.clave = p_clave;
  if found then
    return public.fn_resultado_gasto(v_barberia, v_prev, true);
  end if;

  if p_monto is null or p_monto <= 0 or p_monto > 50000000 then
    raise exception 'El gasto debe ser de $ 1 a %.', public.fn_pesos(50000000);
  end if;
  if p_categoria is null or p_categoria <> all (public.fn_categorias_gasto()) then
    raise exception 'Elige la categoría del gasto.';
  end if;
  if p_medio is null or p_medio not in ('efectivo', 'transferencia') then
    raise exception 'Elige cómo se pagó el gasto: efectivo o transferencia.';
  end if;
  -- La foto tiene que estar en la carpeta de esta barbería (nadie referencia archivos de otra).
  if v_ruta is not null and v_ruta !~ ('^' || v_barberia::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'La foto del gasto no es válida.';
  end if;

  begin
    insert into public.gastos (id, barberia_id, clave, monto, categoria, medio, nota, foto_ruta)
    values (v_id, v_barberia, p_clave, p_monto, p_categoria, p_medio, v_nota, v_ruta);
  exception when unique_violation then
    -- Dos toques a la vez con la misma clave.
    select g.id into v_prev from public.gastos g where g.barberia_id = v_barberia and g.clave = p_clave;
    if found then
      return public.fn_resultado_gasto(v_barberia, v_prev, true);
    end if;
    raise;
  end;

  return public.fn_resultado_gasto(v_barberia, v_id, false);
end $$;

-- Anula un gasto con motivo.
create or replace function public.anular_gasto(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('gastos');
  v_motivo   text := public.fn_motivo(p_motivo);
  v_anulado  boolean;
begin
  select g.anulado into v_anulado
    from public.gastos g where g.barberia_id = v_barberia and g.id = p_id
     for update;
  if not found then
    raise exception 'No existe ese gasto.' using errcode = 'P0002';
  end if;
  if v_anulado then
    raise exception 'Este gasto ya está anulado.';
  end if;

  update public.gastos
     set anulado = true, anulado_motivo = v_motivo, anulado_por = auth.uid(), anulado_at = now()
   where barberia_id = v_barberia and id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- ---------------------------------------------------------------------
-- 4. Lecturas
-- ---------------------------------------------------------------------

-- Los gastos de un día (sin fecha, el día en que hoy se está registrando) con sus totales, sin contar los anulados.
create or replace function public.obtener_gastos(p_fecha date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('gastos', 'cierre');
  v_fecha    date := coalesce(p_fecha, public.fn_jornada(v_barberia, now()));
begin
  return jsonb_build_object(
    'fecha', v_fecha,
    'totales', (
      select jsonb_build_object(
               'gastos', count(*)::integer,
               'total', coalesce(sum(g.monto), 0)::integer,
               'efectivo', coalesce(sum(g.monto) filter (where g.medio = 'efectivo'), 0)::integer,
               'transferencia', coalesce(sum(g.monto) filter (where g.medio = 'transferencia'), 0)::integer)
        from public.gastos g
       where g.barberia_id = v_barberia and g.fecha = v_fecha and not g.anulado),
    'por_categoria', coalesce((
      select jsonb_agg(jsonb_build_object('categoria', c.categoria, 'total', c.total, 'gastos', c.n)
                       order by c.total desc, c.categoria)
        from (select g.categoria, sum(g.monto)::integer as total, count(*)::integer as n
                from public.gastos g
               where g.barberia_id = v_barberia and g.fecha = v_fecha and not g.anulado
               group by g.categoria) c), '[]'::jsonb),
    'gastos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'created_at', g.created_at, 'monto', g.monto, 'categoria', g.categoria, 'medio', g.medio,
               'nota', g.nota, 'con_foto', g.foto_ruta is not null,
               'anulado', g.anulado, 'anulado_motivo', g.anulado_motivo)
             order by g.created_at desc, g.id)
        from public.gastos g
       where g.barberia_id = v_barberia and g.fecha = v_fecha), '[]'::jsonb));
end $$;

-- Un gasto con la ruta de su foto y quién lo registró (null si no existe o es de otra barbería).
create or replace function public.obtener_gasto(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('gastos', 'cierre');
begin
  return (
    select jsonb_build_object(
             'id', g.id, 'monto', g.monto, 'categoria', g.categoria, 'medio', g.medio, 'nota', g.nota,
             'foto_ruta', g.foto_ruta, 'fecha', g.fecha, 'created_at', g.created_at,
             'registrado_por', p.nombre,
             'anulado', g.anulado, 'anulado_motivo', g.anulado_motivo, 'anulado_at', g.anulado_at)
      from public.gastos g
      left join public.perfiles p on p.barberia_id = g.barberia_id and p.user_id = g.registrado_por
     where g.barberia_id = v_barberia and g.id = p_id);
end $$;

-- ---------------------------------------------------------------------
-- 5. Fotos privadas (Storage)
-- ---------------------------------------------------------------------
-- Un bucket PRIVADO: sin enlaces públicos. Hasta 1 MB por foto (la app las comprime antes de subirlas) y solo
-- imágenes. Cada barbería escribe y lee únicamente en su carpeta (<barberia_id>/…), y solo con el permiso del área.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gastos-fotos', 'gastos-fotos', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists gastos_fotos_insert on storage.objects;
create policy gastos_fotos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'gastos-fotos'
    and (storage.foldername(name))[1] = (select public.mi_barberia())::text
    and (select public.tiene_area('gastos'))
  );

drop policy if exists gastos_fotos_select on storage.objects;
create policy gastos_fotos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'gastos-fotos'
    and (storage.foldername(name))[1] = (select public.mi_barberia())::text
    and (select public.tiene_area('gastos', 'cierre'))
  );

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000025_cierre_del_dia.sql >>>>>>>>>>
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

-- >>>>>>>>>> 20261015000026_inicio.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0026 · LAS CIFRAS DE INICIO (tarea 3.8 · PLAN Fase 3)
--
--   obtener_inicio()   lo que Inicio muestra del día: citas (con quiénes no llegaron), vendido, comisiones, gastos.
--
-- REGLAS
--   * Las cifras de dinero salen de `fn_resumen_dia` con el día en que hoy se registra (el mismo de la caja y del
--     cierre): por construcción son LAS MISMAS que las del cierre. Si hoy ya se cerró, esos números son los del
--     día siguiente y `cierre_hoy` dice cómo salió el cierre.
--   * Cada persona ve lo que su rol permite, y lo demás llega en null:
--       - citas: «agenda» las de todos; «mi_agenda» solo las suyas.
--       - vendido: «caja» o «cierre» ven todo el negocio; un barbero (mi_agenda) ve lo que él cobró.
--       - comisiones: «comisiones» las de todos; un barbero, las suyas (comisión + la propina que es suya).
--       - gastos: «gastos» o «cierre».   - cierre de hoy: «cierre».
-- =====================================================================

create or replace function public.obtener_inicio()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia  uuid := public.requerir_barberia();
  v_hoy       date := public.hoy_bogota();
  v_jornada   date := public.fn_jornada(v_barberia, now());
  v_ini       timestamptz := v_hoy::timestamp at time zone 'America/Bogota';
  v_mio       uuid := public.mi_barbero();
  v_barbero   boolean := public.tiene_area('mi_agenda') and v_mio is not null;
  v_todas     boolean := public.tiene_area('agenda');
  v_dinero    boolean := public.tiene_area('caja', 'cierre');
  v_comisiones boolean := public.tiene_area('comisiones');
  v_r         jsonb := public.fn_resumen_dia(v_barberia, v_jornada);
  v_propio    record;
  v_citas     jsonb;
  v_ventas    jsonb;
  v_comis     jsonb;
  v_gastos    jsonb;
  v_cierre    jsonb;
begin
  -- Lo que cobró el barbero (para quien solo ve lo suyo).
  if v_barbero then
    select count(*)::integer as cobros, coalesce(sum(k.total), 0)::integer as servicios,
           coalesce(sum(k.propina), 0)::integer as propinas, coalesce(sum(k.comision), 0)::integer as comisiones,
           coalesce(sum(k.propina_barbero), 0)::integer as propinas_barbero
      into v_propio
      from public.cobros k
     where k.barberia_id = v_barberia and k.barbero_id = v_mio and k.fecha = v_jornada and not k.anulado;
  end if;

  -- Citas de hoy (día calendario de Bogotá).
  if v_todas or v_barbero then
    select jsonb_build_object(
             'total', count(*) filter (where c.estado <> 'cancelada'),
             'atendidas', count(*) filter (where c.estado = 'atendida'),
             'por_atender', count(*) filter (where c.estado in ('confirmada', 'en_atencion')),
             'no_asistio', count(*) filter (where c.estado = 'no_asistio'),
             'canceladas', count(*) filter (where c.estado = 'cancelada'))
      into v_citas
      from public.citas c
     where c.barberia_id = v_barberia and c.inicio >= v_ini and c.inicio < v_ini + interval '1 day'
       and (v_todas or c.barbero_id = v_mio);
  end if;

  -- Vendido.
  if v_dinero then
    v_ventas := jsonb_build_object('propias', false, 'cobros', v_r -> 'cobros', 'servicios', v_r -> 'servicios', 'propinas', v_r -> 'propinas');
  elsif v_barbero then
    v_ventas := jsonb_build_object('propias', true, 'cobros', v_propio.cobros, 'servicios', v_propio.servicios, 'propinas', v_propio.propinas);
  end if;

  -- Comisiones.
  if v_comisiones then
    v_comis := jsonb_build_object('propias', false, 'comisiones', v_r -> 'comisiones', 'propinas_barbero', v_r -> 'propinas_barbero');
  elsif v_barbero then
    v_comis := jsonb_build_object('propias', true, 'comisiones', v_propio.comisiones, 'propinas_barbero', v_propio.propinas_barbero);
  end if;

  -- Gastos.
  if public.tiene_area('gastos', 'cierre') then
    v_gastos := jsonb_build_object(
      'gastos', v_r -> 'gastos',
      'total', (v_r ->> 'gastos_efectivo')::integer + (v_r ->> 'gastos_transferencia')::integer);
  end if;

  -- Cómo salió el cierre de hoy, si ya se hizo.
  if public.tiene_area('cierre') then
    select jsonb_build_object('id', c.id, 'efectivo_contado', c.efectivo_contado, 'diferencia', c.diferencia)
      into v_cierre
      from public.cierres c
     where c.barberia_id = v_barberia and c.fecha = v_hoy and not c.anulado;
  end if;

  return jsonb_build_object(
    'hoy', v_hoy, 'fecha', v_jornada,
    'citas', v_citas, 'ventas', v_ventas, 'comisiones', v_comis, 'gastos', v_gastos, 'cierre_hoy', v_cierre);
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000027_demo.sql >>>>>>>>>>
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

-- >>>>>>>>>> 20261015000028_contacto_barberia.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0028 · WHATSAPP Y DIRECCIÓN DE LA BARBERÍA, DESDE LA APP (pendiente de la Fase 4 · SPEC §3)
--
--   actualizar_contacto_barberia(p_whatsapp, p_direccion)   deja el WhatsApp y la dirección de la barbería.
--
-- REGLAS
--   * Quien tiene el área «servicios» (el dueño siempre), igual que los ajustes de la agenda y el cartel: son datos que ve
--     el cliente en la reserva, en su cita y en los textos legales (contacto para consultas y reclamos, Ley 1581).
--   * Reemplaza LOS DOS datos: vacío o null quita ese dato (la reserva y la cita simplemente no ofrecen WhatsApp). No hay
--     «null = dejar como está»: la pantalla siempre manda los dos.
--   * El WhatsApp se escribe como lo escribe la gente («300 123 4567») y se guarda en E.164 con `fn_normalizar_telefono`,
--     la misma regla de los clientes; lo que guarda siempre cumple el check de la tabla (`^\+[1-9][0-9]{7,14}$`).
--   * La dirección pierde los espacios de sobra y va de 1 a 120 caracteres (el check de la tabla).
--   * `obtener_contexto` (0017/0027) ya devuelve `whatsapp` y `direccion` dentro de `barberia`: la pantalla los lee de ahí.
-- =====================================================================

create or replace function public.actualizar_contacto_barberia(p_whatsapp text, p_direccion text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia  uuid := public.requerir_area('servicios');
  v_whatsapp  text;
  v_direccion text := nullif(public.fn_limpiar_texto(p_direccion), '');
begin
  -- El mensaje de fn_normalizar_telefono habla de «el celular»; aquí se pide el WhatsApp.
  begin
    v_whatsapp := public.fn_normalizar_telefono(p_whatsapp);
  exception when sqlstate 'P0001' then
    raise exception 'El WhatsApp no es válido. Escríbelo con 10 dígitos, por ejemplo 300 123 4567.';
  end;

  if v_direccion is not null and length(v_direccion) > 120 then
    raise exception 'La dirección es muy larga (máximo 120 caracteres).';
  end if;

  update public.barberias
     set whatsapp = v_whatsapp, direccion = v_direccion
   where id = v_barberia;

  return jsonb_build_object('whatsapp', v_whatsapp, 'direccion', v_direccion);
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000029_consulta_publica_sin_nombre.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0029 · LA CONSULTA PÚBLICA DE UNA CITA YA NO DEVUELVE EL NOMBRE DEL CLIENTE
--
-- Hallazgo de la revisión de seguridad: quien reserva con el celular de OTRA persona queda ligado a la ficha que esa
-- persona ya tiene en la barbería (el mismo celular es el mismo cliente), y `publico_consultar_cita` devolvía el nombre
-- GUARDADO en esa ficha. Bastaba reservar con un celular ajeno y consultar la cita para saber cómo se llama su dueño.
--
-- Ninguna pantalla pública usaba ese campo (el cliente ya sabe cómo se llama), así que se quita de la respuesta.
-- Es la ÚLTIMA versión de fn_publico_consultar (0015) sin la clave 'cliente'; la firma no cambia.
-- =====================================================================

create or replace function public.fn_publico_consultar(p_token uuid, p_ahora timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_c      record;
  v_limite timestamptz;
  v_ok     boolean;
begin
  select c.id, c.inicio, c.fin, c.estado, c.precio, c.duracion_min,
         s.nombre as servicio, x.nombre as barbero,
         b.nombre as barberia, b.slug, b.whatsapp, b.direccion, b.cancelar_hasta_horas, b.dias_adelante
    into v_c
    from public.citas c
    join public.barberias b on b.id = c.barberia_id
    join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
    join public.barberos x on x.barberia_id = c.barberia_id and x.id = c.barbero_id
   where c.token = p_token;
  if not found then
    return jsonb_build_object('existe', false);
  end if;

  v_limite := public.fn_publico_limite(v_c.inicio, v_c.cancelar_hasta_horas);
  v_ok := v_c.estado = 'confirmada' and p_ahora <= v_limite;

  return jsonb_build_object(
    'existe', true,
    'barberia', jsonb_build_object('nombre', v_c.barberia, 'slug', v_c.slug, 'whatsapp', v_c.whatsapp,
                                   'direccion', v_c.direccion, 'cancelar_hasta_horas', v_c.cancelar_hasta_horas,
                                   'dias_adelante', v_c.dias_adelante),
    'cita', jsonb_build_object(
      'inicio', v_c.inicio, 'fin', v_c.fin, 'estado', v_c.estado, 'servicio', v_c.servicio,
      'barbero', v_c.barbero, 'precio', v_c.precio, 'duracion_min', v_c.duracion_min,
      'puede_cambiar', v_ok, 'limite', v_limite));
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000030_nombre_en_la_reserva.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0030 · LA CITA GUARDA EL NOMBRE QUE ESCRIBIÓ QUIEN RESERVÓ (revisión de seguridad, hallazgo 2)
--
-- El celular identifica la ficha del cliente: quien reserva en línea con el celular de otra persona queda ligado a la
-- ficha de su dueño, y la agenda mostraba solo el nombre de esa ficha. Ahora:
--   * `citas.nombre_reserva`: el nombre escrito en la reserva en línea (null si la cita la anotó el equipo).
--   * La agenda (`listar_citas`, `obtener_cita`) y el aviso push dicen `reservo_como` SOLO cuando ese nombre es distinto del de la
--     ficha (sin mirar mayúsculas ni espacios en los bordes); si es el mismo, es null y no se muestra nada.
--   * La respuesta pública (publico_consultar_cita, 0029) sigue sin devolver ningún nombre.
-- Las lecturas de la agenda se ejecutan con los permisos de quien llama: llevan la expresión directa y no llaman a fn_*.
-- Se copian las ÚLTIMAS versiones de fn_publico_reservar (0015), listar_citas y obtener_cita (0011) y publico_tomar_aviso (0018).
-- =====================================================================

alter table public.citas add column if not exists nombre_reserva text;
alter table public.citas drop constraint if exists chk_citas_nombre_reserva;
alter table public.citas add constraint chk_citas_nombre_reserva
  check (nombre_reserva is null or length(btrim(nombre_reserva)) between 1 and 60);
comment on column public.citas.nombre_reserva is 'El nombre que escribió quien reservó en línea (la ficha del cliente puede ser de otra persona con el mismo celular).';

create or replace function public.fn_publico_reservar(
  p_slug text, p_servicio uuid, p_barbero uuid, p_inicio timestamptz,
  p_nombre text, p_telefono text, p_consentimiento boolean, p_web text, p_ahora timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b       record;
  v_nombre  text := coalesce(public.fn_limpiar_texto(p_nombre), '');
  v_tel     text;
  v_inicio  timestamptz;
  v_fecha   date;
  v_barbero uuid;
  v_motivo  text;
  v_r       jsonb;
  v_resumen record;
begin
  -- Campo trampa: una persona no lo ve ni lo llena.
  if btrim(coalesce(p_web, '')) <> '' then
    return public.fn_publico_no('rechazada', 'No pudimos procesar la reserva.');
  end if;

  select b.id, b.nombre, b.reservas_en_linea into v_b
    from public.barberias b where b.slug = lower(btrim(coalesce(p_slug, '')));
  if not found then
    return public.fn_publico_no('no_existe', 'Esa barbería no existe.');
  end if;
  if not v_b.reservas_en_linea then
    return public.fn_publico_no('cerrado', 'Hoy no recibimos reservas en línea.');
  end if;
  if p_consentimiento is distinct from true then
    return public.fn_publico_no('consentimiento', 'Para reservar tienes que aceptar el tratamiento de tus datos.');
  end if;
  if length(v_nombre) = 0 or length(v_nombre) > 60 then
    return public.fn_publico_no('datos', 'Escribe tu nombre (máximo 60 letras).');
  end if;

  begin
    v_tel := public.fn_normalizar_telefono(p_telefono);
  exception when raise_exception then
    v_tel := null;
  end;
  if v_tel is null then
    return public.fn_publico_no('celular_invalido', 'Escribe tu celular con 10 dígitos, por ejemplo 300 123 4567.');
  end if;

  if p_inicio is null or p_servicio is null then
    return public.fn_publico_no('hora_ocupada', 'Esa hora ya no está disponible. Elige otra.');
  end if;
  v_inicio := date_trunc('minute', p_inicio);
  v_fecha := public.fecha_bogota(v_inicio);

  v_motivo := public.fn_publico_topes(v_b.id, v_tel, p_ahora);
  if v_motivo is not null then
    return public.fn_publico_no(v_motivo, 'No pudimos agendar esta reserva ahora. Llámanos o escríbenos por WhatsApp.');
  end if;

  -- La hora tiene que estar entre las libres PÚBLICAS (anticipación, días hacia adelante, horario, bloqueos).
  if p_barbero is null then
    select h.barbero_id into v_barbero
      from public.fn_huecos_cualquiera(v_b.id, p_servicio, v_fecha, v_fecha, p_ahora, true, null) h
     where h.inicio = v_inicio
     limit 1;
  else
    select h.barbero_id into v_barbero
      from public.fn_huecos(v_b.id, p_servicio, p_barbero, v_fecha, v_fecha, p_ahora, true, null) h
     where h.inicio = v_inicio
     limit 1;
  end if;
  if v_barbero is null then
    return public.fn_publico_no('hora_ocupada', 'Esa hora ya no está disponible. Elige otra.');
  end if;

  begin
    v_r := public.fn_crear_cita(v_b.id, v_barbero, p_servicio, v_inicio, null, v_nombre, v_tel, null,
                                'confirmada', false, true, 'cliente');
  exception when raise_exception or exclusion_violation then
    -- Alguien la tomó justo antes (el único error que queda después de validar todo lo demás).
    return public.fn_publico_no('hora_ocupada', 'Esa hora ya la tomaron. Elige otra.');
  end;

  update public.citas set consentimiento_at = p_ahora, nombre_reserva = v_nombre
   where barberia_id = v_b.id and id = (v_r ->> 'id')::uuid;

  select s.nombre as servicio, x.nombre as barbero into v_resumen
    from public.servicios s, public.barberos x
   where s.barberia_id = v_b.id and s.id = p_servicio and x.barberia_id = v_b.id and x.id = v_barbero;

  return jsonb_build_object(
    'ok', true, 'token', v_r -> 'token', 'inicio', v_r -> 'inicio', 'fin', v_r -> 'fin', 'precio', v_r -> 'precio',
    'servicio', v_resumen.servicio, 'barbero', v_resumen.barbero, 'barberia', v_b.nombre);
end $$;

create or replace function public.listar_citas(p_desde date default null, p_hasta date default null,
                                               p_barbero uuid default null, p_con_canceladas boolean default false)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_desde date := coalesce(p_desde, public.hoy_bogota());
  v_hasta date := coalesce(p_hasta, coalesce(p_desde, public.hoy_bogota()));
begin
  if v_hasta < v_desde or v_hasta - v_desde > 62 then
    raise exception 'El rango de fechas no es válido (máximo 62 días).';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'barbero_id', c.barbero_id, 'barbero', b.nombre,
          'cliente_id', c.cliente_id, 'cliente', cl.nombre, 'telefono', cl.telefono,
          'reservo_como', case when c.nombre_reserva is not null and lower(btrim(c.nombre_reserva)) <> lower(btrim(cl.nombre)) then c.nombre_reserva end,
          'servicio_id', c.servicio_id, 'servicio', s.nombre,
          'inicio', c.inicio, 'fin', c.fin, 'duracion_min', c.duracion_min, 'precio', c.precio,
          'estado', c.estado, 'origen', c.origen, 'notas', c.notas,
          'recordatorio_enviado_at', c.recordatorio_enviado_at, 'cancelada_motivo', c.cancelada_motivo)
        order by c.inicio, b.orden, c.id),
      '[]'::jsonb)
      from public.citas c
      join public.barberos b  on b.barberia_id = c.barberia_id and b.id = c.barbero_id
      join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
      join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
     where c.inicio >= (v_desde::timestamp at time zone 'America/Bogota')
       and c.inicio <  ((v_hasta + 1)::timestamp at time zone 'America/Bogota')
       and (p_barbero is null or c.barbero_id = p_barbero)
       and (coalesce(p_con_canceladas, false) or c.estado <> 'cancelada')
  );
end $$;

create or replace function public.obtener_cita(p_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'id', c.id,
           'barbero_id', c.barbero_id, 'barbero', b.nombre,
           'cliente_id', c.cliente_id, 'cliente', cl.nombre, 'telefono', cl.telefono,
           'reservo_como', case when c.nombre_reserva is not null and lower(btrim(c.nombre_reserva)) <> lower(btrim(cl.nombre)) then c.nombre_reserva end,
           'servicio_id', c.servicio_id, 'servicio', s.nombre,
           'inicio', c.inicio, 'fin', c.fin, 'duracion_min', c.duracion_min, 'precio', c.precio,
           'estado', c.estado, 'origen', c.origen, 'notas', c.notas,
           'recordatorio_enviado_at', c.recordatorio_enviado_at, 'cancelada_motivo', c.cancelada_motivo)
    from public.citas c
    join public.barberos b  on b.barberia_id = c.barberia_id and b.id = c.barbero_id
    join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
    join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
   where c.id = p_id
$$;

create or replace function public.publico_tomar_aviso(p_token uuid, p_tipo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c        record;
  v_subs     jsonb;
  v_ahora    timestamptz := now();
begin
  if p_tipo is null or p_tipo not in ('reserva', 'cancelacion') then
    return jsonb_build_object('ok', false);
  end if;

  select c.id, c.barberia_id, c.barbero_id, c.inicio, c.estado, c.origen, c.created_at, c.cancelada_por,
         c.cancelada_at, c.aviso_reserva_at, c.aviso_cancelacion_at,
         cl.nombre as cliente, case when c.nombre_reserva is not null and lower(btrim(c.nombre_reserva)) <> lower(btrim(cl.nombre)) then c.nombre_reserva end as reservo_como,
         s.nombre as servicio, b.nombre as barbero
    into v_c
    from public.citas c
    join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
    join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
    join public.barberos b on b.barberia_id = c.barberia_id and b.id = c.barbero_id
   where c.token = p_token
     for update of c;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  -- Solo la reserva o la cancelación que el CLIENTE acaba de hacer, y una sola vez.
  if p_tipo = 'reserva' then
    if v_c.origen <> 'cliente' or v_c.aviso_reserva_at is not null or v_c.created_at < v_ahora - interval '10 minutes' then
      return jsonb_build_object('ok', false);
    end if;
    update public.citas set aviso_reserva_at = v_ahora where barberia_id = v_c.barberia_id and id = v_c.id;
  else
    if v_c.estado <> 'cancelada' or v_c.cancelada_por is not null or v_c.aviso_cancelacion_at is not null
       or v_c.cancelada_at < v_ahora - interval '10 minutes' then
      return jsonb_build_object('ok', false);
    end if;
    update public.citas set aviso_cancelacion_at = v_ahora where barberia_id = v_c.barberia_id and id = v_c.id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('endpoint', sp.endpoint, 'p256dh', sp.p256dh, 'auth', sp.auth)), '[]'::jsonb)
    into v_subs
    from public.suscripciones_push sp
   where sp.barberia_id = v_c.barberia_id
     and (
       public.fn_areas_de(sp.user_id) @> array['agenda']::text[]
       or (public.fn_areas_de(sp.user_id) @> array['mi_agenda']::text[]
           and exists (select 1 from public.barberos x
                        where x.barberia_id = v_c.barberia_id and x.id = v_c.barbero_id and x.user_id = sp.user_id))
     );

  return jsonb_build_object(
    'ok', true, 'tipo', p_tipo,
    'cita', jsonb_build_object('id', v_c.id, 'cliente', v_c.cliente, 'reservo_como', v_c.reservo_como, 'servicio', v_c.servicio,
                               'barbero', v_c.barbero, 'inicio', v_c.inicio),
    'suscripciones', v_subs);
end $$;

select public.fn_aplicar_permisos();

-- >>>>>>>>>> 20261015000031_push_solo_navegadores.sql >>>>>>>>>>
-- =====================================================================
-- BARBERÍAS · 0031 · LOS AVISOS PUSH SOLO VAN A LOS SERVICIOS DE LOS NAVEGADORES (revisión de seguridad 02, hallazgo S4)
--
-- El servidor manda cada aviso con una petición a la dirección (`endpoint`) que el celular dio al activar los avisos. La base solo
-- pedía que empezara por `https://`: quien tuviera cuenta del equipo podía registrar CUALQUIER dirección y hacer que el servidor
-- le escribiera cada vez que entrara una reserva (SSRF ciego). Ahora:
--   * El `endpoint` tiene que ser de un servicio push de un navegador: Chrome/Edge/Opera/Brave/Samsung (fcm.googleapis.com),
--     Firefox (updates.push.services.mozilla.com), Safari (*.push.apple.com) o Windows (*.notify.windows.com).
--     Mismo patrón que `ENDPOINT_PUSH` en `src/lib/avisos-push.ts` (una prueba los compara).
--   * Máximo 5 celulares con avisos por persona (cambiar de celular: apagar los avisos en uno y activarlos en otro).
-- Es la ÚLTIMA versión de guardar_suscripcion_push (0018), con el tope.
-- =====================================================================

-- Si algún celular quedó con una dirección que ya no se acepta, se olvida: solo es una dirección de avisos, se vuelve a activar.
delete from public.suscripciones_push
 where endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/';

alter table public.suscripciones_push drop constraint if exists suscripciones_push_endpoint_check;
alter table public.suscripciones_push drop constraint if exists chk_suscripciones_endpoint;
alter table public.suscripciones_push add constraint chk_suscripciones_endpoint check (
  length(endpoint) between 20 and 1000
  and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/');

create or replace function public.guardar_suscripcion_push(p_endpoint text, p_p256dh text, p_auth text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda');
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
begin
  if not exists (select 1 from public.suscripciones_push where endpoint = v_endpoint)
     and (select count(*) from public.suscripciones_push where barberia_id = v_barberia and user_id = auth.uid()) >= 5 then
    raise exception 'Ya hay 5 celulares con avisos en esta cuenta. Apaga los avisos en uno para activarlos en otro.';
  end if;

  -- Si ese celular ya estaba (otra persona lo usaba antes), pasa a esta.
  insert into public.suscripciones_push (barberia_id, user_id, endpoint, p256dh, auth)
  values (v_barberia, auth.uid(), v_endpoint, btrim(coalesce(p_p256dh, '')), btrim(coalesce(p_auth, '')))
  on conflict (endpoint) do update
     set barberia_id = excluded.barberia_id, user_id = excluded.user_id,
         p256dh = excluded.p256dh, auth = excluded.auth;
  return jsonb_build_object('ok', true);
exception when check_violation then
  raise exception 'Ese celular no pudo activar los avisos. Intenta de nuevo.';
end $$;

select public.fn_aplicar_permisos();
