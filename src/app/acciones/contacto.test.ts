import { beforeEach, describe, expect, it, vi } from "vitest";

const ejecutar = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((ruta: string) => {
  throw new Error(`REDIRECT:${ruta}`);
});

vi.mock("@/lib/datos/llamar", () => ({ ejecutar }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

const { guardarContacto } = await import("./contacto");

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

describe("guardarContacto", () => {
  it("manda el WhatsApp y la dirección recortados, refresca todo y vuelve a «Más»", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: {} });
    await expect(
      guardarContacto({ error: null }, formulario({ whatsapp: " 300 123 4567 ", direccion: "  Carrera 9 #12-34 " }))
    ).rejects.toThrow("REDIRECT:/mas");
    expect(ejecutar).toHaveBeenCalledWith("actualizar_contacto_barberia", {
      p_whatsapp: "300 123 4567",
      p_direccion: "Carrera 9 #12-34",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("un campo vacío se manda como nulo (quita ese dato)", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: {} });
    await expect(guardarContacto({ error: null }, formulario({ whatsapp: "  ", direccion: "" }))).rejects.toThrow("REDIRECT:/mas");
    expect(ejecutar).toHaveBeenCalledWith("actualizar_contacto_barberia", { p_whatsapp: null, p_direccion: null });
  });

  it("si faltan los campos en el formulario, también quita los datos en vez de fallar", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: {} });
    await expect(guardarContacto({ error: null }, formulario({}))).rejects.toThrow("REDIRECT:/mas");
    expect(ejecutar).toHaveBeenCalledWith("actualizar_contacto_barberia", { p_whatsapp: null, p_direccion: null });
  });

  it("devuelve el mensaje de la base y no refresca ni redirige si la base lo rechaza", async () => {
    ejecutar.mockResolvedValueOnce({
      ok: false,
      error: "El WhatsApp no es válido. Escríbelo con 10 dígitos, por ejemplo 300 123 4567.",
    });
    expect(await guardarContacto({ error: null }, formulario({ whatsapp: "123", direccion: "Calle 1" }))).toEqual({
      error: "El WhatsApp no es válido. Escríbelo con 10 dígitos, por ejemplo 300 123 4567.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["una dirección de más de 120 caracteres", { whatsapp: "", direccion: "x".repeat(121) }, "La dirección es muy larga (máximo 120 caracteres)."],
    ["un WhatsApp de más de 30 caracteres", { whatsapp: "3".repeat(31), direccion: "" }, "El WhatsApp es muy largo."],
  ])("rechaza %s sin llamar a la base", async (_caso, campos, error) => {
    expect(await guardarContacto({ error: null }, formulario(campos))).toEqual({ error });
    expect(ejecutar).not.toHaveBeenCalled();
  });
});
