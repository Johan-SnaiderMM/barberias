import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ejecutar = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/datos/llamar", () => ({ ejecutar }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { anularCobro, cobrar } = await import("./caja");

const cobrado = { ok: true, ya_existia: false, id: "c1", total: 15000, cobrado: 15000, vuelto: 5000 };

beforeEach(() => {
  vi.resetAllMocks();
});

function entrada(extra: Record<string, unknown> = {}) {
  return {
    cita_id: randomUUID(),
    barbero_id: null,
    clave: randomUUID(),
    items: [{ servicio_id: randomUUID(), precio: 15000 }],
    descuento: 0,
    descuento_motivo: "",
    propina: 0,
    pagos: [{ medio: "efectivo", monto: 15000, recibido: 20000 }],
    ...extra,
  };
}

describe("cobrar (acción)", () => {
  it("una cita se cobra con cobrar_cita, con la clave y sin motivo cuando no hay descuento", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: cobrado });
    const e = entrada();
    const r = await cobrar(e);
    expect(r).toEqual({ ok: true, datos: cobrado });
    expect(ejecutar).toHaveBeenCalledWith("cobrar_cita", {
      p_cita: e.cita_id,
      p_clave: e.clave,
      p_items: e.items,
      p_descuento: 0,
      p_descuento_motivo: null,
      p_propina: 0,
      p_pagos: e.pagos,
    });
  });

  it("una venta sin cita se cobra con cobrar_venta y su barbero", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: cobrado });
    const barbero = randomUUID();
    await cobrar(entrada({ cita_id: null, barbero_id: barbero, descuento: 500, descuento_motivo: "Promo" }));
    expect(ejecutar).toHaveBeenCalledWith(
      "cobrar_venta",
      expect.objectContaining({ p_barbero: barbero, p_cliente: null, p_descuento: 500, p_descuento_motivo: "Promo" })
    );
  });

  it("refresca la caja, la agenda y la cita después de cobrar", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: cobrado });
    const e = entrada();
    await cobrar(e);
    expect(revalidatePath).toHaveBeenCalledWith("/caja");
    expect(revalidatePath).toHaveBeenCalledWith("/agenda");
    expect(revalidatePath).toHaveBeenCalledWith("/inicio");
    expect(revalidatePath).toHaveBeenCalledWith(`/agenda/cita/${e.cita_id}`);
  });

  it("devuelve el mensaje de la base y no refresca nada si falla", async () => {
    ejecutar.mockResolvedValueOnce({ ok: false, error: "Los pagos suman $ 17.000 y el total a cobrar es $ 18.000." });
    const r = await cobrar(entrada());
    expect(r).toEqual({ ok: false, error: "Los pagos suman $ 17.000 y el total a cobrar es $ 18.000." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("no llama a la base con una entrada que no es válida", async () => {
    const r = await cobrar(entrada({ items: [] }));
    expect(r).toMatchObject({ ok: false });
    expect(ejecutar).not.toHaveBeenCalled();
    expect(await cobrar("cualquier cosa")).toMatchObject({ ok: false });
  });
});

describe("anularCobro (acción)", () => {
  const formulario = (campos: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(campos)) f.set(k, v);
    return f;
  };
  const anulado = { ok: true, id: "c1", cita_id: "cita-1", cita_reabierta: true };

  it("anula con el motivo recortado y refresca la caja, el cobro, la agenda y la cita", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: anulado });
    const id = randomUUID();
    const r = await anularCobro({ error: null }, formulario({ id, motivo: "  Se cobró mal  " }));
    expect(r).toEqual({ error: null });
    expect(ejecutar).toHaveBeenCalledWith("anular_cobro", { p_cobro: id, p_motivo: "Se cobró mal" });
    expect(revalidatePath).toHaveBeenCalledWith("/caja");
    expect(revalidatePath).toHaveBeenCalledWith(`/caja/cobro/${id}`);
    expect(revalidatePath).toHaveBeenCalledWith("/agenda");
    expect(revalidatePath).toHaveBeenCalledWith("/agenda/cita/cita-1");
  });

  it("un cobro sin cita no refresca ninguna cita", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: { ...anulado, cita_id: null, cita_reabierta: false } });
    await anularCobro({ error: null }, formulario({ id: randomUUID(), motivo: "Error" }));
    expect(revalidatePath.mock.calls.some(([ruta]) => String(ruta).startsWith("/agenda/cita/"))).toBe(false);
  });

  it("devuelve el mensaje de la base y no refresca nada si falla", async () => {
    ejecutar.mockResolvedValueOnce({ ok: false, error: "Este cobro ya está anulado." });
    const r = await anularCobro({ error: null }, formulario({ id: randomUUID(), motivo: "Error" }));
    expect(r).toEqual({ error: "Este cobro ya está anulado." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sin motivo, o con un cobro que no es válido, no llama a la base", async () => {
    expect(await anularCobro({ error: null }, formulario({ id: randomUUID(), motivo: "   " }))).toEqual({
      error: "Escribe por qué se anula el cobro.",
    });
    expect(await anularCobro({ error: null }, formulario({ id: "nada", motivo: "Error" }))).toEqual({ error: "El cobro no es válido." });
    expect(await anularCobro({ error: null }, formulario({ id: randomUUID() }))).toEqual({ error: "Escribe por qué se anula el cobro." });
    expect(ejecutar).not.toHaveBeenCalled();
  });
});
