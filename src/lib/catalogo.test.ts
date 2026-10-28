import { describe, expect, it } from "vitest";
import { DURACION_MAX, DURACION_MIN, DURACION_PASO, DURACIONES, textoDuracion } from "./catalogo";
import { esquemaFijarActivo, esquemaServicio } from "./esquemas/servicio";

describe("textoDuracion", () => {
  it("minutos, horas y horas con minutos", () => {
    expect(textoDuracion(5)).toBe("5 min");
    expect(textoDuracion(30)).toBe("30 min");
    expect(textoDuracion(60)).toBe("1 h");
    expect(textoDuracion(90)).toBe("1 h 30 min");
    expect(textoDuracion(135)).toBe("2 h 15 min");
    expect(textoDuracion(480)).toBe("8 h");
  });
});

describe("DURACIONES", () => {
  it("van de 5 en 5 dentro de los límites de la base", () => {
    expect(DURACIONES[0]).toBe(DURACION_MIN);
    expect(DURACIONES.every((m) => m % DURACION_PASO === 0)).toBe(true);
    expect(DURACIONES.every((m) => m >= DURACION_MIN && m <= DURACION_MAX)).toBe(true);
    expect(new Set(DURACIONES).size).toBe(DURACIONES.length);
  });

  it("incluyen las duraciones habituales de una barbería", () => {
    for (const m of [15, 30, 45, 60, 90]) expect(DURACIONES).toContain(m);
  });
});

describe("esquemaServicio", () => {
  const valido = { nombre: "  Corte  ", precio: 15000, duracion_min: 30 };

  it("acepta un servicio válido y recorta el nombre", () => {
    const r = esquemaServicio.safeParse(valido);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nombre).toBe("Corte");
  });

  it.each([
    ["nombre vacío", { ...valido, nombre: "   " }, /nombre del servicio/],
    ["nombre largo", { ...valido, nombre: "x".repeat(61) }, /muy largo/],
    ["precio negativo", { ...valido, precio: -5 }, /negativo/],
    ["precio decimal", { ...valido, precio: 1500.5 }, /entero/],
    ["precio demasiado alto", { ...valido, precio: 10_000_001 }, /demasiado alto/],
    ["duración NaN", { ...valido, duracion_min: Number.NaN }, /duración/],
    ["duración corta", { ...valido, duracion_min: 0 }, /mínima/],
    ["duración larga", { ...valido, duracion_min: 485 }, /máxima/],
    ["duración fuera de paso", { ...valido, duracion_min: 32 }, /de 5 en 5/],
    ["id inválido", { ...valido, id: "no-es-uuid" }, /no es válido/],
  ])("rechaza %s", (_caso, entrada, mensaje) => {
    const r = esquemaServicio.safeParse(entrada);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(mensaje);
  });
});

describe("esquemaFijarActivo", () => {
  it("pide un id válido y un booleano", () => {
    expect(esquemaFijarActivo.safeParse({ id: "9b2f8c3e-5a41-4d0e-8f6a-1c2d3e4f5a6b", activo: false }).success).toBe(true);
    expect(esquemaFijarActivo.safeParse({ id: "x", activo: true }).success).toBe(false);
    expect(esquemaFijarActivo.safeParse({ id: "9b2f8c3e-5a41-4d0e-8f6a-1c2d3e4f5a6b", activo: "true" }).success).toBe(false);
  });
});
