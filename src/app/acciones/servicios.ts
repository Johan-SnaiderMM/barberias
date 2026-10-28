"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutar } from "@/lib/datos/llamar";
import { leerPesos } from "@/lib/dinero";
import type { EstadoForm } from "@/lib/errores";
import { esquemaFijarActivo, esquemaServicio } from "@/lib/esquemas/servicio";

/**
 * Crear o editar un servicio. Con un campo `id` es edición. Las reglas de verdad (precio, duración, nombre único,
 * permiso del área "servicios") las aplica la base; aquí solo se arma la entrada y se muestra el mensaje.
 */
export async function guardarServicio(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaServicio.safeParse({
    id: formulario.get("id")?.toString() || undefined,
    nombre: formulario.get("nombre")?.toString() ?? "",
    precio: leerPesos(formulario.get("precio")?.toString() ?? ""),
    duracion_min: Number(formulario.get("duracion_min")?.toString() ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos del servicio." };

  const { id, nombre, precio, duracion_min } = parsed.data;
  const resultado = id
    ? await ejecutar("actualizar_servicio", { p_id: id, p_nombre: nombre, p_precio: precio, p_duracion_min: duracion_min })
    : await ejecutar("crear_servicio", { p_nombre: nombre, p_precio: precio, p_duracion_min: duracion_min });
  if (!resultado.ok) return { error: resultado.error };

  revalidatePath("/servicios");
  redirect("/servicios");
}

/** Archivar (activo = false) o restaurar (activo = true) un servicio. Vuelve a la lista al terminar. */
export async function fijarServicioActivo(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaFijarActivo.safeParse({
    id: formulario.get("id")?.toString() ?? "",
    activo: formulario.get("activo")?.toString() === "true",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "No se pudo cambiar el servicio." };

  const resultado = await ejecutar("fijar_servicio_activo", { p_id: parsed.data.id, p_activo: parsed.data.activo });
  if (!resultado.ok) return { error: resultado.error };

  revalidatePath("/servicios");
  redirect("/servicios");
}
