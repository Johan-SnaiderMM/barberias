-- =====================================================================
-- BARBERÍAS · 0020 · LECTURAS DE LA CAJA (tarea 3.2 · SPEC F6)
--
--   obtener_caja(fecha)   lo de un día en la caja: las citas por cobrar, los cobros hechos y cuánto entró por medio.
--   datos_cobro(cita)     lo que necesita la pantalla de Cobrar: la cita (si hay), su cobro vigente (si ya se cobró),
--                         los barberos con el precio que cobra cada uno y el catálogo de servicios.
--
-- Se leen con los permisos de quien llama (RLS): "caja" ve todo; el barbero (mi_agenda), solo lo suyo.
-- =====================================================================

create or replace function public.obtener_caja(p_fecha date default null)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_fecha date := coalesce(p_fecha, public.hoy_bogota());
  v_ini   timestamptz := v_fecha::timestamp at time zone 'America/Bogota';
begin
  return jsonb_build_object(
    'fecha', v_fecha,

    -- Citas del día que se pueden cobrar y todavía no tienen cobro vigente.
    'por_cobrar', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'inicio', c.inicio, 'fin', c.fin, 'estado', c.estado, 'precio', c.precio,
               'cliente', cl.nombre, 'servicio', s.nombre, 'barbero', b.nombre) order by c.inicio, c.id)
        from public.citas c
        join public.barberos b  on b.barberia_id = c.barberia_id and b.id = c.barbero_id
        join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
        join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
       where c.inicio >= v_ini and c.inicio < v_ini + interval '1 day'
         and c.estado in ('confirmada', 'en_atencion', 'atendida')
         and not exists (select 1 from public.cobros k
                          where k.barberia_id = c.barberia_id and k.cita_id = c.id and not k.anulado)
    ), '[]'::jsonb),

    -- Atendidas (o en atención) de los últimos días que se quedaron sin cobrar: plata que no se debe olvidar.
    'atrasadas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'inicio', c.inicio, 'fin', c.fin, 'estado', c.estado, 'precio', c.precio,
               'cliente', cl.nombre, 'servicio', s.nombre, 'barbero', b.nombre) order by c.inicio, c.id)
        from public.citas c
        join public.barberos b  on b.barberia_id = c.barberia_id and b.id = c.barbero_id
        join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
        join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
       where c.inicio < v_ini and c.inicio >= v_ini - interval '14 days'
         and c.estado in ('en_atencion', 'atendida')
         and not exists (select 1 from public.cobros k
                          where k.barberia_id = c.barberia_id and k.cita_id = c.id and not k.anulado)
    ), '[]'::jsonb),

    -- Los cobros del día (también los anulados, marcados), el más reciente primero.
    'cobros', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'created_at', k.created_at, 'cita_id', k.cita_id,
               'barbero', b.nombre, 'cliente', cl.nombre,
               'total', k.total, 'propina', k.propina, 'anulado', k.anulado, 'anulado_motivo', k.anulado_motivo,
               'medios', coalesce((select jsonb_agg(distinct p.medio)
                                     from public.cobro_pagos p where p.barberia_id = k.barberia_id and p.cobro_id = k.id), '[]'::jsonb))
             order by k.created_at desc, k.id)
        from public.cobros k
        join public.barberos b on b.barberia_id = k.barberia_id and b.id = k.barbero_id
        left join public.clientes cl on cl.barberia_id = k.barberia_id and cl.id = k.cliente_id
       where k.fecha = v_fecha
    ), '[]'::jsonb),

    -- Cuánto entró ese día (sin contar los anulados): lo cobrado por servicios, las propinas y por qué medio.
    'totales', jsonb_build_object(
      'cobros', (select count(*) from public.cobros k where k.fecha = v_fecha and not k.anulado),
      'servicios', (select coalesce(sum(k.total), 0) from public.cobros k where k.fecha = v_fecha and not k.anulado),
      'propinas', (select coalesce(sum(k.propina), 0) from public.cobros k where k.fecha = v_fecha and not k.anulado),
      'efectivo', (select coalesce(sum(p.monto), 0)
                     from public.cobro_pagos p join public.cobros k on k.barberia_id = p.barberia_id and k.id = p.cobro_id
                    where k.fecha = v_fecha and not k.anulado and p.medio = 'efectivo'),
      'transferencia', (select coalesce(sum(p.monto), 0)
                          from public.cobro_pagos p join public.cobros k on k.barberia_id = p.barberia_id and k.id = p.cobro_id
                         where k.fecha = v_fecha and not k.anulado and p.medio = 'transferencia')
    )
  );
end $$;

-- Todo lo de la pantalla de Cobrar. Sin p_cita es una venta sin cita (solo barberos y catálogo).
create or replace function public.datos_cobro(p_cita uuid default null)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cita', (select jsonb_build_object(
                      'id', c.id, 'inicio', c.inicio, 'fin', c.fin, 'estado', c.estado, 'precio', c.precio,
                      'servicio_id', c.servicio_id, 'servicio', s.nombre,
                      'cliente_id', c.cliente_id, 'cliente', cl.nombre, 'telefono', cl.telefono,
                      'barbero_id', c.barbero_id, 'barbero', b.nombre)
               from public.citas c
               join public.barberos b  on b.barberia_id = c.barberia_id and b.id = c.barbero_id
               join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
               join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
              where c.id = p_cita),
    -- El cobro vigente de esa cita (null si todavía no se cobra).
    'cobro_id', (select k.id from public.cobros k where k.cita_id = p_cita and not k.anulado),
    -- Barberos activos con el precio que cobra cada uno por cada servicio activo.
    'barberos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'nombre', b.nombre,
               'precios', coalesce((
                  select jsonb_object_agg(s.id::text, coalesce(bs.precio_propio, s.precio))
                    from public.servicios s
                    left join public.barbero_servicios bs
                           on bs.barberia_id = s.barberia_id and bs.barbero_id = b.id and bs.servicio_id = s.id
                   where s.barberia_id = b.barberia_id and s.activo), '{}'::jsonb))
             order by b.orden, b.nombre)
        from public.barberos b where b.activo), '[]'::jsonb),
    'servicios', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio) order by s.orden, s.nombre)
        from public.servicios s where s.activo), '[]'::jsonb)
  )
$$;

select public.fn_aplicar_permisos();
