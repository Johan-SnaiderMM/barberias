import "server-only";
import type { Bloqueo } from "@/lib/tipos/agenda";
import { consultar } from "./llamar";

/** Bloqueos que todavía no terminan, en orden de fecha. Sin `barberoId`, los de toda la barbería. */
export function listarBloqueos(barberoId?: string): Promise<Bloqueo[]> {
  return consultar<Bloqueo[]>("listar_bloqueos", { p_barbero: barberoId ?? null });
}
