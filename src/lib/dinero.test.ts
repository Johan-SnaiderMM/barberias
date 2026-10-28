import { describe, expect, it } from "vitest";
import {
  aPesos,
  atajosEfectivo,
  calcularCobro,
  calcularEfectivo,
  compararCaja,
  COMISION_POR_DEFECTO,
  efectivoEsperado,
  esPorcentajeValido,
  formatearMiles,
  formatearPesos,
  leerPesos,
  planDePagos,
  porcentajeDe,
  repartirDescuento,
  repartoDeCobro,
  sumar,
  textoDiferencia,
  validarCobro,
} from "./dinero";

describe("aPesos", () => {
  it("redondea al peso y descarta lo que no es número", () => {
    expect(aPesos(1999.6)).toBe(2000);
    expect(aPesos(0.4)).toBe(0);
    expect(aPesos(Number.NaN)).toBe(0);
    expect(aPesos(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("formatearPesos / formatearMiles", () => {
  it("usa punto de miles y signo menos tipográfico", () => {
    expect(formatearPesos(0)).toBe("$ 0");
    expect(formatearPesos(999)).toBe("$ 999");
    expect(formatearPesos(12500)).toBe("$ 12.500");
    expect(formatearPesos(1234567)).toBe("$ 1.234.567");
    expect(formatearPesos(-12500)).toBe("− $ 12.500");
  });

  it("formatearMiles quita el símbolo y el signo", () => {
    expect(formatearMiles(12500)).toBe("12.500");
    expect(formatearMiles(-3000)).toBe("3.000");
  });
});

describe("leerPesos", () => {
  it("solo cuenta los dígitos", () => {
    expect(leerPesos("12.500")).toBe(12500);
    expect(leerPesos("$ 12 500")).toBe(12500);
    expect(leerPesos("12,500")).toBe(12500);
    expect(leerPesos("")).toBe(0);
    expect(leerPesos("abc")).toBe(0);
  });

  it("tiene tope de 8 dígitos", () => {
    expect(leerPesos("123456789012")).toBe(12345678);
  });
});

describe("sumar", () => {
  it("suma enteros y la lista vacía da 0", () => {
    expect(sumar([15000, 5000, 2500])).toBe(22500);
    expect(sumar([])).toBe(0);
  });
});

describe("porcentajeDe", () => {
  it("calcula el porcentaje exacto cuando divide bien", () => {
    expect(porcentajeDe(35000, 40)).toBe(14000);
    expect(porcentajeDe(20000, 50)).toBe(10000);
    expect(porcentajeDe(20000, 0)).toBe(0);
    expect(porcentajeDe(20000, 100)).toBe(20000);
  });

  it("redondea hacia abajo: lo que sobra se queda en la barbería", () => {
    expect(porcentajeDe(9999, 33)).toBe(3299); // 3299,67
    expect(porcentajeDe(1, 50)).toBe(0);
    expect(porcentajeDe(15500, 35)).toBe(5425); // 5425 exacto
    expect(porcentajeDe(15501, 35)).toBe(5425); // 5425,35
  });

  it("la parte del barbero y la de la barbería suman siempre el total", () => {
    for (const valor of [0, 1, 99, 100, 12345, 35000, 99999999]) {
      for (const pct of [0, 1, 33, 40, 50, 60, 99, 100]) {
        const barbero = porcentajeDe(valor, pct);
        const barberia = valor - barbero;
        expect(barbero + barberia).toBe(valor);
        expect(barbero).toBeGreaterThanOrEqual(0);
        expect(barberia).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("coincide con la aritmética entera exacta (BigInt) en muchos casos", () => {
    // Generador congruencial fijo: pruebas reproducibles, sin azar.
    let semilla = 12345;
    const siguiente = (tope: number) => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla % tope;
    };
    for (let i = 0; i < 3000; i++) {
      const valor = siguiente(100_000_000);
      const pct = siguiente(101);
      const esperado = Number((BigInt(valor) * BigInt(pct)) / BigInt(100));
      expect(porcentajeDe(valor, pct)).toBe(esperado);
    }
  });

  it("rechaza porcentajes y valores no válidos", () => {
    expect(() => porcentajeDe(1000, -1)).toThrow(RangeError);
    expect(() => porcentajeDe(1000, 101)).toThrow(RangeError);
    expect(() => porcentajeDe(1000, 12.5)).toThrow(RangeError);
    expect(() => porcentajeDe(-1, 50)).toThrow(RangeError);
    expect(() => porcentajeDe(10.5, 50)).toThrow(RangeError);
  });
});

describe("calcularEfectivo", () => {
  it("da el vuelto cuando sobra", () => {
    expect(calcularEfectivo(20000, 15000)).toEqual({ vuelto: 5000, falta: 0, alcanza: true });
  });

  it("alcanza justo", () => {
    expect(calcularEfectivo(15000, 15000)).toEqual({ vuelto: 0, falta: 0, alcanza: true });
  });

  it("dice cuánto falta", () => {
    expect(calcularEfectivo(10000, 15000)).toEqual({ vuelto: 0, falta: 5000, alcanza: false });
  });
});

describe("repartirDescuento", () => {
  // Los mismos casos que prueba la base (src/test/cobros.test.ts): el sobrante va, de a un peso, a la mayor fracción.
  it.each([
    [[18000, 22000], 5000, [2250, 2750]],
    [[100, 100, 100], 100, [34, 33, 33]],
    [[3, 5], 4, [2, 2]],
    [[10, 7], 5, [3, 2]],
    [[1, 1, 1], 2, [1, 1, 0]],
    [[7, 7, 7, 7], 10, [3, 3, 2, 2]],
    [[100], 100, [100]],
    [[5000, 0, 5000], 3, [2, 0, 1]],
  ] as [number[], number, number[]][])("%j con %s de descuento -> %j", (precios, descuento, esperado) => {
    expect(repartirDescuento(precios, descuento)).toEqual(esperado);
  });

  it("sin descuento, o con líneas en cero, no reparte nada", () => {
    expect(repartirDescuento([15000, 8000], 0)).toEqual([0, 0]);
    expect(repartirDescuento([0, 0], 0)).toEqual([0, 0]);
    expect(repartirDescuento([], 0)).toEqual([]);
  });

  it("las partes suman exactamente el descuento y ninguna pasa del precio de su línea (muchos casos)", () => {
    let semilla = 987654321;
    const siguiente = (tope: number) => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla % tope;
    };
    for (let i = 0; i < 3000; i++) {
      const precios = Array.from({ length: 1 + siguiente(6) }, () => siguiente(3) === 0 ? 0 : siguiente(200_000));
      const subtotal = sumar(precios);
      const descuento = subtotal === 0 ? 0 : siguiente(subtotal + 1);
      const partes = repartirDescuento(precios, descuento);
      expect(sumar(partes)).toBe(descuento);
      partes.forEach((parte, j) => {
        expect(parte).toBeGreaterThanOrEqual(0);
        expect(parte).toBeLessThanOrEqual(precios[j]);
      });
    }
  });

  it("es proporcional: una línea 'más cara' nunca recibe menos que una más barata", () => {
    const partes = repartirDescuento([1000, 5000, 20000], 7777);
    expect(partes[0]).toBeLessThanOrEqual(partes[1]);
    expect(partes[1]).toBeLessThanOrEqual(partes[2]);
  });

  it("rechaza un descuento mayor que el subtotal, negativo o con decimales", () => {
    expect(() => repartirDescuento([1000], 1001)).toThrow(RangeError);
    expect(() => repartirDescuento([1000], -1)).toThrow(RangeError);
    expect(() => repartirDescuento([1000], 10.5)).toThrow(RangeError);
  });
});

describe("calcularCobro", () => {
  it("un servicio sin descuento ni propina: todo se cobra y la comisión sale del total", () => {
    const r = calcularCobro({ lineas: [{ precio: 18000, comisionPct: 50 }], descuento: 0, propina: 0 });
    expect(r).toMatchObject({ subtotal: 18000, descuento: 0, total: 18000, propina: 0, aCobrar: 18000, comision: 9000, parteBarberia: 9000 });
  });

  it("el descuento baja lo cobrado de cada línea y, con ello, su comisión", () => {
    const r = calcularCobro({
      lineas: [{ precio: 18000, comisionPct: 50 }, { precio: 22000, comisionPct: 40 }],
      descuento: 5000,
      propina: 2000,
    });
    expect(r.lineas).toEqual([
      { precio: 18000, descuento: 2250, neto: 15750, comision: 7875 },
      { precio: 22000, descuento: 2750, neto: 19250, comision: 7700 },
    ]);
    expect(r).toMatchObject({ subtotal: 40000, total: 35000, aCobrar: 37000, comision: 15575, parteBarberia: 19425 });
  });

  it("la comisión baja al peso: el sobrante se queda en la barbería", () => {
    const r = calcularCobro({ lineas: [{ precio: 9999, comisionPct: 33 }], descuento: 0, propina: 0 });
    expect(r.comision).toBe(3299);
    expect(r.parteBarberia).toBe(6700);
  });

  it("las comisiones más la parte de la barbería suman siempre lo cobrado, al peso", () => {
    let semilla = 424242;
    const siguiente = (tope: number) => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla % tope;
    };
    for (let i = 0; i < 2000; i++) {
      const lineas = Array.from({ length: 1 + siguiente(5) }, () => ({ precio: siguiente(80_000), comisionPct: siguiente(101) }));
      const subtotal = sumar(lineas.map((l) => l.precio));
      const descuento = subtotal === 0 ? 0 : siguiente(subtotal + 1);
      const r = calcularCobro({ lineas, descuento, propina: siguiente(5000) });
      expect(r.comision + r.parteBarberia).toBe(r.total);
      expect(sumar(r.lineas.map((l) => l.neto))).toBe(r.total);
      expect(r.parteBarberia).toBeGreaterThanOrEqual(0);
    }
  });

  it("sin porcentaje conocido no hay comisión", () => {
    expect(calcularCobro({ lineas: [{ precio: 15000 }], descuento: 0, propina: 0 }).comision).toBe(0);
  });

  it("la propina es del barbero salvo que el ajuste diga que se queda en la barbería", () => {
    const base = { lineas: [{ precio: 18000, comisionPct: 50 }], descuento: 0, propina: 2000 };
    expect(calcularCobro(base).propinaBarbero).toBe(2000);
    expect(calcularCobro({ ...base, propinaDelBarbero: true }).propinaBarbero).toBe(2000);
    expect(calcularCobro({ ...base, propinaDelBarbero: false }).propinaBarbero).toBe(0);
    expect(calcularCobro({ ...base, propina: 0 }).propinaBarbero).toBe(0);
  });
});

describe("comisiones: constantes y reparto", () => {
  it("el porcentaje por defecto es 50 y un porcentaje válido es un entero de 0 a 100", () => {
    expect(COMISION_POR_DEFECTO).toBe(50);
    for (const n of [0, 1, 50, 99, 100]) expect(esPorcentajeValido(n)).toBe(true);
    for (const n of [-1, 101, 50.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(esPorcentajeValido(n)).toBe(false);
  });

  it("repartoDeCobro: lo del barbero (comisión y su propina) más lo de la barbería suman lo que entró", () => {
    expect(repartoDeCobro({ total: 18000, comision: 9000, propina: 2000, propinaBarbero: 2000 })).toEqual({ barbero: 11000, barberia: 9000 });
    expect(repartoDeCobro({ total: 18000, comision: 9000, propina: 2000, propinaBarbero: 0 })).toEqual({ barbero: 9000, barberia: 11000 });
    expect(repartoDeCobro({ total: 0, comision: 0, propina: 0, propinaBarbero: 0 })).toEqual({ barbero: 0, barberia: 0 });
  });

  it("repartoDeCobro cuadra con calcularCobro en muchas combinaciones", () => {
    let semilla = 777;
    const siguiente = (tope: number) => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla % tope;
    };
    for (let i = 0; i < 1000; i++) {
      const lineas = Array.from({ length: 1 + siguiente(4) }, () => ({ precio: siguiente(60_000), comisionPct: siguiente(101) }));
      const subtotal = sumar(lineas.map((l) => l.precio));
      const r = calcularCobro({
        lineas,
        descuento: subtotal === 0 ? 0 : siguiente(subtotal + 1),
        propina: siguiente(4000),
        propinaDelBarbero: siguiente(2) === 0,
      });
      const reparto = repartoDeCobro({ total: r.total, comision: r.comision, propina: r.propina, propinaBarbero: r.propinaBarbero });
      expect(reparto.barbero + reparto.barberia).toBe(r.aCobrar);
      expect(reparto.barbero).toBeGreaterThanOrEqual(0);
      expect(reparto.barberia).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("cierre del día", () => {
  it("efectivoEsperado: lo cobrado en efectivo menos los gastos y los pagos a barberos en efectivo", () => {
    expect(efectivoEsperado({ efectivoCobros: 25000, gastosEfectivo: 4000, liquidacionesEfectivo: 7500 })).toBe(13500);
    expect(efectivoEsperado({ efectivoCobros: 0, gastosEfectivo: 0, liquidacionesEfectivo: 0 })).toBe(0);
    // Puede ser negativo: salió más efectivo del que entró.
    expect(efectivoEsperado({ efectivoCobros: 0, gastosEfectivo: 30000, liquidacionesEfectivo: 0 })).toBe(-30000);
  });

  it("compararCaja: sobra, falta o cuadra", () => {
    expect(compararCaja(13500, 13500)).toEqual({ diferencia: 0, estado: "cuadra" });
    expect(compararCaja(14000, 13500)).toEqual({ diferencia: 500, estado: "sobra" });
    expect(compararCaja(13000, 13500)).toEqual({ diferencia: -500, estado: "falta" });
    expect(compararCaja(0, -30000)).toEqual({ diferencia: 30000, estado: "sobra" });
  });

  it("textoDiferencia", () => {
    expect(textoDiferencia(0)).toBe("Cuadra");
    expect(textoDiferencia(500)).toBe("Sobran $ 500");
    expect(textoDiferencia(-12500)).toBe("Faltan $ 12.500");
  });
});

describe("planDePagos y validarCobro", () => {
  it("efectivo: un pago por todo, con lo recibido", () => {
    expect(planDePagos({ medio: "efectivo", aCobrar: 18000, recibido: 20000, referencia: "", pagaAhora: 0 })).toEqual([
      { medio: "efectivo", monto: 18000, recibido: 20000 },
    ]);
  });

  it("transferencia: un pago con la referencia limpia; sin referencia no la manda", () => {
    expect(planDePagos({ medio: "transferencia", aCobrar: 18000, recibido: 0, referencia: "  M123 ", pagaAhora: 0 })).toEqual([
      { medio: "transferencia", monto: 18000, referencia: "M123" },
    ]);
    expect(planDePagos({ medio: "transferencia", aCobrar: 18000, recibido: 0, referencia: " ", pagaAhora: 0 })).toEqual([
      { medio: "transferencia", monto: 18000 },
    ]);
  });

  it("parte y parte: la parte en efectivo es exacta y el resto va por transferencia", () => {
    expect(planDePagos({ medio: "transferencia", aCobrar: 18000, recibido: 0, referencia: "", pagaAhora: 10000 })).toEqual([
      { medio: "efectivo", monto: 10000, recibido: 10000 },
      { medio: "transferencia", monto: 8000 },
    ]);
  });

  it("sin nada que cobrar no hay pagos", () => {
    expect(planDePagos({ medio: "efectivo", aCobrar: 0, recibido: 0, referencia: "", pagaAhora: 0 })).toEqual([]);
  });

  it("valida que los pagos sumen lo que se cobra y calcula el vuelto", () => {
    expect(validarCobro(18000, 0, [{ medio: "efectivo", monto: 18000, recibido: 20000 }])).toEqual({ ok: true, vuelto: 2000 });
    expect(validarCobro(18000, 2000, [{ medio: "efectivo", monto: 10000 }, { medio: "transferencia", monto: 10000 }])).toEqual({
      ok: true,
      vuelto: 0,
    });
    expect(validarCobro(18000, 0, [{ medio: "efectivo", monto: 17000 }])).toEqual({
      ok: false,
      error: "Los pagos suman $ 17.000 y el total a cobrar es $ 18.000.",
    });
  });

  it("rechaza efectivo que no alcanza, pagos en cero, sin pagos y propina fuera de rango", () => {
    expect(validarCobro(18000, 0, [{ medio: "efectivo", monto: 18000, recibido: 15000 }])).toMatchObject({ ok: false });
    expect(validarCobro(18000, 0, [{ medio: "efectivo", monto: 0 }])).toMatchObject({ ok: false });
    expect(validarCobro(18000, 0, [])).toEqual({ ok: false, error: "Elige cómo se paga." });
    expect(validarCobro(18000, -1, [{ medio: "efectivo", monto: 17999 }])).toMatchObject({ ok: false });
    expect(validarCobro(18000, 1_000_001, [])).toMatchObject({ ok: false });
  });

  it("una cortesía (total 0) no lleva pagos", () => {
    expect(validarCobro(0, 0, [])).toEqual({ ok: true, vuelto: 0 });
    expect(validarCobro(0, 0, [{ medio: "efectivo", monto: 1 }])).toEqual({ ok: false, error: "No hay nada que cobrar." });
  });
});

describe("atajosEfectivo", () => {
  it("ofrece el valor exacto y los billetes que lo cubren, sin repetir", () => {
    expect(atajosEfectivo(18000)).toEqual([18000, 20000, 50000]);
    expect(atajosEfectivo(20000)).toEqual([20000, 50000]);
    expect(atajosEfectivo(32000)).toEqual([32000, 35000, 40000, 50000]);
  });

  it("no ofrece nada si no hay nada que cobrar", () => {
    expect(atajosEfectivo(0)).toEqual([]);
    expect(atajosEfectivo(-5)).toEqual([]);
  });
});
