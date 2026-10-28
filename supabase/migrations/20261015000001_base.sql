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
