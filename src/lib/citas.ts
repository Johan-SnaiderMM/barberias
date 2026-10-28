/**
 * Estados de una cita y qué cambios permite cada uno. Es el MISMO mapa que `cambiar_estado_cita` en SQL
 * (migración 0010); una prueba lo compara contra la base. Sirve para mostrar solo los botones que valen.
 * Módulo puro: lo usan componentes `"use client"`.
 */

export const ESTADOS_CITA = ["confirmada", "en_atencion", "atendida", "cancelada", "no_asistio"] as const;
export type EstadoCita = (typeof ESTADOS_CITA)[number];

export const ETIQUETA_ESTADO: Record<EstadoCita, string> = {
  confirmada: "Confirmada",
  en_atencion: "En atención",
  atendida: "Atendida",
  cancelada: "Cancelada",
  no_asistio: "No asistió",
};

/** Estados que ocupan la hora del barbero (los que cuenta la restricción de la base y `fn_huecos`). */
export const OCUPAN_LA_HORA: readonly EstadoCita[] = ["confirmada", "en_atencion", "atendida"];

/**
 * A qué estados se puede pasar desde cada uno con `cambiar_estado_cita`. Cancelar NO está aquí: tiene su propia
 * función (`cancelar_cita`) porque pide motivo.
 */
export const TRANSICIONES: Record<EstadoCita, readonly EstadoCita[]> = {
  confirmada: ["en_atencion", "no_asistio"],
  en_atencion: ["atendida", "confirmada"],
  atendida: ["en_atencion"],
  no_asistio: ["confirmada"],
  cancelada: ["confirmada"],
};

export function puedeCambiar(de: EstadoCita, a: EstadoCita): boolean {
  return TRANSICIONES[de].includes(a);
}

/** Solo una cita confirmada se mueve de hora o se cancela. */
export function puedeMoverOCancelar(estado: EstadoCita): boolean {
  return estado === "confirmada";
}

export function esEstadoCita(valor: unknown): valor is EstadoCita {
  return typeof valor === "string" && (ESTADOS_CITA as readonly string[]).includes(valor);
}

/**
 * ¿La cita quedó "por cerrar"? Confirmada y ya terminó su hora: nadie dijo si se atendió o no llegó. La agenda la
 * destaca para que el personal la resuelva antes de cerrar el día.
 */
export function porCerrar(cita: { estado: string; fin: string }, ahoraMs: number): boolean {
  return cita.estado === "confirmada" && new Date(cita.fin).getTime() <= ahoraMs;
}

/** Confirmada y su hora ya empezó (pero no terminó): debería estar en atención. */
export function deberiaEstarEnAtencion(cita: { estado: string; inicio: string; fin: string }, ahoraMs: number): boolean {
  return (
    cita.estado === "confirmada" &&
    new Date(cita.inicio).getTime() <= ahoraMs &&
    new Date(cita.fin).getTime() > ahoraMs
  );
}
