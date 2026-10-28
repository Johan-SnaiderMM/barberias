"use server";

import { revalidatePath } from "next/cache";
import { ejecutar } from "@/lib/datos/llamar";
import type { EstadoForm, Resultado } from "@/lib/errores";
import { esquemaAnularLiquidacion, esquemaLiquidar } from "@/lib/esquemas/liquidacion";
import type { Liquidado } from "@/lib/tipos/liquidaciones";

function refrescar(barbero?: string, liquidacion?: string) {
  revalidatePath("/comisiones");
  revalidatePath("/inicio");
  revalidatePath("/cierre");
  if (barbero) revalidatePath(`/comisiones/barbero/${barbero}`);
  if (liquidacion) revalidatePath(`/comisiones/liquidacion/${liquidacion}`);
}

/**
 * Le paga a un barbero todo lo que se le debe hasta un día. Con la misma `clave` devuelve la liquidación que ya se
 * hizo, así un doble toque o un reintento por mala señal no paga dos veces. No redirige: la pantalla decide a dónde ir.
 */
export async function liquidar(entrada: unknown): Promise<Resultado<Liquidado>> {
  const parsed = esquemaLiquidar.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa la liquidación." };

  const v = parsed.data;
  const r = await ejecutar<Liquidado>("liquidar_comisiones", {
    p_barbero: v.barbero_id,
    p_hasta: v.hasta,
    p_medio: v.medio,
    p_clave: v.clave,
    p_nota: v.nota === "" ? null : v.nota,
  });
  if (!r.ok) return r;

  refrescar(v.barbero_id, r.datos.id);
  return r;
}

/** Anula una liquidación con motivo: sus cobros vuelven a estar pendientes. La pantalla se refresca sola. */
export async function anularLiquidacion(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaAnularLiquidacion.safeParse({
    id: formulario.get("id")?.toString() ?? "",
    motivo: formulario.get("motivo")?.toString() ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa el motivo." };

  const r = await ejecutar("anular_liquidacion", { p_id: parsed.data.id, p_motivo: parsed.data.motivo });
  if (!r.ok) return { error: r.error };

  refrescar(undefined, parsed.data.id);
  // Los cobros que estaban en la liquidación vuelven a salir en la pantalla de su barbero.
  revalidatePath("/comisiones/barbero/[id]", "page");
  return { error: null };
}
