/**
 * Datos comunes de los textos legales (tarea 4.3): el aviso de privacidad (`/aviso-de-privacidad`), la política de
 * tratamiento de datos (`/privacidad`) y la cláusula de encargo (docs/legal/encargo-de-datos.md). Son BORRADORES: un
 * abogado los revisa antes de salir a un piloto con clientes reales. Cliente y servidor pueden importar este archivo.
 */

export const VERSION_LEGAL = {
  /** Número de la versión: sube cuando cambia el texto de cualquiera de los tres (aviso, política o cláusula). */
  version: "1",
  fecha: "17 de octubre de 2026",
} as const;

/** Plazos de la Ley 1581 de 2012 (arts. 14 y 15), en días hábiles. */
export const PLAZOS_LEGALES = {
  consulta: 10,
  consultaProrroga: 5,
  reclamo: 15,
  reclamoProrroga: 8,
} as const;

/** Un nombre corto de barbería en una dirección (`?b=la-fina`): solo letras, números y guiones, como el slug. */
export function slugDeLaDireccion(valor: unknown): string | null {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return typeof v === "string" && v.length >= 3 && v.length <= 40 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) ? v : null;
}

/** Los dos textos que se leen antes de reservar, con la barbería a la que corresponden (si se conoce). */
export function enlacesLegales(slug: string | null): { aviso: string; politica: string } {
  const b = slug ? `?b=${slug}` : "";
  return { aviso: `/aviso-de-privacidad${b}`, politica: `/privacidad${b}` };
}
