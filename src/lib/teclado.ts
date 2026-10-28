/**
 * Teclado numérico propio para montos: lógica pura. Se usa en lugar del teclado del sistema para que no tape el
 * botón de cobrar y para que cada toque responda al instante (sin zoom involuntario).
 */
import { type Pesos } from "@/lib/dinero";

export type Tecla = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "00" | "borrar";

/** Tope: 8 dígitos (99.999.999), igual que leerPesos. */
export const MAX_PESOS: Pesos = 99_999_999;

export const FILAS_TECLADO: Tecla[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["00", "0", "borrar"],
];

/** Aplica una tecla al monto actual: agrega dígitos a la derecha, "00" multiplica por 100, borrar quita el último. */
export function aplicarTecla(valor: Pesos, tecla: Tecla): Pesos {
  if (tecla === "borrar") return Math.floor(valor / 10);
  const siguiente = tecla === "00" ? valor * 100 : valor * 10 + Number(tecla);
  return siguiente > MAX_PESOS ? valor : siguiente;
}

/** Aplica varias teclas seguidas (para las pruebas y para escribir un monto de una vez). */
export function escribirMonto(teclas: Tecla[], inicial: Pesos = 0): Pesos {
  return teclas.reduce((valor, tecla) => aplicarTecla(valor, tecla), inicial);
}
