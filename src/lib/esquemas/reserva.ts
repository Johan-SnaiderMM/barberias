import { z } from "zod";

/** Entradas de la reserva pública. Solo servidor: los componentes de cliente no importan Zod. */

const INSTANTE = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Elige la hora.");

export const esquemaReserva = z.object({
  slug: z.string().trim().min(1, "Falta la barbería.").max(60),
  servicio_id: z.uuid("Elige el servicio."),
  /** null = "el primero disponible". */
  barbero_id: z.uuid("Elige el barbero.").nullable(),
  inicio: INSTANTE,
  nombre: z.string().trim().min(1, "Escribe tu nombre.").max(60, "El nombre es muy largo (máximo 60 letras)."),
  telefono: z.string().trim().min(1, "Escribe tu celular.").max(30, "El celular es muy largo."),
  consentimiento: z.literal(true, { error: "Para reservar tienes que aceptar el tratamiento de tus datos." }),
  /** Campo trampa: las personas no lo ven. */
  web: z.string().max(200).default(""),
});

export const esquemaConsultaHuecos = z.object({
  slug: z.string().trim().min(1).max(60),
  servicio: z.uuid(),
  barbero: z.uuid().nullable(),
  /** Cuántos días después de hoy empieza el rango. */
  desde: z.number().int().min(0).max(90),
});

export const esquemaToken = z.object({ token: z.uuid("El enlace de la cita no es válido.") });

export const esquemaCancelarPublica = z.object({
  token: z.uuid("El enlace de la cita no es válido."),
  motivo: z.string().trim().max(200, "El motivo es muy largo (máximo 200 letras).").default(""),
});

export const esquemaMoverPublica = z.object({
  token: z.uuid("El enlace de la cita no es válido."),
  inicio: INSTANTE,
});
