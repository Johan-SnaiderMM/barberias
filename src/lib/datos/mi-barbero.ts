import "server-only";
import { obtenerUsuario } from "@/lib/sesion";
import type { Barbero } from "@/lib/tipos/agenda";

/**
 * El barbero (activo) que es la persona de la sesión, o null si su cuenta no está vinculada con ninguno.
 * Sirve para armar "Mi día" y para fijar el barbero en los formularios de quien solo abre "mi agenda".
 * La base decide igual quién ve y toca qué (`mi_barbero()`); esto es para mostrar la pantalla correcta.
 */
export async function barberoPropio(barberos: Barbero[]): Promise<Barbero | null> {
  const usuario = await obtenerUsuario();
  if (!usuario) return null;
  return barberos.find((b) => b.user_id === usuario.id && b.activo) ?? null;
}
