/**
 * Cobros y pagos (tarea 3.1 · migración 0019, SPEC F6): cobrar una cita o una venta sin cita, pagos mixtos, descuento
 * repartido, idempotencia y que lo cobrado no se edite. Habla con la API como lo haría la app.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { como, rpc } from "./base-datos";
import { crearEscenarioAgenda, en, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  const { crearBase } = await import("./base-datos");
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

type Cobrado = {
  ok: boolean;
  ya_existia: boolean;
  id: string;
  cita_id: string | null;
  subtotal: number;
  descuento: number;
  total: number;
  propina: number;
  cobrado: number;
  vuelto: number;
  comision: number;
  fecha: string;
  anulado: boolean;
};
type Args = Record<string, unknown>;

const efectivo = (monto: number, recibido?: number) => ({ medio: "efectivo", monto, ...(recibido ? { recibido } : {}) });
const nequi = (monto: number, referencia?: string) => ({ medio: "transferencia", monto, ...(referencia ? { referencia } : {}) });

async function citaDe(e: EscenarioAgenda, o: { barbero?: string; servicio?: string; inicio?: string } = {}): Promise<string> {
  const r = await rpc<{ id: string }>(db, e.recepcion, "crear_cita", {
    p_barbero: o.barbero ?? e.camilo,
    p_servicio: o.servicio ?? e.corte,
    p_inicio: o.inicio ?? en(0),
    p_cliente_nombre: "Juan Pérez",
    p_cliente_telefono: "300 123 4567",
  });
  return r.id;
}

const cobrarCita = (e: EscenarioAgenda, actor: string, cita: string, args: Args = {}) =>
  rpc<Cobrado>(db, actor, "cobrar_cita", { p_cita: cita, p_clave: randomUUID(), ...args });

const cobrarVenta = (e: EscenarioAgenda, actor: string, args: Args = {}) =>
  rpc<Cobrado>(db, actor, "cobrar_venta", { p_barbero: e.camilo, p_clave: randomUUID(), ...args });

const filas = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

describe("cobrar_cita", () => {
  it("cobra el servicio de la cita tal cual, con el precio con el que se agendó, y la deja atendida", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    const r = await cobrarCita(e, e.cajero, cita, { p_pagos: [efectivo(18000)] });
    expect(r).toMatchObject({ ok: true, ya_existia: false, subtotal: 18000, descuento: 0, total: 18000, propina: 0, cobrado: 18000, vuelto: 0 });

    const [cobro] = await filas<{ cita_id: string; barbero_id: string; cliente_id: string; fecha: Date; created_at: Date; anulado: boolean }>(
      `select * from public.cobros where id = $1`,
      [r.id]
    );
    expect(cobro).toMatchObject({ cita_id: cita, barbero_id: e.camilo, anulado: false });
    expect(cobro.cliente_id).toEqual(expect.any(String));

    const items = await filas<{ tipo: string; nombre: string; precio: number; precio_lista: number }>(
      `select * from public.cobro_items where cobro_id = $1`,
      [r.id]
    );
    expect(items).toEqual([expect.objectContaining({ tipo: "servicio", nombre: "Corte", precio: 18000, precio_lista: 18000 })]);

    expect((await filas<{ estado: string }>(`select estado from public.citas where id = $1`, [cita]))[0].estado).toBe("atendida");
  });

  it("el precio de la cita no cambia si después cambia el catálogo", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e, { barbero: e.dani });
    await db.query(`update public.servicios set precio = 99000 where id = $1`, [e.corte]);
    const r = await cobrarCita(e, e.cajero, cita, { p_pagos: [efectivo(15000)] });
    expect(r.total).toBe(15000);
  });

  it("efectivo con vuelto: el pago guarda lo aplicado, lo recibido y el vuelto", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await cobrarCita(e, e.cajero, await citaDe(e), { p_pagos: [efectivo(18000, 20000)] });
    expect(r.vuelto).toBe(2000);
    const [p] = await filas<{ medio: string; monto: number; recibido: number; vuelto: number }>(
      `select * from public.cobro_pagos where cobro_id = $1`,
      [r.id]
    );
    expect(p).toMatchObject({ medio: "efectivo", monto: 18000, recibido: 20000, vuelto: 2000 });
  });

  it("pago mixto (parte en efectivo, parte por Nequi) suma exacto", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await cobrarCita(e, e.cajero, await citaDe(e), { p_pagos: [efectivo(10000), nequi(8000, "M1234567")] });
    expect(r).toMatchObject({ total: 18000, cobrado: 18000, vuelto: 0 });
    const pagos = await filas<{ medio: string; monto: number; referencia: string | null }>(
      `select medio, monto, referencia from public.cobro_pagos where cobro_id = $1 order by monto`,
      [r.id]
    );
    expect(pagos).toEqual([
      { medio: "transferencia", monto: 8000, referencia: "M1234567" },
      { medio: "efectivo", monto: 10000, referencia: null },
    ]);
  });

  it("los pagos tienen que sumar exactamente lo que se cobra", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    await expect(cobrarCita(e, e.cajero, cita, { p_pagos: [efectivo(10000), nequi(7000)] })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Los pagos suman $ 17.000 y el total a cobrar es $ 18.000"),
    });
    await expect(cobrarCita(e, e.cajero, cita, { p_pagos: [efectivo(19000)] })).rejects.toMatchObject({
      message: expect.stringContaining("suman $ 19.000"),
    });
    expect((await filas(`select 1 from public.cobros where cita_id = $1`, [cita])).length).toBe(0);
  });

  it("el efectivo recibido tiene que alcanzar; el medio y el monto tienen que ser válidos", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    await expect(cobrarCita(e, e.cajero, cita, { p_pagos: [efectivo(18000, 15000)] })).rejects.toMatchObject({
      message: expect.stringContaining("El efectivo recibido ($ 15.000) no alcanza"),
    });
    await expect(cobrarCita(e, e.cajero, cita, { p_pagos: [{ medio: "fiado", monto: 18000 }] })).rejects.toMatchObject({
      message: expect.stringContaining("El medio de pago no es válido"),
    });
    await expect(cobrarCita(e, e.cajero, cita, { p_pagos: [efectivo(0)] })).rejects.toMatchObject({
      message: expect.stringContaining("mayor que cero"),
    });
    await expect(cobrarCita(e, e.cajero, cita, {})).rejects.toMatchObject({ message: expect.stringContaining("Elige cómo se paga") });
  });

  it("la propina va aparte: los pagos suman total + propina", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    await expect(cobrarCita(e, e.cajero, cita, { p_propina: 2000, p_pagos: [efectivo(18000)] })).rejects.toMatchObject({
      message: expect.stringContaining("suman $ 18.000 y el total a cobrar es $ 20.000"),
    });
    const r = await cobrarCita(e, e.cajero, cita, { p_propina: 2000, p_pagos: [efectivo(20000, 20000)] });
    expect(r).toMatchObject({ total: 18000, propina: 2000, cobrado: 20000 });
  });

  it.each([-1, 1_000_001])("una propina de %s no es válida", async (propina) => {
    const e = await crearEscenarioAgenda(db);
    await expect(cobrarCita(e, e.cajero, await citaDe(e), { p_propina: propina, p_pagos: [efectivo(18000)] })).rejects.toMatchObject({
      message: expect.stringContaining("propina no es válida"),
    });
  });

  it("servicios y extras editables: otro precio, otro servicio y un extra con nombre", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    const r = await cobrarCita(e, e.cajero, cita, {
      p_items: [{ servicio_id: e.corte, precio: 16000 }, { servicio_id: e.combo }, { nombre: "  Cera   para peinar ", precio: 8000 }],
      p_pagos: [efectivo(46000)],
    });
    expect(r).toMatchObject({ subtotal: 46000, total: 46000 });
    const items = await filas<{ tipo: string; nombre: string; precio: number; precio_lista: number | null; servicio_id: string | null }>(
      `select * from public.cobro_items where cobro_id = $1 order by orden`,
      [r.id]
    );
    expect(items.map((i) => [i.tipo, i.nombre, i.precio, i.precio_lista])).toEqual([
      ["servicio", "Corte", 16000, 18000],
      ["servicio", "Corte + barba", 22000, 22000],
      ["extra", "Cera para peinar", 8000, null],
    ]);
    expect(items[2].servicio_id).toBeNull();
  });

  describe("descuento", () => {
    const extras = (...precios: number[]) => precios.map((precio, i) => ({ nombre: `Extra ${i + 1}`, precio }));
    const descuentos = async (id: string) =>
      (await filas<{ descuento: number }>(`select descuento from public.cobro_items where cobro_id = $1 order by orden`, [id])).map((r) => r.descuento);

    it("lleva motivo y queda guardado", async () => {
      const e = await crearEscenarioAgenda(db);
      const r = await cobrarCita(e, e.cajero, await citaDe(e), {
        p_descuento: 3000,
        p_descuento_motivo: "  Cliente   frecuente ",
        p_pagos: [efectivo(15000)],
      });
      expect(r).toMatchObject({ subtotal: 18000, descuento: 3000, total: 15000 });
      const [c] = await filas<{ descuento_motivo: string }>(`select descuento_motivo from public.cobros where id = $1`, [r.id]);
      expect(c.descuento_motivo).toBe("Cliente frecuente");
    });

    it("sin motivo, o mayor que lo que se cobra, se rechaza", async () => {
      const e = await crearEscenarioAgenda(db);
      const cita = await citaDe(e);
      await expect(cobrarCita(e, e.cajero, cita, { p_descuento: 1000, p_pagos: [efectivo(17000)] })).rejects.toMatchObject({
        message: expect.stringContaining("motivo del descuento"),
      });
      await expect(
        cobrarCita(e, e.cajero, cita, { p_descuento: 18001, p_descuento_motivo: "x", p_pagos: [efectivo(1)] })
      ).rejects.toMatchObject({ message: expect.stringContaining("El descuento no puede ser mayor") });
      await expect(
        cobrarCita(e, e.cajero, cita, { p_descuento: -1, p_descuento_motivo: "x", p_pagos: [efectivo(18001)] })
      ).rejects.toMatchObject({ message: expect.stringContaining("El descuento no puede ser mayor") });
    });

    it("se reparte entre las líneas en proporción a su precio y suma exacto", async () => {
      const e = await crearEscenarioAgenda(db);
      const r = await cobrarVenta(e, e.cajero, {
        p_items: [{ servicio_id: e.corte }, { servicio_id: e.combo }],
        p_descuento: 5000,
        p_descuento_motivo: "Promo",
        p_pagos: [efectivo(35000)],
      });
      // 18.000 y 22.000 sobre 40.000: 2.250 y 2.750.
      expect(await descuentos(r.id)).toEqual([2250, 2750]);
    });

    it.each([
      // [precios, descuento, cómo queda repartido]: el sobrante va, de a un peso, a la mayor fracción (empate: la primera).
      [[100, 100, 100], 100, [34, 33, 33]],
      [[3, 5], 4, [2, 2]],
      [[10, 7], 5, [3, 2]],
      [[1, 1, 1], 2, [1, 1, 0]],
      [[7, 7, 7, 7], 10, [3, 3, 2, 2]],
      [[100], 100, [100]],
    ] as [number[], number, number[]][])("el sobrante de redondeo: %j con %s de descuento -> %j", async (precios, desc, esperado) => {
      const e = await crearEscenarioAgenda(db);
      const total = precios.reduce((a, b) => a + b, 0) - desc;
      const r = await cobrarVenta(e, e.cajero, {
        p_items: extras(...precios),
        p_descuento: desc,
        p_descuento_motivo: "Prueba",
        ...(total > 0 ? { p_pagos: [efectivo(total)] } : {}),
      });
      const partes = await descuentos(r.id);
      expect(partes).toEqual(esperado);
      expect(partes.reduce((a, b) => a + b, 0)).toBe(desc);
    });

    it("un descuento igual al subtotal es una cortesía: total 0, sin pagos", async () => {
      const e = await crearEscenarioAgenda(db);
      const cita = await citaDe(e);
      await expect(
        cobrarCita(e, e.cajero, cita, { p_descuento: 18000, p_descuento_motivo: "Cortesía", p_pagos: [efectivo(1)] })
      ).rejects.toMatchObject({ message: expect.stringContaining("No hay nada que cobrar") });
      const r = await cobrarCita(e, e.cajero, cita, { p_descuento: 18000, p_descuento_motivo: "Cortesía" });
      expect(r).toMatchObject({ total: 0, cobrado: 0, descuento: 18000 });
      expect((await filas(`select 1 from public.cobro_pagos where cobro_id = $1`, [r.id])).length).toBe(0);
    });
  });

  describe("idempotencia: no hay doble cobro", () => {
    it("repetir la misma clave devuelve el mismo cobro, sin duplicar nada", async () => {
      const e = await crearEscenarioAgenda(db);
      const cita = await citaDe(e);
      const clave = randomUUID();
      const a = await cobrarCita(e, e.cajero, cita, { p_clave: clave, p_pagos: [efectivo(18000)] });
      const b = await cobrarCita(e, e.cajero, cita, { p_clave: clave, p_pagos: [efectivo(18000)] });
      expect(a.ya_existia).toBe(false);
      expect(b).toMatchObject({ ya_existia: true, id: a.id, total: 18000 });
      expect((await filas(`select 1 from public.cobros where barberia_id = $1`, [e.barberiaId])).length).toBe(1);
      expect((await filas(`select 1 from public.cobro_pagos where barberia_id = $1`, [e.barberiaId])).length).toBe(1);
    });

    it("otra clave sobre una cita ya cobrada se rechaza", async () => {
      const e = await crearEscenarioAgenda(db);
      const cita = await citaDe(e);
      await cobrarCita(e, e.cajero, cita, { p_pagos: [efectivo(18000)] });
      await expect(cobrarCita(e, e.cajero, cita, { p_pagos: [efectivo(18000)] })).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining("ya está cobrada"),
      });
      expect((await filas(`select 1 from public.cobros where cita_id = $1`, [cita])).length).toBe(1);
    });

    it("la base lo garantiza aunque alguien escriba directo: un solo cobro vigente por cita", async () => {
      const e = await crearEscenarioAgenda(db);
      const cita = await citaDe(e);
      const r = await cobrarCita(e, e.cajero, cita, { p_pagos: [efectivo(18000)] });
      await expect(
        db.query(
          `insert into public.cobros (barberia_id, cita_id, barbero_id, clave, subtotal, total) values ($1, $2, $3, $4, 18000, 18000)`,
          [e.barberiaId, cita, e.camilo, randomUUID()]
        )
      ).rejects.toMatchObject({ code: "23505" });
      expect(r.ok).toBe(true);
    });

    it("sin clave no se cobra", async () => {
      const e = await crearEscenarioAgenda(db);
      await expect(
        rpc(db, e.cajero, "cobrar_cita", { p_cita: await citaDe(e), p_clave: null, p_pagos: [efectivo(18000)] })
      ).rejects.toMatchObject({ message: expect.stringContaining("Falta la clave del cobro") });
    });
  });

  it.each(["cancelada", "no_asistio"])("una cita %s no se cobra", async (estado) => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    if (estado === "cancelada") await rpc(db, e.recepcion, "cancelar_cita", { p_id: cita, p_motivo: "Avisó" });
    else await db.query(`update public.citas set estado = 'no_asistio' where id = $1`, [cita]);
    await expect(cobrarCita(e, e.cajero, cita, { p_pagos: [efectivo(18000)] })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("no se cobra"),
    });
  });

  it("se puede cobrar una cita en atención o ya atendida (y confirmada: pasa a atendida)", async () => {
    const e = await crearEscenarioAgenda(db);
    const a = await citaDe(e, { inicio: en(0) });
    const b = await citaDe(e, { inicio: en(60) });
    await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: a, p_estado: "en_atencion" });
    await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: b, p_estado: "en_atencion" });
    await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: b, p_estado: "atendida" });
    expect((await cobrarCita(e, e.cajero, a, { p_pagos: [efectivo(18000)] })).ok).toBe(true);
    expect((await cobrarCita(e, e.cajero, b, { p_pagos: [efectivo(18000)] })).ok).toBe(true);
    expect((await filas<{ estado: string }>(`select estado from public.citas where id = any($1)`, [[a, b]])).map((c) => c.estado)).toEqual([
      "atendida",
      "atendida",
    ]);
  });

  describe("líneas", () => {
    it("sin líneas, o con más de 20, se rechaza", async () => {
      const e = await crearEscenarioAgenda(db);
      const cita = await citaDe(e);
      await expect(cobrarCita(e, e.cajero, cita, { p_items: [], p_pagos: [efectivo(1)] })).rejects.toMatchObject({
        message: expect.stringContaining("al menos un servicio o un extra"),
      });
      await expect(
        cobrarCita(e, e.cajero, cita, { p_items: Array.from({ length: 21 }, () => ({ nombre: "X", precio: 100 })), p_pagos: [efectivo(2100)] })
      ).rejects.toMatchObject({ message: expect.stringContaining("máximo 20 líneas") });
    });

    it("un extra necesita nombre y precio; un precio fuera de rango se rechaza", async () => {
      const e = await crearEscenarioAgenda(db);
      const cita = await citaDe(e);
      const intento = (item: Args) => cobrarCita(e, e.cajero, cita, { p_items: [item], p_pagos: [efectivo(1)] });
      await expect(intento({ nombre: "", precio: 1000 })).rejects.toMatchObject({ message: expect.stringContaining("nombre del extra") });
      await expect(intento({ nombre: "Cera" })).rejects.toMatchObject({ message: expect.stringContaining("necesita un precio") });
      await expect(intento({ nombre: "Cera", precio: 0 })).rejects.toMatchObject({ message: expect.stringContaining("necesita un precio") });
      await expect(intento({ servicio_id: e.corte, precio: 10_000_001 })).rejects.toMatchObject({ message: expect.stringContaining("no es válido") });
      await expect(intento({ servicio_id: e.corte, precio: -5 })).rejects.toMatchObject({ message: expect.stringContaining("no es válido") });
    });

    it("un servicio que no existe, de otra barbería o archivado se rechaza (salvo el de la propia cita)", async () => {
      const a = await crearEscenarioAgenda(db);
      const b = await crearEscenarioAgenda(db);
      const cita = await citaDe(a);
      await expect(cobrarCita(a, a.cajero, cita, { p_items: [{ servicio_id: b.corte }], p_pagos: [efectivo(1)] })).rejects.toMatchObject({
        code: "P0002",
      });
      await expect(
        cobrarCita(a, a.cajero, cita, { p_items: [{ servicio_id: "no-es-un-uuid" }], p_pagos: [efectivo(1)] })
      ).rejects.toMatchObject({ message: expect.stringContaining("servicio de una línea no es válido") });

      await db.query(`update public.servicios set activo = false where id = $1`, [a.combo]);
      await expect(cobrarCita(a, a.cajero, cita, { p_items: [{ servicio_id: a.combo }], p_pagos: [efectivo(1)] })).rejects.toMatchObject({
        message: expect.stringContaining("está archivado"),
      });
      // El servicio de la cita se puede cobrar aunque ya se haya archivado.
      await db.query(`update public.servicios set activo = false where id = $1`, [a.corte]);
      expect((await cobrarCita(a, a.cajero, cita, { p_pagos: [efectivo(18000)] })).ok).toBe(true);
    });
  });

  it("una cita de otra barbería no existe para quien la cobra", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    await expect(cobrarCita(a, b.cajero, await citaDe(a), { p_pagos: [efectivo(18000)] })).rejects.toMatchObject({ code: "P0002" });
  });
});

describe("cobrar_venta (sin cita)", () => {
  it("cobra con el barbero que atendió, sin cita y sin cliente", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await cobrarVenta(e, e.cajero, { p_items: [{ servicio_id: e.corte }], p_pagos: [efectivo(18000)] });
    expect(r).toMatchObject({ ok: true, cita_id: null, total: 18000 });
    const [c] = await filas<{ cita_id: string | null; barbero_id: string; cliente_id: string | null }>(
      `select cita_id, barbero_id, cliente_id from public.cobros where id = $1`,
      [r.id]
    );
    expect(c).toEqual({ cita_id: null, barbero_id: e.camilo, cliente_id: null });
    // Dani cobra el corte al precio del catálogo (no tiene precio propio): 15.000.
    const d = await cobrarVenta(e, e.cajero, { p_barbero: e.dani, p_items: [{ servicio_id: e.corte }], p_pagos: [efectivo(15000)] });
    expect(d.total).toBe(15000);
  });

  it("puede llevar un cliente existente; otro cliente, de otra barbería o inexistente, no", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const cliente = (await filas<{ id: string }>(`insert into public.clientes (barberia_id, nombre) values ($1, 'Ana') returning id`, [a.barberiaId]))[0].id;
    const ajeno = (await filas<{ id: string }>(`insert into public.clientes (barberia_id, nombre) values ($1, 'Otro') returning id`, [b.barberiaId]))[0].id;
    const r = await cobrarVenta(a, a.cajero, { p_cliente: cliente, p_items: [{ nombre: "Cejas", precio: 3000 }], p_pagos: [nequi(3000)] });
    expect((await filas<{ cliente_id: string }>(`select cliente_id from public.cobros where id = $1`, [r.id]))[0].cliente_id).toBe(cliente);
    await expect(
      cobrarVenta(a, a.cajero, { p_cliente: ajeno, p_items: [{ nombre: "Cejas", precio: 3000 }], p_pagos: [nequi(3000)] })
    ).rejects.toMatchObject({ code: "P0002" });
  });

  it("el barbero tiene que existir y estar activo", async () => {
    const e = await crearEscenarioAgenda(db);
    const otra = await crearEscenarioAgenda(db);
    const intento = (barbero: string) =>
      cobrarVenta(e, e.cajero, { p_barbero: barbero, p_items: [{ nombre: "Cejas", precio: 3000 }], p_pagos: [efectivo(3000)] });
    await expect(intento(otra.camilo)).rejects.toMatchObject({ code: "P0002" });
    await db.query(`update public.barberos set activo = false where id = $1`, [e.dani]);
    await expect(intento(e.dani)).rejects.toMatchObject({ message: expect.stringContaining("Dani ya no está activo") });
  });

  it("la misma clave devuelve la misma venta; claves distintas son ventas distintas", async () => {
    const e = await crearEscenarioAgenda(db);
    const clave = randomUUID();
    const args = { p_clave: clave, p_items: [{ nombre: "Cejas", precio: 3000 }], p_pagos: [efectivo(3000)] };
    const a = await cobrarVenta(e, e.cajero, args);
    const b = await cobrarVenta(e, e.cajero, args);
    expect(b).toMatchObject({ ya_existia: true, id: a.id });
    await cobrarVenta(e, e.cajero, { p_items: [{ nombre: "Cejas", precio: 3000 }], p_pagos: [efectivo(3000)] });
    expect((await filas(`select 1 from public.cobros where barberia_id = $1`, [e.barberiaId])).length).toBe(2);
  });
});

describe("permisos y lectura", () => {
  it("cobran el dueño, la recepción y quien tiene el área caja; no el barbero ni un visitante", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const actor of [e.userId, e.recepcion, e.cajero]) {
      const r = await cobrarVenta(e, actor, { p_items: [{ nombre: "Cejas", precio: 3000 }], p_pagos: [efectivo(3000)] });
      expect(r.ok).toBe(true);
    }
    await expect(cobrarVenta(e, e.cuentaCamilo, { p_items: [{ nombre: "Cejas", precio: 3000 }], p_pagos: [efectivo(3000)] })).rejects.toMatchObject({
      code: "42501",
    });
    await expect(cobrarCita(e, e.cuentaCamilo, await citaDe(e), { p_pagos: [efectivo(18000)] })).rejects.toMatchObject({ code: "42501" });
    await expect(
      rpc(db, null, "cobrar_venta", { p_barbero: e.camilo, p_clave: randomUUID(), p_items: [], p_pagos: [] })
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("obtener_cobro trae las líneas y los pagos; el barbero ve los suyos y no los de otro", async () => {
    const e = await crearEscenarioAgenda(db);
    const deCamilo = await cobrarCita(e, e.cajero, await citaDe(e, { barbero: e.camilo }), { p_pagos: [efectivo(18000, 20000)] });
    const deDani = await cobrarCita(e, e.cajero, await citaDe(e, { barbero: e.dani, inicio: en(120) }), { p_pagos: [efectivo(15000)] });

    const mio = await rpc<{ barbero: string; items: unknown[]; pagos: { vuelto: number }[]; total: number } | null>(db, e.cuentaCamilo, "obtener_cobro", {
      p_id: deCamilo.id,
    });
    expect(mio).toMatchObject({ barbero: "Camilo", total: 18000 });
    expect(mio!.items).toHaveLength(1);
    expect(mio!.pagos[0].vuelto).toBe(2000);
    expect(await rpc(db, e.cuentaCamilo, "obtener_cobro", { p_id: deDani.id })).toBeNull();
    expect(await rpc(db, e.cajero, "obtener_cobro", { p_id: deDani.id })).toMatchObject({ barbero: "Dani" });
  });

  it("una barbería no ve los cobros de otra", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const r = await cobrarVenta(a, a.cajero, { p_items: [{ nombre: "Cejas", precio: 3000 }], p_pagos: [efectivo(3000)] });
    expect(await rpc(db, b.cajero, "obtener_cobro", { p_id: r.id })).toBeNull();
    for (const tabla of ["cobros", "cobro_items", "cobro_pagos"]) {
      expect(await como(db, b.cajero, `select 1 from public.${tabla}`)).toEqual([]);
    }
    await expect(como(db, null, `select 1 from public.cobros`)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("lo cobrado no se edita ni se borra", () => {
  it("las líneas, los pagos y los montos del cobro no cambian; la anulación sí (con motivo)", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await cobrarCita(e, e.cajero, await citaDe(e), { p_pagos: [efectivo(18000)] });

    await expect(db.query(`update public.cobros set total = 1, subtotal = 1 where id = $1`, [r.id])).rejects.toMatchObject({
      message: expect.stringContaining("no se edita"),
    });
    await expect(db.query(`update public.cobros set propina = 500 where id = $1`, [r.id])).rejects.toMatchObject({ code: "42501" });
    await expect(db.query(`update public.cobro_items set precio = 1 where cobro_id = $1`, [r.id])).rejects.toMatchObject({ code: "42501" });
    await expect(db.query(`update public.cobro_pagos set monto = 1 where cobro_id = $1`, [r.id])).rejects.toMatchObject({ code: "42501" });
    for (const tabla of ["cobros", "cobro_items", "cobro_pagos"]) {
      await expect(db.query(`delete from public.${tabla}`)).rejects.toMatchObject({ code: "42501" });
    }

    // Anular sí: con motivo (el constraint lo exige). Y un cobro anulado no se reactiva.
    await expect(db.query(`update public.cobros set anulado = true where id = $1`, [r.id])).rejects.toMatchObject({ code: "23514" });
    await db.query(`update public.cobros set anulado = true, anulado_motivo = 'Prueba', anulado_at = now() where id = $1`, [r.id]);
    await expect(
      db.query(`update public.cobros set anulado = false, anulado_motivo = null, anulado_at = null where id = $1`, [r.id])
    ).rejects.toMatchObject({ message: expect.stringContaining("no se reactiva") });
  });

  it("las restricciones de la tabla: el total sale del subtotal y el descuento, y un descuento lleva motivo", async () => {
    const e = await crearEscenarioAgenda(db);
    const insertar = (subtotal: number, descuento: number, total: number, motivo: string | null) =>
      db.query(
        `insert into public.cobros (barberia_id, barbero_id, clave, subtotal, descuento, descuento_motivo, total) values ($1, $2, $3, $4, $5, $6, $7)`,
        [e.barberiaId, e.camilo, randomUUID(), subtotal, descuento, motivo, total]
      );
    await expect(insertar(10000, 0, 9000, null)).rejects.toMatchObject({ code: "23514" });
    await expect(insertar(10000, 2000, 8000, null)).rejects.toMatchObject({ code: "23514" });
    await expect(insertar(10000, 12000, -2000, "x")).rejects.toMatchObject({ code: "23514" });
    await insertar(10000, 2000, 8000, "Promo");
  });

  it("un pago en efectivo lleva recibido y vuelto coherentes; una transferencia no", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await cobrarVenta(e, e.cajero, { p_items: [{ nombre: "Cejas", precio: 3000 }], p_pagos: [efectivo(3000)] });
    const insertar = (medio: string, monto: number, recibido: number | null, vuelto: number | null) =>
      db.query(`insert into public.cobro_pagos (barberia_id, cobro_id, medio, monto, recibido, vuelto) values ($1, $2, $3, $4, $5, $6)`, [
        e.barberiaId,
        r.id,
        medio,
        monto,
        recibido,
        vuelto,
      ]);
    await expect(insertar("efectivo", 3000, null, null)).rejects.toMatchObject({ code: "23514" });
    await expect(insertar("efectivo", 3000, 5000, 1000)).rejects.toMatchObject({ code: "23514" });
    await expect(insertar("transferencia", 3000, 5000, 2000)).rejects.toMatchObject({ code: "23514" });
    await expect(insertar("fiado", 3000, null, null)).rejects.toMatchObject({ code: "23514" });
    await insertar("efectivo", 3000, 5000, 2000);
    await insertar("transferencia", 3000, null, null);
  });
});
