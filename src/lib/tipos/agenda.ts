/**
 * Formas de lo que devuelven las funciones de lectura de la agenda (listar_servicios, listar_barberos…).
 * Solo tipos: los pueden importar componentes `"use client"`.
 */

export type Servicio = {
  id: string;
  nombre: string;
  /** Pesos enteros. */
  precio: number;
  duracion_min: number;
  /** false = archivado (no se ofrece, pero sigue en citas y cobros viejos). */
  activo: boolean;
};

/** Un servicio que hace un barbero. `null` = usa el precio / la duración del catálogo. */
export type ServicioDeBarbero = {
  servicio_id: string;
  precio_propio: number | null;
  duracion_propia: number | null;
};

export type Barbero = {
  id: string;
  nombre: string;
  /** Cuenta del barbero en la app (null = todavía no tiene). */
  user_id: string | null;
  /** false = no sale en la reserva en línea (sigue en la agenda del personal). */
  acepta_reservas: boolean;
  /** false = archivado. */
  activo: boolean;
  orden: number;
  servicios: ServicioDeBarbero[];
  /** Franjas de trabajo de la semana (día 0 = domingo; horas en minutos desde la medianoche, Bogotá). */
  horario: { dia: number; desde: number; hasta: number }[];
};

/** Un rato en que un barbero NO atiende. `inicio` y `fin` son instantes ISO. */
export type Bloqueo = {
  id: string;
  barbero_id: string;
  inicio: string;
  fin: string;
  motivo: string | null;
};

/** Una cita que cae sobre un bloqueo (lo que devuelve `crear_bloqueo` para avisar). */
export type CitaAfectada = {
  id: string;
  inicio: string;
  fin: string;
  estado: string;
  cliente: string;
  servicio: string;
};

/**
 * Estado del formulario de bloqueos. `citas` con elementos = el bloqueo NO se guardó porque cae sobre esas citas:
 * hay que confirmar para guardarlo igual (las citas no se cancelan solas).
 */
export type EstadoBloqueo = { error: string | null; citas?: CitaAfectada[] };

// Agenda (citas del día, horas libres, clientes)

/** Una cita tal como la devuelven `listar_citas` y `obtener_cita`. `inicio` y `fin` son instantes ISO. */
export type CitaDia = {
  id: string;
  barbero_id: string;
  barbero: string;
  cliente_id: string;
  cliente: string;
  /** El nombre que escribió quien reservó en línea, solo si es distinto del de la ficha (el celular identifica la ficha). */
  reservo_como?: string | null;
  telefono: string | null;
  servicio_id: string;
  servicio: string;
  inicio: string;
  fin: string;
  duracion_min: number;
  /** Pesos enteros, copiados del catálogo al crear la cita. */
  precio: number;
  estado: "confirmada" | "en_atencion" | "atendida" | "cancelada" | "no_asistio";
  origen: "personal" | "cliente";
  notas: string | null;
  recordatorio_enviado_at: string | null;
  cancelada_motivo: string | null;
};

/** Una hora libre (`obtener_huecos`). */
export type HuecoLibre = { barbero_id: string; inicio: string; fin: string };

/** Un cliente de `buscar_clientes`, con su historial resumido. */
export type ClienteBuscado = {
  id: string;
  nombre: string;
  telefono: string | null;
  nota: string | null;
  visitas: number;
  no_asistio: number;
  ultima_visita: string | null;
};

/** La ficha de un cliente (`obtener_cliente`): sus datos, su resumen y sus últimas 20 citas. */
export type FichaCliente = ClienteBuscado & {
  creado: string;
  citas: {
    id: string;
    inicio: string;
    fin: string;
    estado: CitaDia["estado"];
    precio: number;
    servicio: string;
    barbero: string;
  }[];
};

/** Algo que el personal puede confirmar al agendar o mover (hora pasada, fuera de horario, bloqueo). */
export type AvisoCita = { tipo: "pasado" | "fuera_de_horario" | "bloqueo"; mensaje: string };

/** Estado de los formularios de cita. `avisos` con elementos = no se guardó: hay que confirmar. */
export type EstadoFormCita = { error: string | null; avisos?: AvisoCita[] };
