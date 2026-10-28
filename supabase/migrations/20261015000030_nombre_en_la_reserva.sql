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
