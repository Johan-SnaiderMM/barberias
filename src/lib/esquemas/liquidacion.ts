import { z } from "zod";
import { esFecha } from "@/lib/periodos";

/** Entradas de Liquidar y de anular una liquidación. Solo servidor: los componentes de cliente no importan Zod. */

export const esquemaLiquidar = z.object({
  barbero_id: z.uuid("El barbero no es válido."),
  /** Se paga todo lo pendiente hasta este día ('YYYY-MM-DD'). */
  hasta: z.string().refine(esFecha, "La fecha no es válida."),
  medio: z.enum(["efectivo", "transferencia"], { error: "Elige cómo se le paga: efectivo o transferencia." }),
  /** Idempotencia: la crea la pantalla al abrirse; repetirla no paga dos veces. */
  clave: z.uuid("Recarga la pantalla e intenta de nuevo."),
  nota: z.string().trim().max(200, "La nota es muy larga (máximo 200 letras).").default(""),
});

export const esquemaAnularLiquidacion = z.object({
  id: z.uuid("La liquidación no es válida."),
  motivo: z
    .string()
    .trim()
    .min(1, "Escribe por qué se anula la liquidación.")
    .max(200, "El motivo es muy largo (máximo 200 letras)."),
});

export type EntradaLiquidar = z.infer<typeof esquemaLiquidar>;
