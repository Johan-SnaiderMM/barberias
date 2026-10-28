"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutar } from "@/lib/datos/llamar";
import type { EstadoForm } from "@/lib/errores";
import { esquemaCliente, esquemaNotaCliente } from "@/lib/esquemas/cliente";

function texto(formulario: FormData, campo: string): string | undefined {
  const v = formulario.get(campo)?.toString().trim() ?? "";
  return v === "" ? undefined : v;
}

/**
 * Crea (sin `id`) o edita (con `id`) un cliente: nombre y celular. El celular se reconoce y normaliza en la base y
 * no se repite dentro de la barbería (si ya es de otro cliente, el mensaje dice de quién).
 */
export async function guardarCliente(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaCliente.safeParse({
    id: texto(formulario, "id"),
    nombre: formulario.get("nombre")?.toString() ?? "",
    telefono: texto(formulario, "telefono"),
    nota: texto(formulario, "nota"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos del cliente." };

  const v = parsed.data;
  if (v.id) {
    const r = await ejecutar("actualizar_cliente", { p_id: v.id, p_nombre: v.nombre, p_telefono: v.telefono ?? null });
    if (!r.ok) return { error: r.error };
    revalidatePath("/clientes");
    redirect(`/clientes/${v.id}`);
  }

  const r = await ejecutar<{ id: string }>("crear_cliente", {
    p_nombre: v.nombre,
    p_telefono: v.telefono ?? null,
    p_nota: v.nota ?? null,
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/clientes");
  redirect(`/clientes/${r.datos.id}`);
}

/** Estado del formulario de la nota: `guardado` = se guardó (para mostrarlo sin salir de la ficha). */
export type EstadoNota = { error: string | null; guardado?: boolean };

/** Guarda la nota del corte del cliente. La escriben recepción y el barbero. */
export async function guardarNotaCliente(_anterior: EstadoNota, formulario: FormData): Promise<EstadoNota> {
  const parsed = esquemaNotaCliente.safeParse({
    id: formulario.get("id")?.toString() ?? "",
    nota: formulario.get("nota")?.toString() ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa la nota." };

  const r = await ejecutar("guardar_nota_cliente", { p_id: parsed.data.id, p_nota: parsed.data.nota });
  if (!r.ok) return { error: r.error };
  revalidatePath(`/clientes/${parsed.data.id}`);
  return { error: null, guardado: true };
}
