import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { esquemaAnularLiquidacion, esquemaLiquidar } from "./liquidacion";

const base = () => ({ barbero_id: randomUUID(), hasta: "2026-10-14", medio: "efectivo", clave: randomUUID(), nota: "" });
const mensaje = (entrada: unknown) => {
  const r = esquemaLiquidar.safeParse(entrada);
  return r.success ? null : r.error.issues[0].message;
};

describe("esquemaLiquidar", () => {
  it("acepta una liquidación en efectivo o por transferencia, con o sin nota", () => {
    expect(esquemaLiquidar.safeParse(base()).success).toBe(true);
    const r = esquemaLiquidar.safeParse({ ...base(), medio: "transferencia", nota: "  Quincena  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nota).toBe("Quincena");
    // Sin nota: queda vacía.
    const { nota: _nota, ...sinNota } = base();
    const s = esquemaLiquidar.safeParse(sinNota);
    expect(s.success && s.data.nota).toBe("");
  });

  it.each([
    ["un barbero que no es uuid", { barbero_id: "x" }, "El barbero no es válido."],
    ["una fecha que no existe", { hasta: "2026-02-30" }, "La fecha no es válida."],
    ["una fecha mal escrita", { hasta: "14/10/2026" }, "La fecha no es válida."],
    ["un medio raro", { medio: "fiado" }, "Elige cómo se le paga: efectivo o transferencia."],
    ["un medio vacío", { medio: undefined }, "Elige cómo se le paga: efectivo o transferencia."],
    ["una clave que no es uuid", { clave: "abc" }, "Recarga la pantalla e intenta de nuevo."],
    ["una nota de más de 200 letras", { nota: "x".repeat(201) }, "La nota es muy larga (máximo 200 letras)."],
  ] as [string, Record<string, unknown>, string][])("rechaza %s", (_nombre, cambio, esperado) => {
    expect(mensaje({ ...base(), ...cambio })).toBe(esperado);
  });
});

describe("esquemaAnularLiquidacion", () => {
  it("acepta una liquidación con su motivo y lo recorta", () => {
    const id = randomUUID();
    const r = esquemaAnularLiquidacion.safeParse({ id, motivo: "  Medio equivocado  " });
    expect(r.success && r.data).toEqual({ id, motivo: "Medio equivocado" });
  });

  it.each([
    ["sin motivo", { id: randomUUID(), motivo: "  " }, "Escribe por qué se anula la liquidación."],
    ["con un motivo larguísimo", { id: randomUUID(), motivo: "a".repeat(201) }, "El motivo es muy largo (máximo 200 letras)."],
    ["con una liquidación que no es uuid", { id: "1", motivo: "Error" }, "La liquidación no es válida."],
  ])("rechaza %s", (_nombre, entrada, esperado) => {
    const r = esquemaAnularLiquidacion.safeParse(entrada);
    expect(r.success ? null : r.error.issues[0].message).toBe(esperado);
  });
});
