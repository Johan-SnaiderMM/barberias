"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutar } from "@/lib/datos/llamar";
import type { EstadoForm } from "@/lib/errores";
import { esquemaReiniciarDemo } from "@/lib/esquemas/demo";
import { textoPinRechazado, type RespuestaReinicio } from "@/lib/tipos/demo";

/**
 * Reinicia la demo: borra lo que se hizo en ella y vuelven los datos de ejemplo. La base solo lo permite al dueño de
 * una barbería de demostración, y si la demo tiene PIN, la base lo comprueba (esta pantalla solo lo manda).
 * Si sale bien, redirige a Inicio con los datos nuevos.
 */
export async function reiniciarDemo(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaReiniciarDemo.safeParse({ pin: formulario.get("pin")?.toString() ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa el PIN." };

  const r = await ejecutar<RespuestaReinicio>("reiniciar_demo", { p_pin: parsed.data.pin === "" ? null : parsed.data.pin });
  if (!r.ok) return { error: r.error };
  if (!r.datos.ok) return { error: textoPinRechazado(r.datos) };

  revalidatePath("/", "layout");
  redirect("/inicio");
}
