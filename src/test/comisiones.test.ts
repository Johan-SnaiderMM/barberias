/**
 * Comisiones (tarea 3.4 · migración 0022, SPEC F7): el porcentaje por barbero con excepción por servicio, calculado
 * al cobrar y guardado en cada línea (instantánea), la propina del barbero y los permisos del área "comisiones".
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { como, crearMiembro, crearRol, rpc } from "./base-datos";
import { crearEscenarioAgenda, en, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  const { crearBase } = await import("./base-datos");
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

type Cobrado = { ok: boolean; id: string; total: number; propina: number; comision: number };
type Args = Record<string, unknown>;
type Config = {
  defecto: number;
  propina_del_barbero: boolean;
  barberos: { id: string; nombre: string; activo: boolean; pct: number; definido: boolean; excepciones: { servicio_id: string; servicio: string; pct: number }[] }[];
};

const efectivo = (monto: number, recibido?: number) => ({ medio: "efectivo", monto, ...(recibido ? { recibido } : {}) });
const nequi = (monto: number) => ({ medio: "transferencia", monto });

const filas = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

/** Una venta sin cita (así no hay que armar agenda) de lo que se pida, pagada tal cual en efectivo. */
async function vender(e: EscenarioAgenda, barbero: string, items: unknown[], extra: Args = {}): Promise<Cobrado> {
  // Lo que cobra cada barbero por el catálogo del escenario: Camilo $ 18.000 el corte, Dani $ 15.000; el combo $ 22.000.
  const precioDe = (i: { servicio_id?: string; precio?: number }) =>
    i.precio ?? (i.servicio_id === e.corte ? (barbero === e.camilo ? 18000 : 15000) : 22000);
  const subtotal = (items as { servicio_id?: string; precio?: number }[]).reduce((s, i) => s + precioDe(i), 0);
  const aCobrar = subtotal - Number(extra.p_descuento ?? 0) + Number(extra.p_propina ?? 0);
  return rpc<Cobrado>(db, e.cajero, "cobrar_venta", {
    p_barbero: barbero,
    p_clave: randomUUID(),
    p_items: items,
    p_pagos: aCobrar > 0 ? [efectivo(aCobrar)] : [],
    ...extra,
  });
}

const guardar = (e: EscenarioAgenda, barbero: string, pct: number, excepciones: { servicio_id: string; pct: number }[] = []) =>
  rpc(db, e.userId, "guardar_comisiones_barbero", { p_barbero: barbero, p_pct: pct, p_excepciones: excepciones });

const lineas = (cobro: string) =>
  filas<{ tipo: string; servicio_id: string | null; precio: number; descuento: number; comision_pct: number; comision: number }>(
    `select tipo, servicio_id, precio, descuento, comision_pct, comision from public.cobro_items where cobro_id = $1 order by orden`,
    [cobro]
  );
const cobroDe = async (id: string) =>
  (await filas<{ comision: number; propina: number; propina_barbero: number; total: number; subtotal: number; descuento: number }>(
    `select comision, propina, propina_barbero, total, subtotal, descuento from public.cobros where id = $1`,
    [id]
  ))[0];

describe("el porcentaje al cobrar", () => {
  it("sin nada guardado, un barbero gana el 50 % por defecto", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await vender(e, e.camilo, [{ servicio_id: e.corte }]);
    expect(r.total).toBe(18000);
    expect(await lineas(r.id)).toEqual([expect.objectContaining({ precio: 18000, comision_pct: 50, comision: 9000 })]);
    expect((await cobroDe(r.id)).comision).toBe(9000);
    expect((await filas<{ d: number }>(`select public.fn_comision_defecto() as d`))[0].d).toBe(50);
  });

  it("el porcentaje del barbero se aplica a los cobros nuevos y queda guardado en la línea", async () => {
    const e = await crearEscenarioAgenda(db);
    await guardar(e, e.camilo, 60);
    const r = await vender(e, e.camilo, [{ servicio_id: e.corte }]);
    expect(await lineas(r.id)).toEqual([expect.objectContaining({ comision_pct: 60, comision: 10800 })]);
    expect((await cobroDe(r.id)).comision).toBe(10800);
  });

  it("cambiar el porcentaje no altera los cobros ya hechos (instantánea)", async () => {
    const e = await crearEscenarioAgenda(db);
    const antes = await vender(e, e.camilo, [{ servicio_id: e.corte }]);
    await guardar(e, e.camilo, 70);
    const medio = await vender(e, e.camilo, [{ servicio_id: e.corte }]);
    await guardar(e, e.camilo, 40, [{ servicio_id: e.corte, pct: 10 }]);

    expect(await lineas(antes.id)).toEqual([expect.objectContaining({ comision_pct: 50, comision: 9000 })]);
    expect(await lineas(medio.id)).toEqual([expect.objectContaining({ comision_pct: 70, comision: 12600 })]);
    expect((await cobroDe(antes.id)).comision).toBe(9000);
    expect(await rpc(db, e.cajero, "obtener_cobro", { p_id: antes.id })).toMatchObject({
      comision: 9000,
      items: [expect.objectContaining({ comision_pct: 50, comision: 9000 })],
    });
    // El cobro nuevo sí usa lo de ahora (la excepción del corte).
    const despues = await vender(e, e.camilo, [{ servicio_id: e.corte }]);
    expect(await lineas(despues.id)).toEqual([expect.objectContaining({ comision_pct: 10, comision: 1800 })]);
  });

  it("una excepción por servicio manda sobre el porcentaje base; lo demás usa el base", async () => {
    const e = await crearEscenarioAgenda(db);
    await guardar(e, e.camilo, 50, [{ servicio_id: e.corte, pct: 70 }]);
    const r = await vender(e, e.camilo, [{ servicio_id: e.corte }, { servicio_id: e.combo }]);
    expect(await lineas(r.id)).toEqual([
      expect.objectContaining({ precio: 18000, comision_pct: 70, comision: 12600 }),
      expect.objectContaining({ precio: 22000, comision_pct: 50, comision: 11000 }),
    ]);
    expect((await cobroDe(r.id)).comision).toBe(23600);
  });

  it("una excepción es del barbero: otro barbero cobra el mismo servicio con su propio porcentaje", async () => {
    const e = await crearEscenarioAgenda(db);
    await guardar(e, e.camilo, 50, [{ servicio_id: e.corte, pct: 70 }]);
    await guardar(e, e.dani, 40);
    const deDani = await vender(e, e.dani, [{ servicio_id: e.corte }]);
    expect(await lineas(deDani.id)).toEqual([expect.objectContaining({ precio: 15000, comision_pct: 40, comision: 6000 })]);
    const deCamilo = await vender(e, e.camilo, [{ servicio_id: e.corte }]);
    expect(await lineas(deCamilo.id)).toEqual([expect.objectContaining({ comision_pct: 70 })]);
  });

  it("un extra usa el porcentaje base del barbero, aunque haya excepciones", async () => {
    const e = await crearEscenarioAgenda(db);
    await guardar(e, e.camilo, 40, [{ servicio_id: e.corte, pct: 90 }]);
    const r = await vender(e, e.camilo, [{ nombre: "Cera", precio: 8000 }]);
    expect(await lineas(r.id)).toEqual([expect.objectContaining({ tipo: "extra", comision_pct: 40, comision: 3200 })]);
  });

  it("redondea hacia abajo al peso y el resto queda para la barbería", async () => {
    const e = await crearEscenarioAgenda(db);
    const a = await vender(e, e.camilo, [{ servicio_id: e.corte, precio: 15001 }]);
    expect((await lineas(a.id))[0]).toMatchObject({ comision_pct: 50, comision: 7500 });
    expect(15001 - (await cobroDe(a.id)).comision).toBe(7501);

    await guardar(e, e.camilo, 33);
    const b = await vender(e, e.camilo, [{ nombre: "Gel", precio: 999 }]);
    expect((await lineas(b.id))[0]).toMatchObject({ comision_pct: 33, comision: 329 });
  });

  it("se calcula sobre lo que realmente se cobró: el descuento se reparte entre las líneas", async () => {
    const e = await crearEscenarioAgenda(db);
    // 18.000 + 22.000 = 40.000 con 10.000 de descuento: a la primera le tocan 4.500 y a la segunda 5.500.
    const r = await vender(e, e.camilo, [{ servicio_id: e.corte }, { servicio_id: e.combo }], {
      p_descuento: 10000,
      p_descuento_motivo: "Cliente frecuente",
    });
    expect(await lineas(r.id)).toEqual([
      expect.objectContaining({ precio: 18000, descuento: 4500, comision: 6750 }),
      expect.objectContaining({ precio: 22000, descuento: 5500, comision: 8250 }),
    ]);
    expect((await cobroDe(r.id)).comision).toBe(15000);

    await guardar(e, e.camilo, 50, [{ servicio_id: e.corte, pct: 70 }]);
    const s = await vender(e, e.camilo, [{ servicio_id: e.corte }, { servicio_id: e.combo }], {
      p_descuento: 10000,
      p_descuento_motivo: "Cliente frecuente",
    });
    expect((await cobroDe(s.id)).comision).toBe(9450 + 8250);
  });

  it("0 % no paga comisión y 100 % paga todo lo cobrado de la línea", async () => {
    const e = await crearEscenarioAgenda(db);
    await guardar(e, e.camilo, 0);
    const cero = await vender(e, e.camilo, [{ servicio_id: e.corte }]);
    expect((await cobroDe(cero.id)).comision).toBe(0);
    await guardar(e, e.camilo, 100);
    const todo = await vender(e, e.camilo, [{ servicio_id: e.corte }], { p_descuento: 1000, p_descuento_motivo: "Promo" });
    expect((await cobroDe(todo.id)).comision).toBe(17000);
  });

  it("una cortesía (nada que cobrar) no genera comisión", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await vender(e, e.camilo, [{ servicio_id: e.corte, precio: 0 }]);
    expect(r.total).toBe(0);
    expect((await cobroDe(r.id)).comision).toBe(0);
    expect(await lineas(r.id)).toEqual([expect.objectContaining({ comision: 0 })]);
  });

  it("una cita cobrada usa el porcentaje del barbero que la atendió", async () => {
    const e = await crearEscenarioAgenda(db);
    await guardar(e, e.dani, 45);
    const cita = await rpc<{ id: string }>(db, e.recepcion, "crear_cita", {
      p_barbero: e.dani,
      p_servicio: e.corte,
      p_inicio: en(0),
      p_cliente_nombre: "Juan Pérez",
    });
    const r = await rpc<Cobrado>(db, e.cajero, "cobrar_cita", { p_cita: cita.id, p_clave: randomUUID(), p_pagos: [efectivo(15000)] });
    expect((await lineas(r.id))[0]).toMatchObject({ comision_pct: 45, comision: 6750 });
  });
});

describe("las partes suman lo cobrado, al peso", () => {
  /** Un generador determinista (mismo resultado en cada corrida). */
  function azar(semilla: number) {
    let s = semilla >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it("en 40 combinaciones de porcentaje, excepción, descuento, propina y pagos mixtos", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = azar(20261015);
    const entero = (max: number) => Math.floor(r() * (max + 1));

    for (let i = 0; i < 40; i++) {
      const barbero = i % 2 === 0 ? e.camilo : e.dani;
      const base = entero(100);
      const excepcion = r() < 0.5 ? entero(100) : null;
      await guardar(e, barbero, base, excepcion === null ? [] : [{ servicio_id: e.corte, pct: excepcion }]);

      const items: Record<string, unknown>[] = [];
      for (let n = 1 + entero(2); n > 0; n--) {
        const precio = 1000 + entero(60000);
        items.push(r() < 0.5 ? { servicio_id: r() < 0.5 ? e.corte : e.combo, precio } : { nombre: `Extra ${i}-${n}`, precio });
      }
      const subtotal = items.reduce((s, x) => s + (x.precio as number), 0);
      const descuento = r() < 0.5 ? entero(subtotal) : 0;
      const propina = r() < 0.5 ? entero(5000) : 0;
      const aCobrar = subtotal - descuento + propina;

      const pagos: unknown[] = [];
      if (aCobrar > 0) {
        const enEfectivo = entero(aCobrar);
        if (enEfectivo > 0) pagos.push(efectivo(enEfectivo, enEfectivo + entero(5000)));
        if (aCobrar - enEfectivo > 0) pagos.push(nequi(aCobrar - enEfectivo));
      }

      const cobro = await rpc<Cobrado>(db, e.cajero, "cobrar_venta", {
        p_barbero: barbero,
        p_clave: randomUUID(),
        p_items: items,
        p_descuento: descuento,
        p_descuento_motivo: descuento > 0 ? "Promo" : null,
        p_propina: propina,
        p_pagos: pagos,
      });

      const c = await cobroDe(cobro.id);
      const ls = await lineas(cobro.id);
      const sumaPagos = (await filas<{ s: string }>(`select coalesce(sum(monto), 0) as s from public.cobro_pagos where cobro_id = $1`, [cobro.id]))[0].s;

      expect(c.total).toBe(subtotal - descuento);
      expect(ls.reduce((s, l) => s + l.precio, 0)).toBe(c.subtotal);
      expect(ls.reduce((s, l) => s + l.descuento, 0)).toBe(c.descuento);
      expect(ls.reduce((s, l) => s + l.comision, 0)).toBe(c.comision);
      for (const l of ls) {
        const pctEsperado = l.tipo === "servicio" && l.servicio_id === e.corte && excepcion !== null ? excepcion : base;
        expect(l.comision_pct).toBe(pctEsperado);
        expect(l.comision).toBe(Math.floor(((l.precio - l.descuento) * l.comision_pct) / 100));
      }
      // La comisión nunca pasa de lo cobrado, y comisión + parte de la barbería = lo cobrado por servicios.
      expect(c.comision).toBeLessThanOrEqual(c.total);
      expect(c.comision + (c.total - c.comision)).toBe(c.total);
      expect(Number(sumaPagos) - c.total).toBe(c.propina);
    }
  });
});

describe("la propina del barbero", () => {
  it("por defecto es del barbero; cambiar el ajuste solo vale para los cobros que vienen", async () => {
    const e = await crearEscenarioAgenda(db);
    const a = await vender(e, e.camilo, [{ servicio_id: e.corte }], { p_propina: 2000 });
    expect(await cobroDe(a.id)).toMatchObject({ propina: 2000, propina_barbero: 2000 });

    expect(await rpc(db, e.userId, "fijar_propina_del_barbero", { p_del_barbero: false })).toEqual({ propina_del_barbero: false });
    const b = await vender(e, e.camilo, [{ servicio_id: e.corte }], { p_propina: 3000 });
    expect(await cobroDe(b.id)).toMatchObject({ propina: 3000, propina_barbero: 0 });
    expect(await cobroDe(a.id)).toMatchObject({ propina: 2000, propina_barbero: 2000 });

    await rpc(db, e.userId, "fijar_propina_del_barbero", { p_del_barbero: true });
    const c = await vender(e, e.camilo, [{ servicio_id: e.corte }], { p_propina: 1500 });
    expect(await cobroDe(c.id)).toMatchObject({ propina: 1500, propina_barbero: 1500 });
  });

  it("la propina no cuenta como comisión ni cambia el reparto de los servicios", async () => {
    const e = await crearEscenarioAgenda(db);
    const sin = await vender(e, e.camilo, [{ servicio_id: e.corte }]);
    const con = await vender(e, e.camilo, [{ servicio_id: e.corte }], { p_propina: 5000 });
    expect((await cobroDe(con.id)).comision).toBe((await cobroDe(sin.id)).comision);
  });

  it("hay que decir de quién es", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(rpc(db, e.userId, "fijar_propina_del_barbero", { p_del_barbero: null })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("de quién es la propina"),
    });
  });

  it("una barbería no cambia la de otra", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    await rpc(db, a.userId, "fijar_propina_del_barbero", { p_del_barbero: false });
    expect((await rpc<Config>(db, b.userId, "obtener_comisiones_config")).propina_del_barbero).toBe(true);
    expect((await rpc<Config>(db, a.userId, "obtener_comisiones_config")).propina_del_barbero).toBe(false);
  });
});

describe("guardar_comisiones_barbero", () => {
  it.each([[-1], [101], [null]])("el porcentaje %s no vale", async (pct) => {
    const e = await crearEscenarioAgenda(db);
    await expect(rpc(db, e.userId, "guardar_comisiones_barbero", { p_barbero: e.camilo, p_pct: pct })).rejects.toMatchObject({
      code: "P0001",
      message: "La comisión va de 0 % a 100 %.",
    });
    expect(await filas(`select 1 from public.comisiones_barbero where barbero_id = $1`, [e.camilo])).toEqual([]);
  });

  it("las excepciones tienen que ser una lista válida", async () => {
    const e = await crearEscenarioAgenda(db);
    const intentar = (excepciones: unknown) =>
      rpc(db, e.userId, "guardar_comisiones_barbero", { p_barbero: e.camilo, p_pct: 50, p_excepciones: excepciones });

    await expect(intentar({ servicio_id: e.corte, pct: 70 })).rejects.toMatchObject({ message: expect.stringContaining("lista de excepciones") });
    await expect(intentar([{ pct: 70 }])).rejects.toMatchObject({ message: expect.stringContaining("lista de excepciones") });
    await expect(intentar([{ servicio_id: "no-es-uuid", pct: 70 }])).rejects.toMatchObject({ message: expect.stringContaining("lista de excepciones") });
    await expect(intentar([{ servicio_id: e.corte, pct: 70 }, { servicio_id: e.corte, pct: 60 }])).rejects.toMatchObject({
      message: expect.stringContaining("dos veces"),
    });
    await expect(intentar([{ servicio_id: randomUUID(), pct: 70 }])).rejects.toMatchObject({ message: expect.stringContaining("no existe o está archivado") });
    await expect(intentar([{ servicio_id: e.corte }])).rejects.toMatchObject({ message: expect.stringContaining('Falta el dato "pct"') });
    await expect(intentar([{ servicio_id: e.corte, pct: "70" }])).rejects.toMatchObject({ message: expect.stringContaining("número entero") });
    await expect(intentar([{ servicio_id: e.corte, pct: 70.5 }])).rejects.toMatchObject({ message: expect.stringContaining("número entero") });
    await expect(intentar([{ servicio_id: e.corte, pct: 101 }])).rejects.toMatchObject({ message: "La comisión va de 0 % a 100 %." });
  });

  it("si algo no vale no se guarda nada (ni el porcentaje base)", async () => {
    const e = await crearEscenarioAgenda(db);
    await guardar(e, e.camilo, 60, [{ servicio_id: e.corte, pct: 70 }]);
    await expect(guardar(e, e.camilo, 10, [{ servicio_id: e.corte, pct: 70 }, { servicio_id: e.combo, pct: 999 }])).rejects.toMatchObject({ code: "P0001" });
    const config = await rpc<Config>(db, e.userId, "obtener_comisiones_config");
    const camilo = config.barberos.find((b) => b.id === e.camilo)!;
    expect(camilo.pct).toBe(60);
    expect(camilo.excepciones).toEqual([expect.objectContaining({ servicio: "Corte", pct: 70 })]);
  });

  it("deja exactamente las excepciones que llegan", async () => {
    const e = await crearEscenarioAgenda(db);
    const excepcionesDe = async () =>
      (await rpc<Config>(db, e.userId, "obtener_comisiones_config")).barberos.find((b) => b.id === e.camilo)!.excepciones.map((x) => [x.servicio, x.pct]);

    await guardar(e, e.camilo, 50, [{ servicio_id: e.corte, pct: 70 }, { servicio_id: e.combo, pct: 60 }]);
    expect(await excepcionesDe()).toEqual([["Corte", 70], ["Corte + barba", 60]]);
    await guardar(e, e.camilo, 50, [{ servicio_id: e.combo, pct: 55 }]);
    expect(await excepcionesDe()).toEqual([["Corte + barba", 55]]);
    await guardar(e, e.camilo, 50, []);
    expect(await excepcionesDe()).toEqual([]);
  });

  it("las excepciones de un servicio archivado se conservan y vuelven si se restaura", async () => {
    const e = await crearEscenarioAgenda(db);
    await guardar(e, e.camilo, 50, [{ servicio_id: e.combo, pct: 65 }]);
    await rpc(db, e.userId, "fijar_servicio_activo", { p_id: e.combo, p_activo: false });
    await guardar(e, e.camilo, 55, []);
    const archivado = (await rpc<Config>(db, e.userId, "obtener_comisiones_config")).barberos.find((b) => b.id === e.camilo)!;
    expect(archivado.excepciones).toEqual([]);
    expect(await filas(`select pct from public.comisiones_servicio where barbero_id = $1 and servicio_id = $2`, [e.camilo, e.combo])).toEqual([{ pct: 65 }]);

    await rpc(db, e.userId, "fijar_servicio_activo", { p_id: e.combo, p_activo: true });
    const restaurado = (await rpc<Config>(db, e.userId, "obtener_comisiones_config")).barberos.find((b) => b.id === e.camilo)!;
    expect(restaurado.excepciones).toEqual([expect.objectContaining({ servicio: "Corte + barba", pct: 65 })]);
  });

  it("un barbero que no existe, o es de otra barbería, no se toca", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    await expect(rpc(db, a.userId, "guardar_comisiones_barbero", { p_barbero: randomUUID(), p_pct: 50 })).rejects.toMatchObject({ code: "P0002" });
    await expect(rpc(db, b.userId, "guardar_comisiones_barbero", { p_barbero: a.camilo, p_pct: 10 })).rejects.toMatchObject({ code: "P0002" });
    // Un servicio de otra barbería tampoco entra como excepción.
    await expect(guardar(b, b.camilo, 50, [{ servicio_id: a.corte, pct: 70 }])).rejects.toMatchObject({ message: expect.stringContaining("no existe o está archivado") });
    expect(await filas(`select 1 from public.comisiones_barbero where barbero_id = $1`, [a.camilo])).toEqual([]);
  });

  it("también se le puede poner porcentaje a un barbero archivado (su historial sigue)", async () => {
    const e = await crearEscenarioAgenda(db);
    await rpc(db, e.userId, "fijar_barbero_activo", { p_id: e.dani, p_activo: false });
    await guardar(e, e.dani, 35);
    const dani = (await rpc<Config>(db, e.userId, "obtener_comisiones_config")).barberos.find((b) => b.id === e.dani)!;
    expect(dani).toMatchObject({ activo: false, pct: 35, definido: true });
  });
});

describe("obtener_comisiones_config", () => {
  it("lista a los barberos con su porcentaje, si es el de por defecto o uno guardado, y sus excepciones", async () => {
    const e = await crearEscenarioAgenda(db);
    await guardar(e, e.camilo, 60, [{ servicio_id: e.corte, pct: 70 }]);
    const config = await rpc<Config>(db, e.userId, "obtener_comisiones_config");
    expect(config).toMatchObject({ defecto: 50, propina_del_barbero: true });
    expect(config.barberos.map((b) => [b.nombre, b.pct, b.definido])).toEqual([
      ["Camilo", 60, true],
      ["Dani", 50, false],
    ]);
    expect(config.barberos[0].excepciones).toEqual([{ servicio_id: e.corte, servicio: "Corte", pct: 70 }]);
    expect(config.barberos[1].excepciones).toEqual([]);
  });

  it("no mezcla barberías", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    await guardar(a, a.camilo, 80);
    const deB = await rpc<Config>(db, b.userId, "obtener_comisiones_config");
    expect(deB.barberos.map((x) => x.id).sort()).toEqual([b.camilo, b.dani].sort());
    expect(deB.barberos.every((x) => !x.definido)).toBe(true);
  });
});

describe("permisos", () => {
  async function conArea(e: EscenarioAgenda) {
    await crearRol(db, e.barberiaId, "Contadora", ["comisiones"]);
    return crearMiembro(db, e.barberiaId, "Marta", ["Contadora"]);
  }

  it("cambian los porcentajes el dueño y quien tiene el área comisiones; no la recepción, la caja ni el barbero", async () => {
    const e = await crearEscenarioAgenda(db);
    const contadora = await conArea(e);
    for (const actor of [e.userId, contadora]) {
      await rpc(db, actor, "guardar_comisiones_barbero", { p_barbero: e.camilo, p_pct: 55 });
      await rpc(db, actor, "fijar_propina_del_barbero", { p_del_barbero: true });
      expect((await rpc<Config>(db, actor, "obtener_comisiones_config")).barberos).toHaveLength(2);
    }
    for (const actor of [e.recepcion, e.cajero, e.cuentaCamilo, e.cuentaDani]) {
      await expect(rpc(db, actor, "guardar_comisiones_barbero", { p_barbero: e.camilo, p_pct: 99 })).rejects.toMatchObject({ code: "42501" });
      await expect(rpc(db, actor, "fijar_propina_del_barbero", { p_del_barbero: false })).rejects.toMatchObject({ code: "42501" });
      await expect(rpc(db, actor, "obtener_comisiones_config")).rejects.toMatchObject({ code: "42501" });
    }
    await expect(rpc(db, null, "guardar_comisiones_barbero", { p_barbero: e.camilo, p_pct: 99 })).rejects.toMatchObject({ code: "42501" });
    expect((await rpc<Config>(db, e.userId, "obtener_comisiones_config")).barberos[0].pct).toBe(55);
  });

  it("las tablas solo las lee quien tiene el área; un barbero no ve lo que gana otro, ni lo suyo", async () => {
    const e = await crearEscenarioAgenda(db);
    const contadora = await conArea(e);
    await guardar(e, e.camilo, 60, [{ servicio_id: e.corte, pct: 70 }]);
    for (const tabla of ["comisiones_barbero", "comisiones_servicio"]) {
      expect((await como(db, e.userId, `select * from public.${tabla}`)).length).toBe(1);
      expect((await como(db, contadora, `select * from public.${tabla}`)).length).toBe(1);
      for (const actor of [e.recepcion, e.cajero, e.cuentaCamilo, e.cuentaDani]) {
        expect(await como(db, actor, `select * from public.${tabla}`)).toEqual([]);
      }
      await expect(como(db, null, `select * from public.${tabla}`)).rejects.toMatchObject({ code: "42501" });
    }
    // Otra barbería no ve nada de esta.
    const otra = await crearEscenarioAgenda(db);
    expect(await como(db, otra.userId, `select * from public.comisiones_barbero`)).toEqual([]);
  });

  it("nadie escribe las tablas directo desde la app", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(
      como(db, e.userId, `insert into public.comisiones_barbero (barberia_id, barbero_id, pct) values ($1, $2, 99)`, [e.barberiaId, e.camilo])
    ).rejects.toMatchObject({ code: "42501" });
    await guardar(e, e.camilo, 60);
    await expect(como(db, e.userId, `update public.comisiones_barbero set pct = 1`)).rejects.toMatchObject({ code: "42501" });
    await expect(como(db, e.userId, `delete from public.comisiones_barbero`)).rejects.toMatchObject({ code: "42501" });
    await expect(como(db, e.userId, `update public.barberias set propina_del_barbero = false`)).rejects.toMatchObject({ code: "42501" });
  });

  it("la base no deja porcentajes fuera de 0 a 100 aunque alguien escriba directo", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const pct of [-1, 101]) {
      await expect(
        db.query(`insert into public.comisiones_barbero (barberia_id, barbero_id, pct) values ($1, $2, $3)`, [e.barberiaId, e.camilo, pct])
      ).rejects.toMatchObject({ code: "23514" });
    }
  });
});
