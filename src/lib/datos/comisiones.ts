import "server-only";
import type { ComisionesConfig } from "@/lib/tipos/comisiones";
import { consultar } from "./llamar";

/** Los porcentajes de cada barbero, sus excepciones por servicio y el ajuste de la propina (área «comisiones»). */
export function obtenerComisionesConfig(): Promise<ComisionesConfig> {
  return consultar<ComisionesConfig>("obtener_comisiones_config");
}
