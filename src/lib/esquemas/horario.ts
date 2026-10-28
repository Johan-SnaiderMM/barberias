import { z } from "zod";
import { validarFranjas } from "@/lib/horarios";

/** Horario semanal completo de un barbero. Solo servidor: los componentes de cliente no importan Zod. */
export const esquemaHorario = z
  .object({
    barbero_id: z.uuid("El barbero no es válido."),
    franjas: z
      .array(
        z.object({
          dia: z.number().int().min(0).max(6),
          desde: z.number().int().min(0).max(1439),
          hasta: z.number().int().min(1).max(1440),
        })
      )
      .max(28, "Son demasiadas franjas."),
  })
  .superRefine((v, ctx) => {
    const problema = validarFranjas(v.franjas);
    if (problema) ctx.addIssue({ code: "custom", message: problema, path: ["franjas"] });
  });

export type EntradaHorario = z.infer<typeof esquemaHorario>;

const FECHA = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha.")
  .refine((f) => !Number.isNaN(Date.parse(`${f}T00:00:00Z`)), "Elige una fecha válida.");

/** Un bloqueo: días completos (con fecha de fin opcional) o unas horas de un día. */
export const esquemaBloqueo = z
  .object({
    barbero_id: z.uuid("El barbero no es válido."),
    tipo: z.enum(["dia", "horas"], { error: "Elige si es todo el día o unas horas." }),
    fecha: FECHA,
    fecha_fin: FECHA.optional(),
    desde: z.number().int().min(0).max(1439).optional(),
    hasta: z.number().int().min(1).max(1440).optional(),
    motivo: z.string().trim().max(100, "El motivo es muy largo (máximo 100 letras).").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.tipo === "dia") {
      if (v.fecha_fin && v.fecha_fin < v.fecha) {
        ctx.addIssue({ code: "custom", message: "El último día no puede ser anterior al primero.", path: ["fecha_fin"] });
      }
      return;
    }
    if (v.desde === undefined || v.hasta === undefined) {
      ctx.addIssue({ code: "custom", message: "Elige desde qué hora y hasta cuál.", path: ["desde"] });
    } else if (v.hasta <= v.desde) {
      ctx.addIssue({ code: "custom", message: "La hora final debe ser después de la inicial.", path: ["hasta"] });
    }
  });

export type EntradaBloqueo = z.infer<typeof esquemaBloqueo>;

/** Ajustes de la agenda de la barbería. */
export const esquemaAjustes = z.object({
  paso_min: z
    .number({ error: "Elige cada cuánto arrancan las horas." })
    .int()
    .refine((n) => n === 15 || n === 30, "Las horas arrancan cada 15 o cada 30 minutos."),
  dias_adelante: z.number({ error: "Elige hasta cuántos días adelante." }).int().min(1, "Mínimo 1 día.").max(90, "Máximo 90 días."),
  anticipacion_min: z.number({ error: "Elige la anticipación." }).int().min(0).max(1440, "Máximo 1 día."),
  colchon_min: z.number({ error: "Elige el descanso entre citas." }).int().min(0).max(60, "Máximo 60 minutos."),
  reservas_en_linea: z.boolean(),
  cancelar_hasta_horas: z
    .number({ error: "Elige hasta cuándo puede cancelar el cliente." })
    .int()
    .min(0)
    .max(168, "Máximo 7 días."),
});

export type EntradaAjustes = z.infer<typeof esquemaAjustes>;
