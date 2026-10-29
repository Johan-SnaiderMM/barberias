/** Utilidades de texto para buscar. Módulo puro: lo usan componentes `"use client"`. */

/** Sin tildes ni mayúsculas, para que «jose» encuentre «José» y «barba» encuentre «Corte y Barba». */
export function textoPlano(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
