-- =====================================================================
-- BARBERÍAS · 0010 · CREAR, MOVER Y CANCELAR CITAS A MANO (tarea 1.6 · SPEC F4)
--
--   crear_cita(...)              agenda una cita (cliente existente o nuevo por celular).
--   crear_cita_sin_reserva(...)  "llegó sin cita": empieza AHORA, en atención.
--   mover_cita(...)              cambia SOLO la hora (mismo barbero); la hora final se recalcula sola.
--   cancelar_cita(...)           cancela con motivo (la hora queda libre).
--   cambiar_estado_cita(...)     empezar, terminar, no llegó, deshacer y reactivar.
--
-- REGLAS
--   * Permiso: "agenda" (de cualquiera) o "mi_agenda" (solo el propio barbero): fn_requerir_agenda_de.
--   * NUNCA dos citas vigentes se traslapan: lo garantiza la restricción de la tabla (0008). Si la hora está ocupada
--     la función FALLA con un mensaje claro (quién la tiene y de qué hora a qué hora) y NO cambia nada.
--   * AVISOS que se pueden confirmar (el personal sabe más que la regla): hora que ya pasó, fuera del horario del
--     barbero, o sobre un bloqueo. Sin confirmar no se guarda y se devuelven los avisos:
--       {"ok": false, "motivo": "avisos", "avisos": [{"tipo": "...", "mensaje": "..."}]}
--     Una hora OCUPADA no es un aviso: no se puede forzar.
--   * Precio y duración los copia el trigger de 0008; el cliente se resuelve por celular dentro de la barbería.
--   * Mover una cita borra su recordatorio (el aviso que se mandó era de otra hora).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ayudantes (internos)
-- ---------------------------------------------------------------------

-- Celular -> E.164. Un celular colombiano de 10 dígitos que empieza en 3 recibe +57; con "+" o "00" se respeta el país.
-- Vacío -> null. Si no se entiende, falla con un mensaje claro. (Espejo en src/lib/telefono.ts: una prueba los compara.)
create or replace function public.fn_normalizar_telefono(p_texto text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_txt text := btrim(coalesce(p_texto, ''));
  v_dig text;
begin
  if v_txt = '' then
    return null;
  end if;
  v_dig := regexp_replace(v_txt, '\D', '', 'g');
  if left(v_txt, 1) = '+' or left(v_dig, 2) = '00' then
    v_dig := regexp_replace(v_dig, '^00', '');
    if v_dig ~ '^[1-9][0-9]{7,14}$' then
      return '+' || v_dig;
    end if;
  elsif v_dig ~ '^3[0-9]{9}$' then
    return '+57' || v_dig;
  elsif v_dig ~ '^573[0-9]{9}$' then
    return '+' || v_dig;
  end if;
  raise exception 'El celular no es válido. Escríbelo con 10 dígitos, por ejemplo 300 123 4567.';
end $$;

-- "10:05 a. m." (hora de Bogotá). Espejo de horaCorta en src/lib/fechas.ts.
create or replace function public.fn_hora_texto(p timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p at time zone 'America/Bogota', 'FMHH12:MI')
         || case when extract(hour from (p at time zone 'America/Bogota')) < 12 then ' a. m.' else ' p. m.' end
$$;

create or replace function public.fn_texto_estado(p_estado text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_estado
           when 'confirmada' then 'confirmada'
           when 'en_atencion' then 'en atención'
           when 'atendida' then 'atendida'
           when 'cancelada' then 'cancelada'
           when 'no_asistio' then 'no asistió'
           else p_estado
         end
$$;

-- ¿La cita [inicio, fin) cabe entera dentro de una franja del barbero ese día? (franjas pegadas cuentan como una)
create or replace function public.fn_dentro_de_horario(p_barberia uuid, p_barbero uuid, p_inicio timestamptz, p_fin timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_local timestamp := p_inicio at time zone 'America/Bogota';
  v_m_ini integer;
  v_m_fin integer;
  v_dow   integer;
begin
  v_m_ini := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_m_fin := v_m_ini + (extract(epoch from (p_fin - p_inicio)) / 60)::integer;
  if v_m_fin > 1440 then
    return false;   -- cruza la medianoche
  end if;
  v_dow := extract(dow from v_local)::integer;
  return exists (
    with fr as (
      select h.desde_min, h.hasta_min,
             case when h.desde_min <= max(h.hasta_min) over (
                         order by h.desde_min, h.hasta_min rows between unbounded preceding and 1 preceding)
                  then 0 else 1 end as nueva
        from public.horarios_barbero h
       where h.barberia_id = p_barberia and h.barbero_id = p_barbero and h.dia_semana = v_dow),
    grp as (
      select fr.desde_min, fr.hasta_min, sum(fr.nueva) over (order by fr.desde_min, fr.hasta_min) as g from fr),
    islas as (
      select min(grp.desde_min) as d, max(grp.hasta_min) as h from grp group by grp.g)
    select 1 from islas where islas.d <= v_m_ini and v_m_fin <= islas.h);
end $$;

-- Avisos que se pueden confirmar: hora pasada, fuera del horario del barbero, sobre un bloqueo.
create or replace function public.fn_avisos_cita(p_barberia uuid, p_barbero uuid, p_inicio timestamptz,
                                                 p_fin timestamptz, p_nombre_barbero text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_avisos jsonb := '[]'::jsonb;
  v_b      record;
begin
  if p_inicio < now() - interval '15 minutes' then
    v_avisos := v_avisos || jsonb_build_array(jsonb_build_object('tipo', 'pasado', 'mensaje', 'Esa hora ya pasó.'));
  end if;
  if not public.fn_dentro_de_horario(p_barberia, p_barbero, p_inicio, p_fin) then
    v_avisos := v_avisos || jsonb_build_array(jsonb_build_object(
      'tipo', 'fuera_de_horario', 'mensaje', p_nombre_barbero || ' no trabaja a esa hora.'));
  end if;
  for v_b in
    select x.motivo from public.bloqueos x
     where x.barberia_id = p_barberia and x.barbero_id = p_barbero and x.activo
       and x.inicio < p_fin and x.fin > p_inicio
     order by x.inicio
  loop
    v_avisos := v_avisos || jsonb_build_array(jsonb_build_object(
      'tipo', 'bloqueo',
      'mensaje', p_nombre_barbero || ' tiene un bloqueo' || coalesce(' (' || v_b.motivo || ')', '')
                 || ' que se cruza con esa hora.'));
  end loop;
  return v_avisos;
end $$;

-- El cliente de una cita: uno existente (p_cliente) o, por celular, el que ya existe o uno nuevo.
-- Sin celular siempre es uno nuevo (no se unen por nombre: dos "Juan" no son la misma persona).
create or replace function public.fn_cliente_resolver(p_barberia uuid, p_cliente uuid, p_nombre text, p_telefono text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nombre   text := public.fn_limpiar_texto(p_nombre);
  v_telefono text := public.fn_normalizar_telefono(p_telefono);
  v_id       uuid;
begin
  if p_cliente is not null then
    select id into v_id from public.clientes where barberia_id = p_barberia and id = p_cliente and activo;
    if v_id is null then
      raise exception 'No existe ese cliente.' using errcode = 'P0002';
    end if;
    return v_id;
  end if;

  if length(v_nombre) = 0 or length(v_nombre) > 60 then
    raise exception 'Escribe el nombre del cliente (máximo 60 caracteres).';
  end if;

  if v_telefono is not null then
    select id into v_id from public.clientes where barberia_id = p_barberia and telefono = v_telefono;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  begin
    insert into public.clientes (barberia_id, nombre, telefono)
    values (p_barberia, v_nombre, v_telefono)
    returning id into v_id;
  exception when unique_violation then
    -- Otro lo creó justo ahora con el mismo celular: se usa ese.
    select id into v_id from public.clientes where barberia_id = p_barberia and telefono = v_telefono;
  end;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Insertar una cita (lo comparten crear_cita y crear_cita_sin_reserva)
-- ---------------------------------------------------------------------
create or replace function public.fn_crear_cita(
  p_barberia uuid, p_barbero uuid, p_servicio uuid, p_inicio timestamptz,
  p_cliente uuid, p_cliente_nombre text, p_cliente_telefono text, p_notas text,
  p_estado text, p_avisar boolean, p_confirmar boolean)
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
    insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio, estado, notas)
    values (p_barberia, p_barbero, v_cliente, p_servicio, v_inicio, p_estado, v_notas)
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
-- 3. API del personal
-- ---------------------------------------------------------------------

-- Agenda una cita. Cliente: `p_cliente` (existente) o `p_cliente_nombre` (+ celular opcional, que lo reconoce si ya existe).
create or replace function public.crear_cita(
  p_barbero uuid, p_servicio uuid, p_inicio timestamptz,
  p_cliente uuid default null, p_cliente_nombre text default null, p_cliente_telefono text default null,
  p_notas text default null, p_confirmar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.fn_requerir_agenda_de(p_barbero);
begin
  return public.fn_crear_cita(v_barberia, p_barbero, p_servicio, p_inicio, p_cliente, p_cliente_nombre,
                              p_cliente_telefono, p_notas, 'confirmada', true, p_confirmar);
end $$;

-- "Llegó sin cita": la cita empieza AHORA (en atención). Si el barbero está ocupado, falla con quién lo tiene.
create or replace function public.crear_cita_sin_reserva(
  p_barbero uuid, p_servicio uuid,
  p_cliente uuid default null, p_cliente_nombre text default null, p_cliente_telefono text default null,
  p_notas text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.fn_requerir_agenda_de(p_barbero);
begin
  return public.fn_crear_cita(v_barberia, p_barbero, p_servicio, now(), p_cliente, p_cliente_nombre,
                              p_cliente_telefono, p_notas, 'en_atencion', false, true);
end $$;

-- Cambia SOLO la hora de una cita confirmada. Ocupada -> falla y la deja donde estaba.
create or replace function public.mover_cita(p_id uuid, p_inicio timestamptz, p_confirmar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_inicio   timestamptz := date_trunc('minute', p_inicio);
  v_c        record;
  v_nombre   text;
  v_fin      timestamptz;
  v_avisos   jsonb;
  v_choque   record;
begin
  if p_inicio is null then
    raise exception 'Elige la nueva fecha y hora.';
  end if;

  select c.barbero_id, c.estado, c.inicio, c.duracion_min into v_c
    from public.citas c where c.barberia_id = v_barberia and c.id = p_id
     for update;
  if not found then
    raise exception 'No existe esa cita.' using errcode = 'P0002';
  end if;
  perform public.fn_requerir_agenda_de(v_c.barbero_id);

  if v_c.estado <> 'confirmada' then
    raise exception 'Solo se pueden mover las citas confirmadas (esta está %).', public.fn_texto_estado(v_c.estado);
  end if;

  v_fin := public.fn_sumar_minutos(v_inicio, v_c.duracion_min);
  if v_inicio = v_c.inicio then
    return jsonb_build_object('ok', true, 'id', p_id, 'inicio', v_inicio, 'fin', v_fin);
  end if;

  select nombre into v_nombre from public.barberos where barberia_id = v_barberia and id = v_c.barbero_id;

  if not coalesce(p_confirmar, false) then
    v_avisos := public.fn_avisos_cita(v_barberia, v_c.barbero_id, v_inicio, v_fin, v_nombre);
    if jsonb_array_length(v_avisos) > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'avisos', 'avisos', v_avisos);
    end if;
  end if;

  begin
    update public.citas
       set inicio = v_inicio, recordatorio_enviado_at = null
     where barberia_id = v_barberia and id = p_id;
  exception when exclusion_violation then
    select c.inicio, c.fin, cl.nombre as cliente into v_choque
      from public.citas c
      join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
     where c.barberia_id = v_barberia and c.barbero_id = v_c.barbero_id and c.id <> p_id
       and c.estado in ('confirmada', 'en_atencion', 'atendida')
       and tstzrange(c.inicio, c.fin, '[)') && tstzrange(v_inicio, v_fin, '[)')
     order by c.inicio
     limit 1;
    if v_choque.cliente is null then
      raise exception '% ya tiene una cita a esa hora.', v_nombre;
    end if;
    raise exception '% ya tiene a % de % a % (elige otra hora).',
      v_nombre, v_choque.cliente, public.fn_hora_texto(v_choque.inicio), public.fn_hora_texto(v_choque.fin);
  end;

  return jsonb_build_object('ok', true, 'id', p_id, 'inicio', v_inicio, 'fin', v_fin);
end $$;

-- Cancela una cita confirmada. El motivo es obligatorio y la hora queda libre.
create or replace function public.cancelar_cita(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_motivo   text := public.fn_limpiar_texto(p_motivo);
  v_c        record;
begin
  if length(v_motivo) = 0 then
    raise exception 'Escribe por qué se cancela la cita.';
  end if;
  if length(v_motivo) > 200 then
    raise exception 'El motivo es muy largo (máximo 200 letras).';
  end if;

  select c.barbero_id, c.estado into v_c
    from public.citas c where c.barberia_id = v_barberia and c.id = p_id
     for update;
  if not found then
    raise exception 'No existe esa cita.' using errcode = 'P0002';
  end if;
  perform public.fn_requerir_agenda_de(v_c.barbero_id);

  if v_c.estado <> 'confirmada' then
    raise exception 'Solo se pueden cancelar las citas confirmadas (esta está %).', public.fn_texto_estado(v_c.estado);
  end if;

  update public.citas
     set estado = 'cancelada', cancelada_motivo = v_motivo, cancelada_por = auth.uid(), cancelada_at = now()
   where barberia_id = v_barberia and id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'estado', 'cancelada');
end $$;

-- Cambios de estado (la cancelación va por cancelar_cita):
--   confirmada  -> en_atencion (empezar) · no_asistio (no llegó; solo cuando ya es la hora)
--   en_atencion -> atendida (terminar) · confirmada (deshacer)
--   atendida    -> en_atencion (reabrir)
--   no_asistio  -> confirmada (deshacer)
--   cancelada   -> confirmada (reactivar; falla si otra cita ya tomó la hora)
create or replace function public.cambiar_estado_cita(p_id uuid, p_estado text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_c        record;
  v_ok       boolean;
  v_nombre   text;
  v_choque   record;
begin
  if p_estado is null or p_estado not in ('confirmada', 'en_atencion', 'atendida', 'no_asistio') then
    raise exception 'Ese estado no es válido (para cancelar se usa «cancelar la cita»).';
  end if;

  select c.barbero_id, c.estado, c.inicio, c.fin into v_c
    from public.citas c where c.barberia_id = v_barberia and c.id = p_id
     for update;
  if not found then
    raise exception 'No existe esa cita.' using errcode = 'P0002';
  end if;
  perform public.fn_requerir_agenda_de(v_c.barbero_id);

  v_ok := case v_c.estado
            when 'confirmada'  then p_estado in ('en_atencion', 'no_asistio')
            when 'en_atencion' then p_estado in ('atendida', 'confirmada')
            when 'atendida'    then p_estado = 'en_atencion'
            when 'no_asistio'  then p_estado = 'confirmada'
            when 'cancelada'   then p_estado = 'confirmada'
            else false
          end;
  if not v_ok then
    raise exception 'Una cita % no se puede pasar a %.',
      public.fn_texto_estado(v_c.estado), public.fn_texto_estado(p_estado);
  end if;
  if p_estado = 'no_asistio' and now() < v_c.inicio then
    raise exception 'Todavía no es la hora de la cita.';
  end if;

  begin
    update public.citas
       set estado = p_estado,
           cancelada_motivo = case when p_estado = 'confirmada' then null else cancelada_motivo end,
           cancelada_por    = case when p_estado = 'confirmada' then null else cancelada_por end,
           cancelada_at     = case when p_estado = 'confirmada' then null else cancelada_at end
     where barberia_id = v_barberia and id = p_id;
  exception when exclusion_violation then
    select nombre into v_nombre from public.barberos where barberia_id = v_barberia and id = v_c.barbero_id;
    select c.inicio, c.fin, cl.nombre as cliente into v_choque
      from public.citas c
      join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
     where c.barberia_id = v_barberia and c.barbero_id = v_c.barbero_id and c.id <> p_id
       and c.estado in ('confirmada', 'en_atencion', 'atendida')
       and tstzrange(c.inicio, c.fin, '[)') && tstzrange(v_c.inicio, v_c.fin, '[)')
     order by c.inicio
     limit 1;
    raise exception 'No se puede reactivar: % ya tiene a % de % a % (esa hora ya la tomaron).',
      v_nombre, coalesce(v_choque.cliente, 'otra persona'),
      coalesce(public.fn_hora_texto(v_choque.inicio), public.fn_hora_texto(v_c.inicio)),
      coalesce(public.fn_hora_texto(v_choque.fin), public.fn_hora_texto(v_c.fin));
  end;

  return jsonb_build_object('ok', true, 'id', p_id, 'estado', p_estado);
end $$;

select public.fn_aplicar_permisos();
