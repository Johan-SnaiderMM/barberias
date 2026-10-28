/**
 * Opciones de los ajustes de la agenda (columnas de `barberias`, migración 0007). Los límites son los mismos que
 * los `check` de la base. Módulo puro: lo usan formularios de cliente y esquemas Zod.
 */
import { textoDuracion } from "@/lib/catalogo";

export type AjustesAgenda = {
  paso_min: number;
  dias_adelante: number;
  anticipacion_min: number;
  colchon_min: number;
  /** Si está apagado, el cliente ve el catálogo pero no puede reservar (migración 0015). */
  reservas_en_linea: boolean;
  /** Hasta cuántas horas antes de la cita el cliente puede cancelarla o moverla desde su enlace. */
  cancelar_hasta_horas: number;
};

/** Valores con los que nace una barbería (los mismos defaults de la base y del SPEC F3). */
export const AJUSTES_POR_DEFECTO: AjustesAgenda = {
  paso_min: 30,
  dias_adelante: 30,
  anticipacion_min: 60,
  colchon_min: 0,
  reservas_en_linea: true,
  cancelar_hasta_horas: 2,
};

export const PASOS: readonly number[] = [15, 30];
export const DIAS_ADELANTE_OPCIONES: readonly number[] = [7, 14, 30, 60, 90];
export const ANTICIPACION_OPCIONES: readonly number[] = [0, 30, 60, 120, 180, 360, 720, 1440];
export const COLCHON_OPCIONES: readonly number[] = [0, 5, 10, 15, 20, 30];
export const CANCELAR_HASTA_OPCIONES: readonly number[] = [0, 1, 2, 4, 12, 24, 48];

/** 0 -> "Hasta la hora de la cita"; 1 -> "1 hora antes"; 24 -> "1 día antes"; 48 -> "2 días antes". */
export function textoCancelarHasta(horas: number): string {
  if (horas === 0) return "Hasta la hora de la cita";
  if (horas === 1) return "1 hora antes";
  if (horas >= 24 && horas % 24 === 0) return horas === 24 ? "1 día antes" : `${horas / 24} días antes`;
  return `${horas} horas antes`;
}

/** 0 -> "Sin anticipación"; 60 -> "1 h"; 1440 -> "1 día". */
export function textoAnticipacion(minutos: number): string {
  if (minutos === 0) return "Sin anticipación";
  if (minutos === 1440) return "1 día";
  return textoDuracion(minutos);
}

/** 0 -> "Sin descanso"; 10 -> "10 min". */
export function textoColchon(minutos: number): string {
  return minutos === 0 ? "Sin descanso" : textoDuracion(minutos);
}
