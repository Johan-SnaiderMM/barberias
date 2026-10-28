-- =====================================================================
-- BARBERÍAS · 0026 · LAS CIFRAS DE INICIO (tarea 3.8 · PLAN Fase 3)
--
--   obtener_inicio()   lo que Inicio muestra del día: citas (con quiénes no llegaron), vendido, comisiones, gastos.
--
-- REGLAS
--   * Las cifras de dinero salen de `fn_resumen_dia` con el día en que hoy se registra (el mismo de la caja y del
--     cierre): por construcción son LAS MISMAS que las del cierre. Si hoy ya se cerró, esos números son los del
--     día siguiente y `cierre_hoy` dice cómo salió el cierre.
--   * Cada persona ve lo que su rol permite, y lo demás llega en null:
--       - citas: «agenda» las de todos; «mi_agenda» solo las suyas.
--       - vendido: «caja» o «cierre» ven todo el negocio; un barbero (mi_agenda) ve lo que él cobró.
--       - comisiones: «comisiones» las de todos; un barbero, las suyas (comisión + la propina que es suya).
--       - gastos: «gastos» o «cierre».   - cierre de hoy: «cierre».
-- =====================================================================

create or replace function public.obtener_inicio()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia  uuid := public.requerir_barberia();
  v_hoy       date := public.hoy_bogota();
  v_jornada   date := public.fn_jornada(v_barberia, now());
  v_ini       timestamptz := v_hoy::timestamp at time zone 'America/Bogota';
  v_mio       uuid := public.mi_barbero();
  v_barbero   boolean := public.tiene_area('mi_agenda') and v_mio is not null;
  v_todas     boolean := public.tiene_area('agenda');
  v_dinero    boolean := public.tiene_area('caja', 'cierre');
  v_comisiones boolean := public.tiene_area('comisiones');
  v_r         jsonb := public.fn_resumen_dia(v_barberia, v_jornada);
  v_propio    record;
  v_citas     jsonb;
  v_ventas    jsonb;
  v_comis     jsonb;
  v_gastos    jsonb;
  v_cierre    jsonb;
begin
  -- Lo que cobró el barbero (para quien solo ve lo suyo).
  if v_barbero then
    select count(*)::integer as cobros, coalesce(sum(k.total), 0)::integer as servicios,
           coalesce(sum(k.propina), 0)::integer as propinas, coalesce(sum(k.comision), 0)::integer as comisiones,
           coalesce(sum(k.propina_barbero), 0)::integer as propinas_barbero
      into v_propio
      from public.cobros k
     where k.barberia_id = v_barberia and k.barbero_id = v_mio and k.fecha = v_jornada and not k.anulado;
  end if;

  -- Citas de hoy (día calendario de Bogotá).
  if v_todas or v_barbero then
    select jsonb_build_object(
             'total', count(*) filter (where c.estado <> 'cancelada'),
             'atendidas', count(*) filter (where c.estado = 'atendida'),
             'por_atender', count(*) filter (where c.estado in ('confirmada', 'en_atencion')),
             'no_asistio', count(*) filter (where c.estado = 'no_asistio'),
             'canceladas', count(*) filter (where c.estado = 'cancelada'))
      into v_citas
      from public.citas c
     where c.barberia_id = v_barberia and c.inicio >= v_ini and c.inicio < v_ini + interval '1 day'
       and (v_todas or c.barbero_id = v_mio);
  end if;

  -- Vendido.
  if v_dinero then
    v_ventas := jsonb_build_object('propias', false, 'cobros', v_r -> 'cobros', 'servicios', v_r -> 'servicios', 'propinas', v_r -> 'propinas');
  elsif v_barbero then
    v_ventas := jsonb_build_object('propias', true, 'cobros', v_propio.cobros, 'servicios', v_propio.servicios, 'propinas', v_propio.propinas);
  end if;

  -- Comisiones.
  if v_comisiones then
    v_comis := jsonb_build_object('propias', false, 'comisiones', v_r -> 'comisiones', 'propinas_barbero', v_r -> 'propinas_barbero');
  elsif v_barbero then
    v_comis := jsonb_build_object('propias', true, 'comisiones', v_propio.comisiones, 'propinas_barbero', v_propio.propinas_barbero);
  end if;

  -- Gastos.
  if public.tiene_area('gastos', 'cierre') then
    v_gastos := jsonb_build_object(
      'gastos', v_r -> 'gastos',
      'total', (v_r ->> 'gastos_efectivo')::integer + (v_r ->> 'gastos_transferencia')::integer);
  end if;

  -- Cómo salió el cierre de hoy, si ya se hizo.
  if public.tiene_area('cierre') then
    select jsonb_build_object('id', c.id, 'efectivo_contado', c.efectivo_contado, 'diferencia', c.diferencia)
      into v_cierre
      from public.cierres c
     where c.barberia_id = v_barberia and c.fecha = v_hoy and not c.anulado;
  end if;

  return jsonb_build_object(
    'hoy', v_hoy, 'fecha', v_jornada,
    'citas', v_citas, 'ventas', v_ventas, 'comisiones', v_comis, 'gastos', v_gastos, 'cierre_hoy', v_cierre);
end $$;

select public.fn_aplicar_permisos();
