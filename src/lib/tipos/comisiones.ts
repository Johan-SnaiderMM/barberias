/** Lo que devuelven las funciones de comisiones (migración 0022). Los porcentajes son enteros de 0 a 100. */

export type ExcepcionComision = { servicio_id: string; servicio: string; pct: number };

export type ComisionDeBarbero = {
  id: string;
  nombre: string;
  activo: boolean;
  /** Su porcentaje: el guardado, o el de por defecto mientras no tenga uno (`definido` = false). */
  pct: number;
  definido: boolean;
  /** Servicios en los que gana un porcentaje distinto al base. */
  excepciones: ExcepcionComision[];
};

export type ComisionesConfig = {
  /** Lo que gana quien no tiene porcentaje guardado. */
  defecto: number;
  /** true = la propina es del barbero; false = se queda en la barbería. */
  propina_del_barbero: boolean;
  barberos: ComisionDeBarbero[];
};
