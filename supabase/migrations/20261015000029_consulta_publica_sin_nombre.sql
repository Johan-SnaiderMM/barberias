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
