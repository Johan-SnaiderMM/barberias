import { z } from "zod";
import { esFecha } from "@/lib/periodos";

/** Entradas de la pantalla de cierre. Solo servidor: los componentes de cliente no importan Zod. */

export const esquemaCerrarDia = z.object({
  /** El día que se cierra ('YYYY-MM-DD'). */
  fecha: z.string().refine(esFecha, "La fecha no es válida."),
  efectivo_contado: z
    .number("Escribe cuánto efectivo contaste.")
    .int("Los pesos van enteros.")
    .min(0, "Escribe cuánto efectivo contaste (desde $ 0).")
    .max(1_000_000_000, "El efectivo contado es demasiado alto."),
  /** Idempotencia: la crea la pantalla al abrirse; repetirla no cierra dos veces. */
  clave: z.uuid("Recarga la pantalla e intenta de nuevo."),
  nota: z.string().trim().max(200, "La nota es muy larga (máximo 200 letras).").default(""),
});

export const esquemaAnularCierre = z.object({
  id: z.uuid("El cierre no es válido."),
  motivo: z
    .string()
    .trim()
    .min(1, "Escribe por qué se anula el cierre.")
    .max(200, "El motivo es muy largo (máximo 200 letras)."),
});

export type EntradaCerrarDia = z.infer<typeof esquemaCerrarDia>;
