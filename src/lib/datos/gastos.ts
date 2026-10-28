import "server-only";
import type { GastoDetalle, GastosDelDia } from "@/lib/tipos/gastos";
import { consultar } from "./llamar";

/** Los gastos de un día ('YYYY-MM-DD'; sin fecha, el día en que hoy se está registrando) con sus totales. */
export function obtenerGastos(fecha?: string): Promise<GastosDelDia> {
  return consultar<GastosDelDia>("obtener_gastos", { p_fecha: fecha ?? null });
}

/** Un gasto con la ruta de su foto, o null si no existe o es de otra barbería. */
export function obtenerGasto(id: string): Promise<GastoDetalle | null> {
  return consultar<GastoDetalle | null>("obtener_gasto", { p_id: id });
}
