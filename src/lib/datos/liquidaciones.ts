import "server-only";
import type { ComisionesDeBarbero, LiquidacionDetalle, ResumenComisiones } from "@/lib/tipos/liquidaciones";
import { consultar } from "./llamar";

/** Por barbero: lo generado entre dos días ('YYYY-MM-DD') y lo que falta por pagarle hasta `hasta`. */
export function obtenerResumenComisiones(desde: string, hasta: string): Promise<ResumenComisiones> {
  return consultar<ResumenComisiones>("obtener_resumen_comisiones", { p_desde: desde, p_hasta: hasta });
}

/** Lo que se le debe a un barbero hasta un día, con sus cobros pendientes y sus últimas liquidaciones. */
export function obtenerComisionesDeBarbero(barbero: string, hasta: string): Promise<ComisionesDeBarbero> {
  return consultar<ComisionesDeBarbero>("obtener_comisiones_de_barbero", { p_barbero: barbero, p_hasta: hasta });
}

/** Una liquidación con los cobros que pagó, o null si no existe o quien pregunta no la puede ver. */
export function obtenerLiquidacion(id: string): Promise<LiquidacionDetalle | null> {
  return consultar<LiquidacionDetalle | null>("obtener_liquidacion", { p_id: id });
}
