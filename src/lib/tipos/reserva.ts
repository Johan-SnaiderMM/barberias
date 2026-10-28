/** Lo que devuelve la API pública de reservas (migración 0015). Sin nada del equipo ni de otros clientes. */

export type ServicioPublico = { id: string; nombre: string; precio: number; duracion_min: number };

export type BarberoPublico = {
  id: string;
  nombre: string;
  /** Lo que ESE barbero ofrece, con su precio y duración propios si los tiene. */
  servicios: { servicio_id: string; precio: number; duracion_min: number }[];
};

export type BarberiaPublica = {
  nombre: string;
  slug: string;
  whatsapp: string | null;
  direccion: string | null;
  reservas_en_linea: boolean;
  dias_adelante: number;
  anticipacion_min: number;
  cancelar_hasta_horas: number;
};

export type CatalogoPublico =
  | { existe: false }
  | { existe: true; barberia: BarberiaPublica; servicios: ServicioPublico[]; barberos: BarberoPublico[] };

/** Una hora libre. `inicio` y `fin` son instantes ISO. */
export type HuecoPublico = { barbero_id: string; inicio: string; fin: string };

export type CitaPublica =
  | { existe: false }
  | {
      existe: true;
      barberia: Pick<BarberiaPublica, "nombre" | "slug" | "whatsapp" | "direccion" | "cancelar_hasta_horas" | "dias_adelante">;
      cita: {
        inicio: string;
        fin: string;
        estado: "confirmada" | "en_atencion" | "atendida" | "cancelada" | "no_asistio";
        servicio: string;
        barbero: string;
        precio: number;
        duracion_min: number;
        /** Todavía se puede cancelar o mover desde el enlace. */
        puede_cambiar: boolean;
        /** Hasta cuándo (instante ISO). */
        limite: string;
      };
    };

/** Respuesta de reservar, cancelar y reprogramar cuando no salió: el motivo y un mensaje listo para mostrar. */
export type RechazoPublico = { ok: false; motivo: string; mensaje: string };

/** Estado del formulario de reserva (`useActionState`). */
export type EstadoReserva = { error: string | null; motivo?: string };
