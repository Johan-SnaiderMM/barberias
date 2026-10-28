"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutar } from "@/lib/datos/llamar";
import type { EstadoForm } from "@/lib/errores";
import { esquemaComisionesBarbero, esquemaPropinaDelBarbero } from "@/lib/esquemas/comisiones";

/**
 * Fija el porcentaje base de un barbero y deja exactamente las excepciones por servicio que llegan (campo
 * `excepciones`: JSON con la lista completa). Lo ya cobrado no cambia: cada cobro guardó su porcentaje.
 */
export async function guardarComisionesBarbero(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  let excepciones: unknown;
  try {
    excepciones = JSON.parse(formulario.get("excepciones")?.toString() ?? "[]");
  } catch {
    return { error: "La lista de excepciones no es válida. Recarga la pantalla e intenta de nuevo." };
  }
  const pct = formulario.get("pct")?.toString().trim() ?? "";
  const parsed = esquemaComisionesBarbero.safeParse({
    barbero_id: formulario.get("barbero_id")?.toString() ?? "",
    pct: pct === "" ? Number.NaN : Number(pct),
    excepciones,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los porcentajes." };

  const r = await ejecutar("guardar_comisiones_barbero", {
    p_barbero: parsed.data.barbero_id,
    p_pct: parsed.data.pct,
    p_excepciones: parsed.data.excepciones,
  });
  if (!r.ok) return { error: r.error };

  revalidatePath("/comisiones/porcentajes");
  redirect("/comisiones/porcentajes");
}

/** De quién es la propina de los cobros que vienen (los ya hechos conservan lo que se guardó). */
export async function fijarPropinaDelBarbero(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const valor = formulario.get("del_barbero")?.toString();
  const parsed = esquemaPropinaDelBarbero.safeParse({ del_barbero: valor === "true" ? true : valor === "false" ? false : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Indica de quién es la propina." };

  const r = await ejecutar("fijar_propina_del_barbero", { p_del_barbero: parsed.data.del_barbero });
  if (!r.ok) return { error: r.error };

  revalidatePath("/comisiones/porcentajes");
  return { error: null };
}
