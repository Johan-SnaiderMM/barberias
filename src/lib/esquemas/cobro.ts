import { z } from "zod";
import { LINEAS_MAXIMAS, PRECIO_MAXIMO, PROPINA_MAXIMA } from "@/lib/dinero";

/** Entradas de la pantalla de Cobrar. Solo servidor: los componentes de cliente no importan Zod. */

const PESOS = z.number("Escribe un monto válido.").int("Los pesos van enteros.");

const LINEA_SERVICIO = z.object({
  servicio_id: z.uuid("El servicio no es válido."),
  precio: PESOS.min(0).max(PRECIO_MAXIMO, "El precio es muy alto.").optional(),
});

const LINEA_EXTRA = z.object({
  nombre: z.string().trim().min(1, "Escribe el nombre del extra.").max(60, "El nombre del extra es muy largo (máximo 60 letras)."),
  precio: PESOS.min(1, "El extra necesita un precio.").max(PRECIO_MAXIMO, "El precio es muy alto."),
});

const PAGO = z.object({
  medio: z.enum(["efectivo", "transferencia"], { error: "El medio de pago no es válido." }),
  monto: PESOS.min(1, "El valor de cada pago debe ser mayor que cero.").max(PRECIO_MAXIMO * LINEAS_MAXIMAS),
  recibido: PESOS.min(1).max(PRECIO_MAXIMO * LINEAS_MAXIMAS).optional(),
  referencia: z.string().trim().max(60, "La referencia es muy larga (máximo 60 letras).").optional(),
});

export const esquemaCobro = z
  .object({
    /** La cita que se cobra; null = venta sin cita (entonces hay que decir el barbero). */
    cita_id: z.uuid("La cita no es válida.").nullable(),
    barbero_id: z.uuid("Elige el barbero.").nullable(),
    cliente_id: z.uuid("El cliente no es válido.").nullable().optional(),
    /** Idempotencia: la crea la pantalla al abrirse; repetirla no cobra dos veces. */
    clave: z.uuid("Recarga la pantalla e intenta de nuevo."),
    items: z.array(z.union([LINEA_SERVICIO, LINEA_EXTRA])).min(1, "Agrega al menos un servicio o un extra.").max(LINEAS_MAXIMAS),
    descuento: PESOS.min(0).max(PRECIO_MAXIMO * LINEAS_MAXIMAS),
    descuento_motivo: z.string().trim().max(120, "El motivo del descuento es muy largo (máximo 120 letras).").default(""),
    propina: PESOS.min(0, "La propina no es válida.").max(PROPINA_MAXIMA, "La propina no es válida."),
    pagos: z.array(PAGO).max(4),
  })
  .superRefine((v, ctx) => {
    if (v.cita_id === null && v.barbero_id === null) {
      ctx.addIssue({ code: "custom", message: "Elige el barbero.", path: ["barbero_id"] });
    }
    if (v.descuento > 0 && v.descuento_motivo === "") {
      ctx.addIssue({ code: "custom", message: "Escribe el motivo del descuento.", path: ["descuento_motivo"] });
    }
  });

export type EntradaCobro = z.infer<typeof esquemaCobro>;

/** Anular un cobro: siempre con motivo (la base lo exige y lo recorta a 200 letras). */
export const esquemaAnularCobro = z.object({
  id: z.uuid("El cobro no es válido."),
  motivo: z
    .string()
    .trim()
    .min(1, "Escribe por qué se anula el cobro.")
    .max(200, "El motivo es muy largo (máximo 200 letras)."),
});
