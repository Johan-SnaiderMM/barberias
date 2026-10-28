import "server-only";
import type { Barbero } from "@/lib/tipos/agenda";
import { consultar } from "./llamar";

/** Barberos de la barbería: activos primero, en el orden en que se crearon. */
export function listarBarberos(conArchivados = false): Promise<Barbero[]> {
  return consultar<Barbero[]>("listar_barberos", { p_con_archivados: conArchivados });
}
