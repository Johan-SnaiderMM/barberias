import { describe, expect, it } from "vitest";
import type { CierreHecho } from "./tipos/cierre";
import { enlaceWhatsappA, enlaceWhatsappSinNumero, mensajeRecordatorio, mensajeResumenCierre } from "./whatsapp";

const base = {
  cliente: "Juan Carlos Pérez",
  barberia: "Barbería de Prueba",
  servicio: "Corte",
  barbero: "Camilo",
  dia: "jueves 15 de octubre",
  hora: "5:00 p. m.",
};

describe("enlaceWhatsappA", () => {
  it("arma https://wa.me/<dígitos>?text=<mensaje codificado>", () => {
    expect(enlaceWhatsappA("+573001234567", "Hola ñ & 1")).toBe("https://wa.me/573001234567?text=Hola%20%C3%B1%20%26%201");
  });

  it("el mensaje se recupera tal cual al decodificarlo", () => {
    const mensaje = mensajeRecordatorio(base);
    const enlace = enlaceWhatsappA("+573001234567", mensaje)!;
    expect(decodeURIComponent(enlace.split("?text=")[1])).toBe(mensaje);
  });

  it.each([null, undefined, "", "3001234567", "573001234567", "+0123456789", "+57", "+57 300 123 4567", "abc"])(
    "sin celular válido (%j) no hay enlace",
    (valor) => {
      expect(enlaceWhatsappA(valor, "Hola")).toBeNull();
    }
  );

  it("acepta celulares de otros países en E.164", () => {
    expect(enlaceWhatsappA("+14155552671", "Hi")).toBe("https://wa.me/14155552671?text=Hi");
  });

  it("cambia el espacio fino de las horas por un espacio normal", () => {
    const enlace = enlaceWhatsappA("+573001234567", "5:00 p. m.")!;
    expect(decodeURIComponent(enlace.split("?text=")[1])).toBe("5:00 p. m.");
  });
});

describe("enlaceWhatsappSinNumero", () => {
  it("abre WhatsApp para elegir a quién mandarlo", () => {
    expect(enlaceWhatsappSinNumero("Hola mundo")).toBe("https://wa.me/?text=Hola%20mundo");
  });
});

const cierre: CierreHecho = {
  ok: true,
  ya_existia: false,
  id: "c1",
  fecha: "2026-10-15",
  created_at: "2026-10-15T23:30:00Z",
  cobros: 3,
  servicios: 55000,
  propinas: 2000,
  comisiones: 27500,
  propinas_barbero: 2000,
  efectivo_cobros: 25000,
  transferencia_cobros: 32000,
  gastos: 2,
  gastos_efectivo: 4000,
  gastos_transferencia: 6000,
  liquidaciones_efectivo: 7500,
  liquidaciones_transferencia: 0,
  efectivo_esperado: 13500,
  efectivo_contado: 13000,
  diferencia: -500,
  nota: null,
  anulado: false,
  anulado_motivo: null,
  anulado_at: null,
  registrado_por: "Ruth",
};

describe("mensajeResumenCierre", () => {
  const dia = "Jueves 15 de octubre";

  it("trae lo cobrado por medio, los gastos, los pagos a barberos y el efectivo contra lo esperado", () => {
    const m = mensajeResumenCierre({ barberia: "Barbería de Prueba", dia, cierre });
    expect(m).toBe(
      [
        "*Cierre del día · Barbería de Prueba*",
        "Jueves 15 de octubre",
        "",
        "*Cobrado:* $ 57.000 (3 cobros)",
        "• Efectivo: $ 25.000",
        "• Nequi: $ 32.000",
        "• Servicios $ 55.000 + propinas $ 2.000",
        "",
        "*Gastos:* $ 10.000 (2 gastos)",
        "• Efectivo: $ 4.000",
        "• Nequi: $ 6.000",
        "",
        "*Pagos a barberos:* $ 7.500",
        "• Efectivo: $ 7.500",
        "",
        "*Efectivo en la caja*",
        "Esperado: $ 13.500",
        "Contado: $ 13.000",
        "Diferencia: Faltan $ 500",
      ].join("\n")
    );
  });

  it("solo nombra lo que tuvo movimiento y dice cuando cuadra o sobra", () => {
    const m = mensajeResumenCierre({
      barberia: "B",
      dia,
      cierre: {
        ...cierre,
        cobros: 1,
        gastos: 0,
        gastos_efectivo: 0,
        gastos_transferencia: 0,
        liquidaciones_efectivo: 0,
        efectivo_esperado: 25000,
        efectivo_contado: 25500,
        diferencia: 500,
        nota: "Billete de más",
      },
    });
    expect(m).toContain("*Cobrado:* $ 57.000 (1 cobro)");
    expect(m).toContain("*Gastos:* $ 0\n\n*Efectivo en la caja*");
    expect(m).not.toContain("Pagos a barberos");
    expect(m).toContain("Diferencia: Sobran $ 500");
    expect(m.endsWith("\n\nNota: Billete de más")).toBe(true);
    expect(mensajeResumenCierre({ barberia: "B", dia, cierre: { ...cierre, liquidaciones_efectivo: 0, liquidaciones_transferencia: 3000 } })).toContain(
      "*Pagos a barberos:* $ 3.000\n• Transferencia: $ 3.000"
    );
    expect(mensajeResumenCierre({ barberia: "B", dia, cierre: { ...cierre, efectivo_contado: 13500, diferencia: 0 } })).toContain("Diferencia: Cuadra");
  });

  it("no deja espacios raros y se manda por WhatsApp sin perder nada", () => {
    const m = mensajeResumenCierre({ barberia: "Barbería de Prueba", dia, cierre });
    expect(m).not.toMatch(/[  ]/);
    const enlace = enlaceWhatsappSinNumero(m);
    expect(enlace.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(enlace.split("?text=")[1])).toBe(m);
  });
});

describe("mensajeRecordatorio", () => {
  it("lleva el primer nombre, la barbería, el servicio, el barbero, el día y la hora", () => {
    const m = mensajeRecordatorio(base);
    expect(m).toContain("Hola Juan,");
    expect(m).not.toContain("Carlos");
    expect(m).toContain("en Barbería de Prueba: Corte con Camilo");
    expect(m).toContain("el jueves 15 de octubre a las 5:00 p. m.");
  });

  it("la hora cierra la frase con un solo punto («p. m.», no «p. m..»)", () => {
    expect(mensajeRecordatorio(base)).toContain("a las 5:00 p. m.\nSi no puedes venir");
    expect(mensajeRecordatorio(base)).not.toContain("..");
  });

  it("si la hora no termina en punto, se lo agrega", () => {
    expect(mensajeRecordatorio({ ...base, hora: "17:00" })).toContain("a las 17:00.\nSi no puedes venir");
  });

  it("dice «a la 1:00» y no «a las 1:00»", () => {
    expect(mensajeRecordatorio({ ...base, hora: "1:30 p. m." })).toContain("a la 1:30 p. m.");
    expect(mensajeRecordatorio({ ...base, hora: "11:30 a. m." })).toContain("a las 11:30 a. m.");
    expect(mensajeRecordatorio({ ...base, hora: "12:00 p. m." })).toContain("a las 12:00 p. m.");
  });

  it("sin nombre, saluda sin él", () => {
    expect(mensajeRecordatorio({ ...base, cliente: "   " })).toMatch(/^Hola, te recordamos/);
  });

  it("no deja espacios raros en la hora", () => {
    const m = mensajeRecordatorio({ ...base, hora: "5:00 p. m." });
    expect(m).not.toMatch(/[  ]/);
    expect(m).toContain("5:00 p. m.");
  });
});
