import { describe, expect, it } from "vitest";
import { esquemaBarbero, esquemaFijarActivoBarbero, esquemaServiciosBarbero } from "./barbero";

const UUID_A = "9b2f8c3e-5a41-4d0e-8f6a-1c2d3e4f5a6b";
const UUID_B = "1f0e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b";

describe("esquemaBarbero", () => {
  it("acepta un barbero válido y recorta el nombre", () => {
    const r = esquemaBarbero.safeParse({ nombre: "  Camilo ", acepta_reservas: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nombre).toBe("Camilo");
  });

  it.each([
    ["nombre vacío", { nombre: "  ", acepta_reservas: true }, /nombre del barbero/],
    ["nombre largo", { nombre: "x".repeat(41), acepta_reservas: true }, /muy largo/],
    ["id inválido", { id: "no", nombre: "Camilo", acepta_reservas: true }, /no es válido/],
  ])("rechaza %s", (_caso, entrada, mensaje) => {
    const r = esquemaBarbero.safeParse(entrada);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(mensaje);
  });
});

describe("esquemaFijarActivoBarbero", () => {
  it("pide un id válido y un booleano", () => {
    expect(esquemaFijarActivoBarbero.safeParse({ id: UUID_A, activo: false }).success).toBe(true);
    expect(esquemaFijarActivoBarbero.safeParse({ id: "x", activo: false }).success).toBe(false);
  });
});

describe("esquemaServiciosBarbero", () => {
  const base = { barbero_id: UUID_A };

  it("acepta una lista con precios y duraciones propios o null", () => {
    const r = esquemaServiciosBarbero.safeParse({
      ...base,
      servicios: [
        { servicio_id: UUID_A, precio_propio: 20000, duracion_propia: 45 },
        { servicio_id: UUID_B, precio_propio: null, duracion_propia: null },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("acepta la lista vacía (el barbero no hace nada)", () => {
    expect(esquemaServiciosBarbero.safeParse({ ...base, servicios: [] }).success).toBe(true);
  });

  it.each([
    ["precio negativo", { precio_propio: -1, duracion_propia: null }, /negativo/],
    ["precio decimal", { precio_propio: 10.5, duracion_propia: null }, /entero/],
    ["precio enorme", { precio_propio: 10_000_001, duracion_propia: null }, /demasiado alto/],
    ["duración fuera de paso", { precio_propio: null, duracion_propia: 32 }, /de 5 en 5/],
    ["duración muy corta", { precio_propio: null, duracion_propia: 0 }, /mínima/],
    ["duración muy larga", { precio_propio: null, duracion_propia: 600 }, /máxima/],
  ])("rechaza %s", (_caso, extra, mensaje) => {
    const r = esquemaServiciosBarbero.safeParse({ ...base, servicios: [{ servicio_id: UUID_A, ...extra }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(mensaje);
  });

  it("rechaza un servicio_id que no es uuid", () => {
    const r = esquemaServiciosBarbero.safeParse({
      ...base,
      servicios: [{ servicio_id: "x", precio_propio: null, duracion_propia: null }],
    });
    expect(r.success).toBe(false);
  });
});
