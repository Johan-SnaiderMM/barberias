-- =====================================================================
-- BARBERÍAS · 0011 · LECTURAS DE LA AGENDA (tarea 1.7 · SPEC F4)
--
--   listar_citas(...)    las citas de un rango de días (hora de Bogotá), con cliente, servicio y barbero.
--   obtener_huecos(...)  las horas libres para el PERSONAL (sin anticipación ni "acepta reservas"; nunca las pasadas).
--   buscar_clientes(...) clientes por nombre o celular, con visitas, última visita y "no asistió".
--
-- Quién ve qué lo decide la base: "agenda" y "caja" ven todas las citas; "mi_agenda" (el barbero) solo las suyas
-- (RLS de 0008). obtener_huecos a quien solo tiene "mi_agenda" le responde únicamente por su propio tiempo.
-- =====================================================================

-- Citas de un rango de días de Bogotá [p_desde, p_hasta] (por defecto hoy), en orden de hora.
-- Las canceladas no salen salvo que se pidan. Lee con los permisos de quien llama (RLS).
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

-- Una cita con los mismos datos que listar_citas (null si no existe o no la puede ver quien pregunta).
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

-- Horas libres para el personal: [{"barbero_id", "inicio", "fin"}, …].
--   * Con p_barbero: las de ese barbero. Sin p_barbero: "la primera disponible" (una hora por instante, con el
--     barbero que ese día tiene menos citas).
--   * p_ignorar_cita: al mover una cita, la propia no cuenta contra sí misma.
create or replace function public.obtener_huecos(p_servicio uuid, p_barbero uuid default null,
                                                 p_desde date default null, p_hasta date default null,
                                                 p_ignorar_cita uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda');
  v_barbero  uuid := p_barbero;
begin
  if not public.tiene_area('agenda') then
    -- Solo "mi_agenda": únicamente su propio tiempo.
    v_barbero := public.mi_barbero();
    if v_barbero is null or (p_barbero is not null and p_barbero <> v_barbero) then
      raise exception 'Solo puedes ver tu propia agenda.' using errcode = '42501';
    end if;
  end if;

  if v_barbero is null then
    return coalesce((
      select jsonb_agg(jsonb_build_object('barbero_id', h.barbero_id, 'inicio', h.inicio, 'fin', h.fin)
                       order by h.inicio, h.barbero_id)
        from public.fn_huecos_cualquiera(v_barberia, p_servicio, p_desde, p_hasta, now(), false, p_ignorar_cita) h
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('barbero_id', h.barbero_id, 'inicio', h.inicio, 'fin', h.fin)
                     order by h.inicio, h.barbero_id)
      from public.fn_huecos(v_barberia, p_servicio, v_barbero, p_desde, p_hasta, now(), false, p_ignorar_cita) h
  ), '[]'::jsonb);
end $$;

-- Clientes por nombre (parte, sin importar mayúsculas) o por celular (dígitos). Sin texto: los más recientes.
-- visitas = citas atendidas; no_asistio = veces que no llegó; ultima_visita = su última cita atendida.
create or replace function public.buscar_clientes(p_texto text default null, p_limite integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda', 'caja');
  v_texto    text := nullif(public.fn_limpiar_texto(p_texto), '');
  v_digitos  text := regexp_replace(coalesce(p_texto, ''), '\D', '', 'g');
  v_limite   integer := least(greatest(coalesce(p_limite, 20), 1), 50);
begin
  return (
    select coalesce(jsonb_agg(f.fila order by f.ultima desc nulls last, f.orden_nombre), '[]'::jsonb)
      from (
        select jsonb_build_object(
                 'id', t.id, 'nombre', t.nombre, 'telefono', t.telefono, 'nota', t.nota,
                 'visitas', t.visitas, 'no_asistio', t.no_asistio, 'ultima_visita', t.ultima) as fila,
               t.ultima, lower(t.nombre) as orden_nombre
          from (
            select cl.id, cl.nombre, cl.telefono, cl.nota,
                   (select count(*) from public.citas c
                     where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id and c.estado = 'atendida')::integer as visitas,
                   (select count(*) from public.citas c
                     where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id and c.estado = 'no_asistio')::integer as no_asistio,
                   (select max(c.inicio) from public.citas c
                     where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id and c.estado = 'atendida') as ultima
              from public.clientes cl
             where cl.barberia_id = v_barberia and cl.activo
               and (v_texto is null
                    or cl.nombre ilike '%' || replace(replace(v_texto, '%', ''), '_', '') || '%'
                    or (length(v_digitos) >= 3 and cl.telefono like '%' || v_digitos || '%'))
          ) t
         order by t.ultima desc nulls last, lower(t.nombre)
         limit v_limite
      ) f
  );
end $$;

select public.fn_aplicar_permisos();
