import { fechaBogota, fechaCorta, minutosDelDiaBogota, sumarDias } from "@/lib/fechas";
import { minutosATexto } from "@/lib/horarios";

/**
 * Texto corto de un bloqueo a partir de sus instantes (ISO), en hora de Bogotá:
 *   "lun 2 nov · todo el día"  ·  "lun 2 nov al mié 4 nov · todo el día"  ·  "lun 2 nov · 2:00 p. m. a 4:00 p. m.".
 * Un bloqueo que empieza a las 00:00 y termina a las 00:00 de un día posterior es de días completos.
 */
export function describirBloqueo(inicio: string, fin: string): string {
  const diaInicio = fechaBogota(inicio);
  const diaFin = fechaBogota(fin);
  const desde = minutosDelDiaBogota(inicio);
  const hasta = minutosDelDiaBogota(fin);

  if (desde === 0 && hasta === 0 && diaFin > diaInicio) {
    const ultimo = sumarDias(diaFin, -1);
    return ultimo === diaInicio
      ? `${fechaCorta(diaInicio)} · todo el día`
      : `${fechaCorta(diaInicio)} al ${fechaCorta(ultimo)} · todo el día`;
  }
  if (diaInicio === diaFin) return `${fechaCorta(diaInicio)} · ${minutosATexto(desde)} a ${minutosATexto(hasta)}`;
  return `${fechaCorta(diaInicio)} ${minutosATexto(desde)} → ${fechaCorta(diaFin)} ${minutosATexto(hasta)}`;
}
