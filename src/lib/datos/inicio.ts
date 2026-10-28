import "server-only";
import type { InicioDelDia } from "@/lib/tipos/inicio";
import { consultar } from "./llamar";

/** Las cifras del día para Inicio: citas, vendido, comisiones y gastos (cada rol ve las suyas). */
export function obtenerInicio(): Promise<InicioDelDia> {
  return consultar<InicioDelDia>("obtener_inicio");
}
