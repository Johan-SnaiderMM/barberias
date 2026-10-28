import { z } from "zod";

/** Alta y edición de un cliente (con `id` es edición). Solo servidor: los componentes de cliente no importan Zod. */
export const esquemaCliente = z.object({
  id: z.uuid("El cliente no es válido.").optional(),
  nombre: z
    .string()
    .trim()
    .min(1, "Escribe el nombre del cliente.")
    .max(60, "El nombre es muy largo (máximo 60 letras)."),
  telefono: z.string().trim().max(30, "El celular es muy largo.").optional(),
  /** Solo en el alta; la nota de un cliente existente se guarda aparte. */
  nota: z.string().trim().max(300, "La nota es muy larga (máximo 300 letras).").optional(),
});

/** La nota del corte. Vacía = sin nota. */
export const esquemaNotaCliente = z.object({
  id: z.uuid("El cliente no es válido."),
  nota: z.string().trim().max(300, "La nota es muy larga (máximo 300 letras)."),
});
