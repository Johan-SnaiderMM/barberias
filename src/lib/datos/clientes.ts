import "server-only";
import type { ClienteBuscado, FichaCliente } from "@/lib/tipos/agenda";
import { consultar } from "./llamar";

/** Clientes por nombre o celular (sin texto: los más recientes). Hasta 50. */
export function listarClientes(texto?: string): Promise<ClienteBuscado[]> {
  return consultar<ClienteBuscado[]>("buscar_clientes", { p_texto: texto?.trim() || null, p_limite: 50 });
}

/** La ficha de un cliente, o null si no existe (o es de otra barbería). */
export function obtenerFichaCliente(id: string): Promise<FichaCliente | null> {
  return consultar<FichaCliente | null>("obtener_cliente", { p_id: id });
}
