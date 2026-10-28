-- =====================================================================
-- BARBERÍAS · 0009 · DISPONIBILIDAD: LAS HORAS LIBRES (tarea 1.5 · SPEC F5)
--
-- UNA sola función SQL calcula las horas libres; no hay otra versión en TypeScript. La usan la reserva pública
-- (Fase 2) y la agenda del personal (1.6/1.7), así que nunca se contradicen.
--
--   fn_huecos(...)            las horas libres de uno o de todos los barberos que hacen un servicio.
--   fn_huecos_cualquiera(...) "la primera disponible": una sola hora por instante, con el barbero que ese día tiene
--                             menos citas (a igual carga, el de menor orden).
--
-- REGLAS (la tabla de casos de borde está en src/test/disponibilidad.test.ts):
--   * Las horas posibles arrancan en la hora de inicio de cada franja y avanzan de `paso_min` en `paso_min`.
--     Las franjas pegadas (13:00 y 13:00) se unen en una sola.
--   * Una hora vale si el servicio ENTRA completo en la franja. La duración es la del barbero si la tiene propia.
--   * Se descartan las que se cruzan con una cita vigente (confirmada, en atención o atendida) o con un bloqueo
--     activo. Entre dos citas debe quedar el descanso `colchon_min` (no se pide contra un bloqueo ni contra el
--     cierre de la franja).
--   * Público (p_publico = true): respeta `anticipacion_min` y `dias_adelante` y solo ofrece a quien acepta reservas
--     en línea. Personal (false): sin esos límites. En ambos casos nunca ofrece una hora que ya pasó.
--   * Las fechas y las horas de las franjas son de Bogotá (sin horario de verano).
--
-- Son internas (fn_*): las llaman las funciones públicas y de personal, que validan permisos.
-- p_ahora existe para que las pruebas usen un "ahora" fijo.
-- =====================================================================

create or replace function public.fn_huecos(
  p_barberia     uuid,
  p_servicio     uuid,
  p_barbero      uuid default null,
  p_desde        date default null,
  p_hasta        date default null,
  p_ahora        timestamptz default now(),
  p_publico      boolean default true,
  p_ignorar_cita uuid default null
)
returns table (barbero_id uuid, inicio timestamptz, fin timestamptz, carga_dia integer, orden_barbero integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_hoy      date := public.fecha_bogota(p_ahora);
  v_desde    date := coalesce(p_desde, public.fecha_bogota(p_ahora));
  v_hasta    date;
  v_paso     integer;
  v_dias     integer;
  v_antic    integer;
  v_colchon  integer;
begin
  v_hasta := coalesce(p_hasta, v_desde);
  if v_hasta < v_desde or v_hasta - v_desde > 62 then
    raise exception 'El rango de fechas no es válido (máximo 62 días).';
  end if;

  select b.paso_min, b.dias_adelante, b.anticipacion_min, b.colchon_min
    into v_paso, v_dias, v_antic, v_colchon
    from public.barberias b
   where b.id = p_barberia;
  if not found then
    return;
  end if;

  return query
  with
  serv as (
    select s.id, s.duracion_min
      from public.servicios s
     where s.barberia_id = p_barberia and s.id = p_servicio and s.activo
  ),
  -- Barberos que pueden: activos, que hacen ESE servicio (con su duración propia si la tienen).
  barb as (
    select b.id as bid, b.orden as orden, coalesce(bs.duracion_propia, serv.duracion_min) as dur
      from public.barberos b
      join serv on true
      join public.barbero_servicios bs
        on bs.barberia_id = b.barberia_id and bs.barbero_id = b.id and bs.servicio_id = serv.id
     where b.barberia_id = p_barberia and b.activo
       and (p_barbero is null or b.id = p_barbero)
       and (not p_publico or b.acepta_reservas)
  ),
  dias as (
    select g::date as dia
      from generate_series(v_desde::timestamp, v_hasta::timestamp, interval '1 day') g
  ),
  -- Franjas pegadas (13:00 y 13:00) se unen: "islas" de minutos por barbero y día de la semana.
  fr as (
    select h.barbero_id as bid, h.dia_semana, h.desde_min, h.hasta_min,
           case when h.desde_min <= max(h.hasta_min) over (
                       partition by h.barbero_id, h.dia_semana
                       order by h.desde_min, h.hasta_min
                       rows between unbounded preceding and 1 preceding)
                then 0 else 1 end as nueva
      from public.horarios_barbero h
     where h.barberia_id = p_barberia and h.barbero_id in (select bid from barb)
  ),
  grp as (
    select fr.bid, fr.dia_semana, fr.desde_min, fr.hasta_min,
           sum(fr.nueva) over (partition by fr.bid, fr.dia_semana order by fr.desde_min, fr.hasta_min) as g
      from fr
  ),
  islas as (
    select grp.bid, grp.dia_semana, min(grp.desde_min) as desde_min, max(grp.hasta_min) as hasta_min
      from grp
     group by grp.bid, grp.dia_semana, grp.g
  ),
  -- Cada isla en cada día pedido, como instantes (las horas de la franja son de Bogotá).
  ventanas as (
    select b.bid, b.orden, b.dur, d.dia,
           ((d.dia + i.desde_min * interval '1 minute') at time zone 'America/Bogota') as v_ini,
           ((d.dia + i.hasta_min * interval '1 minute') at time zone 'America/Bogota') as v_fin
      from barb b
      join islas i on i.bid = b.bid
      join dias d on i.dia_semana = extract(dow from d.dia)::integer
  ),
  -- Horas posibles: de paso en paso desde el inicio de la isla, mientras el servicio entre completo.
  candidatas as (
    select v.bid, v.orden, v.dia, g as c_ini, g + v.dur * interval '1 minute' as c_fin
      from ventanas v
     cross join lateral generate_series(
            v.v_ini, v.v_fin - v.dur * interval '1 minute', v_paso * interval '1 minute') g
  )
  select c.bid, c.c_ini, c.c_fin,
         (select count(*)::integer
            from public.citas k
           where k.barberia_id = p_barberia and k.barbero_id = c.bid
             and k.estado in ('confirmada', 'en_atencion', 'atendida')
             and k.id is distinct from p_ignorar_cita
             and public.fecha_bogota(k.inicio) = c.dia) as carga_dia,
         c.orden
    from candidatas c
   where c.c_ini >= p_ahora
     and (not p_publico or c.c_ini >= p_ahora + v_antic * interval '1 minute')
     and (not p_publico or c.dia <= v_hoy + v_dias)
     -- Contra otras citas: debe quedar el descanso entre ambas.
     and not exists (
           select 1 from public.citas k
            where k.barberia_id = p_barberia and k.barbero_id = c.bid
              and k.estado in ('confirmada', 'en_atencion', 'atendida')
              and k.id is distinct from p_ignorar_cita
              and c.c_ini < k.fin + v_colchon * interval '1 minute'
              and c.c_fin + v_colchon * interval '1 minute' > k.inicio)
     -- Contra bloqueos: se cruzan o no (sin descanso).
     and not exists (
           select 1 from public.bloqueos x
            where x.barberia_id = p_barberia and x.barbero_id = c.bid and x.activo
              and c.c_ini < x.fin and c.c_fin > x.inicio)
   order by c.c_ini, c.orden;
end $$;

-- "La primera disponible": para cada hora, UN barbero: el que ese día tiene menos citas; si empatan, el de menor orden.
create or replace function public.fn_huecos_cualquiera(
  p_barberia     uuid,
  p_servicio     uuid,
  p_desde        date default null,
  p_hasta        date default null,
  p_ahora        timestamptz default now(),
  p_publico      boolean default true,
  p_ignorar_cita uuid default null
)
returns table (barbero_id uuid, inicio timestamptz, fin timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (h.inicio) h.barbero_id, h.inicio, h.fin
    from public.fn_huecos(p_barberia, p_servicio, null, p_desde, p_hasta, p_ahora, p_publico, p_ignorar_cita) h
   order by h.inicio, h.carga_dia, h.orden_barbero
$$;

select public.fn_aplicar_permisos();
