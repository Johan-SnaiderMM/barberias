import { z } from "zod";
import { DURACION_MAX, DURACION_MIN, DURACION_PASO, PRECIO_MAX } from "@/lib/catalogo";

/** Crear o editar un barbero (con `id` es edición). Solo servidor: los componentes de cliente no importan Zod. */
export const esquemaBarbero = z.object({
  id: z.uuid("El barbero no es válido.").optional(),
  nombre: z
    .string()
    .trim()
    .min(1, "Escribe el nombre del barbero.")
    .max(40, "El nombre es muy largo (máximo 40 letras)."),
  acepta_reservas: z.boolean(),
});

/** Archivar o restaurar. */
export const esquemaFijarActivoBarbero = z.object({
  id: z.uuid("El barbero no es válido."),
  activo: z.boolean(),
});

/** Lo que hace un barbero: la lista completa de servicios, cada uno con precio/duración propios opcionales. */
export const esquemaServiciosBarbero = z.object({
  barbero_id: z.uuid("El barbero no es válido."),
  servicios: z
    .array(
      z.object({
        servicio_id: z.uuid("Uno de los servicios no es válido."),
        precio_propio: z
          .number()
          .int("El precio debe ser un número entero.")
          .min(0, "El precio no puede ser negativo.")
          .max(PRECIO_MAX, "El precio es demasiado alto.")
          .nullable(),
        duracion_propia: z
          .number()
          .int("Elige la duración.")
          .min(DURACION_MIN, `La duración mínima es de ${DURACION_MIN} minutos.`)
          .max(DURACION_MAX, "La duración máxima es de 8 horas.")
          .refine((n) => n % DURACION_PASO === 0, `La duración va de ${DURACION_PASO} en ${DURACION_PASO} minutos.`)
          .nullable(),
      })
    )
    .max(100, "Son demasiados servicios."),
});

export type EntradaBarbero = z.infer<typeof esquemaBarbero>;
export type EntradaServiciosBarbero = z.infer<typeof esquemaServiciosBarbero>;
