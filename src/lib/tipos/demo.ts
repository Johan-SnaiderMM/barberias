/**
 * Lo que devuelve `reiniciar_demo(pin)` (migración 0027). Solo tipos y textos: lo pueden importar componentes `"use client"`.
 *   { ok: true }                                          listo, datos de ejemplo recargados
 *   { ok: false, motivo: "pin", intentos_restantes }      el PIN no coincide
 *   { ok: false, motivo: "bloqueado", minutos }           demasiados intentos
 */
export type RespuestaReinicio =
  | { ok: true }
  | { ok: false; motivo: "pin"; intentos_restantes: number }
  | { ok: false; motivo: "bloqueado"; minutos: number };

/** El mensaje para quien se equivocó con el PIN. */
export function textoPinRechazado(r: Extract<RespuestaReinicio, { ok: false }>): string {
  if (r.motivo === "bloqueado") {
    return r.minutos === 1 ? "Demasiados intentos. Espera 1 minuto." : `Demasiados intentos. Espera ${r.minutos} minutos.`;
  }
  return r.intentos_restantes === 1 ? "El PIN no es correcto. Te queda 1 intento." : `El PIN no es correcto. Te quedan ${r.intentos_restantes} intentos.`;
}
