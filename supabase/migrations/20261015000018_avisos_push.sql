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
