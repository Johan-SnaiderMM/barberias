/**
 * Listas que pueden crecer: ninguna sale entera de una vez. Las del día (agenda, «Por cobrar») llevan un buscador desde
 * unas cuantas filas; las historias dejan a la vista las primeras y pliegan el resto. Módulo puro: lo usan componentes
 * `"use client"`.
 */
import { textoPlano } from "@/lib/texto";

/** Desde cuántas filas aparece el buscador de una lista del día (con menos, se ven todas de un vistazo). */
export const MIN_PARA_BUSCAR = 6;

/** Cuántas filas de una historia se ven sin desplegar. */
export const HISTORIA_VISIBLE = 5;

/**
 * Parte una lista en lo que se ve y lo que va plegado. No se pliega UNA sola fila (el botón ocuparía lo mismo que ella),
 * así que con `visibles + 1` filas o menos no se pliega nada.
 */
export function partirLista<T>(filas: T[], visibles = HISTORIA_VISIBLE): { visibles: T[]; plegadas: T[] } {
  if (filas.length <= visibles + 1) return { visibles: filas, plegadas: [] };
  return { visibles: filas.slice(0, visibles), plegadas: filas.slice(visibles) };
}

/**
 * Las citas que coinciden con lo escrito: el cliente, el servicio o el barbero, sin tildes ni mayúsculas; o el celular
 * (con 3 dígitos o más, sin importar espacios ni guiones). Vacío = todas.
 */
export function filtrarCitas<T extends { cliente: string | null; servicio: string; barbero: string; telefono?: string | null }>(
  citas: T[],
  busqueda: string
): T[] {
  const q = textoPlano(busqueda.trim());
  if (!q) return citas;
  const digitos = q.replace(/\D/g, "");
  return citas.filter(
    (c) =>
      textoPlano(`${c.cliente ?? ""} ${c.servicio} ${c.barbero}`).includes(q) ||
      (digitos.length >= 3 && (c.telefono ?? "").replace(/\D/g, "").includes(digitos))
  );
}
