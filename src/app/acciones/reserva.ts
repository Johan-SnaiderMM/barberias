"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { ejecutarPublico } from "@/lib/datos/llamar";
import type { EstadoForm } from "@/lib/errores";
import {
  esquemaCancelarPublica,
  esquemaConsultaHuecos,
  esquemaMoverPublica,
  esquemaReserva,
  esquemaToken,
} from "@/lib/esquemas/reserva";
import { hoyBogota, sumarDias } from "@/lib/fechas";
import { avisarAlPersonal } from "@/lib/push";
import type { EstadoReserva, HuecoPublico, RechazoPublico } from "@/lib/tipos/reserva";

/** Días que se piden por vez a la base (la base admite hasta 62). */
const VENTANA_DIAS = 30;

export type RespuestaHuecosPublicos = { ok: true; huecos: HuecoPublico[] } | { ok: false; error: string };

/**
 * Horas libres de un servicio (con un barbero o "el primero disponible"), desde hoy + `desde` días y por 30 días.
 * La calcula la base (`publico_huecos`): aquí no hay otra versión.
 */
export async function huecosPublicos(
  slug: string,
  servicio: string,
  barbero: string | null,
  desde: number
): Promise<RespuestaHuecosPublicos> {
  const parsed = esquemaConsultaHuecos.safeParse({ slug, servicio, barbero, desde });
  if (!parsed.success) return { ok: false, error: "Revisa el servicio y el barbero." };

  const inicio = sumarDias(hoyBogota(), parsed.data.desde);
  const r = await ejecutarPublico<HuecoPublico[]>("publico_huecos", {
    p_slug: parsed.data.slug,
    p_servicio: parsed.data.servicio,
    p_barbero: parsed.data.barbero,
    p_desde: inicio,
    p_hasta: sumarDias(inicio, VENTANA_DIAS),
  });
  return r.ok ? { ok: true, huecos: r.datos } : { ok: false, error: r.error };
}

type RespuestaReserva = { ok: true; token: string } | RechazoPublico;

/** Reserva sin cuenta. Si sale, lleva al cliente a su cita (`/cita/<token>`); si no, devuelve el motivo. */
export async function reservar(_anterior: EstadoReserva, formulario: FormData): Promise<EstadoReserva> {
  const barbero = formulario.get("barbero_id")?.toString() ?? "";
  const parsed = esquemaReserva.safeParse({
    slug: formulario.get("slug")?.toString() ?? "",
    servicio_id: formulario.get("servicio_id")?.toString() ?? "",
    barbero_id: barbero === "" ? null : barbero,
    inicio: formulario.get("inicio")?.toString() ?? "",
    nombre: formulario.get("nombre")?.toString() ?? "",
    telefono: formulario.get("telefono")?.toString() ?? "",
    consentimiento: formulario.get("consentimiento")?.toString() === "1",
    web: formulario.get("web")?.toString() ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa tus datos." };

  const v = parsed.data;
  const r = await ejecutarPublico<RespuestaReserva>("publico_reservar", {
    p_slug: v.slug,
    p_servicio: v.servicio_id,
    p_barbero: v.barbero_id,
    p_inicio: v.inicio,
    p_nombre: v.nombre,
    p_telefono: v.telefono,
    p_consentimiento: v.consentimiento,
    p_web: v.web === "" ? null : v.web,
  });
  if (!r.ok) return { error: r.error };
  if (!r.datos.ok) return { error: r.datos.mensaje, motivo: r.datos.motivo };

  // El aviso al personal sale DESPUÉS de responderle al cliente: nunca lo hace esperar ni fallar.
  const token = r.datos.token;
  after(() => avisarAlPersonal(token, "reserva"));
  redirect(`/cita/${token}?nueva=1`);
}

/** Las horas a las que se puede mover ESA cita (mismo barbero y servicio). */
export async function huecosDeMiCita(token: string, desde: number): Promise<RespuestaHuecosPublicos> {
  const parsed = esquemaToken.safeParse({ token });
  if (!parsed.success) return { ok: false, error: "El enlace de la cita no es válido." };
  const inicio = sumarDias(hoyBogota(), Math.min(Math.max(desde, 0), 90));
  const r = await ejecutarPublico<HuecoPublico[]>("publico_huecos_cita", {
    p_token: parsed.data.token,
    p_desde: inicio,
    p_hasta: sumarDias(inicio, VENTANA_DIAS),
  });
  return r.ok ? { ok: true, huecos: r.datos } : { ok: false, error: r.error };
}

/** Cancela la cita desde el enlace (hasta el límite de la barbería). */
export async function cancelarMiCita(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaCancelarPublica.safeParse({
    token: formulario.get("token")?.toString() ?? "",
    motivo: formulario.get("motivo")?.toString() ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "No se pudo cancelar." };

  const r = await ejecutarPublico<{ ok: true } | RechazoPublico>("publico_cancelar_cita", {
    p_token: parsed.data.token,
    p_motivo: parsed.data.motivo === "" ? null : parsed.data.motivo,
  });
  if (!r.ok) return { error: r.error };
  if (!r.datos.ok) return { error: r.datos.mensaje };

  const token = parsed.data.token;
  after(() => avisarAlPersonal(token, "cancelacion"));
  revalidatePath(`/cita/${token}`);
  redirect(`/cita/${token}`);
}

/** Cambia la hora de la cita desde el enlace. Si la hora ya la tomaron, devuelve el motivo para recargar las horas. */
export async function moverMiCita(_anterior: EstadoReserva, formulario: FormData): Promise<EstadoReserva> {
  const parsed = esquemaMoverPublica.safeParse({
    token: formulario.get("token")?.toString() ?? "",
    inicio: formulario.get("inicio")?.toString() ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Elige la nueva hora." };

  const r = await ejecutarPublico<{ ok: true } | RechazoPublico>("publico_reprogramar_cita", {
    p_token: parsed.data.token,
    p_inicio: parsed.data.inicio,
  });
  if (!r.ok) return { error: r.error };
  if (!r.datos.ok) return { error: r.datos.mensaje, motivo: r.datos.motivo };

  revalidatePath(`/cita/${parsed.data.token}`);
  redirect(`/cita/${parsed.data.token}?movida=1`);
}
