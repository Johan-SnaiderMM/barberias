import "server-only";
import type { CajaDelDia, CobroDetalle, DatosCobro } from "@/lib/tipos/caja";
import { consultar } from "./llamar";

/** La caja de un día de Bogotá ('YYYY-MM-DD'; por defecto hoy): por cobrar, cobros hechos y totales. */
export function obtenerCaja(fecha?: string): Promise<CajaDelDia> {
  return consultar<CajaDelDia>("obtener_caja", { p_fecha: fecha ?? null });
}

/** Lo que necesita la pantalla de Cobrar. Sin cita es una venta sin cita (solo barberos y catálogo). */
export function datosCobro(cita?: string): Promise<DatosCobro> {
  return consultar<DatosCobro>("datos_cobro", { p_cita: cita ?? null });
}

/** Un cobro con sus líneas y sus pagos, o null si no existe o quien pregunta no lo puede ver. */
export function obtenerCobro(id: string): Promise<CobroDetalle | null> {
  return consultar<CobroDetalle | null>("obtener_cobro", { p_id: id });
}
