/**
 * Horario semanal de un barbero: franjas por día, con las horas como MINUTOS desde la medianoche (hora de Bogotá).
 * Es el mismo modelo que `horarios_barbero` (migración 0007) y las mismas reglas que `guardar_horario_barbero`;
 * aquí sirven para mostrar y para dar respuesta inmediata en el formulario. La base es la que decide.
 * Módulo puro: lo usan componentes `"use client"`.
 */

/** Un tramo de trabajo. `dia`: 0 = domingo … 6 = sábado. `desde` y `hasta` en minutos (0 a 1440). */
export type FranjaHorario = { dia: number; desde: number; hasta: number };

/** Días en el orden en que se muestran (la semana empieza el lunes). */
export const DIAS_SEMANA = [
  { dia: 1, nombre: "Lunes", corto: "Lun" },
  { dia: 2, nombre: "Martes", corto: "Mar" },
  { dia: 3, nombre: "Miércoles", corto: "Mié" },
  { dia: 4, nombre: "Jueves", corto: "Jue" },
  { dia: 5, nombre: "Viernes", corto: "Vie" },
  { dia: 6, nombre: "Sábado", corto: "Sáb" },
  { dia: 0, nombre: "Domingo", corto: "Dom" },
] as const;

export const MINUTOS_DIA = 1440;
export const MAX_FRANJAS_POR_DIA = 4;

const NOMBRE_EN_MINUSCULA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** 540 -> "9:00 a. m."; 810 -> "1:30 p. m."; 0 y 1440 -> "12:00 a. m.". */
export function minutosATexto(minutos: number): string {
  const h24 = Math.floor(minutos / 60) % 24;
  const m = minutos % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "a. m." : "p. m."}`;
}

/** 540 -> "09:00" (el valor de un `<input type="time">`). 1440 -> "00:00". */
export function minutosAHora24(minutos: number): string {
  const h = Math.floor(minutos / 60) % 24;
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * "09:00" -> 540. null si no es una hora válida. Con `esFin`, "00:00" significa la medianoche del final del día (1440):
 * así una franja "de 6:00 p. m. a 12:00 a. m." se entiende como hasta la medianoche.
 */
export function hora24AMinutos(texto: string, esFin = false): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(texto.trim());
  if (!m) return null;
  const minutos = Number(m[1]) * 60 + Number(m[2]);
  return esFin && minutos === 0 ? MINUTOS_DIA : minutos;
}

/** "9:00 a. m. – 1:00 p. m." */
export function textoFranja(f: Pick<FranjaHorario, "desde" | "hasta">): string {
  return `${minutosATexto(f.desde)} – ${minutosATexto(f.hasta)}`;
}

/** Franjas de un día, ordenadas por hora de inicio. */
export function franjasDelDia(franjas: readonly FranjaHorario[], dia: number): FranjaHorario[] {
  return franjas.filter((f) => f.dia === dia).sort((a, b) => a.desde - b.desde);
}

/** "9:00 a. m. – 1:00 p. m. · 2:30 p. m. – 7:00 p. m." o "No trabaja". */
export function resumenDia(franjas: readonly FranjaHorario[], dia: number): string {
  const delDia = franjasDelDia(franjas, dia);
  return delDia.length === 0 ? "No trabaja" : delDia.map(textoFranja).join(" · ");
}

/** Cuántos días distintos de la semana trabaja. */
export function diasQueTrabaja(franjas: readonly FranjaHorario[]): number {
  return new Set(franjas.map((f) => f.dia)).size;
}

/**
 * Revisa un horario con las mismas reglas que `guardar_horario_barbero`. Devuelve el mensaje del primer problema
 * (en español, listo para mostrar) o null si está bien. Franjas pegadas (13:00 y 13:00) son válidas.
 */
export function validarFranjas(franjas: readonly FranjaHorario[]): string | null {
  for (const f of franjas) {
    if (![f.dia, f.desde, f.hasta].every(Number.isInteger)) return "El horario no es válido.";
    if (f.dia < 0 || f.dia > 6) return "El día de la semana no es válido.";
    if (f.desde < 0 || f.desde > 1439 || f.hasta < 1 || f.hasta > MINUTOS_DIA) {
      return "Las horas deben estar entre las 12:00 a. m. y las 12:00 a. m. del día siguiente.";
    }
    if (f.hasta <= f.desde) return `La franja del ${NOMBRE_EN_MINUSCULA[f.dia]} termina antes de empezar.`;
  }
  for (const { dia } of DIAS_SEMANA) {
    const delDia = franjasDelDia(franjas, dia);
    if (delDia.length > MAX_FRANJAS_POR_DIA) return `Un día no puede tener más de ${MAX_FRANJAS_POR_DIA} franjas.`;
    for (let i = 1; i < delDia.length; i++) {
      if (delDia[i].desde < delDia[i - 1].hasta) return `Las franjas del ${NOMBRE_EN_MINUSCULA[dia]} se cruzan.`;
    }
  }
  return null;
}
