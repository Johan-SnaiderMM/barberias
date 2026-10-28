import { describe, expect, it } from "vitest";
import {
  esFecha,
  esPeriodo,
  hastaEfectivo,
  periodoAnterior,
  periodoSiguiente,
  PERIODOS,
  rangoDelPeriodo,
  textoPeriodo,
} from "./periodos";

describe("esPeriodo y esFecha", () => {
  it("reconoce los periodos y las fechas que existen", () => {
    for (const p of PERIODOS) expect(esPeriodo(p)).toBe(true);
    for (const x of ["", "dia", "SEMANA", null, undefined, 3]) expect(esPeriodo(x)).toBe(false);
    for (const f of ["2026-10-14", "2028-02-29", "2026-12-31"]) expect(esFecha(f)).toBe(true);
    for (const f of ["2026-02-29", "2026-13-01", "2026-00-10", "26-10-14", "2026-10-1", "ayer", "", null, 20261014]) expect(esFecha(f)).toBe(false);
  });
});

describe("rangoDelPeriodo", () => {
  it("hoy es el día", () => {
    expect(rangoDelPeriodo("hoy", "2026-10-14")).toEqual({ desde: "2026-10-14", hasta: "2026-10-14" });
  });

  it("la semana va de lunes a domingo, con cualquier día de la semana como referencia", () => {
    // 2026-10-12 es lunes.
    for (const dia of ["2026-10-12", "2026-10-14", "2026-10-18"]) {
      expect(rangoDelPeriodo("semana", dia)).toEqual({ desde: "2026-10-12", hasta: "2026-10-18" });
    }
    expect(rangoDelPeriodo("semana", "2026-10-19")).toEqual({ desde: "2026-10-19", hasta: "2026-10-25" });
  });

  it("la semana cruza meses y años", () => {
    expect(rangoDelPeriodo("semana", "2026-10-29")).toEqual({ desde: "2026-10-26", hasta: "2026-11-01" });
    expect(rangoDelPeriodo("semana", "2026-12-31")).toEqual({ desde: "2026-12-28", hasta: "2027-01-03" });
  });

  it("la quincena es del 1 al 15 o del 16 al último día del mes", () => {
    expect(rangoDelPeriodo("quincena", "2026-10-01")).toEqual({ desde: "2026-10-01", hasta: "2026-10-15" });
    expect(rangoDelPeriodo("quincena", "2026-10-15")).toEqual({ desde: "2026-10-01", hasta: "2026-10-15" });
    expect(rangoDelPeriodo("quincena", "2026-10-16")).toEqual({ desde: "2026-10-16", hasta: "2026-10-31" });
    expect(rangoDelPeriodo("quincena", "2026-11-30")).toEqual({ desde: "2026-11-16", hasta: "2026-11-30" });
    expect(rangoDelPeriodo("quincena", "2026-02-20")).toEqual({ desde: "2026-02-16", hasta: "2026-02-28" });
    expect(rangoDelPeriodo("quincena", "2028-02-20")).toEqual({ desde: "2028-02-16", hasta: "2028-02-29" });
  });

  it("el mes va del 1 al último día", () => {
    expect(rangoDelPeriodo("mes", "2026-10-14")).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(rangoDelPeriodo("mes", "2026-02-03")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoDelPeriodo("mes", "2028-02-03")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(rangoDelPeriodo("mes", "2026-12-31")).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });
});

describe("periodoAnterior y periodoSiguiente", () => {
  it("dan un día dentro del periodo vecino; recorrerlos hacia atrás y hacia adelante no deja huecos ni se cruza", () => {
    for (const periodo of PERIODOS) {
      let ref = "2026-12-20";
      for (let i = 0; i < 40; i++) {
        const actual = rangoDelPeriodo(periodo, ref);
        const antes = rangoDelPeriodo(periodo, periodoAnterior(periodo, ref));
        const despues = rangoDelPeriodo(periodo, periodoSiguiente(periodo, ref));
        expect(periodoSiguiente(periodo, antes.desde)).toBeTruthy();
        expect(rangoDelPeriodo(periodo, periodoSiguiente(periodo, antes.desde))).toEqual(actual);
        expect(rangoDelPeriodo(periodo, periodoAnterior(periodo, despues.desde))).toEqual(actual);
        expect(antes.hasta < actual.desde).toBe(true);
        expect(despues.desde > actual.hasta).toBe(true);
        ref = periodoAnterior(periodo, ref);
      }
    }
  });

  it("ejemplos", () => {
    expect(periodoAnterior("semana", "2026-10-14")).toBe("2026-10-11");
    expect(periodoSiguiente("semana", "2026-10-14")).toBe("2026-10-19");
    expect(periodoAnterior("quincena", "2026-11-03")).toBe("2026-10-31");
    expect(periodoSiguiente("quincena", "2026-10-03")).toBe("2026-10-16");
    expect(periodoAnterior("mes", "2026-03-10")).toBe("2026-02-28");
    expect(periodoSiguiente("mes", "2026-12-10")).toBe("2027-01-01");
    expect(periodoAnterior("hoy", "2026-10-01")).toBe("2026-09-30");
  });
});

describe("hastaEfectivo", () => {
  it("es el final del periodo, sin pasar de hoy", () => {
    expect(hastaEfectivo({ desde: "2026-10-12", hasta: "2026-10-18" }, "2026-10-14")).toBe("2026-10-14");
    expect(hastaEfectivo({ desde: "2026-10-05", hasta: "2026-10-11" }, "2026-10-14")).toBe("2026-10-11");
    expect(hastaEfectivo({ desde: "2026-10-14", hasta: "2026-10-14" }, "2026-10-14")).toBe("2026-10-14");
  });
});

describe("textoPeriodo", () => {
  const hoy = "2026-10-14"; // miércoles

  it("hoy, ayer y otros días", () => {
    expect(textoPeriodo("hoy", "2026-10-14", hoy)).toEqual({ titulo: "Hoy", detalle: "mié 14 oct" });
    expect(textoPeriodo("hoy", "2026-10-13", hoy)).toEqual({ titulo: "Ayer", detalle: "mar 13 oct" });
    expect(textoPeriodo("hoy", "2026-10-09", hoy)).toEqual({ titulo: "vie 9 oct", detalle: "vie 9 oct" });
  });

  it("el periodo actual dice «Esta…» y los demás, solo el nombre; siempre con su rango", () => {
    expect(textoPeriodo("semana", hoy, hoy)).toEqual({ titulo: "Esta semana", detalle: "lun 12 oct – dom 18 oct" });
    expect(textoPeriodo("semana", "2026-10-07", hoy)).toEqual({ titulo: "Semana", detalle: "lun 5 oct – dom 11 oct" });
    expect(textoPeriodo("quincena", hoy, hoy)).toEqual({ titulo: "Esta quincena", detalle: "jue 1 oct – jue 15 oct" });
    expect(textoPeriodo("quincena", "2026-10-20", hoy).titulo).toBe("Quincena");
    expect(textoPeriodo("mes", hoy, hoy)).toEqual({ titulo: "Este mes", detalle: "jue 1 oct – sáb 31 oct" });
    expect(textoPeriodo("mes", "2026-09-10", hoy).titulo).toBe("Mes");
  });
});
