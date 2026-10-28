-- =====================================================================
-- BARBERÍAS · 0012 · CLIENTES: ALTA, FICHA Y NOTA DEL CORTE (tarea 1.8 · SPEC F10)
--
--   * El alta AUTOMÁTICA por celular ya existe: crear_cita une o crea el cliente (fn_cliente_resolver, 0010).
--     Un celular es un cliente dentro de la barbería (índice único, 0008).
--   * crear_cliente(...)         alta manual (p. ej. pasar la libreta). Un celular repetido dice de quién es.
--   * actualizar_cliente(...)    nombre y celular (recepción: área "agenda").
--   * guardar_nota_cliente(...)  la nota del corte ("degradé 2 a los lados"): también la escribe el barbero.
--   * obtener_cliente(...)       la ficha: datos, visitas, no asistió, última visita y las últimas 20 citas.
--                                El barbero (solo "mi_agenda") ve en el historial únicamente SUS citas.
--
-- No se borra a nadie. (La supresión de datos personales a pedido del titular, Ley 1581, se resuelve con una
-- función propia en la Fase 4: no es un DELETE.)
-- =====================================================================

create or replace function public.crear_cliente(p_nombre text, p_telefono text default null, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda');
  v_nombre   text := public.fn_limpiar_texto(p_nombre);
  v_telefono text := public.fn_normalizar_telefono(p_telefono);
  v_nota     text := nullif(public.fn_limpiar_texto(p_nota), '');
  v_id       uuid;
  v_dueno    text;
begin
  if length(v_nombre) = 0 or length(v_nombre) > 60 then
    raise exception 'Escribe el nombre del cliente (máximo 60 caracteres).';
  end if;
  if v_nota is not null and length(v_nota) > 300 then
    raise exception 'La nota es muy larga (máximo 300 letras).';
  end if;

  if v_telefono is not null then
    select nombre into v_dueno from public.clientes where barberia_id = v_barberia and telefono = v_telefono;
    if found then
      raise exception 'Ese celular ya es de %.', v_dueno;
    end if;
  end if;

  begin
    insert into public.clientes (barberia_id, nombre, telefono, nota)
    values (v_barberia, v_nombre, v_telefono, v_nota)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ese celular ya es de otro cliente.';
  end;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.actualizar_cliente(p_id uuid, p_nombre text, p_telefono text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda');
  v_nombre   text := public.fn_limpiar_texto(p_nombre);
  v_telefono text := public.fn_normalizar_telefono(p_telefono);
  v_dueno    text;
begin
  if length(v_nombre) = 0 or length(v_nombre) > 60 then
    raise exception 'Escribe el nombre del cliente (máximo 60 caracteres).';
  end if;

  if v_telefono is not null then
    select nombre into v_dueno
      from public.clientes where barberia_id = v_barberia and telefono = v_telefono and id <> p_id;
    if found then
      raise exception 'Ese celular ya es de %.', v_dueno;
    end if;
  end if;

  begin
    update public.clientes set nombre = v_nombre, telefono = v_telefono
     where barberia_id = v_barberia and id = p_id;
  exception when unique_violation then
    raise exception 'Ese celular ya es de otro cliente.';
  end;
  if not found then
    raise exception 'No existe ese cliente.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end $$;

-- La nota del corte. Vacía = sin nota.
create or replace function public.guardar_nota_cliente(p_id uuid, p_nota text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda');
  v_nota     text := nullif(public.fn_limpiar_texto(p_nota), '');
begin
  if v_nota is not null and length(v_nota) > 300 then
    raise exception 'La nota es muy larga (máximo 300 letras).';
  end if;
  update public.clientes set nota = v_nota where barberia_id = v_barberia and id = p_id;
  if not found then
    raise exception 'No existe ese cliente.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end $$;

-- La ficha del cliente (null si no existe). Quien solo abre "mi_agenda" ve en el historial únicamente sus citas.
create or replace function public.obtener_cliente(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda', 'caja');
  v_todas    boolean := public.tiene_area('agenda', 'caja');
  v_mio      uuid := public.mi_barbero();
  v          jsonb;
begin
  select jsonb_build_object(
           'id', cl.id, 'nombre', cl.nombre, 'telefono', cl.telefono, 'nota', cl.nota, 'creado', cl.created_at,
           'visitas', (select count(*) from public.citas c
                        where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id and c.estado = 'atendida'),
           'no_asistio', (select count(*) from public.citas c
                           where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id and c.estado = 'no_asistio'),
           'ultima_visita', (select max(c.inicio) from public.citas c
                              where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id and c.estado = 'atendida'),
           'citas', coalesce((
             select jsonb_agg(to_jsonb(h) order by h.inicio desc)
               from (
                 select c.id, c.inicio, c.fin, c.estado, c.precio, s.nombre as servicio, b.nombre as barbero
                   from public.citas c
                   join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
                   join public.barberos b on b.barberia_id = c.barberia_id and b.id = c.barbero_id
                  where c.barberia_id = cl.barberia_id and c.cliente_id = cl.id
                    and (v_todas or c.barbero_id = v_mio)
                  order by c.inicio desc
                  limit 20
               ) h), '[]'::jsonb))
    into v
    from public.clientes cl
   where cl.barberia_id = v_barberia and cl.id = p_id;
  return v;
end $$;

select public.fn_aplicar_permisos();
