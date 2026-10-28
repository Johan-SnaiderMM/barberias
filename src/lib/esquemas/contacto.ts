import { z } from "zod";

/**
 * WhatsApp y dirección de la barbería. Vacío = quitar ese dato. El formato del WhatsApp lo decide la base
 * (`fn_normalizar_telefono`); aquí solo se corta lo absurdo antes de mandarlo. Solo servidor: los componentes de
 * cliente no importan Zod.
 */
export const esquemaContacto = z.object({
  whatsapp: z.string().trim().max(30, "El WhatsApp es muy largo."),
  direccion: z.string().trim().max(120, "La dirección es muy larga (máximo 120 caracteres)."),
});

export type EntradaContacto = z.infer<typeof esquemaContacto>;
