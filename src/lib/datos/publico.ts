import "server-only";
import { consultarPublico } from "@/lib/datos/llamar";
import type { BarberiaPublica, CatalogoPublico, CitaPublica, HuecoPublico } from "@/lib/tipos/reserva";

/** Catálogo público de una barbería por su slug. Nunca lanza por un slug desconocido: `{ existe: false }`. */
export async function obtenerCatalogoPublico(slug: string): Promise<CatalogoPublico> {
  return consultarPublico<CatalogoPublico>("publico_catalogo", { p_slug: slug });
}

/** Quién es la barbería (nombre, dirección y WhatsApp) para los textos legales, o null si el nombre no existe o la base falla. */
export async function obtenerResponsable(slug: string | null): Promise<Pick<BarberiaPublica, "nombre" | "direccion" | "whatsapp"> | null> {
  if (!slug) return null;
  const c = await obtenerCatalogoPublico(slug).catch(() => null);
  return c?.existe ? { nombre: c.barberia.nombre, direccion: c.barberia.direccion, whatsapp: c.barberia.whatsapp } : null;
}

/** Horas a las que se puede mover una cita (los próximos 30 días), mismo barbero y servicio. */
export async function obtenerHuecosDeCita(token: string, desde: string, hasta: string): Promise<HuecoPublico[]> {
  return consultarPublico<HuecoPublico[]>("publico_huecos_cita", { p_token: token, p_desde: desde, p_hasta: hasta });
}

/** La cita de quien tiene el enlace secreto. Un token que no existe da `{ existe: false }`. */
export async function obtenerCitaPublica(token: string): Promise<CitaPublica> {
  // Un texto que no es un uuid ni siquiera llega a la base.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return { existe: false };
  return consultarPublico<CitaPublica>("publico_consultar_cita", { p_token: token });
}
