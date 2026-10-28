import "server-only";
import type { CitaDia } from "@/lib/tipos/agenda";
import { consultar } from "./llamar";

/**
 * Citas de un rango de días de Bogotá ('YYYY-MM-DD'; por defecto hoy), en orden de hora. Quien solo abre
 * "mi agenda" recibe únicamente las suyas: lo decide la base.
 */
export function listarCitas(
  opciones: { desde?: string; hasta?: string; barbero?: string; conCanceladas?: boolean } = {}
): Promise<CitaDia[]> {
  return consultar<CitaDia[]>("listar_citas", {
    p_desde: opciones.desde ?? null,
    p_hasta: opciones.hasta ?? null,
    p_barbero: opciones.barbero ?? null,
    p_con_canceladas: opciones.conCanceladas ?? false,
  });
}

/** Una cita por id, o null si no existe o quien pregunta no la puede ver. */
export function obtenerCita(id: string): Promise<CitaDia | null> {
  return consultar<CitaDia | null>("obtener_cita", { p_id: id });
}
