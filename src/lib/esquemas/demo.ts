import { z } from "zod";

/** Entrada de «Reiniciar demo». Solo servidor: los componentes de cliente no importan Zod. */
export const esquemaReiniciarDemo = z.object({
  /** El PIN de reinicio (4 a 8 dígitos) o vacío si la demo no tiene. La base es quien lo comprueba. */
  pin: z.string().trim().regex(/^(\d{4,8})?$/, "El PIN tiene de 4 a 8 números."),
});
