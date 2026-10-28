/** Lo que devuelven las funciones del cierre del día (migración 0025). Pesos enteros; fechas 'YYYY-MM-DD' de Bogotá. */
import type { Pesos } from "@/lib/dinero";

/** Las cifras de un día (lo mismo para el cierre y para Inicio). */
export type CifrasDelDia = {
  cobros: number;
  /** Lo cobrado por servicios y extras, ya con los descuentos. */
  servicios: Pesos;
  propinas: Pesos;
  /** Lo que ganaron los barberos por esos servicios (suma de las comisiones guardadas). */
  comisiones: Pesos;
  /** La parte de las propinas que es de los barberos. */
  propinas_barbero: Pesos;
  /** Lo que quedó en la caja de los cobros en efectivo (sin el vuelto). */
  efectivo_cobros: Pesos;
  transferencia_cobros: Pesos;
  gastos: number;
  gastos_efectivo: Pesos;
  gastos_transferencia: Pesos;
  /** Lo que se le pagó a los barberos ese día. */
  liquidaciones_efectivo: Pesos;
  liquidaciones_transferencia: Pesos;
  /** Efectivo que debe haber en la caja: puede ser negativo. */
  efectivo_esperado: Pesos;
};

/** Un cierre vigente (o el resultado de cerrar): las cifras al cerrar más lo que se contó. */
export type CierreHecho = CifrasDelDia & {
  ok: true;
  ya_existia: boolean;
  id: string;
  fecha: string;
  created_at: string;
  efectivo_contado: Pesos;
  /** contado − esperado: sobra (+) o falta (−). */
  diferencia: Pesos;
  nota: string | null;
  anulado: boolean;
  anulado_motivo: string | null;
  anulado_at: string | null;
  /** Nombre de quien cerró. */
  registrado_por: string | null;
};

export type DiaDeCierre = {
  fecha: string;
  /** El día en que hoy se registra (tras cerrar el de hoy, el siguiente). */
  jornada: string;
  cierre: CierreHecho | null;
  /** Las guardadas si el día está cerrado; las de ahora si no. */
  resumen: CifrasDelDia;
  /** Citas del día que se atendieron y todavía no se cobran. */
  sin_cobrar: number;
  /** Días anteriores con movimiento que nadie cerró (los más recientes primero). */
  sin_cerrar: string[];
};
