import { describe, expect, it } from "vitest";
import {
  DIAS_SEMANA,
  diasQueTrabaja,
  franjasDelDia,
  hora24AMinutos,
  minutosAHora24,
  minutosATexto,
  resumenDia,
  textoFranja,
  validarFranjas,
  type FranjaHorario,
} from "./horarios";

const f = (dia: number, desde: number, hasta: number): FranjaHorario => ({ dia, desde, hasta });

describe("minutosATexto", () => {
  it("usa 12 horas con a. m. / p. m.", () => {
    expect(minutosATexto(540)).toBe("9:00 a. m.");
    expect(minutosATexto(810)).toBe("1:30 p. m.");
    expect(minutosATexto(720)).toBe("12:00 p. m.");
    expect(minutosATexto(1139)).toBe("6:59 p. m.");
  });

  it("la medianoche es 12:00 a. m., al principio y al final del día", () => {
    expect(minutosATexto(0)).toBe("12:00 a. m.");
    expect(minutosATexto(1440)).toBe("12:00 a. m.");
  });
});

describe("minutosAHora24 / hora24AMinutos", () => {
  it("van y vuelven", () => {
    for (const min of [0, 5, 540, 810, 1139, 1435]) {
      expect(hora24AMinutos(minutosAHora24(min))).toBe(min);
    }
  });

  it("1440 se escribe 00:00 y, como fin de franja, vuelve a 1440", () => {
    expect(minutosAHora24(1440)).toBe("00:00");
    expect(hora24AMinutos("00:00", true)).toBe(1440);
    expect(hora24AMinutos("00:00", false)).toBe(0);
  });

  it("rechaza lo que no es una hora", () => {
    expect(hora24AMinutos("")).toBeNull();
    expect(hora24AMinutos("9:00")).toBeNull();
    expect(hora24AMinutos("24:00")).toBeNull();
    expect(hora24AMinutos("12:60")).toBeNull();
    expect(hora24AMinutos("abc")).toBeNull();
  });
});

describe("resúmenes", () => {
  const horario = [f(1, 870, 1140), f(1, 540, 780), f(3, 600, 1080)];

  it("textoFranja y resumenDia ordenan por hora de inicio", () => {
    expect(textoFranja(f(1, 540, 780))).toBe("9:00 a. m. – 1:00 p. m.");
    expect(resumenDia(horario, 1)).toBe("9:00 a. m. – 1:00 p. m. · 2:30 p. m. – 7:00 p. m.");
    expect(resumenDia(horario, 3)).toBe("10:00 a. m. – 6:00 p. m.");
  });

  it("un día sin franjas no trabaja", () => {
    expect(resumenDia(horario, 0)).toBe("No trabaja");
    expect(franjasDelDia(horario, 2)).toEqual([]);
  });

  it("cuenta los días distintos que trabaja", () => {
    expect(diasQueTrabaja(horario)).toBe(2);
    expect(diasQueTrabaja([])).toBe(0);
  });

  it("la semana empieza el lunes y termina el domingo (0)", () => {
    expect(DIAS_SEMANA.map((d) => d.dia)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe("validarFranjas (mismas reglas que el SQL)", () => {
  it("acepta un horario normal, franjas pegadas y la medianoche final", () => {
    expect(validarFranjas([f(1, 540, 780), f(1, 870, 1140)])).toBeNull();
    expect(validarFranjas([f(1, 540, 780), f(1, 780, 1140)])).toBeNull();
    expect(validarFranjas([f(0, 0, 1440)])).toBeNull();
    expect(validarFranjas([])).toBeNull();
  });

  it("rechaza franjas que se cruzan, con el nombre del día", () => {
    expect(validarFranjas([f(3, 540, 780), f(3, 700, 900)])).toBe("Las franjas del miércoles se cruzan.");
    expect(validarFranjas([f(0, 540, 780), f(0, 540, 780)])).toBe("Las franjas del domingo se cruzan.");
  });

  it("rechaza franjas al revés, vacías o fuera del día", () => {
    expect(validarFranjas([f(1, 600, 540)])).toBe("La franja del lunes termina antes de empezar.");
    expect(validarFranjas([f(2, 600, 600)])).toBe("La franja del martes termina antes de empezar.");
    expect(validarFranjas([f(1, 540, 1500)])).toMatch(/entre las 12:00/);
    expect(validarFranjas([f(7, 540, 600)])).toBe("El día de la semana no es válido.");
    expect(validarFranjas([f(1, 540.5, 600)])).toBe("El horario no es válido.");
  });

  it("rechaza más de 4 franjas en un día", () => {
    const cinco = [0, 1, 2, 3, 4].map((i) => f(1, 360 + i * 180, 420 + i * 180));
    expect(validarFranjas(cinco)).toMatch(/más de 4 franjas/);
  });
});
