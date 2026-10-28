import { z } from "zod";
import { CATEGORIAS_GASTO, GASTO_MAXIMO, NOTA_GASTO_MAXIMA } from "@/lib/gastos";

/** Entradas de las pantallas de gastos. Solo servidor: los componentes de cliente no importan Zod. */

export const esquemaGasto = z.object({
  /** Idempotencia: la crea la pantalla al abrirse; repetirla no registra dos veces (y nombra la foto). */
  clave: z.uuid("Recarga la pantalla e intenta de nuevo."),
  monto: z
    .number("Escribe cuánto fue el gasto.")
    .int("Los pesos van enteros.")
    .min(1, "Escribe cuánto fue el gasto.")
    .max(GASTO_MAXIMO, "El gasto es demasiado alto."),
  categoria: z.enum(CATEGORIAS_GASTO, { error: "Elige la categoría del gasto." }),
  medio: z.enum(["efectivo", "transferencia"], { error: "Elige cómo se pagó el gasto: efectivo o transferencia." }),
  nota: z.string().trim().max(NOTA_GASTO_MAXIMA, `La nota es muy larga (máximo ${NOTA_GASTO_MAXIMA} letras).`).default(""),
});

export const esquemaAnularGasto = z.object({
  id: z.uuid("El gasto no es válido."),
  motivo: z
    .string()
    .trim()
    .min(1, "Escribe por qué se anula el gasto.")
    .max(200, "El motivo es muy largo (máximo 200 letras)."),
});

export type EntradaGasto = z.infer<typeof esquemaGasto>;
