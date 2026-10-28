import "server-only";
import type { Servicio } from "@/lib/tipos/agenda";
import { consultar } from "./llamar";

/** Servicios de la barbería: activos primero, en el orden en que se crearon. */
export function listarServicios(conArchivados = false): Promise<Servicio[]> {
  return consultar<Servicio[]>("listar_servicios", { p_con_archivados: conArchivados });
}
