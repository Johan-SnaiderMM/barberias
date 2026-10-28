"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { bd } from "@/lib/datos/bd";
import { mensajeDeError } from "@/lib/errores";
import { esquemaEntrar } from "@/lib/esquemas/sesion";
import { codigoValido, normalizarCodigo } from "@/lib/invitaciones";

export type EstadoEntrada = { error: string | null };

/**
 * Unirse al equipo con un código de invitación (migración 0013). Si el celular no tiene sesión se le abre una
 * anónima (sin correo ni contraseña) y con ella se canjea el código: desde ahí ese celular es de esa persona, con
 * sus roles. Si el código no sirve, el mensaje de la base (en español) se muestra tal cual.
 */
export async function unirmeAlEquipo(_anterior: EstadoEntrada, formulario: FormData): Promise<EstadoEntrada> {
  const codigo = normalizarCodigo(formulario.get("codigo")?.toString() ?? "");
  if (!codigoValido(codigo)) return { error: "El código tiene 8 letras y números, como K7MP-2XQ9. Revísalo." };

  let base;
  try {
    base = await bd();
  } catch (e) {
    console.error("[sesion] no se pudo abrir la base de datos:", e instanceof Error ? e.message : e);
    return { error: "La app todavía no está configurada." };
  }
  if (!(await base.usuario())) {
    const { error } = await base.entrarAnonimo();
    if (error) return { error };
  }
  // Con la MISMA conexión: la sesión recién abierta todavía no llegó al navegador.
  const { error } = await base.rpc("canjear_invitacion", { p_codigo: codigo });
  if (error) {
    console.error(`[bd] canjear_invitacion falló (${error.codigo}): ${error.mensaje}`);
    return { error: mensajeDeError(error) };
  }
  revalidatePath("/", "layout");
  redirect("/inicio");
}

/**
 * El dueño de una barbería entra con su correo y su contraseña. Su cuenta la crea quien administra, en
 * Supabase, y le da de alta la barbería con `fn_crear_barberia` (migración 0004).
 */
export async function entrarConClave(_anterior: EstadoEntrada, formulario: FormData): Promise<EstadoEntrada> {
  const parsed = esquemaEntrar.safeParse({
    correo: formulario.get("correo")?.toString() ?? "",
    clave: formulario.get("clave")?.toString() ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa el correo y la contraseña." };

  let base;
  try {
    base = await bd();
  } catch (e) {
    // Lo más común: se publicó sin configurar Supabase. El detalle va al registro del servidor, no a la pantalla.
    console.error("[sesion] no se pudo abrir la base de datos:", e instanceof Error ? e.message : e);
    return { error: "La app todavía no está configurada." };
  }
  const { error } = await base.entrarConClave(parsed.data.correo, parsed.data.clave);
  if (error) return { error };
  revalidatePath("/", "layout");
  redirect("/inicio");
}

/**
 * «Probar la demo»: entra a la barbería de demostración sin pedir datos (cuenta y contraseña en variables del
 * servidor). Los datos son inventados y el dueño de la demo puede reiniciarlos desde «Más».
 */
export async function entrarDemo(): Promise<EstadoEntrada> {
  let base;
  try {
    base = await bd();
  } catch (e) {
    console.error("[sesion] no se pudo abrir la base de datos:", e instanceof Error ? e.message : e);
    return { error: "La demo todavía no está configurada. Avisa a quien te la compartió." };
  }
  const { error } = await base.entrarDemo();
  if (error) return { error };
  revalidatePath("/", "layout");
  redirect("/inicio?recorrido=1"); // Inicio arranca el recorrido guiado y limpia la dirección
}

/** Salir: cierra la sesión de este celular y vuelve a /entrar. */
export async function salir(): Promise<void> {
  await (await bd()).salir();
  revalidatePath("/", "layout");
  redirect("/entrar");
}
