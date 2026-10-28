import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { esquemaAnularCobro, esquemaCobro } from "./cobro";

const base = () => ({
  cita_id: randomUUID(),
  barbero_id: null,
  clave: randomUUID(),
  items: [{ servicio_id: randomUUID(), precio: 15000 }],
  descuento: 0,
  descuento_motivo: "",
  propina: 0,
  pagos: [{ medio: "efectivo", monto: 15000, recibido: 20000 }],
});

const mensaje = (entrada: unknown) => {
  const r = esquemaCobro.safeParse(entrada);
  return r.success ? null : r.error.issues[0].message;
};

describe("esquemaCobro", () => {
  it("acepta un cobro de cita con un servicio y un pago en efectivo", () => {
    expect(esquemaCobro.safeParse(base()).success).toBe(true);
  });

  it("acepta servicios y extras juntos, y una venta sin cita con su barbero", () => {
    const r = esquemaCobro.safeParse({
      ...base(),
      cita_id: null,
      barbero_id: randomUUID(),
      items: [{ servicio_id: randomUUID() }, { nombre: "  Cera ", precio: 8000 }],
      pagos: [{ medio: "transferencia", monto: 8000, referencia: " M123 " }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.items[1]).toEqual({ nombre: "Cera", precio: 8000 });
  });

  it("una venta sin cita necesita el barbero", () => {
    expect(mensaje({ ...base(), cita_id: null, barbero_id: null })).toBe("Elige el barbero.");
  });

  it("un descuento necesita su motivo", () => {
    expect(mensaje({ ...base(), descuento: 1000 })).toBe("Escribe el motivo del descuento.");
    expect(esquemaCobro.safeParse({ ...base(), descuento: 1000, descuento_motivo: "Promo" }).success).toBe(true);
  });

  it.each([
    ["sin líneas", { items: [] }, "Agrega al menos un servicio o un extra."],
    ["más de 20 líneas", { items: Array.from({ length: 21 }, () => ({ nombre: "X", precio: 100 })) }, null],
    ["un extra sin precio", { items: [{ nombre: "Cera", precio: 0 }] }, null],
    ["un extra sin nombre", { items: [{ nombre: "  ", precio: 1000 }] }, null],
    ["un precio con decimales", { items: [{ servicio_id: randomUUID(), precio: 15000.5 }] }, null],
    ["un precio altísimo", { items: [{ servicio_id: randomUUID(), precio: 10_000_001 }] }, null],
    ["una propina negativa", { propina: -1 }, "La propina no es válida."],
    ["una propina enorme", { propina: 1_000_001 }, "La propina no es válida."],
    ["un medio de pago raro", { pagos: [{ medio: "fiado", monto: 15000 }] }, "El medio de pago no es válido."],
    ["un pago en cero", { pagos: [{ medio: "efectivo", monto: 0 }] }, "El valor de cada pago debe ser mayor que cero."],
    ["una clave que no es uuid", { clave: "abc" }, "Recarga la pantalla e intenta de nuevo."],
    ["una cita que no es uuid", { cita_id: "nada" }, "La cita no es válida."],
  ] as [string, Record<string, unknown>, string | null][])("rechaza %s", (_nombre, cambio, esperado) => {
    const m = mensaje({ ...base(), ...cambio });
    expect(m).not.toBeNull();
    if (esperado) expect(m).toBe(esperado);
  });
});

describe("esquemaAnularCobro", () => {
  it("acepta un cobro con su motivo y lo recorta", () => {
    const id = randomUUID();
    const r = esquemaAnularCobro.safeParse({ id, motivo: "  Se cobró mal  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ id, motivo: "Se cobró mal" });
  });

  it.each([
    ["sin motivo", { id: randomUUID(), motivo: "" }, "Escribe por qué se anula el cobro."],
    ["con un motivo de puros espacios", { id: randomUUID(), motivo: "    " }, "Escribe por qué se anula el cobro."],
    ["con un motivo de más de 200 letras", { id: randomUUID(), motivo: "a".repeat(201) }, "El motivo es muy largo (máximo 200 letras)."],
    ["con un cobro que no es uuid", { id: "123", motivo: "Error" }, "El cobro no es válido."],
  ])("rechaza %s", (_nombre, entrada, esperado) => {
    const r = esquemaAnularCobro.safeParse(entrada);
    expect(r.success ? null : r.error.issues[0].message).toBe(esperado);
  });
});
