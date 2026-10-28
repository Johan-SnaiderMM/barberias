import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  avanzarDesde,
  esAccion,
  irAPaso,
  iniciarGuia,
  leerGuia,
  PASOS,
  pasoEnRuta,
  pasoTrasNavegar,
  pasoTrasSaltar,
  terminarGuia,
} from "./guia";

afterEach(() => terminarGuia());

describe("recorrido guiado: los pasos", () => {
  it("avanza solo cuando la persona llega a la pantalla que se le pidió", () => {
    expect(pasoTrasNavegar(1, "/agenda/cita/abc-123")).toBe(2); // tocó una cita
    expect(pasoTrasNavegar(3, "/caja/cobrar/abc-123")).toBe(4); // tocó una cita por cobrar
    expect(pasoTrasNavegar(3, "/caja/venta")).toBe(4); // o la venta sin cita
  });

  it("no avanza en otras pantallas ni en pasos que se pasan con botón", () => {
    expect(pasoTrasNavegar(1, "/caja")).toBe(1);
    expect(pasoTrasNavegar(1, "/agenda/nueva")).toBe(1);
    expect(pasoTrasNavegar(3, "/agenda")).toBe(3);
    expect(pasoTrasNavegar(0, "/inicio")).toBe(0);
    expect(pasoTrasNavegar(5, "/gastos/nuevo")).toBe(5);
    expect(pasoTrasNavegar(9, "/mas")).toBe(9);
  });

  it("si en el cobro la persona vuelve a Caja sin cobrar, la guía retrocede al paso de elegir qué cobrar", () => {
    expect(pasoTrasNavegar(4, "/caja")).toBe(3);
    expect(pasoTrasNavegar(4, "/caja/cobrar/abc")).toBe(4);
  });

  it("cada paso sabe en qué pantalla ocurre y a dónde llevar a la persona", () => {
    for (const [i, p] of PASOS.entries()) {
      expect(p.titulo.length, `paso ${i}`).toBeGreaterThan(0);
      expect(p.texto.length, `paso ${i}`).toBeGreaterThan(20);
      expect(p.ir.startsWith("/"), `paso ${i}`).toBe(true);
      // Los pasos de la cita y del cobro ocurren en una pantalla que necesita un registro: se lleva a la lista para elegirlo.
      if (i !== 2 && i !== 4) expect(pasoEnRuta(i, p.ir), `paso ${i}: «ir» debe estar dentro de «ruta»`).toBe(true);
    }
  });

  it("la pantalla a la que llega la persona en un paso es donde empieza el siguiente", () => {
    const muestras: Record<number, string> = { 1: "/agenda/cita/x", 3: "/caja/cobrar/x" };
    for (const [i, ruta] of Object.entries(muestras)) {
      expect(PASOS[Number(i)].alLlegarA?.test(ruta), `paso ${i}`).toBe(true);
      expect(pasoEnRuta(Number(i) + 1, ruta), `paso ${Number(i) + 1}`).toBe(true);
    }
  });

  it("los pasos de acción se pueden saltar sin quedar en uno que necesita lo que se omitió", () => {
    expect(esAccion(1)).toBe(true);
    expect(esAccion(3)).toBe(true);
    expect(esAccion(4)).toBe(true);
    expect(esAccion(0)).toBe(false);
    expect(esAccion(2)).toBe(false);
    expect(esAccion(9)).toBe(false);
    // Saltar la agenda va a Caja (no a «Atiende la cita», que necesita una cita abierta); saltar Caja o el cobro va a Gastos.
    expect(pasoTrasSaltar(1)).toBe(3);
    expect(pasoTrasSaltar(3)).toBe(5);
    expect(pasoTrasSaltar(4)).toBe(5);
    expect(pasoTrasSaltar(0)).toBe(1);
    for (const i of [1, 3, 4]) expect(PASOS[pasoTrasSaltar(i)].ir, `paso ${i}`).toMatch(/^\/(caja|gastos)$/);
  });

  it("cada pantalla del recorrido existe (si se renombra una ruta, esta prueba avisa)", () => {
    for (const [i, p] of PASOS.entries()) {
      const partes = p.ir.split("/").filter(Boolean);
      const candidatas = ["(app)", "(tarea)"].map((g) => path.join(process.cwd(), "src", "app", g, ...partes, "page.tsx"));
      expect(
        candidatas.some((c) => fs.existsSync(c)),
        `paso ${i}: no hay página para ${p.ir}`
      ).toBe(true);
    }
  });

  it("cada elemento que resalta la guía existe en alguna pantalla", () => {
    const fuentes: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const ruta = path.join(dir, e.name);
        if (e.isDirectory()) recorrer(ruta);
        else if (e.name.endsWith(".tsx")) fuentes.push(fs.readFileSync(ruta, "utf8"));
      }
    };
    recorrer(path.join(process.cwd(), "src"));
    const objetivos = [...new Set(PASOS.map((p) => p.objetivo).filter((o): o is string => Boolean(o)))];
    expect(objetivos.length).toBeGreaterThan(0);
    for (const o of objetivos) {
      const marcado = fuentes.some((f) => f.split("\n").some((linea) => /guia/.test(linea) && linea.includes(`"${o}"`)));
      expect(marcado, `ninguna pantalla marca data-guia="${o}"`).toBe(true);
    }
  });
});

describe("recorrido guiado: el estado", () => {
  it("empieza abierto en el primer paso", () => {
    iniciarGuia();
    expect(leerGuia()).toEqual({ paso: 0, abierta: true });
  });

  it("avanzarDesde solo avanza si la guía está en ese paso", () => {
    irAPaso(4);
    avanzarDesde(3);
    expect(leerGuia()?.paso).toBe(4);
    avanzarDesde(4); // cobro confirmado
    expect(leerGuia()).toEqual({ paso: 5, abierta: true });
    terminarGuia();
    avanzarDesde(4); // sin guía activa no hace nada
    expect(leerGuia()).toBeNull();
  });

  it("al pasar del último paso, el recorrido termina", () => {
    irAPaso(PASOS.length - 1);
    expect(leerGuia()?.paso).toBe(PASOS.length - 1);
    irAPaso(PASOS.length);
    expect(leerGuia()).toBeNull();
  });
});
