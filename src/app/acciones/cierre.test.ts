import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ejecutar = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/datos/llamar", () => ({ ejecutar }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { anularCierre, cerrarDia } = await import("./cierre");

beforeEach(() => {
  vi.resetAllMocks();
});

const cerrado = { ok: true, ya_existia: false, id: "c1", fecha: "2026-10-14", diferencia: -500 };
const entrada = (extra: Record<string, unknown> = {}) => ({ fecha: "2026-10-14", efectivo_contado: 13000, clave: randomUUID(), nota: "", ...extra });

describe("cerrarDia (acción)", () => {
  it("manda el día, lo contado y la clave, con la nota vacía como nula, y refresca las pantallas", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: cerrado });
    const e = entrada();
    expect(await cerrarDia(e)).toEqual({ ok: true, datos: cerrado });
    expect(ejecutar).toHaveBeenCalledWith("registrar_cierre", { p_fecha: "2026-10-14", p_efectivo_contado: 13000, p_clave: e.clave, p_nota: null });
    for (const ruta of ["/cierre", "/inicio", "/caja", "/gastos"]) expect(revalidatePath).toHaveBeenCalledWith(ruta);
  });

  it("acepta contar cero y manda la nota recortada", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: cerrado });
    await cerrarDia(entrada({ efectivo_contado: 0, nota: "  Billete roto  " }));
    expect(ejecutar).toHaveBeenCalledWith("registrar_cierre", expect.objectContaining({ p_efectivo_contado: 0, p_nota: "Billete roto" }));
  });

  it("devuelve el mensaje de la base y no refresca nada si falla", async () => {
    ejecutar.mockResolvedValueOnce({ ok: false, error: "El 14/10/2026 ya está cerrado." });
    expect(await cerrarDia(entrada())).toEqual({ ok: false, error: "El 14/10/2026 ya está cerrado." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["una fecha que no existe", { fecha: "2026-02-30" }, "La fecha no es válida."],
    ["efectivo negativo", { efectivo_contado: -1 }, "Escribe cuánto efectivo contaste (desde $ 0)."],
    ["efectivo con decimales", { efectivo_contado: 10.5 }, "Los pesos van enteros."],
    ["efectivo que no es número", { efectivo_contado: Number.NaN }, "Escribe cuánto efectivo contaste."],
    ["una clave inválida", { clave: "x" }, "Recarga la pantalla e intenta de nuevo."],
    ["una nota larguísima", { nota: "x".repeat(201) }, "La nota es muy larga (máximo 200 letras)."],
  ])("no llama a la base con %s", async (_nombre, cambio, esperado) => {
    expect(await cerrarDia(entrada(cambio))).toEqual({ ok: false, error: esperado });
    expect(await cerrarDia("cualquier cosa")).toMatchObject({ ok: false });
    expect(ejecutar).not.toHaveBeenCalled();
  });
});

describe("anularCierre (acción)", () => {
  const formulario = (campos: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(campos)) f.set(k, v);
    return f;
  };

  it("anula con el motivo recortado y refresca", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: { ok: true } });
    const id = randomUUID();
    expect(await anularCierre({ error: null }, formulario({ id, motivo: "  Conté mal  " }))).toEqual({ error: null });
    expect(ejecutar).toHaveBeenCalledWith("anular_cierre", { p_id: id, p_motivo: "Conté mal" });
    expect(revalidatePath).toHaveBeenCalledWith("/cierre");
  });

  it("devuelve el error de la base sin refrescar", async () => {
    ejecutar.mockResolvedValueOnce({ ok: false, error: "Para anular el cierre del 13/10/2026, primero anula el del 14/10/2026." });
    expect(await anularCierre({ error: null }, formulario({ id: randomUUID(), motivo: "Error" }))).toEqual({
      error: "Para anular el cierre del 13/10/2026, primero anula el del 14/10/2026.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sin motivo o con un cierre inválido no llama a la base", async () => {
    expect(await anularCierre({ error: null }, formulario({ id: randomUUID(), motivo: " " }))).toEqual({ error: "Escribe por qué se anula el cierre." });
    expect(await anularCierre({ error: null }, formulario({ id: "no", motivo: "Error" }))).toEqual({ error: "El cierre no es válido." });
    expect(ejecutar).not.toHaveBeenCalled();
  });
});
