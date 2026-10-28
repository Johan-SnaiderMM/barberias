import { z } from "zod";

/** Entradas de los formularios de cita. Solo servidor: los componentes de cliente no importan Zod. */

const INSTANTE = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Elige la fecha y la hora.");

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no es válida.");

const NOTAS = z.string().trim().max(300, "La nota es muy larga (máximo 300 letras).");

/** Datos del cliente: uno existente (`cliente_id`) o uno nuevo (nombre, y celular opcional). */
const CLIENTE = {
  cliente_id: z.uuid("El cliente no es válido.").optional(),
  cliente_nombre: z.string().trim().max(60, "El nombre del cliente es muy largo (máximo 60 letras).").optional(),
  cliente_telefono: z.string().trim().max(30, "El celular es muy largo.").optional(),
};

function exigirCliente(v: { cliente_id?: string; cliente_nombre?: string }, ctx: z.RefinementCtx) {
  if (!v.cliente_id && !v.cliente_nombre) {
    ctx.addIssue({ code: "custom", message: "Escribe el nombre del cliente.", path: ["cliente_nombre"] });
  }
}

export const esquemaCrearCita = z
  .object({
    servicio_id: z.uuid("Elige el servicio."),
    barbero_id: z.uuid("Elige el barbero."),
    inicio: INSTANTE,
    ...CLIENTE,
    notas: NOTAS.optional(),
    confirmar: z.boolean(),
  })
  .superRefine(exigirCliente);

export const esquemaCitaSinReserva = z
  .object({
    servicio_id: z.uuid("Elige el servicio."),
    barbero_id: z.uuid("Elige el barbero."),
    ...CLIENTE,
    notas: NOTAS.optional(),
  })
  .superRefine(exigirCliente);

export const esquemaMoverCita = z.object({
  id: z.uuid("La cita no es válida."),
  inicio: INSTANTE,
  confirmar: z.boolean(),
});

export const esquemaCancelarCita = z.object({
  id: z.uuid("La cita no es válida."),
  motivo: z
    .string()
    .trim()
    .min(1, "Escribe por qué se cancela la cita.")
    .max(200, "El motivo es muy largo (máximo 200 letras)."),
  /** Día al que volver ('YYYY-MM-DD'), si viene. */
  volver: FECHA.optional(),
});

export const esquemaCambiarEstadoCita = z.object({
  id: z.uuid("La cita no es válida."),
  estado: z.enum(["confirmada", "en_atencion", "atendida", "no_asistio"], { error: "Ese estado no es válido." }),
});

/** Dejar constancia del recordatorio por WhatsApp de una cita. */
export const esquemaRecordatorioCita = z.object({
  id: z.uuid("La cita no es válida."),
});

/** Consulta de horas libres de un día. */
export const esquemaConsultaHuecos = z.object({
  servicio: z.uuid(),
  barbero: z.uuid().nullable(),
  fecha: FECHA,
  ignorarCita: z.uuid().nullable(),
});

export type EntradaCrearCita = z.infer<typeof esquemaCrearCita>;
