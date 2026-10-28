/**
 * Liquidar comisiones (tarea 3.5 · migración 0023, SPEC F7): pagarle a un barbero lo que se le debe sin liquidar dos
 * veces el mismo cobro, anular la liquidación, y el resumen por barbero y periodo.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { como, crearMiembro, crearRol, rpc } from "./base-datos";
import { crearEscenarioAgenda, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  const { crearBase } = await import("./base-datos");
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

type Liquidado = {
  ok: boolean;
  ya_existia: boolean;
  id: string;
  barbero_id: string;
  barbero: string;
  cobros: number;
  comision: number;
  propina: number;
  total: number;
  medio: string;
  hasta: string;
  fecha: string;
  anulada: boolean;
};
type Resumen = {
  desde: string;
  hasta: string;
  todos: boolean;
  barberos: {
    id: string;
    nombre: string;
    activo: boolean;
    cobros: number;
    servicios: number;
    comision: number;
    propina: number;
    liquidado: number;
    pendiente_cobros: number;
    pendiente: number;
    pendiente_desde: string | null;
  }[];
};
type DeBarbero = {
  barbero: { id: string; nombre: string };
  hasta: string;
  pendiente: { cobros: number; comision: number; propina: number; total: number; desde: string | null };
  cobros: { id: string; fecha: string; cliente: string | null; servicios: string; total: number; comision: number; propina_barbero: number }[];
  liquidaciones: { id: string; total: number; cobros: number; medio: string; anulada: boolean }[];
};

const D1 = "2030-03-01";
const D2 = "2030-03-02";
const D3 = "2030-03-05";

const filas = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

/** Una venta (sin cita) del barbero, en el día que se diga: el día de un cobro es el del reloj, que aquí no sirve. */
async function vender(e: EscenarioAgenda, barbero: string, dia: string, o: { propina?: number; items?: unknown[]; total?: number } = {}) {
  const items = o.items ?? [{ servicio_id: e.corte }];
  const total = o.total ?? (barbero === e.camilo ? 18000 : 15000);
  const propina = o.propina ?? 0;
  const r = await rpc<{ id: string }>(db, e.cajero, "cobrar_venta", {
    p_barbero: barbero,
    p_clave: randomUUID(),
    p_items: items,
    p_propina: propina,
    p_pagos: total + propina > 0 ? [{ medio: "efectivo", monto: total + propina }] : [],
  });
  await db.query(`update public.cobros set fecha = $2 where id = $1`, [r.id, dia]);
  return r.id;
}

const liquidar = (actor: string | null, barbero: string, hasta: string, args: Record<string, unknown> = {}) =>
  rpc<Liquidado>(db, actor, "liquidar_comisiones", { p_barbero: barbero, p_hasta: hasta, p_medio: "efectivo", p_clave: randomUUID(), ...args });

const anularLiquidacion = (actor: string | null, id: string, motivo: string | null = "Se pagó mal") =>
  rpc<{ ok: boolean; id: string; cobros: number }>(db, actor, "anular_liquidacion", { p_id: id, p_motivo: motivo });

const vigentesDe = async (cobro: string) =>
  (await filas(`select 1 from public.liquidacion_cobros where cobro_id = $1 and vigente`, [cobro])).length;

describe("liquidar_comisiones", () => {
  it("paga todo lo pendiente del barbero hasta el día elegido: comisión y la propina que es suya", async () => {
    const e = await crearEscenarioAgenda(db);
    const a = await vender(e, e.camilo, D1, { propina: 2000 });
    const b = await vender(e, e.camilo, D2);
    const despues = await vender(e, e.camilo, D3);
    const deDani = await vender(e, e.dani, D1);

    const r = await liquidar(e.userId, e.camilo, D2, { p_medio: "transferencia", p_nota: "  Quincena  " });
    expect(r).toMatchObject({
      ok: true,
      ya_existia: false,
      barbero: "Camilo",
      cobros: 2,
      comision: 18000, // 9.000 + 9.000 (50 %)
      propina: 2000,
      total: 20000,
      medio: "transferencia",
      hasta: D2,
      anulada: false,
    });
    expect(await vigentesDe(a)).toBe(1);
    expect(await vigentesDe(b)).toBe(1);
    expect(await vigentesDe(despues)).toBe(0);
    expect(await vigentesDe(deDani)).toBe(0);

    const [fila] = await filas<{ nota: string; fecha: Date; registrado_por: string }>(`select nota, fecha, registrado_por from public.liquidaciones where id = $1`, [r.id]);
    expect(fila).toMatchObject({ nota: "Quincena", registrado_por: e.userId });
    const [hoy] = await filas<{ hoy: Date }>(`select public.hoy_bogota() as hoy`);
    expect(fila.fecha).toEqual(hoy.hoy);
  });

  it("lo que se le paga es lo que se guardó al cobrar: cambiar el porcentaje después no lo mueve", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1, { propina: 1000 });
    await rpc(db, e.userId, "guardar_comisiones_barbero", { p_barbero: e.camilo, p_pct: 90, p_excepciones: [] });
    await rpc(db, e.userId, "fijar_propina_del_barbero", { p_del_barbero: false });
    const r = await liquidar(e.userId, e.camilo, D1);
    expect(r).toMatchObject({ comision: 9000, propina: 1000, total: 10000 });
  });

  it("si la propina no era del barbero, no se le paga", async () => {
    const e = await crearEscenarioAgenda(db);
    await rpc(db, e.userId, "fijar_propina_del_barbero", { p_del_barbero: false });
    await vender(e, e.camilo, D1, { propina: 3000 });
    expect(await liquidar(e.userId, e.camilo, D1)).toMatchObject({ comision: 9000, propina: 0, total: 9000 });
  });

  it("los cobros anulados no se liquidan", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    const malo = await vender(e, e.camilo, D1);
    await rpc(db, e.cajero, "anular_cobro", { p_cobro: malo, p_motivo: "Error" });
    const r = await liquidar(e.userId, e.camilo, D1);
    expect(r).toMatchObject({ cobros: 1, total: 9000 });
    expect(await vigentesDe(malo)).toBe(0);
  });

  it("repetir la clave devuelve la misma liquidación, sin pagar dos veces", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    const clave = randomUUID();
    const a = await liquidar(e.userId, e.camilo, D1, { p_clave: clave });
    const b = await liquidar(e.userId, e.camilo, D1, { p_clave: clave });
    expect(a.ya_existia).toBe(false);
    expect(b).toMatchObject({ ya_existia: true, id: a.id, total: 9000 });
    expect((await filas(`select 1 from public.liquidaciones where barberia_id = $1`, [e.barberiaId])).length).toBe(1);
    expect((await filas(`select 1 from public.liquidacion_cobros where barberia_id = $1`, [e.barberiaId])).length).toBe(1);
  });

  it("con otra clave y nada pendiente no se crea nada", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    await liquidar(e.userId, e.camilo, D1);
    await expect(liquidar(e.userId, e.camilo, D1)).rejects.toMatchObject({
      code: "P0001",
      message: "No hay nada por liquidar de Camilo hasta el 01/03/2030.",
    });
    await expect(liquidar(e.userId, e.dani, D3)).rejects.toMatchObject({ message: expect.stringContaining("No hay nada por liquidar de Dani") });
    expect((await filas(`select 1 from public.liquidaciones where barberia_id = $1`, [e.barberiaId])).length).toBe(1);
  });

  it("un cobro no se liquida dos veces: la segunda liquidación paga solo lo nuevo", async () => {
    const e = await crearEscenarioAgenda(db);
    const a = await vender(e, e.camilo, D1);
    const b = await vender(e, e.camilo, D3);
    const primera = await liquidar(e.userId, e.camilo, D2);
    const segunda = await liquidar(e.userId, e.camilo, D3);
    expect(primera).toMatchObject({ cobros: 1, total: 9000 });
    expect(segunda).toMatchObject({ cobros: 1, total: 9000 });
    expect(await vigentesDe(a)).toBe(1);
    expect(await vigentesDe(b)).toBe(1);
  });

  it("la base lo garantiza aunque alguien escriba directo: un cobro, una sola liquidación vigente", async () => {
    const e = await crearEscenarioAgenda(db);
    const cobro = await vender(e, e.camilo, D1);
    const primera = await liquidar(e.userId, e.camilo, D1);
    const otra = randomUUID();
    await db.query(
      `insert into public.liquidaciones (id, barberia_id, barbero_id, clave, hasta, medio, cobros, comision, propina, total, fecha)
       values ($1, $2, $3, $4, $5, 'efectivo', 1, 9000, 0, 9000, $5)`,
      [otra, e.barberiaId, e.camilo, randomUUID(), D1]
    );
    await expect(
      db.query(`insert into public.liquidacion_cobros (barberia_id, liquidacion_id, cobro_id, comision, propina_barbero) values ($1, $2, $3, 9000, 0)`, [
        e.barberiaId,
        otra,
        cobro,
      ])
    ).rejects.toMatchObject({ code: "23505" });
    expect(primera.ok).toBe(true);
  });

  it("un barbero con 0 % también se liquida (queda en cero, los cobros dejan de estar pendientes)", async () => {
    const e = await crearEscenarioAgenda(db);
    await rpc(db, e.userId, "guardar_comisiones_barbero", { p_barbero: e.dani, p_pct: 0, p_excepciones: [] });
    const cobro = await vender(e, e.dani, D1);
    const r = await liquidar(e.userId, e.dani, D1);
    expect(r).toMatchObject({ cobros: 1, comision: 0, propina: 0, total: 0 });
    expect(await vigentesDe(cobro)).toBe(1);
  });

  it("también se liquida a un barbero archivado", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.dani, D1);
    await rpc(db, e.userId, "fijar_barbero_activo", { p_id: e.dani, p_activo: false });
    expect(await liquidar(e.userId, e.dani, D1)).toMatchObject({ barbero: "Dani", cobros: 1, total: 7500 });
  });

  it("se pide la clave, el medio y el día; el medio es efectivo o transferencia", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    await expect(liquidar(e.userId, e.camilo, D1, { p_clave: null })).rejects.toMatchObject({ message: expect.stringContaining("Falta la clave") });
    await expect(liquidar(e.userId, e.camilo, D1, { p_medio: "fiado" })).rejects.toMatchObject({ message: expect.stringContaining("efectivo o transferencia") });
    await expect(liquidar(e.userId, e.camilo, D1, { p_medio: null })).rejects.toMatchObject({ message: expect.stringContaining("efectivo o transferencia") });
    await expect(liquidar(e.userId, e.camilo, null as unknown as string)).rejects.toMatchObject({ message: expect.stringContaining("hasta qué día") });
    expect((await filas(`select 1 from public.liquidaciones where barberia_id = $1`, [e.barberiaId])).length).toBe(0);
  });

  it("la nota se limpia y se recorta a 200 letras", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    const r = await liquidar(e.userId, e.camilo, D1, { p_nota: "x".repeat(300) });
    const [fila] = await filas<{ nota: string }>(`select nota from public.liquidaciones where id = $1`, [r.id]);
    expect(fila.nota).toHaveLength(200);
  });

  it("un barbero que no existe o es de otra barbería no se liquida", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    await vender(a, a.camilo, D1);
    await expect(liquidar(a.userId, randomUUID(), D1)).rejects.toMatchObject({ code: "P0002" });
    await expect(liquidar(b.userId, a.camilo, D1)).rejects.toMatchObject({ code: "P0002" });
    expect(await liquidar(a.userId, a.camilo, D1)).toMatchObject({ ok: true });
  });

  it("liquidan el dueño y quien tiene el área comisiones; no la recepción, la caja ni el barbero", async () => {
    const e = await crearEscenarioAgenda(db);
    await crearRol(db, e.barberiaId, "Contadora", ["comisiones"]);
    const contadora = await crearMiembro(db, e.barberiaId, "Marta", ["Contadora"]);
    await vender(e, e.camilo, D1);
    await vender(e, e.dani, D1);
    for (const actor of [e.recepcion, e.cajero, e.cuentaCamilo, e.cuentaDani]) {
      await expect(liquidar(actor, e.camilo, D1)).rejects.toMatchObject({ code: "42501" });
    }
    await expect(liquidar(null, e.camilo, D1)).rejects.toMatchObject({ code: "42501" });
    expect(await liquidar(contadora, e.camilo, D1)).toMatchObject({ ok: true });
    expect(await liquidar(e.userId, e.dani, D1)).toMatchObject({ ok: true });
  });
});

describe("anular_liquidacion", () => {
  it("la anula con motivo: los cobros vuelven a estar pendientes y se pueden liquidar de nuevo", async () => {
    const e = await crearEscenarioAgenda(db);
    const cobro = await vender(e, e.camilo, D1);
    const r = await liquidar(e.userId, e.camilo, D1);
    expect(await anularLiquidacion(e.userId, r.id, "  Me equivoqué de medio  ")).toEqual({ ok: true, id: r.id, cobros: 1 });

    const [fila] = await filas<{ anulada: boolean; anulada_motivo: string; anulada_por: string; anulada_at: Date | null }>(
      `select anulada, anulada_motivo, anulada_por, anulada_at from public.liquidaciones where id = $1`,
      [r.id]
    );
    expect(fila).toMatchObject({ anulada: true, anulada_motivo: "Me equivoqué de medio", anulada_por: e.userId });
    expect(fila.anulada_at).not.toBeNull();
    expect(await vigentesDe(cobro)).toBe(0);
    // El renglón se conserva como historia.
    expect((await filas(`select 1 from public.liquidacion_cobros where liquidacion_id = $1 and not vigente`, [r.id])).length).toBe(1);

    const otra = await liquidar(e.userId, e.camilo, D1, { p_medio: "transferencia" });
    expect(otra).toMatchObject({ cobros: 1, total: 9000, medio: "transferencia" });
    expect(otra.id).not.toBe(r.id);
    expect(await vigentesDe(cobro)).toBe(1);
  });

  it("repetir la clave de una liquidación anulada avisa que se anuló y no la da por hecha", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    const clave = randomUUID();
    const r = await liquidar(e.userId, e.camilo, D1, { p_clave: clave });
    await anularLiquidacion(e.userId, r.id);
    await expect(liquidar(e.userId, e.camilo, D1, { p_clave: clave })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("ya se anuló"),
    });
    expect((await filas(`select 1 from public.liquidacion_cobros where liquidacion_id = $1 and vigente`, [r.id])).length).toBe(0);
  });

  it.each([["vacío", ""], ["solo espacios", "   "], ["nulo", null]])("el motivo es obligatorio (%s)", async (_nombre, motivo) => {
    const e = await crearEscenarioAgenda(db);
    const cobro = await vender(e, e.camilo, D1);
    const r = await liquidar(e.userId, e.camilo, D1);
    await expect(anularLiquidacion(e.userId, r.id, motivo)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Escribe el motivo de la anulación"),
    });
    expect(await vigentesDe(cobro)).toBe(1);
  });

  it("no se anula dos veces, ni una que no existe o es de otra barbería", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    await vender(a, a.camilo, D1);
    const r = await liquidar(a.userId, a.camilo, D1);
    await expect(anularLiquidacion(b.userId, r.id)).rejects.toMatchObject({ code: "P0002" });
    await expect(anularLiquidacion(a.userId, randomUUID())).rejects.toMatchObject({ code: "P0002" });
    await anularLiquidacion(a.userId, r.id, "Primera");
    await expect(anularLiquidacion(a.userId, r.id, "Segunda")).rejects.toMatchObject({ message: expect.stringContaining("ya está anulada") });
    const [fila] = await filas<{ anulada_motivo: string }>(`select anulada_motivo from public.liquidaciones where id = $1`, [r.id]);
    expect(fila.anulada_motivo).toBe("Primera");
  });

  it("solo la anula quien tiene el área comisiones", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    const r = await liquidar(e.userId, e.camilo, D1);
    for (const actor of [e.recepcion, e.cajero, e.cuentaCamilo, null]) {
      await expect(anularLiquidacion(actor, r.id)).rejects.toMatchObject({ code: "42501" });
    }
    expect((await filas<{ anulada: boolean }>(`select anulada from public.liquidaciones where id = $1`, [r.id]))[0].anulada).toBe(false);
  });
});

describe("un cobro liquidado no se anula", () => {
  it("ni por la API ni escribiendo directo; al anular la liquidación, sí", async () => {
    const e = await crearEscenarioAgenda(db);
    const cobro = await vender(e, e.camilo, D1);
    const r = await liquidar(e.userId, e.camilo, D1);

    await expect(rpc(db, e.cajero, "anular_cobro", { p_cobro: cobro, p_motivo: "Error" })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringMatching(/ya se le liquidó a Camilo el \d\d\/\d\d\/\d{4}\. Anula primero esa liquidación/),
    });
    await expect(
      db.query(`update public.cobros set anulado = true, anulado_motivo = 'Directo', anulado_at = now() where id = $1`, [cobro])
    ).rejects.toMatchObject({ message: expect.stringContaining("ya se le liquidó") });
    expect((await filas<{ anulado: boolean }>(`select anulado from public.cobros where id = $1`, [cobro]))[0].anulado).toBe(false);

    await anularLiquidacion(e.userId, r.id);
    expect(await rpc(db, e.cajero, "anular_cobro", { p_cobro: cobro, p_motivo: "Error" })).toMatchObject({ ok: true });
  });

  it("los demás cobros del barbero sí se pueden anular", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    const sinLiquidar = await vender(e, e.camilo, D3);
    await liquidar(e.userId, e.camilo, D1);
    expect(await rpc(db, e.cajero, "anular_cobro", { p_cobro: sinLiquidar, p_motivo: "Error" })).toMatchObject({ ok: true });
  });

  it("obtener_cobro dice qué liquidación lo paga (a quien puede verla)", async () => {
    const e = await crearEscenarioAgenda(db);
    const cobro = await vender(e, e.camilo, D1);
    expect(await rpc<{ liquidacion_id: string | null }>(db, e.userId, "obtener_cobro", { p_id: cobro })).toMatchObject({ liquidacion_id: null });
    const r = await liquidar(e.userId, e.camilo, D1);
    expect(await rpc<{ liquidacion_id: string | null }>(db, e.userId, "obtener_cobro", { p_id: cobro })).toMatchObject({ liquidacion_id: r.id });
    // Quien solo cobra (sin el área comisiones) no ve las liquidaciones.
    expect(await rpc<{ liquidacion_id: string | null }>(db, e.cajero, "obtener_cobro", { p_id: cobro })).toMatchObject({ liquidacion_id: null });
    await anularLiquidacion(e.userId, r.id);
    expect(await rpc<{ liquidacion_id: string | null }>(db, e.userId, "obtener_cobro", { p_id: cobro })).toMatchObject({ liquidacion_id: null });
  });
});

describe("lo liquidado no se edita ni se borra", () => {
  it("la liquidación y sus renglones solo cambian al anularse", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    const r = await liquidar(e.userId, e.camilo, D1);

    for (const sql of [
      `update public.liquidaciones set total = 1, comision = 1 where id = $1`,
      `update public.liquidaciones set medio = 'transferencia' where id = $1`,
      `update public.liquidaciones set hasta = '2031-01-01' where id = $1`,
    ]) {
      await expect(db.query(sql, [r.id])).rejects.toMatchObject({ code: "42501", message: expect.stringContaining("no se edita") });
    }
    await expect(db.query(`update public.liquidacion_cobros set comision = 1 where liquidacion_id = $1`, [r.id])).rejects.toMatchObject({
      code: "42501",
    });
    for (const tabla of ["liquidaciones", "liquidacion_cobros"]) {
      await expect(db.query(`delete from public.${tabla}`)).rejects.toMatchObject({ code: "42501" });
    }
    // Anular exige motivo, y una anulada no se reactiva.
    await expect(db.query(`update public.liquidaciones set anulada = true where id = $1`, [r.id])).rejects.toMatchObject({ code: "23514" });
    await anularLiquidacion(e.userId, r.id);
    await expect(
      db.query(`update public.liquidaciones set anulada = false, anulada_motivo = null, anulada_at = null where id = $1`, [r.id])
    ).rejects.toMatchObject({ message: expect.stringContaining("no se reactiva") });
    await expect(db.query(`update public.liquidacion_cobros set vigente = true where liquidacion_id = $1`, [r.id])).rejects.toMatchObject({
      message: expect.stringContaining("no se reactiva"),
    });
  });

  it("un renglón solo entra si el cobro es del barbero, está vigente y vale lo que se anota", async () => {
    const e = await crearEscenarioAgenda(db);
    const deCamilo = await vender(e, e.camilo, D1);
    const deDani = await vender(e, e.dani, D1);
    const anulado = await vender(e, e.camilo, D1);
    await rpc(db, e.cajero, "anular_cobro", { p_cobro: anulado, p_motivo: "Error" });
    const liq = randomUUID();
    await db.query(
      `insert into public.liquidaciones (id, barberia_id, barbero_id, clave, hasta, medio, cobros, comision, propina, total, fecha)
       values ($1, $2, $3, $4, $5, 'efectivo', 1, 9000, 0, 9000, $5)`,
      [liq, e.barberiaId, e.camilo, randomUUID(), D1]
    );
    const renglon = (cobro: string, comision: number) =>
      db.query(`insert into public.liquidacion_cobros (barberia_id, liquidacion_id, cobro_id, comision, propina_barbero) values ($1, $2, $3, $4, 0)`, [
        e.barberiaId,
        liq,
        cobro,
        comision,
      ]);
    await expect(renglon(deDani, 7500)).rejects.toMatchObject({ message: expect.stringContaining("no se puede liquidar") });
    await expect(renglon(anulado, 9000)).rejects.toMatchObject({ message: expect.stringContaining("no se puede liquidar") });
    await expect(renglon(deCamilo, 1234)).rejects.toMatchObject({ message: expect.stringContaining("no se puede liquidar") });
    await renglon(deCamilo, 9000);
  });

  it("la base no deja una liquidación con el total mal sumado o con un medio raro", async () => {
    const e = await crearEscenarioAgenda(db);
    const insertar = (medio: string, comision: number, propina: number, total: number, cobros = 1) =>
      db.query(
        `insert into public.liquidaciones (barberia_id, barbero_id, clave, hasta, medio, cobros, comision, propina, total, fecha)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $4)`,
        [e.barberiaId, e.camilo, randomUUID(), D1, medio, cobros, comision, propina, total]
      );
    await expect(insertar("efectivo", 9000, 1000, 9000)).rejects.toMatchObject({ code: "23514" });
    await expect(insertar("fiado", 9000, 0, 9000)).rejects.toMatchObject({ code: "23514" });
    await expect(insertar("efectivo", 9000, 0, 9000, 0)).rejects.toMatchObject({ code: "23514" });
    await expect(insertar("efectivo", -1, 0, -1)).rejects.toMatchObject({ code: "23514" });
  });
});

describe("obtener_resumen_comisiones", () => {
  it("por barbero: lo generado en el periodo, lo ya liquidado y lo que falta hasta el final del periodo", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1, { propina: 1000 }); // antes del periodo
    await vender(e, e.camilo, D2, { propina: 2000 });
    await vender(e, e.camilo, D3);
    await vender(e, e.dani, D2);
    await liquidar(e.userId, e.camilo, D2); // paga lo del D1 y lo del D2

    const r = await rpc<Resumen>(db, e.userId, "obtener_resumen_comisiones", { p_desde: D2, p_hasta: D3 });
    expect(r).toMatchObject({ desde: D2, hasta: D3, todos: true });
    expect(r.barberos.map((b) => b.nombre)).toEqual(["Camilo", "Dani"]);
    expect(r.barberos[0]).toMatchObject({
      cobros: 2, // D2 y D3
      servicios: 36000,
      comision: 18000,
      propina: 2000,
      liquidado: 11000, // el de D2: 9.000 + 2.000
      pendiente_cobros: 1,
      pendiente: 9000, // el de D3
      pendiente_desde: D3,
    });
    expect(r.barberos[1]).toMatchObject({ cobros: 1, servicios: 15000, comision: 7500, propina: 0, liquidado: 0, pendiente_cobros: 1, pendiente: 7500 });
  });

  it("lo pendiente incluye lo de antes del periodo (nada viejo se olvida)", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    await vender(e, e.camilo, D3);
    const r = await rpc<Resumen>(db, e.userId, "obtener_resumen_comisiones", { p_desde: D3, p_hasta: D3 });
    expect(r.barberos[0]).toMatchObject({ cobros: 1, comision: 9000, pendiente_cobros: 2, pendiente: 18000, pendiente_desde: D1 });
    const antes = await rpc<Resumen>(db, e.userId, "obtener_resumen_comisiones", { p_desde: D2, p_hasta: D2 });
    expect(antes.barberos[0]).toMatchObject({ cobros: 0, comision: 0, pendiente_cobros: 1, pendiente: 9000, pendiente_desde: D1 });
  });

  it("los cobros anulados no cuentan; los barberos sin movimiento salen en cero; un archivado solo si tiene algo", async () => {
    const e = await crearEscenarioAgenda(db);
    const malo = await vender(e, e.camilo, D2);
    await rpc(db, e.cajero, "anular_cobro", { p_cobro: malo, p_motivo: "Error" });
    await vender(e, e.dani, D2);
    const lucho = (await rpc<{ id: string }>(db, e.userId, "crear_barbero", { p_nombre: "Lucho" })).id;
    await rpc(db, e.userId, "fijar_barbero_activo", { p_id: lucho, p_activo: false });
    await rpc(db, e.userId, "fijar_barbero_activo", { p_id: e.dani, p_activo: false });

    const r = await rpc<Resumen>(db, e.userId, "obtener_resumen_comisiones", { p_desde: D2, p_hasta: D2 });
    // Camilo (activo, sin cobros vigentes), Dani (archivado, pero con un cobro); Lucho (archivado y sin nada) no sale.
    expect(r.barberos.map((b) => [b.nombre, b.activo, b.cobros, b.pendiente])).toEqual([
      ["Camilo", true, 0, 0],
      ["Dani", false, 1, 7500],
    ]);
  });

  it("el barbero ve solo lo suyo; la recepción y la caja no lo ven", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    await vender(e, e.dani, D1);
    const mio = await rpc<Resumen>(db, e.cuentaCamilo, "obtener_resumen_comisiones", { p_desde: D1, p_hasta: D1 });
    expect(mio.todos).toBe(false);
    expect(mio.barberos.map((b) => b.nombre)).toEqual(["Camilo"]);
    expect(mio.barberos[0]).toMatchObject({ comision: 9000, pendiente: 9000 });
    for (const actor of [e.recepcion, e.cajero]) {
      await expect(rpc(db, actor, "obtener_resumen_comisiones", { p_desde: D1, p_hasta: D1 })).rejects.toMatchObject({ code: "42501" });
    }
    await expect(rpc(db, null, "obtener_resumen_comisiones", { p_desde: D1, p_hasta: D1 })).rejects.toMatchObject({ code: "42501" });
  });

  it("el periodo tiene que ser válido y no se mezclan barberías", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    await vender(a, a.camilo, D1);
    await expect(rpc(db, a.userId, "obtener_resumen_comisiones", { p_desde: D3, p_hasta: D1 })).rejects.toMatchObject({
      message: expect.stringContaining("periodo no es válido"),
    });
    const deB = await rpc<Resumen>(db, b.userId, "obtener_resumen_comisiones", { p_desde: D1, p_hasta: D1 });
    expect(deB.barberos.every((x) => x.cobros === 0 && x.pendiente === 0)).toBe(true);
  });
});

describe("obtener_comisiones_de_barbero y obtener_liquidacion", () => {
  it("lista lo pendiente (lo más reciente primero) con su cliente y sus servicios, y las últimas liquidaciones", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await rpc<{ id: string }>(db, e.recepcion, "crear_cita", {
      p_barbero: e.camilo,
      p_servicio: e.corte,
      p_inicio: "2030-03-04T15:00:00Z",
      p_cliente_nombre: "Juan Pérez",
    });
    const deCita = (await rpc<{ id: string }>(db, e.cajero, "cobrar_cita", {
      p_cita: cita.id,
      p_clave: randomUUID(),
      p_items: [{ servicio_id: e.corte }, { nombre: "Cera", precio: 8000 }],
      p_propina: 1000,
      p_pagos: [{ medio: "efectivo", monto: 27000 }],
    })).id;
    await db.query(`update public.cobros set fecha = $2 where id = $1`, [deCita, D3]);
    await vender(e, e.camilo, D1);
    await vender(e, e.camilo, D2);
    await liquidar(e.userId, e.camilo, D2); // paga los dos de arriba
    const tardio = await vender(e, e.camilo, D2); // se registró después de liquidar, pero es de un día ya liquidado: sigue pendiente

    const r = await rpc<DeBarbero>(db, e.userId, "obtener_comisiones_de_barbero", { p_barbero: e.camilo, p_hasta: D3 });
    expect(r.barbero.nombre).toBe("Camilo");
    expect(r.pendiente).toMatchObject({ cobros: 2, comision: 22000, propina: 1000, total: 23000, desde: D2 });
    expect(r.cobros.map((c) => c.id)).toEqual([deCita, tardio]); // el más reciente primero
    expect(r.cobros[0]).toMatchObject({ fecha: D3, cliente: "Juan Pérez", servicios: "Corte, Cera", total: 26000, comision: 13000, propina_barbero: 1000 });
    expect(r.cobros[1]).toMatchObject({ fecha: D2, cliente: null, servicios: "Corte", comision: 9000, propina_barbero: 0 });
    expect(r.liquidaciones).toHaveLength(1);
    expect(r.liquidaciones[0]).toMatchObject({ cobros: 2, total: 18000, medio: "efectivo", anulada: false });
  });

  it("el barbero ve lo suyo y no lo de otro; la caja no ve nada", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    expect((await rpc<DeBarbero>(db, e.cuentaCamilo, "obtener_comisiones_de_barbero", { p_barbero: e.camilo, p_hasta: D1 })).pendiente.total).toBe(9000);
    await expect(rpc(db, e.cuentaDani, "obtener_comisiones_de_barbero", { p_barbero: e.camilo, p_hasta: D1 })).rejects.toMatchObject({ code: "42501" });
    await expect(rpc(db, e.cajero, "obtener_comisiones_de_barbero", { p_barbero: e.camilo, p_hasta: D1 })).rejects.toMatchObject({ code: "42501" });
    await expect(rpc(db, e.userId, "obtener_comisiones_de_barbero", { p_barbero: randomUUID(), p_hasta: D1 })).rejects.toMatchObject({ code: "P0002" });
  });

  it("obtener_liquidacion trae los cobros que pagó; el barbero ve la suya; otra barbería y la caja no", async () => {
    const e = await crearEscenarioAgenda(db);
    const otra = await crearEscenarioAgenda(db);
    const a = await vender(e, e.camilo, D1, { propina: 1500 });
    await vender(e, e.camilo, D2);
    await vender(e, e.dani, D2);
    const r = await liquidar(e.userId, e.camilo, D2, { p_nota: "Semana 1" });

    const detalle = await rpc<{
      barbero: string;
      cobros: number;
      total: number;
      nota: string;
      anulada: boolean;
      items: { cobro_id: string; fecha: string; servicios: string; comision: number; propina_barbero: number }[];
    } | null>(db, e.userId, "obtener_liquidacion", { p_id: r.id });
    expect(detalle).toMatchObject({ barbero: "Camilo", cobros: 2, total: 19500, nota: "Semana 1", anulada: false });
    expect(detalle!.items.map((i) => i.cobro_id)).toContain(a);
    expect(detalle!.items.find((i) => i.cobro_id === a)).toMatchObject({ fecha: D1, servicios: "Corte", comision: 9000, propina_barbero: 1500 });

    expect(await rpc(db, e.cuentaCamilo, "obtener_liquidacion", { p_id: r.id })).toMatchObject({ id: r.id });
    expect(await rpc(db, e.cuentaDani, "obtener_liquidacion", { p_id: r.id })).toBeNull();
    expect(await rpc(db, e.cajero, "obtener_liquidacion", { p_id: r.id })).toBeNull();
    expect(await rpc(db, otra.userId, "obtener_liquidacion", { p_id: r.id })).toBeNull();

    await anularLiquidacion(e.userId, r.id, "Prueba");
    expect(await rpc(db, e.userId, "obtener_liquidacion", { p_id: r.id })).toMatchObject({ anulada: true, anulada_motivo: "Prueba" });
  });
});

describe("las tablas", () => {
  it("solo las lee quien tiene el área (o el barbero, lo suyo); nadie escribe directo desde la app", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, D1);
    await vender(e, e.dani, D1);
    await liquidar(e.userId, e.camilo, D1);
    await liquidar(e.userId, e.dani, D1);

    expect((await como(db, e.userId, `select * from public.liquidaciones`)).length).toBe(2);
    expect((await como(db, e.userId, `select * from public.liquidacion_cobros`)).length).toBe(2);
    expect((await como(db, e.cuentaCamilo, `select * from public.liquidaciones`)).length).toBe(1);
    expect((await como(db, e.cuentaCamilo, `select * from public.liquidacion_cobros`)).length).toBe(1);
    for (const actor of [e.recepcion, e.cajero]) {
      expect(await como(db, actor, `select * from public.liquidaciones`)).toEqual([]);
      expect(await como(db, actor, `select * from public.liquidacion_cobros`)).toEqual([]);
    }
    await expect(como(db, null, `select * from public.liquidaciones`)).rejects.toMatchObject({ code: "42501" });

    await expect(como(db, e.userId, `update public.liquidaciones set anulada = true`)).rejects.toMatchObject({ code: "42501" });
    await expect(como(db, e.userId, `delete from public.liquidaciones`)).rejects.toMatchObject({ code: "42501" });
    await expect(
      como(db, e.userId, `insert into public.liquidacion_cobros (barberia_id, liquidacion_id, cobro_id, comision, propina_barbero) values ($1, $2, $3, 0, 0)`, [
        e.barberiaId,
        randomUUID(),
        randomUUID(),
      ])
    ).rejects.toMatchObject({ code: "42501" });
  });
});
