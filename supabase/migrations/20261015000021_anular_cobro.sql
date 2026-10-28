-- =====================================================================
-- BARBERÍAS · 0021 · ANULAR UN COBRO (tarea 3.3 · SPEC F6)
--
--   anular_cobro(cobro, motivo)   anula un cobro con motivo y reabre su cita para corregirla.
--
-- REGLAS
--   * Un cobro no se edita ni se borra: se anula con motivo (obligatorio). Quedan sus líneas, sus pagos, quién lo
--     anuló y cuándo. Un cobro anulado ya no cuenta en la caja ni en las comisiones.
--   * Anular un cobro de cita la reabre: `atendida` -> `en_atencion`, para volver a cobrarla bien (con otra clave).
--   * No quedan huérfanos: una cita con un cobro VIGENTE no sale de `atendida` (ni por la API ni escribiendo directo).
--     Para reabrirla hay que anular el cobro; al anularlo, la cita se reabre sola.
--   * Repetir la clave de un cobro que ya se anuló NO devuelve ese cobro como si estuviera hecho: avisa que se anuló.
--   * Permiso: área "caja" (la misma que cobra).
--   * Más adelante se le suman dos frenos: un cobro liquidado al barbero (3.5) y un día ya cerrado (3.7) no se anulan
--     sin deshacer antes la liquidación o el cierre.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Repetir la clave de un cobro anulado
-- ---------------------------------------------------------------------
-- Antes devolvía siempre el cobro; si alguien lo anuló y la pantalla vieja vuelve a mandar la misma clave, el
-- "Este cobro ya estaba hecho" sería mentira (la cita quedó sin cobrar). Ahora lo dice.
create or replace function public.fn_resultado_cobro(p_barberia uuid, p_id uuid, p_ya boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_res jsonb;
begin
  select jsonb_build_object(
           'ok', true, 'ya_existia', p_ya, 'id', c.id, 'cita_id', c.cita_id,
           'subtotal', c.subtotal, 'descuento', c.descuento, 'total', c.total, 'propina', c.propina,
           'cobrado', c.total + c.propina,
           'vuelto', coalesce((select sum(p.vuelto) from public.cobro_pagos p where p.barberia_id = c.barberia_id and p.cobro_id = c.id), 0),
           'comision', c.comision, 'fecha', c.fecha, 'anulado', c.anulado)
    into v_res
    from public.cobros c
   where c.barberia_id = p_barberia and c.id = p_id;

  if p_ya and coalesce((v_res ->> 'anulado')::boolean, false) then
    raise exception 'Ese cobro ya se anuló. Abre Cobrar de nuevo para cobrar otra vez.';
  end if;
  return v_res;
end $$;

-- ---------------------------------------------------------------------
-- 2. Una cita cobrada se queda atendida
-- ---------------------------------------------------------------------
create or replace function public.fn_cita_cobrada_se_queda()
returns trigger
language plpgsql
security definer      -- ve todos los cobros, sin importar los permisos de quien cambia la cita
set search_path = public, pg_temp
as $$
begin
  if old.estado = 'atendida' and new.estado <> 'atendida'
     and exists (select 1 from public.cobros k
                  where k.barberia_id = old.barberia_id and k.cita_id = old.id and not k.anulado) then
    raise exception 'Esta cita ya está cobrada. Para reabrirla, anula el cobro (se reabre sola).';
  end if;
  return new;
end $$;

drop trigger if exists trg_cita_cobrada_se_queda on public.citas;
create trigger trg_cita_cobrada_se_queda before update of estado on public.citas
  for each row execute function public.fn_cita_cobrada_se_queda();

-- ---------------------------------------------------------------------
-- 3. Anular
-- ---------------------------------------------------------------------
create or replace function public.anular_cobro(p_cobro uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('caja');
  v_motivo   text := public.fn_motivo(p_motivo);
  v_cita      uuid;
  v_anulado   boolean;
  v_reabierta boolean := false;
begin
  -- Mismo orden de bloqueo que al cobrar (primero la cita, después el cobro), para que no se crucen.
  select k.cita_id into v_cita from public.cobros k where k.barberia_id = v_barberia and k.id = p_cobro;
  if not found then
    raise exception 'No existe ese cobro.' using errcode = 'P0002';
  end if;
  if v_cita is not null then
    perform 1 from public.citas c where c.barberia_id = v_barberia and c.id = v_cita for update;
  end if;

  select k.anulado into v_anulado from public.cobros k where k.barberia_id = v_barberia and k.id = p_cobro for update;
  if v_anulado then
    raise exception 'Este cobro ya está anulado.';
  end if;

  update public.cobros
     set anulado = true, anulado_motivo = v_motivo, anulado_por = auth.uid(), anulado_at = now()
   where barberia_id = v_barberia and id = p_cobro;

  -- Reabrir la cita para corregirla (primero se anula el cobro: mientras estaba vigente, la cita no podía salir de atendida).
  if v_cita is not null then
    update public.citas set estado = 'en_atencion'
     where barberia_id = v_barberia and id = v_cita and estado = 'atendida';
    v_reabierta := found;
  end if;

  return jsonb_build_object('ok', true, 'id', p_cobro, 'cita_id', v_cita, 'cita_reabierta', v_reabierta);
end $$;

select public.fn_aplicar_permisos();
