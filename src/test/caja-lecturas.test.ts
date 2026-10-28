/**
 * Lecturas de la caja (tarea 3.2 · migración 0020): el día de la caja y los datos de la pantalla de Cobrar.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rpc } from "./base-datos";
import { crearEscenarioAgenda, en, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  const { crearBase } = await import("./base-datos");
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

type Caja = {
  fecha: string;
  por_cobrar: { id: string; estado: string; cliente: string; precio: number }[];
  atrasadas: { id: string }[];
  cobros: { id: string; total: number; propina: number; anulado: boolean; barbero: string; medios: string[] }[];
  totales: { cobros: number; servicios: number; propinas: number; efectivo: number; transferencia: number };
};

/** Las 10:00 de Bogotá de 2030-03-04 y el día siguiente. */
const DIA = "2030-03-04";

async function cita(e: EscenarioAgenda, o: { barbero?: string; inicio?: string; nombre?: string } = {}): Promise<string> {
  const r = await rpc<{ id: string }>(db, e.recepcion, "crear_cita", {
    p_barbero: o.barbero ?? e.camilo,
    p_servicio: e.corte,
    p_inicio: o.inicio ?? en(0),
    p_cliente_nombre: o.nombre ?? "Juan Pérez",
  });
  return r.id;
}

/**
 * Cobra y deja el cobro en el día de la prueba: el día de un cobro es el de cuando se hizo (el reloj), que aquí no
 * sirve; la fecha sí se puede mover (es lo que mueve la anulación de un cierre).
 */
async function cobrar(e: EscenarioAgenda, citaId: string, pagos: unknown[], extra: Record<string, unknown> = {}) {
  const r = await rpc<{ id: string }>(db, e.cajero, "cobrar_cita", { p_cita: citaId, p_clave: randomUUID(), p_pagos: pagos, ...extra });
  await db.query(`update public.cobros set fecha = $2 where id = $1`, [r.id, DIA]);
  return r;
}

describe("obtener_caja", () => {
  it("lista las citas del día por cobrar; al cobrarlas pasan a la lista de cobros", async () => {
    const e = await crearEscenarioAgenda(db);
    const a = await cita(e, { nombre: "Ana", inicio: en(0) });
    await cita(e, { nombre: "Beto", inicio: en(60) });
    const antes = await rpc<Caja>(db, e.cajero, "obtener_caja", { p_fecha: DIA });
    expect(antes.por_cobrar.map((c) => c.cliente)).toEqual(["Ana", "Beto"]);
    expect(antes.cobros).toEqual([]);
    expect(antes.totales).toMatchObject({ cobros: 0, servicios: 0, propinas: 0, efectivo: 0, transferencia: 0 });

    await cobrar(e, a, [{ medio: "efectivo", monto: 18000 }]);
    const despues = await rpc<Caja>(db, e.cajero, "obtener_caja", { p_fecha: DIA });
    expect(despues.por_cobrar.map((c) => c.cliente)).toEqual(["Beto"]);
    expect(despues.cobros).toHaveLength(1);
    expect(despues.cobros[0]).toMatchObject({ total: 18000, barbero: "Camilo", anulado: false, medios: ["efectivo"] });
  });

  it("no ofrece cobrar las citas canceladas ni las que no asistieron", async () => {
    const e = await crearEscenarioAgenda(db);
    const a = await cita(e, { nombre: "Ana", inicio: en(0) });
    const b = await cita(e, { nombre: "Beto", inicio: en(60) });
    await cita(e, { nombre: "Carla", inicio: en(120) });
    await rpc(db, e.recepcion, "cancelar_cita", { p_id: a, p_motivo: "Avisó" });
    await db.query(`update public.citas set estado = 'no_asistio' where id = $1`, [b]);
    const caja = await rpc<Caja>(db, e.cajero, "obtener_caja", { p_fecha: DIA });
    expect(caja.por_cobrar.map((c) => c.cliente)).toEqual(["Carla"]);
  });

  it("los totales suman lo cobrado, las propinas y cada medio, sin contar los anulados", async () => {
    const e = await crearEscenarioAgenda(db);
    const a = await cita(e, { inicio: en(0) });
    const b = await cita(e, { inicio: en(60) });
    const c = await cita(e, { inicio: en(120) });
    await cobrar(e, a, [{ medio: "efectivo", monto: 18000 }]);
    await cobrar(e, b, [{ medio: "efectivo", monto: 10000 }, { medio: "transferencia", monto: 10000 }], { p_propina: 2000 });
    const anulado = await cobrar(e, c, [{ medio: "transferencia", monto: 18000 }]);
    await db.query(`update public.cobros set anulado = true, anulado_motivo = 'Prueba', anulado_at = now() where id = $1`, [anulado.id]);

    const caja = await rpc<Caja>(db, e.cajero, "obtener_caja", { p_fecha: DIA });
    expect(caja.totales).toEqual({ cobros: 2, servicios: 36000, propinas: 2000, efectivo: 28000, transferencia: 10000 });
    // Los anulados siguen en la lista (marcados), para no esconder nada.
    expect(caja.cobros).toHaveLength(3);
    expect(caja.cobros.filter((x) => x.anulado)).toHaveLength(1);
  });

  it("avisa de las atendidas de días anteriores que se quedaron sin cobrar", async () => {
    const e = await crearEscenarioAgenda(db);
    const ayer = await cita(e, { inicio: en(-24 * 60) });
    const antier = await cita(e, { inicio: en(-48 * 60) });
    const cobrada = await cita(e, { inicio: en(-72 * 60) });
    const confirmada = await cita(e, { inicio: en(-96 * 60) });
    for (const id of [ayer, antier, cobrada]) await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: id, p_estado: "en_atencion" });
    await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: antier, p_estado: "atendida" });
    await cobrar(e, cobrada, [{ medio: "efectivo", monto: 18000 }]);
    const caja = await rpc<Caja>(db, e.cajero, "obtener_caja", { p_fecha: DIA });
    expect(caja.atrasadas.map((c) => c.id).sort()).toEqual([ayer, antier].sort());
    expect(caja.atrasadas.map((c) => c.id)).not.toContain(confirmada);
  });

  it("el barbero solo ve lo suyo; una barbería no ve lo de otra", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const deCamilo = await cita(a, { nombre: "Ana", inicio: en(0), barbero: a.camilo });
    await cita(a, { nombre: "Beto", inicio: en(60), barbero: a.dani });
    await cobrar(a, deCamilo, [{ medio: "efectivo", monto: 18000 }]);

    const suya = await rpc<Caja>(db, a.cuentaCamilo, "obtener_caja", { p_fecha: DIA });
    expect(suya.cobros).toHaveLength(1);
    expect(suya.por_cobrar).toEqual([]);
    const deDani = await rpc<Caja>(db, a.cuentaDani, "obtener_caja", { p_fecha: DIA });
    expect(deDani.cobros).toEqual([]);
    expect(deDani.por_cobrar.map((c) => c.cliente)).toEqual(["Beto"]);

    const ajena = await rpc<Caja>(db, b.cajero, "obtener_caja", { p_fecha: DIA });
    expect(ajena.cobros).toEqual([]);
    expect(ajena.por_cobrar).toEqual([]);
    expect(ajena.totales.servicios).toBe(0);
  });
});

describe("datos_cobro", () => {
  type Datos = {
    cita: { id: string; precio: number; servicio: string; cliente: string; barbero: string; barbero_id: string; estado: string } | null;
    cobro_id: string | null;
    barberos: { id: string; nombre: string; precios: Record<string, number> }[];
    servicios: { id: string; nombre: string; precio: number }[];
  };

  it("trae la cita, los barberos con su precio propio y el catálogo", async () => {
    const e = await crearEscenarioAgenda(db);
    const c = await cita(e, { nombre: "Ana" });
    const d = await rpc<Datos>(db, e.cajero, "datos_cobro", { p_cita: c });
    expect(d.cita).toMatchObject({ id: c, precio: 18000, servicio: "Corte", cliente: "Ana", barbero: "Camilo", estado: "confirmada" });
    expect(d.cobro_id).toBeNull();
    expect(d.servicios.map((s) => [s.nombre, s.precio])).toEqual([["Corte", 15000], ["Corte + barba", 22000]]);
    const camilo = d.barberos.find((b) => b.nombre === "Camilo")!;
    const dani = d.barberos.find((b) => b.nombre === "Dani")!;
    expect(camilo.precios[e.corte]).toBe(18000);
    expect(camilo.precios[e.combo]).toBe(22000);
    expect(dani.precios[e.corte]).toBe(15000);
  });

  it("dice cuál es el cobro vigente de la cita, y deja de decirlo si se anula", async () => {
    const e = await crearEscenarioAgenda(db);
    const c = await cita(e);
    const r = await cobrar(e, c, [{ medio: "efectivo", monto: 18000 }]);
    expect((await rpc<Datos>(db, e.cajero, "datos_cobro", { p_cita: c })).cobro_id).toBe(r.id);
    await db.query(`update public.cobros set anulado = true, anulado_motivo = 'Prueba', anulado_at = now() where id = $1`, [r.id]);
    expect((await rpc<Datos>(db, e.cajero, "datos_cobro", { p_cita: c })).cobro_id).toBeNull();
  });

  it("sin cita sirve para una venta: solo barberos y catálogo; no muestra los archivados ni los inactivos", async () => {
    const e = await crearEscenarioAgenda(db);
    await db.query(`update public.servicios set activo = false where id = $1`, [e.combo]);
    await db.query(`update public.barberos set activo = false where id = $1`, [e.dani]);
    const d = await rpc<Datos>(db, e.cajero, "datos_cobro");
    expect(d.cita).toBeNull();
    expect(d.servicios.map((s) => s.nombre)).toEqual(["Corte"]);
    expect(d.barberos.map((b) => b.nombre)).toEqual(["Camilo"]);
    expect(Object.keys(d.barberos[0].precios)).toEqual([e.corte]);
  });

  it("una cita de otra barbería no aparece", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const c = await cita(a);
    const d = await rpc<Datos>(db, b.cajero, "datos_cobro", { p_cita: c });
    expect(d.cita).toBeNull();
    expect(d.barberos.map((x) => x.nombre)).toEqual(["Camilo", "Dani"]);
  });
});
