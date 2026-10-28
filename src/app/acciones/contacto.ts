"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutar } from "@/lib/datos/llamar";
import type { EstadoForm } from "@/lib/errores";
import { esquemaContacto } from "@/lib/esquemas/contacto";

/**
 * Guarda el WhatsApp y la dirección de la barbería. Un campo vacío quita ese dato. La base normaliza el WhatsApp
 * (E.164) y es la que rechaza lo que no se entiende; aquí solo se manda lo escrito. Los ven la reserva, la cita y los
 * textos legales, así que se refresca todo el layout.
 */
export async function guardarContacto(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaContacto.safeParse({
    whatsapp: formulario.get("whatsapp")?.toString() ?? "",
    direccion: formulario.get("direccion")?.toString() ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos de contacto." };

  const r = await ejecutar("actualizar_contacto_barberia", {
    p_whatsapp: parsed.data.whatsapp === "" ? null : parsed.data.whatsapp,
    p_direccion: parsed.data.direccion === "" ? null : parsed.data.direccion,
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/", "layout");
  redirect("/mas");
}
