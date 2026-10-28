/** Lo que devuelve obtener_inicio (migración 0026). Pesos enteros; fechas 'YYYY-MM-DD' de Bogotá. Lo que el rol no ve llega en null. */
import type { Pesos } from "@/lib/dinero";

export type InicioDelDia = {
  /** Hoy, por el calendario de Bogotá. */
  hoy: string;
  /** El día de las cifras de dinero: el de hoy, o el siguiente si hoy ya se cerró. */
  fecha: string;
  /** Las citas de hoy por estado (las de todos, o solo las del barbero). */
  citas: { total: number; atendidas: number; por_atender: number; no_asistio: number; canceladas: number } | null;
  /** Lo vendido (cobros, servicios y propinas). `propias`: son solo lo que cobró el barbero. */
  ventas: { propias: boolean; cobros: number; servicios: Pesos; propinas: Pesos } | null;
  /** Lo que ganan los barberos: la comisión por los servicios y la parte de las propinas que es suya. */
  comisiones: { propias: boolean; comisiones: Pesos; propinas_barbero: Pesos } | null;
  gastos: { gastos: number; total: Pesos } | null;
  /** Cómo salió el cierre de hoy, si ya se hizo (solo para quien cierra). */
  cierre_hoy: { id: string; efectivo_contado: Pesos; diferencia: Pesos } | null;
};
