import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FOTO_BYTES_MAXIMOS } from "@/lib/gastos";

const ejecutar = vi.fn();
const revalidatePath = vi.fn();
const subirArchivo = vi.fn();
const obtenerQuien = vi.fn();
const bd = vi.fn(async () => ({ subirArchivo }));

vi.mock("@/lib/datos/llamar", () => ({ ejecutar }));
vi.mock("@/lib/datos/bd", () => ({ bd }));
vi.mock("@/lib/permisos", () => ({ obtenerQuien }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { anularGasto, registrarGasto } = await import("./gastos");

const BARBERIA = randomUUID();
const gastado = { ok: true, ya_existia: false, id: "g1", monto: 45000, categoria: "insumos", medio: "efectivo", fecha: "2026-10-14", con_foto: false, anulado: false };
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);

beforeEach(() => {
  vi.resetAllMocks();
  bd.mockImplementation(async () => ({ subirArchivo }));
  obtenerQuien.mockResolvedValue({ contexto: { barberia: { id: BARBERIA } }, quien: { areas: ["gastos"] } });
  subirArchivo.mockResolvedValue({ error: null });
});

function formulario(campos: Record<string, string | File> = {}) {
  const f = new FormData();
  const base: Record<string, string | File> = { clave: randomUUID(), monto: "45000", categoria: "insumos", medio: "efectivo", nota: "", ...campos };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

describe("registrarGasto", () => {
  it("sin foto: manda todo a la base y refresca las pantallas, sin tocar el almacenamiento", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: gastado });
    const f = formulario({ nota: "  Toallas  " });
    expect(await registrarGasto(f)).toEqual({ ok: true, datos: gastado });
    expect(ejecutar).toHaveBeenCalledWith("registrar_gasto", {
      p_clave: f.get("clave"),
      p_monto: 45000,
      p_categoria: "insumos",
      p_medio: "efectivo",
      p_nota: "Toallas",
      p_foto_ruta: null,
    });
    expect(subirArchivo).not.toHaveBeenCalled();
    expect(obtenerQuien).not.toHaveBeenCalled();
    for (const ruta of ["/gastos", "/cierre", "/inicio"]) expect(revalidatePath).toHaveBeenCalledWith(ruta);
  });

  it("la nota vacía se manda como nula", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: gastado });
    await registrarGasto(formulario({ nota: "   " }));
    expect(ejecutar).toHaveBeenCalledWith("registrar_gasto", expect.objectContaining({ p_nota: null }));
  });

  it("con foto: la sube al bucket privado con la clave como nombre y manda su ruta", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: { ...gastado, con_foto: true } });
    const f = formulario({ foto: new File([JPEG], "recibo.jpg", { type: "image/jpeg" }) });
    const r = await registrarGasto(f);
    expect(r).toMatchObject({ ok: true });
    const ruta = `${BARBERIA}/${f.get("clave")}.jpg`;
    expect(subirArchivo).toHaveBeenCalledWith("gastos-fotos", ruta, JPEG, "image/jpeg");
    expect(ejecutar).toHaveBeenCalledWith("registrar_gasto", expect.objectContaining({ p_foto_ruta: ruta }));
  });

  it("el tipo sale del contenido, no de lo que diga el navegador", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: gastado });
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const f = formulario({ foto: new File([png], "x.jpg", { type: "image/jpeg" }) });
    await registrarGasto(f);
    expect(subirArchivo).toHaveBeenCalledWith("gastos-fotos", `${BARBERIA}/${f.get("clave")}.png`, png, "image/png");
  });

  it("algo que no es una foto, aunque diga serlo, no se sube ni se registra", async () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const r = await registrarGasto(formulario({ foto: new File([html], "recibo.jpg", { type: "image/jpeg" }) }));
    expect(r).toEqual({ ok: false, error: "La foto debe ser JPG, PNG o WebP." });
    expect(subirArchivo).not.toHaveBeenCalled();
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("una foto demasiado pesada se rechaza antes de leerla", async () => {
    const pesada = new File([new Uint8Array(FOTO_BYTES_MAXIMOS + 1)], "grande.jpg", { type: "image/jpeg" });
    expect(await registrarGasto(formulario({ foto: pesada }))).toEqual({ ok: false, error: "La foto pesa demasiado. Toma otra." });
    expect(subirArchivo).not.toHaveBeenCalled();
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("sin el área gastos no se sube nada", async () => {
    obtenerQuien.mockResolvedValue({ contexto: { barberia: { id: BARBERIA } }, quien: { areas: ["caja"] } });
    const r = await registrarGasto(formulario({ foto: new File([JPEG], "r.jpg", { type: "image/jpeg" }) }));
    expect(r).toEqual({ ok: false, error: "No tienes permiso para registrar gastos. Pídeselo al dueño." });
    expect(subirArchivo).not.toHaveBeenCalled();
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("si la foto no se puede guardar, devuelve el aviso y no registra el gasto", async () => {
    subirArchivo.mockResolvedValue({ error: "No se pudo guardar la foto. Intenta de nuevo en un momento." });
    const r = await registrarGasto(formulario({ foto: new File([JPEG], "r.jpg", { type: "image/jpeg" }) }));
    expect(r).toEqual({ ok: false, error: "No se pudo guardar la foto. Intenta de nuevo en un momento." });
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("devuelve el mensaje de la base y no refresca nada si falla", async () => {
    ejecutar.mockResolvedValueOnce({ ok: false, error: "Elige la categoría del gasto." });
    expect(await registrarGasto(formulario())).toEqual({ ok: false, error: "Elige la categoría del gasto." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["sin valor", { monto: "" }, "Escribe cuánto fue el gasto."],
    ["con un valor que no es número", { monto: "mucho" }, "Escribe cuánto fue el gasto."],
    ["con valor cero", { monto: "0" }, "Escribe cuánto fue el gasto."],
    ["sin categoría", { categoria: "" }, "Elige la categoría del gasto."],
    ["con un medio raro", { medio: "fiado" }, "Elige cómo se pagó el gasto: efectivo o transferencia."],
    ["con una clave inválida", { clave: "x" }, "Recarga la pantalla e intenta de nuevo."],
    ["con una nota larguísima", { nota: "x".repeat(130) }, "La nota es muy larga (máximo 120 letras)."],
  ])("no llama a la base %s", async (_nombre, cambio, esperado) => {
    expect(await registrarGasto(formulario(cambio))).toEqual({ ok: false, error: esperado });
    expect(ejecutar).not.toHaveBeenCalled();
    expect(subirArchivo).not.toHaveBeenCalled();
  });
});

describe("anularGasto", () => {
  const motivo = (campos: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(campos)) f.set(k, v);
    return f;
  };

  it("anula con el motivo recortado y refresca las pantallas", async () => {
    ejecutar.mockResolvedValueOnce({ ok: true, datos: { ok: true, id: "g" } });
    const id = randomUUID();
    expect(await anularGasto({ error: null }, motivo({ id, motivo: "  Duplicado  " }))).toEqual({ error: null });
    expect(ejecutar).toHaveBeenCalledWith("anular_gasto", { p_id: id, p_motivo: "Duplicado" });
    for (const ruta of ["/gastos", `/gastos/${id}`, "/cierre", "/inicio"]) expect(revalidatePath).toHaveBeenCalledWith(ruta);
  });

  it("devuelve el error de la base sin refrescar", async () => {
    ejecutar.mockResolvedValueOnce({ ok: false, error: "Este gasto ya está anulado." });
    expect(await anularGasto({ error: null }, motivo({ id: randomUUID(), motivo: "Error" }))).toEqual({ error: "Este gasto ya está anulado." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sin motivo o con un gasto inválido no llama a la base", async () => {
    expect(await anularGasto({ error: null }, motivo({ id: randomUUID(), motivo: " " }))).toEqual({ error: "Escribe por qué se anula el gasto." });
    expect(await anularGasto({ error: null }, motivo({ id: "no", motivo: "Error" }))).toEqual({ error: "El gasto no es válido." });
    expect(ejecutar).not.toHaveBeenCalled();
  });
});
