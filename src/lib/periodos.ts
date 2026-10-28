/**
 * Periodos para mirar y liquidar comisiones: hoy, semana, quincena y mes. Trabajan con fechas de calendario
 * ('YYYY-MM-DD', día de Bogotá), sin horas ni zonas horarias. Un periodo siempre incluye `desde` y `hasta`.
 *
 *   hoy       el día
 *   semana    de lunes a domingo
 *   quincena  del 1 al 15, o del 16 al último día del mes
 *   mes       del 1 al último día del mes
 */
import { fechaCorta, sumarDias } from "@/lib/fechas";

export const PERIODOS = ["hoy", "semana", "quincena", "mes"] as const;
export type Periodo = (typeof PERIODOS)[number];

export const ETIQUETA_PERIODO: Record<Periodo, string> = {
  hoy: "Hoy",
  semana: "Semana",
  quincena: "Quincena",
  mes: "Mes",
};

export type Rango = { desde: string; hasta: string };

export function esPeriodo(valor: unknown): valor is Periodo {
  return typeof valor === "string" && (PERIODOS as readonly string[]).includes(valor);
}

/** ¿Es una fecha 'YYYY-MM-DD' que existe en el calendario? */
export function esFecha(valor: unknown): valor is string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [y, m, d] = valor.split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

const dos = (n: number) => String(n).padStart(2, "0");
const ultimoDia = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** El periodo que contiene la fecha `ref`. */
export function rangoDelPeriodo(periodo: Periodo, ref: string): Rango {
  const [y, m, d] = ref.split("-").map(Number);
  const mes = `${y}-${dos(m)}`;
  switch (periodo) {
    case "hoy":
      return { desde: ref, hasta: ref };
    case "semana": {
      const diaDeLaSemana = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = lunes
      const desde = sumarDias(ref, -diaDeLaSemana);
      return { desde, hasta: sumarDias(desde, 6) };
    }
    case "quincena":
      return d <= 15 ? { desde: `${mes}-01`, hasta: `${mes}-15` } : { desde: `${mes}-16`, hasta: `${mes}-${dos(ultimoDia(y, m))}` };
    case "mes":
      return { desde: `${mes}-01`, hasta: `${mes}-${dos(ultimoDia(y, m))}` };
  }
}

/** Una fecha dentro del periodo anterior (su último día). */
export function periodoAnterior(periodo: Periodo, ref: string): string {
  return sumarDias(rangoDelPeriodo(periodo, ref).desde, -1);
}

/** Una fecha dentro del periodo siguiente (su primer día). */
export function periodoSiguiente(periodo: Periodo, ref: string): string {
  return sumarDias(rangoDelPeriodo(periodo, ref).hasta, 1);
}

/** Hasta dónde se mira y se liquida: el final del periodo, sin pasar de hoy. */
export function hastaEfectivo(rango: Rango, hoy: string): string {
  return rango.hasta > hoy ? hoy : rango.hasta;
}

/** Cómo se llama el periodo en pantalla: «Esta semana», «Hoy», «Ayer»… y su rango de fechas. */
export function textoPeriodo(periodo: Periodo, ref: string, hoy: string): { titulo: string; detalle: string } {
  const rango = rangoDelPeriodo(periodo, ref);
  const esElActual = rango.desde <= hoy && hoy <= rango.hasta;
  if (periodo === "hoy") {
    const titulo = ref === hoy ? "Hoy" : ref === sumarDias(hoy, -1) ? "Ayer" : fechaCorta(ref);
    return { titulo, detalle: fechaCorta(ref) };
  }
  const detalle = `${fechaCorta(rango.desde)} – ${fechaCorta(rango.hasta)}`;
  const titulos: Record<Exclude<Periodo, "hoy">, [string, string]> = {
    semana: ["Esta semana", "Semana"],
    quincena: ["Esta quincena", "Quincena"],
    mes: ["Este mes", "Mes"],
  };
  return { titulo: titulos[periodo][esElActual ? 0 : 1], detalle };
}
