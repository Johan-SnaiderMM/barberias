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
