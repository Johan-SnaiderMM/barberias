import type { CookieOptions } from "@supabase/ssr";

/**
 * Cookies de la sesión de Supabase endurecidas. `@supabase/ssr` las escribe con `httpOnly: false` y sin `secure` porque
 * su cliente del navegador las lee con JavaScript; esta app NUNCA usa ese cliente (todo pasa por el servidor), así que
 * el navegador no las necesita y un script ajeno no debe poder leerlas. En producción solo viajan por HTTPS.
 */
export function cookieDeSesion(opciones: CookieOptions | undefined): CookieOptions {
  return { ...opciones, httpOnly: true, secure: process.env.NODE_ENV === "production" };
}
