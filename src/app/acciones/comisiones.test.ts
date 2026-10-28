import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ejecutar = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((ruta: string) => {
  throw new Error(`REDIRECT:${ruta}`);
});

vi.mock("@/lib/datos/llamar", () => ({ ejecutar }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

const { fijarPropinaDelBarbero, guardarComisionesBarbero } = await import("./comisiones");

beforeEach(() => {
  vi.resetAllMocks();
  redirect.mockImplementation((ruta: string) => {
    throw new Error(`REDIRECT:${ruta}`);
  });
});

const formulario = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

describe("guardarComisionesBarbero", () => {
  it("manda el porcentaje y las excepciones, refresca la lista y vuelve a ella", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: {} });
    const barbero = randomUUID();
    const servicio = randomUUID();
    await expect(
      guardarComisionesBarbero(
        { error: null },
        formulario({ barbero_id: barbero, pct: "60", excepciones: JSON.stringify([{ servicio_id: servicio, pct: 70 }]) })
      )
    ).rejects.toThrow("REDIRECT:/comisiones/porcentajes");
    expect(ejecutar).toHaveBeenCalledWith("guardar_comisiones_barbero", {
      p_barbero: barbero,
      p_pct: 60,
      p_excepciones: [{ servicio_id: servicio, pct: 70 }],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/comisiones/porcentajes");
  });

  it("sin excepciones manda una lista vacía", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: {} });
    await expect(
      guardarComisionesBarbero({ error: null }, formulario({ barbero_id: randomUUID(), pct: "0" }))
    ).rejects.toThrow("REDIRECT");
    expect(ejecutar).toHaveBeenCalledWith("guardar_comisiones_barbero", expect.objectContaining({ p_pct: 0, p_excepciones: [] }));
  });

  it("devuelve el mensaje de la base y no redirige si falla", async () => {
    ejecutar.mockResolvedValueOnce({ ok: false, error: "No tienes permiso para Comisiones de todos. Pídeselo al dueño." });
    const r = await guardarComisionesBarbero({ error: null }, formulario({ barbero_id: randomUUID(), pct: "50", excepciones: "[]" }));
    expect(r).toEqual({ error: "No tienes permiso para Comisiones de todos. Pídeselo al dueño." });
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["un porcentaje vacío", { pct: "" }, "Escribe un porcentaje válido."],
    ["un porcentaje de más de 100", { pct: "150" }, "La comisión va de 0 % a 100 %."],
    ["un porcentaje que no es número", { pct: "mucho" }, "Escribe un porcentaje válido."],
    ["un barbero que no es válido", { barbero_id: "x" }, "El barbero no es válido."],
    ["una lista de excepciones que no es JSON", { excepciones: "{no" }, "La lista de excepciones no es válida. Recarga la pantalla e intenta de nuevo."],
  ])("no llama a la base con %s", async (_nombre, cambio, esperado) => {
    const r = await guardarComisionesBarbero(
      { error: null },
      formulario({ barbero_id: randomUUID(), pct: "50", excepciones: "[]", ...cambio })
    );
    expect(r).toEqual({ error: esperado });
    expect(ejecutar).not.toHaveBeenCalled();
  });
});

describe("fijarPropinaDelBarbero", () => {
  it.each([["true", true], ["false", false]])("manda %s y refresca la pantalla", async (texto, valor) => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: {} });
    expect(await fijarPropinaDelBarbero({ error: null }, formulario({ del_barbero: texto }))).toEqual({ error: null });
    expect(ejecutar).toHaveBeenCalledWith("fijar_propina_del_barbero", { p_del_barbero: valor });
    expect(revalidatePath).toHaveBeenCalledWith("/comisiones/porcentajes");
  });

  it("sin un valor claro no llama a la base", async () => {
    expect(await fijarPropinaDelBarbero({ error: null }, formulario({}))).toEqual({ error: "Indica de quién es la propina." });
    expect(await fijarPropinaDelBarbero({ error: null }, formulario({ del_barbero: "tal vez" }))).toEqual({ error: "Indica de quién es la propina." });
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("devuelve el error de la base", async () => {
    ejecutar.mockResolvedValueOnce({ ok: false, error: "No se pudo completar." });
    expect(await fijarPropinaDelBarbero({ error: null }, formulario({ del_barbero: "true" }))).toEqual({ error: "No se pudo completar." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
