/**
 * El enlace público de reservas de una barbería y el texto para compartirlo. Módulo puro (lo usan el servidor y las
 * pruebas): el origen se arma a partir de las cabeceras de la petición, sin leer variables de entorno.
 */

/** "https://app.ejemplo.com" a partir de las cabeceras. Detrás de un proxy (Vercel) manda `x-forwarded-*`. */
export function origenDeCabeceras(cab: { host?: string | null; hostReenviado?: string | null; protoReenviado?: string | null }): string {
  const host = (cab.hostReenviado ?? cab.host ?? "localhost:3000").split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = (cab.protoReenviado ?? (local ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}

/** El enlace que se imprime en el cartel y se manda por WhatsApp. */
export function urlReservas(origen: string, slug: string): string {
  return `${origen.replace(/\/+$/, "")}/reservar/${slug}`;
}

/** Mensaje para mandar el enlace de reservas a los clientes. */
export function mensajeEnlaceReservas(barberia: string, url: string): string {
  return `Reserva tu cita en ${barberia} desde tu celular, sin llamar: ${url}`;
}
