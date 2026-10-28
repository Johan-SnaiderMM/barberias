"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutar } from "@/lib/datos/llamar";
import type { EstadoForm } from "@/lib/errores";
import { esquemaAjustes, esquemaBloqueo, esquemaHorario } from "@/lib/esquemas/horario";
import { instanteBogota } from "@/lib/fechas";
import type { CitaAfectada, EstadoBloqueo } from "@/lib/tipos/agenda";

/** Deja el horario semanal del barbero con exactamente las franjas que llegan (campo `franjas`: JSON). */
export async function guardarHorario(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  let franjas: unknown;
  try {
    franjas = JSON.parse(formulario.get("franjas")?.toString() ?? "[]");
  } catch {
    return { error: "El horario no es válido. Recarga la pantalla e intenta de nuevo." };
  }
  const parsed = esquemaHorario.safeParse({ barbero_id: formulario.get("barbero_id")?.toString() ?? "", franjas });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa el horario." };

  const r = await ejecutar("guardar_horario_barbero", {
    p_barbero: parsed.data.barbero_id,
    p_franjas: parsed.data.franjas,
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/barberos");
  redirect(`/barberos/${parsed.data.barbero_id}`);
}

/**
 * Bloquea tiempo de un barbero: días completos o unas horas. Las fechas llegan como día de Bogotá.
 * Si el rato cae sobre citas, NO se guarda y se devuelven las citas: con el campo `confirmar` = "1" se guarda igual
 * (las citas quedan como están: alguien las mueve o las cancela).
 */
export async function crearBloqueo(_anterior: EstadoBloqueo, formulario: FormData): Promise<EstadoBloqueo> {
  const numero = (campo: string): number | undefined => {
    const v = formulario.get(campo)?.toString() ?? "";
    return v === "" ? undefined : Number(v);
  };
  const texto = (campo: string): string | undefined => {
    const v = formulario.get(campo)?.toString().trim() ?? "";
    return v === "" ? undefined : v;
  };

  const parsed = esquemaBloqueo.safeParse({
    barbero_id: formulario.get("barbero_id")?.toString() ?? "",
    tipo: formulario.get("tipo")?.toString() ?? "",
    fecha: formulario.get("fecha")?.toString() ?? "",
    fecha_fin: texto("fecha_fin"),
    desde: numero("desde"),
    hasta: numero("hasta"),
    motivo: texto("motivo"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos del bloqueo." };

  const b = parsed.data;
  const inicio = instanteBogota(b.fecha, b.tipo === "dia" ? 0 : b.desde!);
  const fin = instanteBogota(b.tipo === "dia" ? (b.fecha_fin ?? b.fecha) : b.fecha, b.tipo === "dia" ? 1440 : b.hasta!);

  const r = await ejecutar<{ ok: boolean; motivo?: string; citas: CitaAfectada[] }>("crear_bloqueo", {
    p_barbero: b.barbero_id,
    p_inicio: inicio,
    p_fin: fin,
    p_motivo: b.motivo ?? null,
    p_confirmar: formulario.get("confirmar")?.toString() === "1",
  });
  if (!r.ok) return { error: r.error };
  if (!r.datos.ok) return { error: null, citas: r.datos.citas };

  revalidatePath(`/barberos/${b.barbero_id}/bloqueos`);
  redirect(`/barberos/${b.barbero_id}/bloqueos`);
}

/** Quita un bloqueo (queda inactivo, no se borra). */
export async function quitarBloqueo(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const id = formulario.get("id")?.toString() ?? "";
  const barbero = formulario.get("barbero_id")?.toString() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(barbero)) return { error: "El bloqueo no es válido." };

  const r = await ejecutar("quitar_bloqueo", { p_id: id });
  if (!r.ok) return { error: r.error };
  revalidatePath(`/barberos/${barbero}/bloqueos`);
  redirect(`/barberos/${barbero}/bloqueos`);
}

/** Ajustes de la agenda de la barbería (paso, días adelante, anticipación y descanso entre citas). */
export async function guardarAjustes(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaAjustes.safeParse({
    paso_min: Number(formulario.get("paso_min")?.toString() ?? ""),
    dias_adelante: Number(formulario.get("dias_adelante")?.toString() ?? ""),
    anticipacion_min: Number(formulario.get("anticipacion_min")?.toString() ?? ""),
    colchon_min: Number(formulario.get("colchon_min")?.toString() ?? ""),
    // Una casilla sin marcar no viaja en el formulario.
    reservas_en_linea: formulario.get("reservas_en_linea")?.toString() === "1",
    cancelar_hasta_horas: Number(formulario.get("cancelar_hasta_horas")?.toString() ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los ajustes." };

  const r = await ejecutar("actualizar_parametros_agenda", {
    p_paso_min: parsed.data.paso_min,
    p_dias_adelante: parsed.data.dias_adelante,
    p_anticipacion_min: parsed.data.anticipacion_min,
    p_colchon_min: parsed.data.colchon_min,
    p_reservas_en_linea: parsed.data.reservas_en_linea,
    p_cancelar_hasta_horas: parsed.data.cancelar_hasta_horas,
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/", "layout");
  redirect("/mas");
}
