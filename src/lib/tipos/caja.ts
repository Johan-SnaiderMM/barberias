/** Lo que devuelven las funciones de la caja y de los cobros (migraciones 0019 y 0020). Pesos enteros. */
import type { MedioPago, Pesos } from "@/lib/dinero";

/** Una cita que se puede cobrar y todavía no tiene cobro vigente. */
export type CitaPorCobrar = {
  id: string;
  inicio: string;
  fin: string;
  estado: "confirmada" | "en_atencion" | "atendida";
  precio: Pesos;
  cliente: string;
  servicio: string;
  barbero: string;
};

export type CobroDelDia = {
  id: string;
  created_at: string;
  cita_id: string | null;
  barbero: string;
  cliente: string | null;
  total: Pesos;
  propina: Pesos;
  anulado: boolean;
  anulado_motivo: string | null;
  medios: MedioPago[];
};

export type CajaDelDia = {
  fecha: string;
  por_cobrar: CitaPorCobrar[];
  atrasadas: CitaPorCobrar[];
  cobros: CobroDelDia[];
  totales: { cobros: number; servicios: Pesos; propinas: Pesos; efectivo: Pesos; transferencia: Pesos };
};

export type BarberoDeCobro = {
  id: string;
  nombre: string;
  /** servicio_id -> lo que cobra ESE barbero por él (su precio propio, o el del catálogo). */
  precios: Record<string, Pesos>;
};

export type DatosCobro = {
  cita: {
    id: string;
    inicio: string;
    fin: string;
    estado: "confirmada" | "en_atencion" | "atendida" | "cancelada" | "no_asistio";
    precio: Pesos;
    servicio_id: string;
    servicio: string;
    cliente_id: string;
    cliente: string;
    telefono: string | null;
    barbero_id: string;
    barbero: string;
  } | null;
  /** El cobro vigente de la cita, si ya se cobró. */
  cobro_id: string | null;
  barberos: BarberoDeCobro[];
  servicios: { id: string; nombre: string; precio: Pesos }[];
};

/** Lo que responde cobrar_cita / cobrar_venta. */
export type Cobrado = {
  ok: true;
  ya_existia: boolean;
  id: string;
  cita_id: string | null;
  subtotal: Pesos;
  descuento: Pesos;
  total: Pesos;
  propina: Pesos;
  /** total + propina: lo que entró. */
  cobrado: Pesos;
  /** Lo que se le devolvió al cliente de lo que entregó en efectivo. */
  vuelto: Pesos;
  comision: Pesos;
  fecha: string;
  anulado: boolean;
};

/** Lo que responde anular_cobro: si el cobro era de una cita, la cita se reabrió (en atención). */
export type Anulacion = {
  ok: true;
  id: string;
  cita_id: string | null;
  cita_reabierta: boolean;
};

export type CobroDetalle = {
  id: string;
  cita_id: string | null;
  barbero_id: string;
  barbero: string;
  cliente_id: string | null;
  cliente: string | null;
  subtotal: Pesos;
  descuento: Pesos;
  descuento_motivo: string | null;
  total: Pesos;
  propina: Pesos;
  comision: Pesos;
  propina_barbero: Pesos;
  fecha: string;
  created_at: string;
  anulado: boolean;
  anulado_motivo: string | null;
  anulado_at: string | null;
  /** La liquidación vigente que ya le pagó este cobro al barbero (solo la ve quien puede ver liquidaciones). */
  liquidacion_id: string | null;
  items: {
    id: string;
    tipo: "servicio" | "extra";
    servicio_id: string | null;
    nombre: string;
    precio: Pesos;
    precio_lista: Pesos | null;
    descuento: Pesos;
    comision_pct: number;
    comision: Pesos;
  }[];
  pagos: { id: string; medio: MedioPago; monto: Pesos; recibido: Pesos | null; vuelto: Pesos | null; referencia: string | null }[];
};
