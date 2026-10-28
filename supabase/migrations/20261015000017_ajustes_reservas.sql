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
