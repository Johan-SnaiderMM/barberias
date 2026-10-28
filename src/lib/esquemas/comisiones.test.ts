import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { esquemaComisionesBarbero, esquemaPropinaDelBarbero } from "./comisiones";

const mensaje = (entrada: unknown) => {
  const r = esquemaComisionesBarbero.safeParse(entrada);
  return r.success ? null : r.error.issues[0].message;
};

describe("esquemaComisionesBarbero", () => {
  it("acepta un porcentaje base con y sin excepciones", () => {
    const barbero = randomUUID();
    expect(esquemaComisionesBarbero.safeParse({ barbero_id: barbero, pct: 50, excepciones: [] }).success).toBe(true);
    expect(
      esquemaComisionesBarbero.safeParse({
        barbero_id: barbero,
        pct: 0,
        excepciones: [{ servicio_id: randomUUID(), pct: 100 }, { servicio_id: randomUUID(), pct: 70 }],
      }).success
    ).toBe(true);
  });

  it.each([
    ["un porcentaje negativo", { pct: -1 }, "La comisión va de 0 % a 100 %."],
    ["un porcentaje de más de 100", { pct: 101 }, "La comisión va de 0 % a 100 %."],
    ["un porcentaje con decimales", { pct: 50.5 }, "El porcentaje va en números enteros."],
    ["un porcentaje vacío (NaN)", { pct: Number.NaN }, "Escribe un porcentaje válido."],
    ["un porcentaje que es texto", { pct: "50" }, "Escribe un porcentaje válido."],
    ["un barbero que no es uuid", { barbero_id: "nada" }, "El barbero no es válido."],
    ["una excepción con un servicio que no es uuid", { excepciones: [{ servicio_id: "x", pct: 50 }] }, "Uno de los servicios no es válido."],
    ["una excepción fuera de rango", { excepciones: [{ servicio_id: randomUUID(), pct: 150 }] }, "La comisión va de 0 % a 100 %."],
    ["más de 100 excepciones", { excepciones: Array.from({ length: 101 }, () => ({ servicio_id: randomUUID(), pct: 50 })) }, "Son demasiadas excepciones."],
  ] as [string, Record<string, unknown>, string][])("rechaza %s", (_nombre, cambio, esperado) => {
    expect(mensaje({ barbero_id: randomUUID(), pct: 50, excepciones: [], ...cambio })).toBe(esperado);
  });

  it("rechaza un servicio repetido en las excepciones", () => {
    const servicio = randomUUID();
    expect(
      mensaje({
        barbero_id: randomUUID(),
        pct: 50,
        excepciones: [{ servicio_id: servicio, pct: 60 }, { servicio_id: servicio, pct: 70 }],
      })
    ).toBe("Un servicio aparece dos veces en la lista.");
  });
});

describe("esquemaPropinaDelBarbero", () => {
  it("acepta sí o no y rechaza lo demás", () => {
    expect(esquemaPropinaDelBarbero.safeParse({ del_barbero: true }).success).toBe(true);
    expect(esquemaPropinaDelBarbero.safeParse({ del_barbero: false }).success).toBe(true);
    const r = esquemaPropinaDelBarbero.safeParse({ del_barbero: undefined });
    expect(r.success ? null : r.error.issues[0].message).toBe("Indica de quién es la propina.");
    expect(esquemaPropinaDelBarbero.safeParse({ del_barbero: "true" }).success).toBe(false);
  });
});
