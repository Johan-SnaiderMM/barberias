/** Lo que devuelven las funciones de liquidaciones (migración 0023). Pesos enteros; fechas 'YYYY-MM-DD' de Bogotá. */
import type { MedioPago, Pesos } from "@/lib/dinero";

/** Un barbero en el resumen de un periodo. */
export type FilaResumen = {
  id: string;
  nombre: string;
  activo: boolean;
  /** Lo generado en el periodo (cobros vigentes con su fecha dentro del periodo). */
  cobros: number;
  servicios: Pesos;
  comision: Pesos;
  /** La parte de la propina que es del barbero. */
  propina: Pesos;
  /** De lo generado en el periodo, lo que ya se le liquidó (comisión + propina). */
  liquidado: Pesos;
  /** Lo que falta por pagarle hasta el final del periodo, incluso de periodos anteriores. */
  pendiente_cobros: number;
  pendiente: Pesos;
  /** El día del cobro pendiente más antiguo. */
  pendiente_desde: string | null;
};

export type ResumenComisiones = {
  desde: string;
  hasta: string;
  /** true = quien pregunta ve a todos los barberos; false = solo lo suyo. */
  todos: boolean;
  barberos: FilaResumen[];
};

/** Un cobro de un barbero (pendiente de liquidar o ya liquidado). */
export type CobroDeBarbero = {
  id: string;
  fecha: string;
  created_at: string;
  cliente: string | null;
  /** Los nombres de las líneas del cobro, separados por coma. */
  servicios: string;
  total: Pesos;
  comision: Pesos;
  propina_barbero: Pesos;
};

export type LiquidacionDeLista = {
  id: string;
  created_at: string;
  fecha: string;
  hasta: string;
  total: Pesos;
  cobros: number;
  medio: MedioPago;
  anulada: boolean;
};

export type ComisionesDeBarbero = {
  barbero: { id: string; nombre: string; activo: boolean };
  hasta: string;
  pendiente: { cobros: number; comision: Pesos; propina: Pesos; total: Pesos; desde: string | null };
  /** Los pendientes más recientes (hasta 200). */
  cobros: CobroDeBarbero[];
  /** Las últimas liquidaciones del barbero. */
  liquidaciones: LiquidacionDeLista[];
};

/** Lo que responde liquidar_comisiones. */
export type Liquidado = {
  ok: true;
  ya_existia: boolean;
  id: string;
  barbero_id: string;
  barbero: string;
  cobros: number;
  comision: Pesos;
  propina: Pesos;
  total: Pesos;
  medio: MedioPago;
  hasta: string;
  fecha: string;
  anulada: boolean;
};

export type LiquidacionDetalle = {
  id: string;
  barbero_id: string;
  barbero: string;
  hasta: string;
  fecha: string;
  medio: MedioPago;
  cobros: number;
  comision: Pesos;
  propina: Pesos;
  total: Pesos;
  nota: string | null;
  created_at: string;
  anulada: boolean;
  anulada_motivo: string | null;
  anulada_at: string | null;
  items: (Omit<CobroDeBarbero, "id"> & { cobro_id: string })[];
};
