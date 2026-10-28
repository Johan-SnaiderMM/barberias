import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GASTO_MAXIMO } from "@/lib/gastos";
import { esquemaAnularGasto, esquemaGasto } from "./gasto";

const base = () => ({ clave: randomUUID(), monto: 45000, categoria: "insumos", medio: "efectivo", nota: "" });
const mensaje = (entrada: unknown) => {
  const r = esquemaGasto.safeParse(entrada);
  return r.success ? null : r.error.issues[0].message;
};

describe("esquemaGasto", () => {
  it("acepta un gasto con cada categoría y cada medio, con o sin nota", () => {
    for (const categoria of ["arriendo", "insumos", "servicios_publicos", "comisiones", "otros"]) {
      expect(esquemaGasto.safeParse({ ...base(), categoria }).success).toBe(true);
    }
    expect(esquemaGasto.safeParse({ ...base(), medio: "transferencia", nota: "  Toallas  " }).success).toBe(true);
    const { nota: _nota, ...sinNota } = base();
    const r = esquemaGasto.safeParse(sinNota);
    expect(r.success && r.data.nota).toBe("");
    expect(esquemaGasto.safeParse({ ...base(), monto: GASTO_MAXIMO }).success).toBe(true);
  });

  it.each([
    ["sin valor", { monto: Number.NaN }, "Escribe cuánto fue el gasto."],
    ["con valor cero", { monto: 0 }, "Escribe cuánto fue el gasto."],
    ["con valor negativo", { monto: -5 }, "Escribe cuánto fue el gasto."],
    ["con decimales", { monto: 10.5 }, "Los pesos van enteros."],
    ["con un valor altísimo", { monto: GASTO_MAXIMO + 1 }, "El gasto es demasiado alto."],
    ["con una categoría que no existe", { categoria: "luz" }, "Elige la categoría del gasto."],
    ["sin categoría", { categoria: "" }, "Elige la categoría del gasto."],
    ["con un medio raro", { medio: "fiado" }, "Elige cómo se pagó el gasto: efectivo o transferencia."],
    ["con una clave que no es uuid", { clave: "abc" }, "Recarga la pantalla e intenta de nuevo."],
    ["con una nota de más de 120 letras", { nota: "x".repeat(121) }, "La nota es muy larga (máximo 120 letras)."],
  ] as [string, Record<string, unknown>, string][])("rechaza un gasto %s", (_nombre, cambio, esperado) => {
    expect(mensaje({ ...base(), ...cambio })).toBe(esperado);
  });
});

describe("esquemaAnularGasto", () => {
  it("acepta un gasto con su motivo y lo recorta", () => {
    const id = randomUUID();
    const r = esquemaAnularGasto.safeParse({ id, motivo: "  Lo registré dos veces  " });
    expect(r.success && r.data).toEqual({ id, motivo: "Lo registré dos veces" });
  });

  it.each([
    ["sin motivo", { id: randomUUID(), motivo: " " }, "Escribe por qué se anula el gasto."],
    ["con un motivo larguísimo", { id: randomUUID(), motivo: "a".repeat(201) }, "El motivo es muy largo (máximo 200 letras)."],
    ["con un gasto que no es uuid", { id: "7", motivo: "Error" }, "El gasto no es válido."],
  ])("rechaza %s", (_nombre, entrada, esperado) => {
    const r = esquemaAnularGasto.safeParse(entrada);
    expect(r.success ? null : r.error.issues[0].message).toBe(esperado);
  });
});
