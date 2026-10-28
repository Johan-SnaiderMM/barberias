import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ejecutar = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/datos/llamar", () => ({ ejecutar }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { anularLiquidacion, liquidar } = await import("./liquidaciones");

beforeEach(() => {
  vi.resetAllMocks();
});

const liquidado = { ok: true, ya_existia: false, id: "liq-1", barbero_id: "b1", total: 20000 };

function entrada(extra: Record<string, unknown> = {}) {
  return { barbero_id: randomUUID(), hasta: "2026-10-14", medio: "efectivo", clave: randomUUID(), nota: "", ...extra };
}

describe("liquidar (acción)", () => {
  it("manda todo a la base, con la nota vacía como nula, y refresca las pantallas", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: liquidado });
    const e = entrada();
    const r = await liquidar(e);
    expect(r).toEqual({ ok: true, datos: liquidado });
    expect(ejecutar).toHaveBeenCalledWith("liquidar_comisiones", {
      p_barbero: e.barbero_id,
      p_hasta: "2026-10-14",
      p_medio: "efectivo",
      p_clave: e.clave,
      p_nota: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/comisiones");
    expect(revalidatePath).toHaveBeenCalledWith(`/comisiones/barbero/${e.barbero_id}`);
    expect(revalidatePath).toHaveBeenCalledWith("/comisiones/liquidacion/liq-1");
    expect(revalidatePath).toHaveBeenCalledWith("/cierre");
  });

  it("manda la nota recortada", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: liquidado });
    await liquidar(entrada({ nota: "  Quincena  ", medio: "transferencia" }));
    expect(ejecutar).toHaveBeenCalledWith("liquidar_comisiones", expect.objectContaining({ p_nota: "Quincena", p_medio: "transferencia" }));
  });

  it("devuelve el mensaje de la base y no refresca nada si falla", async () => {
    ejecutar.mockResolvedValueOnce({ ok: false, error: "No hay nada por liquidar de Camilo hasta el 14/10/2026." });
    const r = await liquidar(entrada());
    expect(r).toEqual({ ok: false, error: "No hay nada por liquidar de Camilo hasta el 14/10/2026." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("no llama a la base con una entrada que no es válida", async () => {
    expect(await liquidar(entrada({ medio: "fiado" }))).toMatchObject({ ok: false });
    expect(await liquidar(entrada({ hasta: "mañana" }))).toMatchObject({ ok: false, error: "La fecha no es válida." });
    expect(await liquidar("cualquier cosa")).toMatchObject({ ok: false });
    expect(ejecutar).not.toHaveBeenCalled();
  });
});

describe("anularLiquidacion (acción)", () => {
  const formulario = (campos: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(campos)) f.set(k, v);
    return f;
  };

  it("anula con el motivo recortado y refresca las pantallas", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: { ok: true, id: "x", cobros: 2 } });
    const id = randomUUID();
    expect(await anularLiquidacion({ error: null }, formulario({ id, motivo: "  Medio equivocado  " }))).toEqual({ error: null });
    expect(ejecutar).toHaveBeenCalledWith("anular_liquidacion", { p_id: id, p_motivo: "Medio equivocado" });
    expect(revalidatePath).toHaveBeenCalledWith("/comisiones");
    expect(revalidatePath).toHaveBeenCalledWith(`/comisiones/liquidacion/${id}`);
    expect(revalidatePath).toHaveBeenCalledWith("/comisiones/barbero/[id]", "page");
  });

  it("devuelve el error de la base sin refrescar", async () => {
    ejecutar.mockResolvedValueOnce({ ok: false, error: "Esta liquidación ya está anulada." });
    expect(await anularLiquidacion({ error: null }, formulario({ id: randomUUID(), motivo: "Error" }))).toEqual({
      error: "Esta liquidación ya está anulada.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sin motivo o con una liquidación inválida no llama a la base", async () => {
    expect(await anularLiquidacion({ error: null }, formulario({ id: randomUUID(), motivo: " " }))).toEqual({
      error: "Escribe por qué se anula la liquidación.",
    });
    expect(await anularLiquidacion({ error: null }, formulario({ id: "no", motivo: "Error" }))).toEqual({ error: "La liquidación no es válida." });
    expect(ejecutar).not.toHaveBeenCalled();
  });
});
