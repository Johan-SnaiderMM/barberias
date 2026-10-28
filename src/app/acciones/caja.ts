"use server";

import { revalidatePath } from "next/cache";
import { ejecutar } from "@/lib/datos/llamar";
import type { EstadoForm, Resultado } from "@/lib/errores";
import { esquemaAnularCobro, esquemaCobro } from "@/lib/esquemas/cobro";
import type { Anulacion, Cobrado } from "@/lib/tipos/caja";

/**
 * Cobra una cita o una venta sin cita (la base valida todo de nuevo: precios, descuento, que los pagos sumen). Con la
 * misma `clave` devuelve el cobro que ya se hizo, así un doble toque o un reintento por mala señal no cobra dos veces.
 * No redirige: la pantalla muestra la confirmación con el vuelto.
 */
export async function cobrar(entrada: unknown): Promise<Resultado<Cobrado>> {
  const parsed = esquemaCobro.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa el cobro." };

  const v = parsed.data;
  const comunes = {
    p_clave: v.clave,
    p_items: v.items,
    p_descuento: v.descuento,
    p_descuento_motivo: v.descuento_motivo === "" ? null : v.descuento_motivo,
    p_propina: v.propina,
    p_pagos: v.pagos,
  };
  const r = v.cita_id
    ? await ejecutar<Cobrado>("cobrar_cita", { p_cita: v.cita_id, ...comunes })
    : await ejecutar<Cobrado>("cobrar_venta", { p_barbero: v.barbero_id, p_cliente: v.cliente_id ?? null, ...comunes });
  if (!r.ok) return r;

  revalidatePath("/caja");
  revalidatePath("/agenda");
  revalidatePath("/inicio");
  if (v.cita_id) revalidatePath(`/agenda/cita/${v.cita_id}`);
  return r;
}

/**
 * Anula un cobro con motivo. Si era de una cita, la cita se reabre (en atención) para cobrarla bien; el cobro queda
 * en el historial, marcado, y deja de contar en la caja. La pantalla del cobro se refresca sola.
 */
export async function anularCobro(_anterior: EstadoForm, formulario: FormData): Promise<EstadoForm> {
  const parsed = esquemaAnularCobro.safeParse({
    id: formulario.get("id")?.toString() ?? "",
    motivo: formulario.get("motivo")?.toString() ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa el motivo." };

  const r = await ejecutar<Anulacion>("anular_cobro", { p_cobro: parsed.data.id, p_motivo: parsed.data.motivo });
  if (!r.ok) return { error: r.error };

  revalidatePath("/caja");
  revalidatePath(`/caja/cobro/${parsed.data.id}`);
  revalidatePath("/agenda");
  revalidatePath("/inicio");
  if (r.datos.cita_id) revalidatePath(`/agenda/cita/${r.datos.cita_id}`);
  return { error: null };
}
