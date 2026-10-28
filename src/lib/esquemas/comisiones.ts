import { z } from "zod";

/** Entradas de las pantallas de comisiones. Solo servidor: los componentes de cliente no importan Zod. */

const PCT = z
  .number("Escribe un porcentaje válido.")
  .int("El porcentaje va en números enteros.")
  .min(0, "La comisión va de 0 % a 100 %.")
  .max(100, "La comisión va de 0 % a 100 %.");

/** El porcentaje base de un barbero y la lista COMPLETA de sus excepciones por servicio. */
export const esquemaComisionesBarbero = z
  .object({
    barbero_id: z.uuid("El barbero no es válido."),
    pct: PCT,
    excepciones: z
      .array(z.object({ servicio_id: z.uuid("Uno de los servicios no es válido."), pct: PCT }))
      .max(100, "Son demasiadas excepciones."),
  })
  .superRefine((v, ctx) => {
    const vistos = new Set<string>();
    for (const [i, e] of v.excepciones.entries()) {
      if (vistos.has(e.servicio_id)) {
        ctx.addIssue({ code: "custom", message: "Un servicio aparece dos veces en la lista.", path: ["excepciones", i] });
      }
      vistos.add(e.servicio_id);
    }
  });

/** De quién es la propina de los cobros que vienen. */
export const esquemaPropinaDelBarbero = z.object({
  del_barbero: z.boolean("Indica de quién es la propina."),
});

export type EntradaComisionesBarbero = z.infer<typeof esquemaComisionesBarbero>;
