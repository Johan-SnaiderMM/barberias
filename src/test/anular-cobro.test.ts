/**
 * Anular un cobro (tarea 3.3 · migración 0021, SPEC F6): con motivo, reabre la cita, no deja huérfanos y no deja
 * dar por hecho un cobro que ya se anuló.
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

type Cobrado = { ok: boolean; id: string; anulado: boolean; total: number };
type Anulado = { ok: boolean; id: string; cita_id: string | null; cita_reabierta: boolean };
type Args = Record<string, unknown>;

const DIA = "2030-03-04";
const efectivo = (monto: number, recibido?: number) => ({ medio: "efectivo", monto, ...(recibido ? { recibido } : {}) });
const nequi = (monto: number) => ({ medio: "transferencia", monto });

async function citaDe(e: EscenarioAgenda, o: { barbero?: string; inicio?: string } = {}): Promise<string> {
  const r = await rpc<{ id: string }>(db, e.recepcion, "crear_cita", {
    p_barbero: o.barbero ?? e.camilo,
    p_servicio: e.corte,
    p_inicio: o.inicio ?? en(0),
    p_cliente_nombre: "Juan Pérez",
  });
  return r.id;
}

const cobrarCita = (actor: string, cita: string, args: Args = {}) =>
  rpc<Cobrado>(db, actor, "cobrar_cita", { p_cita: cita, p_clave: randomUUID(), p_pagos: [efectivo(18000, 20000)], ...args });

const anular = (actor: string | null, cobro: string, motivo: string | null = "Se cobró mal") =>
  rpc<Anulado>(db, actor, "anular_cobro", { p_cobro: cobro, p_motivo: motivo });

const filas = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const estadoDe = async (cita: string) => (await filas<{ estado: string }>(`select estado from public.citas where id = $1`, [cita]))[0].estado;
const vigentes = async (cita: string) =>
  (await filas(`select 1 from public.cobros where cita_id = $1 and not anulado`, [cita])).length;

describe("anular_cobro", () => {
  it("anula con motivo, deja constancia de quién y cuándo, y reabre la cita", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    const cobro = await cobrarCita(e.cajero, cita);
    expect(await estadoDe(cita)).toBe("atendida");

    const r = await anular(e.cajero, cobro.id, "  Se cobró el servicio equivocado  ");
    expect(r).toEqual({ ok: true, id: cobro.id, cita_id: cita, cita_reabierta: true });

    const [fila] = await filas<{ anulado: boolean; anulado_motivo: string; anulado_por: string; anulado_at: Date | null; registrado_por: string }>(
      `select anulado, anulado_motivo, anulado_por, anulado_at, registrado_por from public.cobros where id = $1`,
      [cobro.id]
    );
    expect(fila).toMatchObject({ anulado: true, anulado_motivo: "Se cobró el servicio equivocado", anulado_por: e.cajero, registrado_por: e.cajero });
    expect(fila.anulado_at).not.toBeNull();
    expect(await estadoDe(cita)).toBe("en_atencion");
  });

  it("no se pierde nada: las líneas y los pagos del cobro anulado siguen ahí", async () => {
    const e = await crearEscenarioAgenda(db);
    const cobro = await cobrarCita(e.cajero, await citaDe(e), { p_pagos: [efectivo(10000), nequi(8000)] });
    await anular(e.cajero, cobro.id);
    expect((await filas(`select 1 from public.cobro_items where cobro_id = $1`, [cobro.id])).length).toBe(1);
    expect((await filas(`select 1 from public.cobro_pagos where cobro_id = $1`, [cobro.id])).length).toBe(2);
    const detalle = await rpc<{ anulado: boolean; anulado_motivo: string; total: number; pagos: unknown[] }>(db, e.cajero, "obtener_cobro", {
      p_id: cobro.id,
    });
    expect(detalle).toMatchObject({ anulado: true, anulado_motivo: "Se cobró mal", total: 18000 });
    expect(detalle.pagos).toHaveLength(2);
  });

  it("la cita reabierta se cobra de nuevo con otra clave; el primer cobro queda en el historial", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    const primero = await cobrarCita(e.cajero, cita);
    await anular(e.recepcion, primero.id, "El cliente pidió también la barba");

    const segundo = await cobrarCita(e.cajero, cita, {
      p_items: [{ servicio_id: e.combo }],
      p_pagos: [efectivo(22000)],
    });
    expect(segundo).toMatchObject({ ok: true, total: 22000 });
    expect(segundo.id).not.toBe(primero.id);
    expect(await estadoDe(cita)).toBe("atendida");
    expect(await vigentes(cita)).toBe(1);
    expect((await filas(`select 1 from public.cobros where cita_id = $1`, [cita])).length).toBe(2);
  });

  it("un cobro sin cita también se anula; no hay cita que reabrir", async () => {
    const e = await crearEscenarioAgenda(db);
    const venta = await rpc<Cobrado>(db, e.cajero, "cobrar_venta", {
      p_barbero: e.camilo,
      p_clave: randomUUID(),
      p_items: [{ nombre: "Cera", precio: 8000 }],
      p_pagos: [efectivo(8000)],
    });
    expect(await anular(e.cajero, venta.id)).toEqual({ ok: true, id: venta.id, cita_id: null, cita_reabierta: false });
  });

  it("anular una venta no toca las citas de nadie", async () => {
    const e = await crearEscenarioAgenda(db);
    const otra = await citaDe(e, { inicio: en(60) });
    await cobrarCita(e.cajero, otra);
    const venta = await rpc<Cobrado>(db, e.cajero, "cobrar_venta", {
      p_barbero: e.camilo,
      p_clave: randomUUID(),
      p_items: [{ nombre: "Cera", precio: 8000 }],
      p_pagos: [efectivo(8000)],
    });
    await anular(e.cajero, venta.id);
    expect(await estadoDe(otra)).toBe("atendida");
    expect(await vigentes(otra)).toBe(1);
  });

  describe("el motivo", () => {
    it.each([["vacío", ""], ["solo espacios", "   "], ["nulo", null]])("es obligatorio (%s)", async (_nombre, motivo) => {
      const e = await crearEscenarioAgenda(db);
      const cita = await citaDe(e);
      const cobro = await cobrarCita(e.cajero, cita);
      await expect(anular(e.cajero, cobro.id, motivo)).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining("Escribe el motivo de la anulación"),
      });
      expect(await vigentes(cita)).toBe(1);
      expect(await estadoDe(cita)).toBe("atendida");
    });

    it("se recorta a 200 letras", async () => {
      const e = await crearEscenarioAgenda(db);
      const cobro = await cobrarCita(e.cajero, await citaDe(e));
      await anular(e.cajero, cobro.id, "a".repeat(250));
      const [fila] = await filas<{ anulado_motivo: string }>(`select anulado_motivo from public.cobros where id = $1`, [cobro.id]);
      expect(fila.anulado_motivo).toHaveLength(200);
    });
  });

  it("no se anula dos veces: el segundo intento avisa y no pisa el motivo", async () => {
    const e = await crearEscenarioAgenda(db);
    const cobro = await cobrarCita(e.cajero, await citaDe(e));
    await anular(e.cajero, cobro.id, "Primer motivo");
    await expect(anular(e.cajero, cobro.id, "Segundo motivo")).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("ya está anulado"),
    });
    const [fila] = await filas<{ anulado_motivo: string }>(`select anulado_motivo from public.cobros where id = $1`, [cobro.id]);
    expect(fila.anulado_motivo).toBe("Primer motivo");
  });

  it("un cobro que no existe, o que es de otra barbería, no se anula", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const cita = await citaDe(a);
    const cobro = await cobrarCita(a.cajero, cita);
    await expect(anular(a.cajero, randomUUID())).rejects.toMatchObject({ code: "P0002", message: expect.stringContaining("No existe ese cobro") });
    await expect(anular(b.cajero, cobro.id)).rejects.toMatchObject({ code: "P0002" });
    expect(await vigentes(cita)).toBe(1);
  });

  it("anulan el dueño, la recepción y quien tiene el área caja; no el barbero ni un visitante", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const actor of [e.userId, e.recepcion, e.cajero]) {
      const cita = await citaDe(e, { inicio: en(60 * (1 + [e.userId, e.recepcion, e.cajero].indexOf(actor))) });
      const cobro = await cobrarCita(e.cajero, cita);
      expect((await anular(actor, cobro.id)).ok).toBe(true);
    }
    const cita = await citaDe(e, { inicio: en(600) });
    const cobro = await cobrarCita(e.cajero, cita);
    await expect(anular(e.cuentaCamilo, cobro.id)).rejects.toMatchObject({ code: "42501" });
    await expect(anular(e.cuentaDani, cobro.id)).rejects.toMatchObject({ code: "42501" });
    await expect(anular(null, cobro.id)).rejects.toMatchObject({ code: "42501" });
    expect(await vigentes(cita)).toBe(1);
  });
});

describe("sin huérfanos: una cita con cobro vigente se queda atendida", () => {
  it("no sale de atendida ni por la API ni escribiendo directo; al anular el cobro, sí", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    const cobro = await cobrarCita(e.cajero, cita);

    await expect(rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: cita, p_estado: "en_atencion" })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("ya está cobrada"),
    });
    for (const estado of ["en_atencion", "confirmada", "no_asistio", "cancelada"]) {
      await expect(db.query(`update public.citas set estado = $2 where id = $1`, [cita, estado])).rejects.toMatchObject({
        message: expect.stringContaining("ya está cobrada"),
      });
    }
    expect(await estadoDe(cita)).toBe("atendida");

    await anular(e.cajero, cobro.id);
    expect(await estadoDe(cita)).toBe("en_atencion");
    // Ya sin cobro vigente la cita vuelve a moverse con normalidad.
    await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: cita, p_estado: "atendida" });
    await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: cita, p_estado: "en_atencion" });
    expect(await estadoDe(cita)).toBe("en_atencion");
  });

  it("una cita atendida que todavía no se cobra sí se puede reabrir", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: cita, p_estado: "en_atencion" });
    await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: cita, p_estado: "atendida" });
    await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: cita, p_estado: "en_atencion" });
    expect(await estadoDe(cita)).toBe("en_atencion");
  });

  it("una cita cobrada no se cancela ni se marca como que no llegó", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    await cobrarCita(e.cajero, cita);
    await expect(rpc(db, e.recepcion, "cancelar_cita", { p_id: cita, p_motivo: "Avisó" })).rejects.toMatchObject({ code: "P0001" });
    await expect(rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: cita, p_estado: "no_asistio" })).rejects.toMatchObject({ code: "P0001" });
    expect(await estadoDe(cita)).toBe("atendida");
  });

  it("cobrar sigue dejando la cita atendida (el freno solo mira cuando sale de atendida)", async () => {
    const e = await crearEscenarioAgenda(db);
    const a = await citaDe(e, { inicio: en(0) });
    const b = await citaDe(e, { inicio: en(60) });
    await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: b, p_estado: "en_atencion" });
    await cobrarCita(e.cajero, a);
    await cobrarCita(e.cajero, b);
    expect(await estadoDe(a)).toBe("atendida");
    expect(await estadoDe(b)).toBe("atendida");
  });
});

describe("la clave de un cobro anulado", () => {
  it("repetirla avisa que se anuló y no lo da por hecho; con otra clave se cobra de nuevo", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    const clave = randomUUID();
    const cobro = await cobrarCita(e.cajero, cita, { p_clave: clave });
    await anular(e.cajero, cobro.id);

    await expect(cobrarCita(e.cajero, cita, { p_clave: clave })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("ya se anuló"),
    });
    expect(await vigentes(cita)).toBe(0);
    expect(await estadoDe(cita)).toBe("en_atencion");

    expect((await cobrarCita(e.cajero, cita)).ok).toBe(true);
    expect(await vigentes(cita)).toBe(1);
  });

  it("repetir la clave de un cobro vigente sigue devolviendo el mismo cobro", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    const clave = randomUUID();
    const a = await cobrarCita(e.cajero, cita, { p_clave: clave });
    const b = await cobrarCita(e.cajero, cita, { p_clave: clave });
    expect(b).toMatchObject({ id: a.id, ya_existia: true, anulado: false });
  });
});

describe("lo que ve la caja después de anular", () => {
  type Caja = {
    por_cobrar: { id: string }[];
    cobros: { id: string; anulado: boolean; anulado_motivo: string | null }[];
    totales: { cobros: number; servicios: number; propinas: number; efectivo: number; transferencia: number };
  };

  it("el cobro anulado deja de contar, sigue en la lista marcado y la cita vuelve a «por cobrar»", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    const otra = await citaDe(e, { inicio: en(60) });
    const cobro = await cobrarCita(e.cajero, cita, { p_propina: 2000, p_pagos: [efectivo(10000), nequi(10000)] });
    const queSigue = await cobrarCita(e.cajero, otra);
    await db.query(`update public.cobros set fecha = $1 where id = any($2)`, [DIA, [cobro.id, queSigue.id]]);

    const antes = await rpc<Caja>(db, e.cajero, "obtener_caja", { p_fecha: DIA });
    expect(antes.totales).toEqual({ cobros: 2, servicios: 36000, propinas: 2000, efectivo: 28000, transferencia: 10000 });
    expect(antes.por_cobrar).toEqual([]);

    await anular(e.cajero, cobro.id, "Error de monto");
    const despues = await rpc<Caja>(db, e.cajero, "obtener_caja", { p_fecha: DIA });
    expect(despues.totales).toEqual({ cobros: 1, servicios: 18000, propinas: 0, efectivo: 18000, transferencia: 0 });
    expect(despues.por_cobrar.map((c) => c.id)).toEqual([cita]);
    expect(despues.cobros.find((c) => c.id === cobro.id)).toMatchObject({ anulado: true, anulado_motivo: "Error de monto" });
    expect(despues.cobros.find((c) => c.id === queSigue.id)).toMatchObject({ anulado: false });
  });

  it("la pantalla de Cobrar vuelve a abrirse: ya no hay cobro vigente en la cita", async () => {
    const e = await crearEscenarioAgenda(db);
    const cita = await citaDe(e);
    const cobro = await cobrarCita(e.cajero, cita);
    expect((await rpc<{ cobro_id: string | null }>(db, e.cajero, "datos_cobro", { p_cita: cita })).cobro_id).toBe(cobro.id);
    await anular(e.cajero, cobro.id);
    const datos = await rpc<{ cobro_id: string | null; cita: { estado: string } }>(db, e.cajero, "datos_cobro", { p_cita: cita });
    expect(datos.cobro_id).toBeNull();
    expect(datos.cita.estado).toBe("en_atencion");
  });
});
