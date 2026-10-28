/** Lo que devuelven las funciones de gastos (migración 0024). Pesos enteros; fechas 'YYYY-MM-DD' de Bogotá. */
import type { MedioPago, Pesos } from "@/lib/dinero";
import type { CategoriaGasto } from "@/lib/gastos";

export type GastoDeLaLista = {
  id: string;
  created_at: string;
  monto: Pesos;
  categoria: CategoriaGasto;
  medio: MedioPago;
  nota: string | null;
  con_foto: boolean;
  anulado: boolean;
  anulado_motivo: string | null;
};

export type GastosDelDia = {
  fecha: string;
  /** Sin contar los anulados. */
  totales: { gastos: number; total: Pesos; efectivo: Pesos; transferencia: Pesos };
  por_categoria: { categoria: CategoriaGasto; total: Pesos; gastos: number }[];
  /** También los anulados (marcados), el más reciente primero. */
  gastos: GastoDeLaLista[];
};

export type GastoDetalle = {
  id: string;
  monto: Pesos;
  categoria: CategoriaGasto;
  medio: MedioPago;
  nota: string | null;
  /** Ruta de la foto en el bucket privado; la app la sirve con /api/foto/gasto/<id>. */
  foto_ruta: string | null;
  fecha: string;
  created_at: string;
  /** Nombre de quien lo registró. */
  registrado_por: string | null;
  anulado: boolean;
  anulado_motivo: string | null;
  anulado_at: string | null;
};

/** Lo que responde registrar_gasto. */
export type Gastado = {
  ok: true;
  ya_existia: boolean;
  id: string;
  monto: Pesos;
  categoria: CategoriaGasto;
  medio: MedioPago;
  fecha: string;
  con_foto: boolean;
  anulado: boolean;
};
