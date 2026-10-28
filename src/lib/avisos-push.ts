/**
 * El texto de los avisos push al personal (reserva nueva y cancelación del cliente). Módulo puro: lo usa el servidor al
 * mandarlos y las pruebas. El aviso lleva el nombre del cliente porque llega solo a celulares del equipo.
 */
import { fechaBogota, fechaCorta, horaCorta } from "@/lib/fechas";

export type TipoAviso = "reserva" | "cancelacion";

export type CitaDeAviso = { id: string; cliente: string; reservo_como?: string | null; servicio: string; barbero: string; inicio: string };

export type AvisoPush = { titulo: string; cuerpo: string; url: string; tag: string };

/**
 * A qué direcciones se le puede mandar un aviso: solo a los servicios push de los navegadores (Chrome, Edge, Opera, Brave y
 * Samsung por FCM; Firefox; Safari; Windows). Es el mismo patrón que la restricción `chk_suscripciones_endpoint` de la
 * migración 0031: una prueba los compara. Así un celular registrado no puede hacer que el servidor escriba a un sitio cualquiera.
 */
export const ENDPOINT_PUSH = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//;

export const esEndpointPush = (url: string): boolean => url.length >= 20 && url.length <= 1000 && ENDPOINT_PUSH.test(url);

/** Espacios normales: las horas salen con espacio fino ("2:35 p. m.") y a un aviso no le hace falta. */
function limpiar(texto: string): string {
  return texto.replace(/[  ]/g, " ");
}

export function armarAviso(tipo: TipoAviso, cita: CitaDeAviso): AvisoPush {
  const cuando = `${fechaCorta(fechaBogota(cita.inicio))}, ${horaCorta(cita.inicio)}`;
  return {
    titulo: tipo === "reserva" ? "Nueva reserva" : "Cita cancelada",
    cuerpo: limpiar(`${cita.cliente}${cita.reservo_como ? ` (reservó como ${cita.reservo_como})` : ""} · ${cita.servicio} · ${cuando} · con ${cita.barbero}`),
    // Al tocar el aviso se abre el detalle de la cita en la app del personal.
    url: `/agenda/cita/${cita.id}`,
    // Un aviso por cita y tipo: si llega repetido, reemplaza al anterior en vez de apilarse.
    tag: `cita-${cita.id}-${tipo}`,
  };
}

/** Convierte la llave pública VAPID (base64 url) en lo que pide `pushManager.subscribe`. */
export function llaveVapidABytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const relleno = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
