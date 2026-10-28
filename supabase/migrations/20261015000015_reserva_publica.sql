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
