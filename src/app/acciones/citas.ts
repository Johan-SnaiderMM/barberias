"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutar } from "@/lib/datos/llamar";
import type { EstadoForm } from "@/lib/errores";
import {
  esquemaCambiarEstadoCita,
  esquemaCancelarCita,
  esquemaCitaSinReserva,
  esquemaConsultaHuecos,
  esquemaCrearCita,
  esquemaMoverCita,
  esquemaRecordatorioCita,
} from "@/lib/esquemas/cita";
import { fechaBogota, hoyBogota } from "@/lib/fechas";
import type { AvisoCita, ClienteBuscado, EstadoFormCita, HuecoLibre } from "@/lib/tipos/agenda";

/** Lo que devuelven crear_cita, crear_cita_sin_reserva y mover_cita. */
type RespuestaCita = { ok: boolean; id?: string; motivo?: string; avisos?: AvisoCita[] };

function texto(formulario: FormData, campo: string): string | undefined {
  const v = formulario.get(campo)?.toString().trim() ?? "";
  return v === "" ? undefined : v;
}

/**
 * Agenda una cita. Si cae fuera del horario, sobre un bloqueo o en una hora que ya pasó, NO se guarda y se
 * devuelven los avisos: con el campo `confirmar` = "1" se guarda igual. Una hora ocupada nunca se puede forzar.
 */
export async function crearCita(_anterior: EstadoFormCita, formulario: FormData): Promise<EstadoFormCita> {
  const parsed = esquemaCrearCita.safeParse({
    servicio_id: formulario.get("servicio_id")?.toString() ?? "",
    barbero_id: formulario.get("barbero_id")?.toString() ?? "",
    inicio: formulario.get("inicio")?.toString() ?? "",
    cliente_id: texto(formulario, "cliente_id"),
    cliente_nombre: texto(formulario, "cliente_nombre"),
    cliente_telefono: texto(formulario, "cliente_telefono"),
    notas: texto(formulario, "notas"),
    confirmar: formulario.get("confirmar")?.toString() === "1",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos de la cita." };

  const v = parsed.data;
  const r = await ejecutar<RespuestaCita>("crear_cita", {
    p_barbero: v.barbero_id,
    p_servicio: v.servicio_id,
    p_inicio: v.inicio,
    p_cliente: v.cliente_id ?? null,
    p_cliente_nombre: v.cliente_nombre ?? null,
    p_cliente_telefono: v.cliente_telefono ?? null,
    p_notas: v.notas ?? null,
    p_confirmar: v.confirmar,
  });
  if (!r.ok) return { error: r.error };
  if (!r.datos.ok) return { error: null, avisos: r.datos.avisos ?? [] };

  revalidatePath("/agenda");
  redirect(`/agenda?fecha=${fechaBogota(v.inicio)}`);
}

/** "Llegó sin cita": empieza ahora, en atención. */
export async function crearCitaSinReserva(_anterior: EstadoFormCita, formulario: FormData): Promise<EstadoFormCita> {
  const parsed = esquemaCitaSinReserva.safeParse({
    servicio_id: formulario.get("servicio_id")?.toString() ?? "",
    barbero_id: formulario.get("barbero_id")?.toString() ?? "",
    cliente_id: texto(formulario, "cliente_id"),
    cliente_nombre: texto(formulario, "cliente_nombre"),
    cliente_telefono: texto(formulario, "cliente_telefono"),
    notas: texto(formulario, "notas"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos." };

  const v = parsed.data;
  const r = await ejecutar<RespuestaCita>("crear_cita_sin_reserva", {
    p_barbero: v.barbero_id,
    p_servicio: v.servicio_id,
    p_cliente: v.cliente_id ?? null,
    p_cliente_nombre: v.cliente_nombre ?? null,
    p_cliente_telefono: v.cliente_telefono ?? null,
    p_notas: v.notas ?? null,
  });
  if (!r.ok) return { error: r.error };

  revalidatePath("/agenda");
  redirect(`/agenda?fecha=${hoyBogota()}`);
}

/** Cambia solo la hora de una cita confirmada (con los mismos avisos que al crearla). */
export async function moverCita(_anterior: EstadoFormCita, formulario: FormData): Promise<EstadoFormCita> {
  const parsed = esquemaMoverCita.safeParse({
    id: formulario.get("id")?.toString() ?? "",
    inicio: formulario.get("inicio")?.toString() ?? "",
    confirmar: formulario.get("confirmar")?.toString() === "1",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa la nueva hora." };

  const v = parsed.data;
  const r = await ejecutar<RespuestaCita>("mover_cita", { p_id: v.id, p_inicio: v.inicio, p_confirmar: v.confirmar });
  if (!r.ok) return { error: r.error };
  if (!r.datos.ok) return { error: null, avisos: r.datos.avisos ?? [] };

  revalidatePath("/agenda");
  redirect(`/agenda?fecha=${fechaBogota(v.inicio)}`);
}

/** Cancela una cita con motivo. */
export async function cancelarCita(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaCancelarCita.safeParse({
    id: formulario.get("id")?.toString() ?? "",
    motivo: formulario.get("motivo")?.toString() ?? "",
    volver: texto(formulario, "volver"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa el motivo." };

  const r = await ejecutar("cancelar_cita", { p_id: parsed.data.id, p_motivo: parsed.data.motivo });
  if (!r.ok) return { error: r.error };

  revalidatePath("/agenda");
  redirect(parsed.data.volver ? `/agenda?fecha=${parsed.data.volver}` : "/agenda");
}

/** Empezar, terminar, no llegó, deshacer o reactivar. La pantalla de la cita se refresca sola. */
export async function cambiarEstadoCita(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaCambiarEstadoCita.safeParse({
    id: formulario.get("id")?.toString() ?? "",
    estado: formulario.get("estado")?.toString() ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "No se pudo cambiar la cita." };

  const r = await ejecutar("cambiar_estado_cita", { p_id: parsed.data.id, p_estado: parsed.data.estado });
  if (!r.ok) return { error: r.error };

  revalidatePath("/agenda");
  revalidatePath(`/agenda/cita/${parsed.data.id}`);
  return { error: null };
}

/**
 * Deja constancia de que se abrió el recordatorio por WhatsApp de una cita (`recordatorio_enviado_at`). Se llama
 * al tocar el botón; el mensaje en sí lo envía la persona desde WhatsApp (migración 0014).
 */
export async function registrarRecordatorio(id: string): Promise<EstadoForm> {
  const parsed = esquemaRecordatorioCita.safeParse({ id });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "La cita no es válida." };

  const r = await ejecutar("registrar_recordatorio_cita", { p_id: parsed.data.id });
  if (!r.ok) return { error: r.error };

  revalidatePath("/agenda");
  revalidatePath(`/agenda/cita/${parsed.data.id}`);
  return { error: null };
}

export type RespuestaHuecos = { ok: true; huecos: HuecoLibre[] } | { ok: false; error: string };

/**
 * Horas libres de un día para el formulario (se llama desde el navegador al cambiar servicio, barbero o día).
 * Sin `barbero` ofrece "la primera disponible". `ignorarCita` es la cita que se está moviendo.
 */
export async function obtenerHuecos(
  servicio: string,
  barbero: string | null,
  fecha: string,
  ignorarCita: string | null
): Promise<RespuestaHuecos> {
  const parsed = esquemaConsultaHuecos.safeParse({ servicio, barbero, fecha, ignorarCita });
  if (!parsed.success) return { ok: false, error: "Revisa el servicio y el día." };

  const r = await ejecutar<HuecoLibre[]>("obtener_huecos", {
    p_servicio: parsed.data.servicio,
    p_barbero: parsed.data.barbero,
    p_desde: parsed.data.fecha,
    p_hasta: parsed.data.fecha,
    p_ignorar_cita: parsed.data.ignorarCita,
  });
  return r.ok ? { ok: true, huecos: r.datos } : { ok: false, error: r.error };
}

export type RespuestaClientes = { ok: true; clientes: ClienteBuscado[] } | { ok: false; error: string };

/** Búsqueda de clientes por nombre o celular para el formulario de cita. */
export async function buscarClientes(consulta: string): Promise<RespuestaClientes> {
  const t = consulta.trim().slice(0, 60);
  if (t.length < 2) return { ok: true, clientes: [] };
  const r = await ejecutar<ClienteBuscado[]>("buscar_clientes", { p_texto: t, p_limite: 5 });
  return r.ok ? { ok: true, clientes: r.datos } : { ok: false, error: r.error };
}
