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
