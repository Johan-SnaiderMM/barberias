-- =====================================================================
-- BARBERÍAS · 0016 · ANTI-ABUSO DE LA RESERVA PÚBLICA (tarea 2.2 · SPEC F5)
--
-- El enlace de reservas lo puede abrir cualquiera: los topes viven en la base, no en la pantalla.
--   * Campo trampa: ya lo revisa fn_publico_reservar (0015): quien lo llena es un robot.
--   * Por celular: máximo 3 citas confirmadas por venir (de la misma barbería). Cancelar una libera el cupo.
--   * Por barbería: máximo 10 reservas en línea por minuto (cuenta las creadas en el último minuto REAL).
-- Los topes se miden sobre las mismas citas: no hay una tabla de intentos aparte. Un robot puede ocupar 10 horas
-- por minuto como mucho, y el personal las cancela con motivo; el tope por celular lo frena apenas repite el número.
--
-- Devuelve el motivo del rechazo ('tope_celular' | 'tope_minuto') o null si pasa. Es el que llama fn_publico_reservar.
-- =====================================================================

create or replace function public.fn_publico_topes(p_barberia uuid, p_telefono text, p_ahora timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_max_celular constant integer := 3;
  v_max_minuto  constant integer := 10;
  v_n           integer;
begin
  select count(*)::integer into v_n
    from public.citas c
    join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
   where c.barberia_id = p_barberia and cl.telefono = p_telefono
     and c.estado = 'confirmada' and c.inicio >= p_ahora;
  if v_n >= v_max_celular then
    return 'tope_celular';
  end if;

  select count(*)::integer into v_n
    from public.citas c
   where c.barberia_id = p_barberia and c.origen = 'cliente'
     and c.created_at > now() - interval '1 minute';
  if v_n >= v_max_minuto then
    return 'tope_minuto';
  end if;

  return null;
end $$;

select public.fn_aplicar_permisos();
