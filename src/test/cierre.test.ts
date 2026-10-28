/**
 * Cierre del día (tarea 3.7 · migración 0025, SPEC F9): las cifras del día, cerrar con el efectivo contado, que un día
 * cerrado no se mueva (lo nuevo va al día siguiente, nada se anula) y que anular el cierre lo reabra.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sumarDias } from "@/lib/fechas";
import { como, comoInterno, crearMiembro, crearRol, rpc } from "./base-datos";
import { crearEscenarioAgenda, en, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  const { crearBase } = await import("./base-datos");
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

type Cifras = {
  cobros: number;
  servicios: number;
  propinas: number;
  comisiones: number;
  propinas_barbero: number;
  efectivo_cobros: number;
  transferencia_cobros: number;
  gastos: number;
  gastos_efectivo: number;
  gastos_transferencia: number;
  liquidaciones_efectivo: number;
  liquidaciones_transferencia: number;
  efectivo_esperado: number;
};
type Cerrado = Cifras & {
  ok: boolean;
  ya_existia: boolean;
  id: string;
  fecha: string;
  efectivo_contado: number;
  diferencia: number;
  nota: string | null;
  anulado: boolean;
  registrado_por: string | null;
};
type Dia = { fecha: string; jornada: string; cierre: Cerrado | null; resumen: Cifras; sin_cobrar: number; sin_cerrar: string[] };

const filas = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const hoyDe = async () => (await filas<{ d: string }>(`select to_char(public.hoy_bogota(), 'YYYY-MM-DD') as d`))[0].d;

const efectivo = (monto: number, recibido?: number) => ({ medio: "efectivo", monto, ...(recibido ? { recibido } : {}) });
const nequi = (monto: number) => ({ medio: "transferencia", monto });

async function vender(e: EscenarioAgenda, barbero: string, items: unknown[], pagos: unknown[], extra: Record<string, unknown> = {}) {
  return (await rpc<{ id: string }>(db, e.cajero, "cobrar_venta", { p_barbero: barbero, p_clave: randomUUID(), p_items: items, p_pagos: pagos, ...extra })).id;
}
const gastar = async (e: EscenarioAgenda, monto: number, medio: string) =>
  (await rpc<{ id: string }>(db, e.recepcion, "registrar_gasto", { p_clave: randomUUID(), p_monto: monto, p_categoria: "insumos", p_medio: medio })).id;
const liquidar = async (e: EscenarioAgenda, barbero: string, hasta: string, medio: string) =>
  (await rpc<{ id: string }>(db, e.userId, "liquidar_comisiones", { p_barbero: barbero, p_hasta: hasta, p_medio: medio, p_clave: randomUUID() })).id;

const cerrar = (actor: string | null, fecha: string, contado: number, args: Record<string, unknown> = {}) =>
  rpc<Cerrado>(db, actor, "registrar_cierre", { p_fecha: fecha, p_efectivo_contado: contado, p_clave: randomUUID(), ...args });
const anularCierre = (actor: string | null, id: string, motivo: string | null = "Me equivoqué al contar") =>
  rpc<{ ok: boolean; id: string; fecha: string }>(db, actor, "anular_cierre", { p_id: id, p_motivo: motivo });
const dia = (actor: string | null, fecha?: string) => rpc<Dia>(db, actor, "obtener_cierre", fecha ? { p_fecha: fecha } : {});
const fechaDe = async (tabla: string, id: string) => (await filas<{ f: string }>(`select to_char(fecha, 'YYYY-MM-DD') as f from public.${tabla} where id = $1`, [id]))[0].f;
const jornada = (e: EscenarioAgenda) =>
  como<{ d: string }>(db, e.userId, `select to_char(public.jornada_actual(), 'YYYY-MM-DD') as d`).then((r) => r[0].d);

/** El día del escenario con todo: 3 cobros, 2 gastos y el pago a un barbero en efectivo. */
async function diaCompleto(e: EscenarioAgenda) {
  const a = await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(20000, 50000)], { p_propina: 2000 });
  const b = await vender(e, e.dani, [{ servicio_id: e.corte }], [efectivo(5000), nequi(10000)]);
  const c = await vender(e, e.camilo, [{ servicio_id: e.combo }], [nequi(22000)]);
  const g1 = await gastar(e, 4000, "efectivo");
  const g2 = await gastar(e, 6000, "transferencia");
  const hoy = await hoyDe();
  const l = await liquidar(e, e.dani, hoy, "efectivo"); // le paga lo de b: 7.500 de comisión
  return { a, b, c, g1, g2, l, hoy };
}

describe("las cifras del día", () => {
  it("un día sin movimiento está en ceros", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await dia(e.userId);
    expect(r.cierre).toBeNull();
    expect(r.resumen).toEqual({
      cobros: 0, servicios: 0, propinas: 0, comisiones: 0, propinas_barbero: 0, efectivo_cobros: 0, transferencia_cobros: 0,
      gastos: 0, gastos_efectivo: 0, gastos_transferencia: 0, liquidaciones_efectivo: 0, liquidaciones_transferencia: 0, efectivo_esperado: 0,
    });
    expect(r.fecha).toBe(await hoyDe());
    expect(r.jornada).toBe(r.fecha);
    expect(r.sin_cerrar).toEqual([]);
  });

  it("efectivo esperado = efectivo cobrado − gastos en efectivo − pagos en efectivo a barberos", async () => {
    const e = await crearEscenarioAgenda(db);
    await diaCompleto(e);
    const { resumen: r } = await dia(e.userId);
    expect(r).toEqual({
      cobros: 3,
      servicios: 55000,
      propinas: 2000,
      comisiones: 27500, // 9.000 + 7.500 + 11.000
      propinas_barbero: 2000,
      efectivo_cobros: 25000, // 20.000 (sin el vuelto) + 5.000
      transferencia_cobros: 32000, // 10.000 + 22.000
      gastos: 2,
      gastos_efectivo: 4000,
      gastos_transferencia: 6000,
      liquidaciones_efectivo: 7500,
      liquidaciones_transferencia: 0,
      efectivo_esperado: 13500, // 25.000 − 4.000 − 7.500
    });
    // Lo cobrado por servicios y propinas es lo que entró por los dos medios.
    expect(r.servicios + r.propinas).toBe(r.efectivo_cobros + r.transferencia_cobros);
  });

  it("el vuelto no cuenta: solo lo que realmente quedó en la caja", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000, 100000)]);
    expect((await dia(e.userId)).resumen.efectivo_cobros).toBe(18000);
  });

  it("los cobros, gastos y pagos anulados no cuentan", async () => {
    const e = await crearEscenarioAgenda(db);
    const { a, g1, l } = await diaCompleto(e);
    const antes = (await dia(e.userId)).resumen;
    await rpc(db, e.userId, "anular_liquidacion", { p_id: l, p_motivo: "Error" });
    await rpc(db, e.cajero, "anular_cobro", { p_cobro: a, p_motivo: "Error" });
    await rpc(db, e.userId, "anular_gasto", { p_id: g1, p_motivo: "Error" });
    const despues = (await dia(e.userId)).resumen;
    expect(despues).toMatchObject({
      cobros: 2,
      servicios: 37000,
      propinas: 0,
      efectivo_cobros: 5000,
      gastos: 1,
      gastos_efectivo: 0,
      liquidaciones_efectivo: 0,
      efectivo_esperado: 5000,
    });
    expect(antes.efectivo_esperado).toBe(13500);
  });

  it("cuenta citas atendidas del día que todavía no se cobran", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    // Una cita de hoy (mediodía de Bogotá), en atención y sin cobro; otra confirmada.
    const inicio = `${hoy}T17:00:00Z`;
    const cita = await rpc<{ id: string }>(db, e.recepcion, "crear_cita", {
      p_barbero: e.camilo, p_servicio: e.corte, p_inicio: inicio, p_cliente_nombre: "Ana", p_confirmar: true,
    });
    await rpc<{ id: string }>(db, e.recepcion, "crear_cita", {
      p_barbero: e.camilo, p_servicio: e.corte, p_inicio: `${hoy}T19:00:00Z`, p_cliente_nombre: "Beto", p_confirmar: true,
    });
    expect((await dia(e.userId)).sin_cobrar).toBe(0);
    await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: cita.id, p_estado: "en_atencion" });
    expect((await dia(e.userId)).sin_cobrar).toBe(1);
    await rpc(db, e.cajero, "cobrar_cita", { p_cita: cita.id, p_clave: randomUUID(), p_pagos: [efectivo(18000)] });
    expect((await dia(e.userId)).sin_cobrar).toBe(0);
  });

  it("avisa de los días anteriores con movimiento que nadie cerró (hasta 14 días atrás)", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    const a = await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    const b = await gastar(e, 1000, "efectivo");
    const viejo = await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    const cerrado = await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    await db.query(`update public.cobros set fecha = $2 where id = $1`, [a, sumarDias(hoy, -1)]);
    await db.query(`update public.gastos set fecha = $2 where id = $1`, [b, sumarDias(hoy, -3)]);
    await db.query(`update public.cobros set fecha = $2 where id = $1`, [viejo, sumarDias(hoy, -20)]);
    await db.query(`update public.cobros set fecha = $2 where id = $1`, [cerrado, sumarDias(hoy, -2)]);
    await cerrar(e.userId, sumarDias(hoy, -2), 18000);

    expect((await dia(e.userId)).sin_cerrar).toEqual([sumarDias(hoy, -1), sumarDias(hoy, -3)]);
  });
});

describe("registrar_cierre", () => {
  it("cierra el día: guarda las cifras, el efectivo contado, la diferencia y quién lo hizo", async () => {
    const e = await crearEscenarioAgenda(db);
    const { hoy } = await diaCompleto(e);

    const r = await cerrar(e.userId, hoy, 13000, { p_nota: "  Faltaron   500  " });
    expect(r).toMatchObject({
      ok: true,
      ya_existia: false,
      fecha: hoy,
      cobros: 3,
      servicios: 55000,
      propinas: 2000,
      efectivo_cobros: 25000,
      transferencia_cobros: 32000,
      gastos: 2,
      gastos_efectivo: 4000,
      liquidaciones_efectivo: 7500,
      efectivo_esperado: 13500,
      efectivo_contado: 13000,
      diferencia: -500,
      nota: "Faltaron 500",
      anulado: false,
    });
    const [dueno] = await filas<{ nombre: string }>(`select nombre from public.perfiles where user_id = $1`, [e.userId]);
    expect(r.registrado_por).toBe(dueno.nombre);
    expect((await filas(`select 1 from public.cierres where barberia_id = $1 and not anulado`, [e.barberiaId])).length).toBe(1);
  });

  it("sobra, falta o cuadra según lo contado", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    const mas = await cerrar(e.userId, hoy, 19000);
    expect(mas).toMatchObject({ efectivo_esperado: 18000, diferencia: 1000 });
    await anularCierre(e.userId, mas.id);
    expect(await cerrar(e.userId, hoy, 18000)).toMatchObject({ diferencia: 0 });
    // Un día sin movimiento y sin efectivo en la caja también se cierra.
    const otra = await crearEscenarioAgenda(db);
    expect(await cerrar(otra.userId, await hoyDe(), 0)).toMatchObject({ efectivo_esperado: 0, efectivo_contado: 0, diferencia: 0 });
  });

  it("el efectivo esperado puede ser negativo si salió más efectivo del que entró", async () => {
    const e = await crearEscenarioAgenda(db);
    await gastar(e, 30000, "efectivo");
    const r = await cerrar(e.userId, await hoyDe(), 0);
    expect(r).toMatchObject({ efectivo_esperado: -30000, diferencia: 30000 });
  });

  it("repetir la clave devuelve el mismo cierre; otra clave sobre un día cerrado se rechaza", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    const clave = randomUUID();
    const a = await cerrar(e.userId, hoy, 0, { p_clave: clave });
    const b = await cerrar(e.userId, hoy, 5, { p_clave: clave });
    expect(a.ya_existia).toBe(false);
    expect(b).toMatchObject({ ya_existia: true, id: a.id, efectivo_contado: 0 });
    await expect(cerrar(e.userId, hoy, 0)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/ya está cerrado/) });
    expect((await filas(`select 1 from public.cierres where barberia_id = $1`, [e.barberiaId])).length).toBe(1);
  });

  it("repetir la clave de un cierre anulado avisa y no lo da por hecho", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    const clave = randomUUID();
    const r = await cerrar(e.userId, hoy, 0, { p_clave: clave });
    await anularCierre(e.userId, r.id);
    await expect(cerrar(e.userId, hoy, 0, { p_clave: clave })).rejects.toMatchObject({ message: expect.stringContaining("ya se anuló") });
  });

  it("valida el día, el efectivo y la clave", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    await expect(cerrar(e.userId, hoy, -1)).rejects.toMatchObject({ message: expect.stringContaining("cuánto efectivo contaste") });
    await expect(cerrar(e.userId, hoy, null as unknown as number)).rejects.toMatchObject({ message: expect.stringContaining("cuánto efectivo contaste") });
    await expect(cerrar(e.userId, hoy, 1_000_000_001)).rejects.toMatchObject({ message: expect.stringContaining("cuánto efectivo contaste") });
    await expect(cerrar(e.userId, null as unknown as string, 0)).rejects.toMatchObject({ message: expect.stringContaining("Elige el día") });
    await expect(cerrar(e.userId, sumarDias(hoy, 5), 0)).rejects.toMatchObject({ message: expect.stringContaining("Todavía no se puede cerrar") });
    await expect(cerrar(e.userId, hoy, 0, { p_clave: null })).rejects.toMatchObject({ message: expect.stringContaining("Falta la clave") });
    expect((await filas(`select 1 from public.cierres where barberia_id = $1`, [e.barberiaId])).length).toBe(0);
  });

  it("se puede cerrar un día anterior que se quedó sin cerrar", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    const ayer = sumarDias(hoy, -1);
    const k = await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    await db.query(`update public.cobros set fecha = $2 where id = $1`, [k, ayer]);
    const r = await cerrar(e.userId, ayer, 18000);
    expect(r).toMatchObject({ fecha: ayer, cobros: 1, efectivo_esperado: 18000, diferencia: 0 });
    // Y el día de hoy sigue abierto para lo que se registre.
    expect(await jornada(e)).toBe(hoy);
  });

  it("cierran el dueño y quien tiene el área cierre; no la recepción, la caja ni el barbero", async () => {
    const e = await crearEscenarioAgenda(db);
    await crearRol(db, e.barberiaId, "Contador", ["cierre"]);
    const contador = await crearMiembro(db, e.barberiaId, "Mario", ["Contador"]);
    const hoy = await hoyDe();
    for (const actor of [e.recepcion, e.cajero, e.cuentaCamilo, null]) {
      await expect(cerrar(actor, hoy, 0)).rejects.toMatchObject({ code: "42501" });
      await expect(dia(actor)).rejects.toMatchObject({ code: "42501" });
    }
    expect((await cerrar(contador, hoy, 0)).ok).toBe(true);
    expect((await dia(contador, hoy)).cierre).toMatchObject({ registrado_por: "Mario" });
  });
});

describe("un día cerrado no se mueve", () => {
  it("las cifras del cierre son las del día y quedan igual aunque después se registre más", async () => {
    const e = await crearEscenarioAgenda(db);
    const { hoy } = await diaCompleto(e);
    const cierre = await cerrar(e.userId, hoy, 13500);

    // Lo que se registra después es del día siguiente...
    const manana = sumarDias(hoy, 1);
    const k = await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    const g = await gastar(e, 9000, "efectivo");
    await vender(e, e.dani, [{ servicio_id: e.corte }], [efectivo(15000)]); // para que Dani tenga qué liquidar
    const l = await liquidar(e, e.dani, manana, "efectivo");
    expect(await fechaDe("cobros", k)).toBe(manana);
    expect(await fechaDe("gastos", g)).toBe(manana);
    expect(await fechaDe("liquidaciones", l)).toBe(manana);
    expect(await jornada(e)).toBe(manana);

    // ...y las cifras del día cerrado siguen siendo las mismas, las guardadas y las que se calculan de nuevo.
    const guardadas = (await dia(e.userId, hoy)).cierre!;
    expect(guardadas).toMatchObject({ id: cierre.id, cobros: 3, servicios: 55000, efectivo_esperado: 13500, diferencia: 0 });
    const hoyVivo = await comoInterno<{ r: Cifras }>(db, e.userId, `select public.fn_resumen_dia($1, $2::date) as r`, [e.barberiaId, hoy]);
    expect(hoyVivo[0].r).toMatchObject({ cobros: 3, servicios: 55000, gastos: 2, efectivo_esperado: 13500 });
    // El día siguiente sí tiene lo nuevo.
    expect((await dia(e.userId)).resumen).toMatchObject({ cobros: 2, gastos: 1, efectivo_cobros: 33000, gastos_efectivo: 9000 });
  });

  it("no se anula un cobro, un gasto ni un pago a un barbero de un día cerrado", async () => {
    const e = await crearEscenarioAgenda(db);
    const { a, b, c, g1, l, hoy } = await diaCompleto(e);
    const cierre = await cerrar(e.userId, hoy, 13500);

    const cerradoMsg = { code: "P0001", message: expect.stringMatching(/ya está cerrado: anular esto movería las cifras del cierre\. Anula primero el cierre del día/) };
    await expect(rpc(db, e.userId, "anular_liquidacion", { p_id: l, p_motivo: "Error" })).rejects.toMatchObject(cerradoMsg);
    await expect(rpc(db, e.userId, "anular_gasto", { p_id: g1, p_motivo: "Error" })).rejects.toMatchObject(cerradoMsg);
    await expect(rpc(db, e.cajero, "anular_cobro", { p_cobro: a, p_motivo: "Error" })).rejects.toMatchObject(cerradoMsg);
    await expect(rpc(db, e.cajero, "anular_cobro", { p_cobro: c, p_motivo: "Error" })).rejects.toMatchObject(cerradoMsg);
    // Un cobro ya liquidado dice primero eso (hay que deshacer la liquidación, y esa tampoco se puede con el día cerrado).
    await expect(rpc(db, e.cajero, "anular_cobro", { p_cobro: b, p_motivo: "Error" })).rejects.toMatchObject({ message: expect.stringContaining("ya se le liquidó") });
    // Escribiendo directo tampoco.
    await expect(db.query(`update public.gastos set anulado = true, anulado_motivo = 'x', anulado_at = now() where id = $1`, [g1])).rejects.toMatchObject({
      message: expect.stringContaining("ya está cerrado"),
    });
    expect((await dia(e.userId, hoy)).cierre).toMatchObject({ cobros: 3, gastos: 2, efectivo_esperado: 13500 });

    // Con el cierre anulado, sí se puede.
    await anularCierre(e.userId, cierre.id);
    expect(await rpc(db, e.cajero, "anular_cobro", { p_cobro: c, p_motivo: "Error" })).toMatchObject({ ok: true });
    expect(await rpc(db, e.userId, "anular_gasto", { p_id: g1, p_motivo: "Error" })).toMatchObject({ ok: true });
  });

  it("un día cerrado no recibe más: dos cierres seguidos mandan lo nuevo dos días adelante", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    await cerrar(e.userId, hoy, 0);
    const manana = sumarDias(hoy, 1);
    expect(await jornada(e)).toBe(manana);
    await cerrar(e.userId, manana, 0);
    expect(await jornada(e)).toBe(sumarDias(hoy, 2));
    const k = await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    expect(await fechaDe("cobros", k)).toBe(sumarDias(hoy, 2));
  });

  it("fn_jornada: lo anterior al cierre sigue siendo del día; lo posterior, del siguiente", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    await cerrar(e.userId, hoy, 0);
    const [r] = await filas<{ antes: string; despues: string; otro_dia: string; otro_dia_natural: string }>(
      `select to_char(public.fn_jornada($1, now() - interval '1 second'), 'YYYY-MM-DD') as antes,
              to_char(public.fn_jornada($1, now() + interval '1 second'), 'YYYY-MM-DD') as despues,
              to_char(public.fn_jornada($1, now() - interval '30 hours'), 'YYYY-MM-DD') as otro_dia,
              to_char(public.fecha_bogota(now() - interval '30 hours'), 'YYYY-MM-DD') as otro_dia_natural`,
      [e.barberiaId]
    );
    // Un instante anterior al cierre sigue siendo de ese día; uno posterior, del siguiente.
    expect(r.antes).toBe(hoy);
    expect(r.despues).toBe(sumarDias(hoy, 1));
    // Otro día calendario (el cierre de hoy no lo toca).
    expect(r.otro_dia).toBe(r.otro_dia_natural);
  });

  it("la caja de hoy sigue al día en que hoy se registra: tras cerrar muestra lo nuevo, y el día cerrado sigue por su fecha", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    await cerrar(e.userId, hoy, 18000);
    await vender(e, e.dani, [{ servicio_id: e.corte }], [efectivo(15000)]);

    type Caja = { fecha: string; totales: { cobros: number; servicios: number } };
    const sinFecha = await rpc<Caja>(db, e.cajero, "obtener_caja");
    expect(sinFecha.fecha).toBe(sumarDias(hoy, 1));
    expect(sinFecha.totales).toMatchObject({ cobros: 1, servicios: 15000 });
    const delCierre = await rpc<Caja>(db, e.cajero, "obtener_caja", { p_fecha: hoy });
    expect(delCierre.totales).toMatchObject({ cobros: 1, servicios: 18000 });
  });
});

describe("anular_cierre", () => {
  it("lo anula con motivo y reabre el día: lo registrado después vuelve a su día y entra al cierre nuevo", async () => {
    const e = await crearEscenarioAgenda(db);
    const { hoy } = await diaCompleto(e);
    const cierre = await cerrar(e.userId, hoy, 13500);
    const k = await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    const g = await gastar(e, 9000, "efectivo");
    await vender(e, e.dani, [{ servicio_id: e.corte }], [efectivo(15000)]);
    const l = await liquidar(e, e.dani, sumarDias(hoy, 1), "efectivo");
    expect(await jornada(e)).toBe(sumarDias(hoy, 1));

    expect(await anularCierre(e.userId, cierre.id, "  Conté mal el efectivo  ")).toEqual({ ok: true, id: cierre.id, fecha: hoy });
    const [fila] = await filas<{ anulado: boolean; anulado_motivo: string; anulado_por: string; anulado_at: Date | null }>(
      `select anulado, anulado_motivo, anulado_por, anulado_at from public.cierres where id = $1`,
      [cierre.id]
    );
    expect(fila).toMatchObject({ anulado: true, anulado_motivo: "Conté mal el efectivo", anulado_por: e.userId });
    expect(fila.anulado_at).not.toBeNull();

    // El día se reabre: lo que se había ido al siguiente vuelve a hoy.
    for (const [tabla, id] of [["cobros", k], ["gastos", g], ["liquidaciones", l]] as const) expect(await fechaDe(tabla, id)).toBe(hoy);
    expect(await jornada(e)).toBe(hoy);
    expect((await dia(e.userId, hoy)).cierre).toBeNull();
    expect((await dia(e.userId, hoy)).resumen).toMatchObject({ cobros: 5, gastos: 3 });

    // Y se cierra de nuevo con las cifras completas.
    const segundo = await cerrar(e.userId, hoy, 0);
    expect(segundo).toMatchObject({ cobros: 5, gastos: 3, id: expect.not.stringMatching(cierre.id) });
  });

  it("lo que se registró de madrugada, ya otro día calendario, no vuelve al día reabierto", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    const cierre = await cerrar(e.userId, hoy, 0);
    const madrugada = await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    // Simula que se registró el día calendario siguiente: su fecha de creación cae en otro día de Bogotá. (Un cobro
    // no deja cambiar su fecha de creación: se apaga el seguro solo para armar el caso.)
    await db.exec(`alter table public.cobros disable trigger trg_cobro_inmutables`);
    try {
      await db.query(`update public.cobros set created_at = created_at + interval '1 day' where id = $1`, [madrugada]);
    } finally {
      await db.exec(`alter table public.cobros enable trigger trg_cobro_inmutables`);
    }
    await anularCierre(e.userId, cierre.id);
    expect(await fechaDe("cobros", madrugada)).toBe(sumarDias(hoy, 1));
  });

  it("solo se anula el cierre más reciente: los de días posteriores se anulan antes", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    const ayer = sumarDias(hoy, -1);
    const k = await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    await db.query(`update public.cobros set fecha = $2 where id = $1`, [k, ayer]);
    const delAyer = await cerrar(e.userId, ayer, 18000);
    const deHoy = await cerrar(e.userId, hoy, 0);

    await expect(anularCierre(e.userId, delAyer.id)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringMatching(/Para anular el cierre del \d\d\/\d\d\/\d{4}, primero anula el del \d\d\/\d\d\/\d{4}/),
    });
    await anularCierre(e.userId, deHoy.id);
    await anularCierre(e.userId, delAyer.id);
    expect((await filas(`select 1 from public.cierres where barberia_id = $1 and not anulado`, [e.barberiaId])).length).toBe(0);
  });

  it.each([["vacío", ""], ["solo espacios", "   "], ["nulo", null]])("el motivo es obligatorio (%s)", async (_nombre, motivo) => {
    const e = await crearEscenarioAgenda(db);
    const cierre = await cerrar(e.userId, await hoyDe(), 0);
    await expect(anularCierre(e.userId, cierre.id, motivo)).rejects.toMatchObject({ message: expect.stringContaining("Escribe el motivo de la anulación") });
    expect((await filas<{ anulado: boolean }>(`select anulado from public.cierres where id = $1`, [cierre.id]))[0].anulado).toBe(false);
  });

  it("no se anula dos veces, ni uno que no existe o es de otra barbería; solo con el área cierre", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const cierre = await cerrar(a.userId, await hoyDe(), 0);
    await expect(anularCierre(b.userId, cierre.id)).rejects.toMatchObject({ code: "P0002" });
    await expect(anularCierre(a.userId, randomUUID())).rejects.toMatchObject({ code: "P0002" });
    for (const actor of [a.recepcion, a.cajero, a.cuentaCamilo, null]) await expect(anularCierre(actor, cierre.id)).rejects.toMatchObject({ code: "42501" });
    await anularCierre(a.userId, cierre.id, "Primero");
    await expect(anularCierre(a.userId, cierre.id, "Segundo")).rejects.toMatchObject({ message: expect.stringContaining("ya está anulado") });
  });
});

describe("la tabla de cierres", () => {
  it("no se edita ni se borra; un día tiene un solo cierre vigente; las cuentas tienen que cuadrar", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    const cierre = await cerrar(e.userId, hoy, 0);

    for (const sql of [
      `update public.cierres set efectivo_contado = 99, diferencia = 99 where id = $1`,
      `update public.cierres set servicios = 5 where id = $1`,
      `update public.cierres set nota = 'otra' where id = $1`,
      `update public.cierres set fecha = fecha + 1 where id = $1`,
    ]) {
      await expect(db.query(sql, [cierre.id])).rejects.toMatchObject({ code: "42501", message: expect.stringContaining("no se edita") });
    }
    await expect(db.query(`delete from public.cierres`)).rejects.toMatchObject({ code: "42501" });
    await expect(db.query(`update public.cierres set anulado = true where id = $1`, [cierre.id])).rejects.toMatchObject({ code: "23514" });

    const insertar = (esperado: number, contado: number, diferencia: number, fecha = sumarDias(hoy, -5)) =>
      db.query(
        `insert into public.cierres (barberia_id, fecha, clave, cobros, servicios, propinas, comisiones, propinas_barbero, efectivo_cobros,
           transferencia_cobros, gastos, gastos_efectivo, gastos_transferencia, liquidaciones_efectivo, liquidaciones_transferencia,
           efectivo_esperado, efectivo_contado, diferencia)
         values ($1, $5, $2, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, $3, $4, $6)`,
        [e.barberiaId, randomUUID(), esperado, contado, fecha, diferencia]
      );
    await expect(insertar(90, 100, 10)).rejects.toMatchObject({ code: "23514" }); // el esperado no sale de las cifras
    await expect(insertar(100, 120, 10)).rejects.toMatchObject({ code: "23514" }); // la diferencia no es contado − esperado
    await expect(insertar(100, 100, 0, hoy)).rejects.toMatchObject({ code: "23505" }); // ya hay un cierre vigente de ese día
    await insertar(100, 100, 0);

    await anularCierre(e.userId, cierre.id);
    await expect(
      db.query(`update public.cierres set anulado = false, anulado_motivo = null, anulado_at = null where id = $1`, [cierre.id])
    ).rejects.toMatchObject({ message: expect.stringContaining("no se reactiva") });
    // Anulado, el día puede volver a cerrarse.
    await insertar(100, 100, 0, hoy);
  });

  it("solo la lee el área cierre; nadie escribe directo desde la app; no se mezclan barberías", async () => {
    const e = await crearEscenarioAgenda(db);
    const otra = await crearEscenarioAgenda(db);
    await crearRol(db, e.barberiaId, "Contador", ["cierre"]);
    const contador = await crearMiembro(db, e.barberiaId, "Mario", ["Contador"]);
    await cerrar(e.userId, await hoyDe(), 0);
    for (const actor of [e.userId, contador]) expect((await como(db, actor, `select * from public.cierres`)).length).toBe(1);
    for (const actor of [e.recepcion, e.cajero, e.cuentaCamilo, otra.userId]) expect(await como(db, actor, `select * from public.cierres`)).toEqual([]);
    await expect(como(db, null, `select * from public.cierres`)).rejects.toMatchObject({ code: "42501" });
    await expect(como(db, e.userId, `update public.cierres set anulado = true`)).rejects.toMatchObject({ code: "42501" });
    await expect(como(db, e.userId, `delete from public.cierres`)).rejects.toMatchObject({ code: "42501" });
    await expect(
      como(db, e.userId, `insert into public.cierres (barberia_id, fecha, clave) values ($1, current_date, $2)`, [e.barberiaId, randomUUID()])
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("una cita que se cobró después del cierre", () => {
  it("el cobro de ahora cae en el día siguiente aunque la cita sea de hoy", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    const cita = await rpc<{ id: string }>(db, e.recepcion, "crear_cita", {
      p_barbero: e.camilo, p_servicio: e.corte, p_inicio: en(0), p_cliente_nombre: "Ana",
    });
    await cerrar(e.userId, hoy, 0);
    const r = await rpc<{ id: string; fecha: string }>(db, e.cajero, "cobrar_cita", { p_cita: cita.id, p_clave: randomUUID(), p_pagos: [efectivo(18000)] });
    expect(r.fecha).toBe(sumarDias(hoy, 1));
  });
});
