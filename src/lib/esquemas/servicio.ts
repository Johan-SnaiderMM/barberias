import { z } from "zod";
import { DURACION_MAX, DURACION_MIN, DURACION_PASO, PRECIO_MAX } from "@/lib/catalogo";

/** Crear o editar un servicio (con `id` es edición). Solo servidor: los componentes de cliente no importan Zod. */
export const esquemaServicio = z.object({
  id: z.uuid("El servicio no es válido.").optional(),
  nombre: z
    .string()
    .trim()
    .min(1, "Escribe el nombre del servicio.")
    .max(60, "El nombre es muy largo (máximo 60 letras)."),
  precio: z
    .number({ error: "Escribe el precio." })
    .int("El precio debe ser un número entero.")
    .min(0, "El precio no puede ser negativo.")
    .max(PRECIO_MAX, "El precio es demasiado alto."),
  duracion_min: z
    .number({ error: "Elige la duración." })
    .int("Elige la duración.")
    .min(DURACION_MIN, `La duración mínima es de ${DURACION_MIN} minutos.`)
    .max(DURACION_MAX, "La duración máxima es de 8 horas.")
    .refine((n) => n % DURACION_PASO === 0, `La duración va de ${DURACION_PASO} en ${DURACION_PASO} minutos.`),
});

/** Archivar o restaurar. */
export const esquemaFijarActivo = z.object({
  id: z.uuid("El servicio no es válido."),
  activo: z.boolean(),
});

export type EntradaServicio = z.infer<typeof esquemaServicio>;
