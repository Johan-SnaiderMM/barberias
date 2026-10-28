import { describe, expect, it } from "vitest";
import { armarAviso, llaveVapidABytes } from "./avisos-push";

const cita = {
  id: "11111111-1111-4111-8111-111111111111",
  cliente: "Laura Prueba",
  servicio: "Corte",
  barbero: "Camilo",
  // 2030-03-04 10:00 en Bogotá
  inicio: "2030-03-04T15:00:00Z",
};

describe("armarAviso", () => {
  it("una reserva nueva dice quién, qué, cuándo y con quién, y abre la cita", () => {
    expect(armarAviso("reserva", cita)).toEqual({
      titulo: "Nueva reserva",
      cuerpo: "Laura Prueba · Corte · lun 4 mar, 10:00 a. m. · con Camilo",
      url: `/agenda/cita/${cita.id}`,
      tag: `cita-${cita.id}-reserva`,
    });
  });

  it("si quien reservó se anotó con otro nombre (usó el celular de otra persona), el aviso lo dice", () => {
    expect(armarAviso("reserva", { ...cita, reservo_como: "Pedro" }).cuerpo).toBe(
      "Laura Prueba (reservó como Pedro) · Corte · lun 4 mar, 10:00 a. m. · con Camilo"
    );
    expect(armarAviso("reserva", { ...cita, reservo_como: null }).cuerpo).toBe(armarAviso("reserva", cita).cuerpo);
  });

  it("una cancelación lleva otro título y otro tag (no reemplaza al aviso de la reserva)", () => {
    const a = armarAviso("cancelacion", cita);
    expect(a.titulo).toBe("Cita cancelada");
    expect(a.tag).toBe(`cita-${cita.id}-cancelacion`);
    expect(a.tag).not.toBe(armarAviso("reserva", cita).tag);
  });

  it("no deja espacios finos en el texto", () => {
    expect(armarAviso("reserva", cita).cuerpo).not.toMatch(/[  ]/);
  });
});

describe("llaveVapidABytes", () => {
  it("convierte base64 url en bytes (con - y _ y sin relleno)", () => {
    // "subjects?" en base64 url -> "c3ViamVjdHM_"
    expect([...llaveVapidABytes("c3ViamVjdHM_")]).toEqual([...new TextEncoder().encode("subjects?")]);
    expect([...llaveVapidABytes("-_8")]).toEqual([0xfb, 0xff]);
  });

  it("una llave pública VAPID real mide 65 bytes y empieza con 0x04", () => {
    const llave = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
    const bytes = llaveVapidABytes(llave);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });
});
