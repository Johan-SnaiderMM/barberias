import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { cookieDeSesion } from "./cookies";

export type ErrorBD = { codigo: string; mensaje: string };
export type RespuestaBD<T> = { data: T; error: null } | { data: null; error: ErrorBD };
export type UsuarioBD = { id: string; email: string | null };

/**
 * Lo único que la app necesita de la base de datos. Hay dos implementaciones con la misma forma:
 *  - Supabase (producción y desarrollo normal).
 *  - PGlite (DEMO_BD=local, solo fuera de producción) para desarrollar sin cuenta de Supabase; y la misma base abierta
 *    al público (DEMO_PUBLICA=1) con datos ficticios: en memoria o, con DATABASE_URL, en un Postgres compartido.
 * Toda la app habla con la base SOLO por funciones RPC (ver supabase/migrations).
 */
export interface BaseDatos {
  rpc<T = unknown>(nombre: string, args?: Record<string, unknown>): Promise<RespuestaBD<T>>;
  /** Usuario de la sesión actual, verificado (null si no hay sesión). */
  usuario(): Promise<UsuarioBD | null>;
  /** El dueño entra con su correo y su contraseña. Devuelve un mensaje listo para mostrar si falla. */
  entrarConClave(correo: string, clave: string): Promise<{ error: string | null }>;
  /**
   * «Probar la demo»: entra a la barbería de demostración sin pedir datos. El correo y la contraseña de la demo viven
   * solo en variables del servidor (DEMO_EMAIL y DEMO_PASSWORD); en el modo local es una cuenta de prueba.
   */
  entrarDemo(): Promise<{ error: string | null }>;
  /**
   * Abre una sesión anónima en este celular (sin correo ni contraseña): la usa quien entra al equipo con un código
   * de invitación. Después de esto, `rpc` ya va con esa sesión.
   */
  entrarAnonimo(): Promise<{ error: string | null }>;
  salir(): Promise<void>;
  /**
   * Guarda un archivo en un bucket PRIVADO con la sesión actual (las políticas del bucket mandan: cada barbería solo
   * escribe en su carpeta). Subir otra vez la misma ruta no es un error: el nombre lleva la clave de la operación, así
   * un reintento por mala señal no falla. Devuelve un mensaje listo para mostrar si no se pudo.
   */
  subirArchivo(bucket: string, ruta: string, datos: Uint8Array, tipo: string): Promise<{ error: string | null }>;
  /** Lee un archivo de un bucket privado con la sesión actual; null si no existe o no hay permiso. */
  leerArchivo(bucket: string, ruta: string): Promise<{ datos: Uint8Array; tipo: string } | null>;
}

/**
 * Demo pública: la base del modo local abierta al público, con datos ficticios y sin cuentas de Supabase. Hay que pedirla
 * con DEMO_PUBLICA=1; sin esa variable no existe. Sin DATABASE_URL vive en la memoria de UN solo proceso; con DATABASE_URL
 * (ver usarDemoCompartida) vive en una base Postgres compartida.
 */
export function usarDemoPublica(): boolean {
  return process.env.DEMO_PUBLICA === "1";
}

/**
 * Demo pública sobre una base Postgres compartida (p. ej. Neon). Es la que sirve en un servidor sin estado como Vercel:
 * ahí cada petición puede caer en una copia distinta de la app, y una base en memoria por copia no es coherente.
 */
export function usarDemoCompartida(): boolean {
  return usarDemoPublica() && Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * El modo local de desarrollo solo existe fuera de producción: en producción `process.env.NODE_ENV` es constante y esa
 * parte se elimina. La única excepción es la demo pública, que se enciende a propósito con DEMO_PUBLICA=1.
 */
export function usarBdLocal(): boolean {
  return usarDemoPublica() || (process.env.NODE_ENV !== "production" && process.env.DEMO_BD === "local");
}

export async function abrirBD(): Promise<BaseDatos> {
  if (usarBdLocal()) {
    const { crearBdLocal } = await import("@/lib/local/bd-local");
    return crearBdLocal();
  }
  return crearBdSupabase();
}

async function crearBdSupabase(): Promise<BaseDatos> {
  const url = process.env.SUPABASE_URL;
  const llave = process.env.SUPABASE_ANON_KEY;
  if (!url || !llave) {
    throw new Error("Falta configurar Supabase: SUPABASE_URL y SUPABASE_ANON_KEY (ver .env.example).");
  }

  const almacen = await cookies();
  const supabase = createServerClient(url, llave, {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) almacen.set(name, value, cookieDeSesion(options));
        } catch {
          // Desde un Server Component no se pueden escribir cookies: proxy.ts ya refresca la sesión.
        }
      },
    },
  });

  // Un solo camino para el correo y la contraseña, del dueño o de la demo.
  async function entrar(correo: string, clave: string): Promise<{ error: string | null }> {
    const { error } = await supabase.auth.signInWithPassword({ email: correo, password: clave });
    if (!error) return { error: null };
    if (error.code === "invalid_credentials") return { error: "El correo o la contraseña no coinciden. Revísalos." };
    if (error.status === 429 || error.code === "over_request_rate_limit") {
      return { error: "Demasiados intentos. Espera unos minutos y vuelve a probar." };
    }
    console.error(`[bd] entrar con contraseña falló: ${error.status ?? "?"} ${error.code ?? ""} ${error.message}`);
    return { error: "No se pudo entrar. Intenta de nuevo en un momento." };
  }

  return {
    async rpc<T>(nombre: string, args: Record<string, unknown> = {}): Promise<RespuestaBD<T>> {
      const { data, error } = await supabase.rpc(nombre, args);
      if (error) return { data: null, error: { codigo: error.code ?? "", mensaje: error.message } };
      return { data: data as T, error: null };
    },

    async usuario() {
      // getClaims verifica la firma del token localmente (sin viaje a la red) y refresca si está por vencer.
      const { data } = await supabase.auth.getClaims();
      const claims = data?.claims;
      return claims?.sub ? { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null } : null;
    },

    entrarConClave: entrar,

    async entrarDemo() {
      const correo = process.env.DEMO_EMAIL?.trim();
      const clave = process.env.DEMO_PASSWORD;
      if (!correo || !clave) return { error: "La demo todavía no está configurada. Avisa a quien te la compartió." };
      const r = await entrar(correo, clave);
      // Si la cuenta de la demo no sirve, el mensaje de «correo o contraseña» no le toca al visitante.
      return r.error?.startsWith("El correo o la contraseña")
        ? { error: "La demo no está disponible en este momento. Avisa a quien te la compartió." }
        : r;
    },

    async entrarAnonimo() {
      const { error } = await supabase.auth.signInAnonymously();
      if (!error) return { error: null };
      console.error(`[bd] sesión anónima falló: ${error.status ?? "?"} ${error.code ?? ""} ${error.message}`);
      // Supabase la trae apagada por defecto: hay que encender "Allow anonymous sign-ins" (ver .env.example).
      if (error.code === "anonymous_provider_disabled") {
        return { error: "Las invitaciones todavía no están encendidas en el servidor. Avísale a quien te invitó." };
      }
      return { error: "No se pudo preparar este celular. Intenta de nuevo en un momento." };
    },

    async salir() {
      await supabase.auth.signOut();
    },

    async subirArchivo(bucket, ruta, datos, tipo) {
      const { error } = await supabase.storage.from(bucket).upload(ruta, datos, { contentType: tipo, upsert: false });
      if (!error) return { error: null };
      const detalle = error as { statusCode?: string; message?: string };
      // El archivo ya estaba (un reintento con la misma clave): sirve igual.
      if (detalle.statusCode === "409" || /already exists|duplicate/i.test(detalle.message ?? "")) return { error: null };
      console.error(`[bd] subir ${bucket}/${ruta} falló: ${detalle.statusCode ?? "?"} ${detalle.message ?? ""}`);
      return { error: "No se pudo guardar la foto. Intenta de nuevo en un momento." };
    },

    async leerArchivo(bucket, ruta) {
      const { data, error } = await supabase.storage.from(bucket).download(ruta);
      if (error || !data) return null;
      return { datos: new Uint8Array(await data.arrayBuffer()), tipo: data.type || "application/octet-stream" };
    },
  };
}
