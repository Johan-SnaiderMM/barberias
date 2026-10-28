import { describe, expect, it } from "vitest";
import { aplicarTecla, escribirMonto, FILAS_TECLADO, MAX_PESOS } from "./teclado";

describe("aplicarTecla", () => {
  it("agrega dígitos a la derecha", () => {
    expect(escribirMonto(["1", "8", "0", "0", "0"])).toBe(18000);
    expect(escribirMonto(["0", "0", "7"])).toBe(7);
  });

  it('"00" multiplica por 100 (los miles se escriben rápido)', () => {
    expect(escribirMonto(["1", "8", "00"])).toBe(1800);
    expect(escribirMonto(["1", "8", "00", "0"])).toBe(18000);
    expect(aplicarTecla(0, "00")).toBe(0);
  });

  it("borrar quita el último dígito y no baja de cero", () => {
    expect(escribirMonto(["1", "8", "0", "borrar"])).toBe(18);
    expect(escribirMonto(["borrar", "borrar"])).toBe(0);
    expect(aplicarTecla(5, "borrar")).toBe(0);
  });

  it("no pasa del tope de 8 dígitos", () => {
    expect(aplicarTecla(MAX_PESOS, "1")).toBe(MAX_PESOS);
    expect(aplicarTecla(10_000_000, "00")).toBe(10_000_000);
    expect(aplicarTecla(9_999_999, "9")).toBe(MAX_PESOS);
  });

  it("el teclado tiene las diez cifras, el doble cero y borrar, en 4 filas de 3", () => {
    expect(FILAS_TECLADO.map((f) => f.length)).toEqual([3, 3, 3, 3]);
    expect(FILAS_TECLADO.flat().sort()).toEqual(["0", "00", "1", "2", "3", "4", "5", "6", "7", "8", "9", "borrar"].sort());
  });
});
