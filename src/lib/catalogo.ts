/**
 * Límites y textos del catálogo de servicios. Son los MISMOS que los `check` de la migración 0005
 * (`servicios`): si cambian allá, cambian aquí. Módulo puro: lo usan formularios de cliente y esquemas Zod.
 */

export const PRECIO_MAX = 10_000_000;
export const DURACION_MIN = 5;
export const DURACION_MAX = 480;
/** La duración va de 5 en 5 minutos. */
export const DURACION_PASO = 5;
/** Opciones del selector de duración: de 5 min a 4 h (lo normal en una barbería). */
export const DURACIONES: readonly number[] = Array.from({ length: 48 }, (_, i) => (i + 1) * DURACION_PASO);

/** 30 -> "30 min"; 60 -> "1 h"; 90 -> "1 h 30 min"; 135 -> "2 h 15 min". */
export function textoDuracion(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
