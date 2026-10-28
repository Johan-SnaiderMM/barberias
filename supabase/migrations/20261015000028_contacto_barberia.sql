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
