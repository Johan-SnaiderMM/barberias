"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutar } from "@/lib/datos/llamar";
import type { EstadoForm } from "@/lib/errores";
import {
  esquemaBarbero,
  esquemaFijarActivoBarbero,
  esquemaServiciosBarbero,
} from "@/lib/esquemas/barbero";

/**
 * Crear (sin `id`) o editar (con `id`) un barbero. Al crearlo se va directo a su ficha para asignarle servicios.
 * Las reglas de verdad (nombre único, permiso del área "servicios") las aplica la base.
 */
export async function guardarBarbero(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const id = formulario.get("id")?.toString() || undefined;
  const parsed = esquemaBarbero.safeParse({
    id,
    nombre: formulario.get("nombre")?.toString() ?? "",
    // En la creación no hay casilla: nace aceptando reservas. En la edición, una casilla sin marcar no viaja.
    acepta_reservas: id ? formulario.get("acepta_reservas") !== null : true,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos del barbero." };

  const datos = parsed.data;
  if (datos.id) {
    const r = await ejecutar("actualizar_barbero", {
      p_id: datos.id,
      p_nombre: datos.nombre,
      p_acepta_reservas: datos.acepta_reservas,
    });
    if (!r.ok) return { error: r.error };
    revalidatePath("/barberos");
    redirect("/barberos");
  }

  const r = await ejecutar<{ id: string }>("crear_barbero", { p_nombre: datos.nombre });
  if (!r.ok) return { error: r.error };
  revalidatePath("/barberos");
  redirect(`/barberos/${r.datos.id}`);
}

/** Archivar (activo = false) o restaurar (activo = true) un barbero. */
export async function fijarBarberoActivo(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaFijarActivoBarbero.safeParse({
    id: formulario.get("id")?.toString() ?? "",
    activo: formulario.get("activo")?.toString() === "true",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "No se pudo cambiar el barbero." };

  const r = await ejecutar("fijar_barbero_activo", { p_id: parsed.data.id, p_activo: parsed.data.activo });
  if (!r.ok) return { error: r.error };
  revalidatePath("/barberos");
  redirect("/barberos");
}

/** Deja asignados exactamente los servicios que llegan (campo `servicios`: JSON con la lista completa). */
export async function guardarServiciosBarbero(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  let servicios: unknown;
  try {
    servicios = JSON.parse(formulario.get("servicios")?.toString() ?? "[]");
  } catch {
    return { error: "La lista de servicios no es válida. Recarga la pantalla e intenta de nuevo." };
  }
  const parsed = esquemaServiciosBarbero.safeParse({
    barbero_id: formulario.get("barbero_id")?.toString() ?? "",
    servicios,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los servicios." };

  const r = await ejecutar("asignar_servicios_barbero", {
    p_barbero: parsed.data.barbero_id,
    p_servicios: parsed.data.servicios,
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/barberos");
  redirect(`/barberos/${parsed.data.barbero_id}`);
}
