import "server-only";
import type { DiaDeCierre } from "@/lib/tipos/cierre";
import { consultar } from "./llamar";

/** Un día para la pantalla de cierre ('YYYY-MM-DD'; sin fecha, el día en que hoy se registra). */
export function obtenerCierre(fecha?: string): Promise<DiaDeCierre> {
  return consultar<DiaDeCierre>("obtener_cierre", { p_fecha: fecha ?? null });
}

/** El día en que hoy se registra: el de la fecha de Bogotá, o el siguiente si ese ya se cerró. */
export function obtenerJornada(): Promise<string> {
  return consultar<string>("jornada_actual");
}
