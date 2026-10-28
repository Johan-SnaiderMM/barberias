"use server";

import { revalidatePath } from "next/cache";
import { puedeVer } from "@/lib/areas";
import { bd } from "@/lib/datos/bd";
import { ejecutar } from "@/lib/datos/llamar";
import type { EstadoForm, Resultado } from "@/lib/errores";
import { esquemaAnularGasto, esquemaGasto } from "@/lib/esquemas/gasto";
import { BUCKET_FOTOS_GASTOS, FOTO_BYTES_MAXIMOS, reconocerImagen, rutaFotoGasto } from "@/lib/gastos";
import { obtenerQuien } from "@/lib/permisos";
import type { Gastado } from "@/lib/tipos/gastos";

/**
 * Registra un gasto, con su foto si la hay (el recibo, ya achicado por el celular). Primero se guarda la foto en el
 * bucket privado, con la clave del gasto como nombre, y después el gasto con su ruta: si algo falla y se reintenta con la
 * misma clave, no queda ni un gasto ni una foto repetidos. No redirige: la pantalla muestra la confirmación.
 */
export async function registrarGasto(formulario: FormData): Promise<Resultado<Gastado>> {
  const parsed = esquemaGasto.safeParse({
    clave: formulario.get("clave")?.toString() ?? "",
    monto: Number(formulario.get("monto")?.toString() || Number.NaN),
    categoria: formulario.get("categoria")?.toString() ?? "",
    medio: formulario.get("medio")?.toString() ?? "",
    nota: formulario.get("nota")?.toString() ?? "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa el gasto." };
  const v = parsed.data;

  let rutaFoto: string | null = null;
  const foto = formulario.get("foto");
  if (foto instanceof File && foto.size > 0) {
    if (foto.size > FOTO_BYTES_MAXIMOS) return { ok: false, error: "La foto pesa demasiado. Toma otra." };
    const { contexto, quien } = await obtenerQuien();
    if (!puedeVer(quien, "gastos")) return { ok: false, error: "No tienes permiso para registrar gastos. Pídeselo al dueño." };

    // Lo que se guarda tiene que SER una foto: se mira el contenido, no el nombre ni el tipo que dijo el navegador.
    const datos = new Uint8Array(await foto.arrayBuffer());
    const tipo = reconocerImagen(datos);
    if (!tipo) return { ok: false, error: "La foto debe ser JPG, PNG o WebP." };
    rutaFoto = rutaFotoGasto(contexto.barberia!.id, v.clave, tipo);
    if (!rutaFoto) return { ok: false, error: "La foto no es válida." };
    const subida = await (await bd()).subirArchivo(BUCKET_FOTOS_GASTOS, rutaFoto, datos, tipo);
    if (subida.error) return { ok: false, error: subida.error };
  }

  const r = await ejecutar<Gastado>("registrar_gasto", {
    p_clave: v.clave,
    p_monto: v.monto,
    p_categoria: v.categoria,
    p_medio: v.medio,
    p_nota: v.nota === "" ? null : v.nota,
    p_foto_ruta: rutaFoto,
  });
  if (!r.ok) return r;

  revalidatePath("/gastos");
  revalidatePath("/cierre");
  revalidatePath("/inicio");
  return r;
}

/** Anula un gasto con motivo. La pantalla se refresca sola. */
export async function anularGasto(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaAnularGasto.safeParse({
    id: formulario.get("id")?.toString() ?? "",
    motivo: formulario.get("motivo")?.toString() ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa el motivo." };

  const r = await ejecutar("anular_gasto", { p_id: parsed.data.id, p_motivo: parsed.data.motivo });
  if (!r.ok) return { error: r.error };

  revalidatePath("/gastos");
  revalidatePath(`/gastos/${parsed.data.id}`);
  revalidatePath("/cierre");
  revalidatePath("/inicio");
  return { error: null };
}
