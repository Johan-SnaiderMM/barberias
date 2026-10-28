"use server";

import { revalidatePath } from "next/cache";
import { ejecutar } from "@/lib/datos/llamar";
import type { EstadoForm, Resultado } from "@/lib/errores";
import { esquemaAnularCierre, esquemaCerrarDia } from "@/lib/esquemas/cierre";
import type { CierreHecho } from "@/lib/tipos/cierre";

function refrescar() {
  revalidatePath("/cierre");
  revalidatePath("/inicio");
  revalidatePath("/caja");
  revalidatePath("/gastos");
}

/**
 * Cierra un día con el efectivo que se contó. Con la misma `clave` devuelve el cierre que ya se hizo, así un doble
 * toque o un reintento por mala señal no cierra dos veces. No redirige: la pantalla se refresca sola.
 */
export async function cerrarDia(entrada: unknown): Promise<Resultado<CierreHecho>> {
  const parsed = esquemaCerrarDia.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa el cierre." };

  const v = parsed.data;
  const r = await ejecutar<CierreHecho>("registrar_cierre", {
    p_fecha: v.fecha,
    p_efectivo_contado: v.efectivo_contado,
    p_clave: v.clave,
    p_nota: v.nota === "" ? null : v.nota,
  });
  if (!r.ok) return r;

  refrescar();
  return r;
}

/** Anula un cierre con motivo y reabre el día. La pantalla se refresca sola. */
export async function anularCierre(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaAnularCierre.safeParse({
    id: formulario.get("id")?.toString() ?? "",
    motivo: formulario.get("motivo")?.toString() ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa el motivo." };

  const r = await ejecutar("anular_cierre", { p_id: parsed.data.id, p_motivo: parsed.data.motivo });
  if (!r.ok) return { error: r.error };

  refrescar();
  return { error: null };
}
