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
