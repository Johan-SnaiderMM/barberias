/**
 * Las cifras de Inicio (tarea 3.8 · migración 0026): las mismas del cierre, y cada rol ve lo suyo.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sumarDias } from "@/lib/fechas";
import { crearMiembro, crearRol, rpc } from "./base-datos";
import { crearEscenarioAgenda, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  const { crearBase } = await import("./base-datos");
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

type Inicio = {
  hoy: string;
  fecha: string;
  citas: { total: number; atendidas: number; por_atender: number; no_asistio: number; canceladas: number } | null;
  ventas: { propias: boolean; cobros: number; servicios: number; propinas: number } | null;
  comisiones: { propias: boolean; comisiones: number; propinas_barbero: number } | null;
  gastos: { gastos: number; total: number } | null;
  cierre_hoy: { id: string; efectivo_contado: number; diferencia: number } | null;
};
type Cierre = { resumen: Record<string, number>; cierre: Record<string, number> | null };

const filas = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const hoyDe = async () => (await filas<{ d: string }>(`select to_char(public.hoy_bogota(), 'YYYY-MM-DD') as d`))[0].d;
const inicio = (actor: string | null) => rpc<Inicio>(db, actor, "obtener_inicio");

const efectivo = (monto: number, recibido?: number) => ({ medio: "efectivo", monto, ...(recibido ? { recibido } : {}) });
const nequi = (monto: number) => ({ medio: "transferencia", monto });

async function vender(e: EscenarioAgenda, barbero: string, items: unknown[], pagos: unknown[], extra: Record<string, unknown> = {}) {
  return (await rpc<{ id: string }>(db, e.cajero, "cobrar_venta", { p_barbero: barbero, p_clave: randomUUID(), p_items: items, p_pagos: pagos, ...extra })).id;
}

/** Cobros de Camilo (corte 18.000 + propina 2.000, y un combo 22.000) y de Dani (corte 15.000), y dos gastos. */
async function diaConDatos(e: EscenarioAgenda) {
  await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(20000, 50000)], { p_propina: 2000 });
  await vender(e, e.camilo, [{ servicio_id: e.combo }], [nequi(22000)]);
  await vender(e, e.dani, [{ servicio_id: e.corte }], [efectivo(5000), nequi(10000)]);
  await rpc(db, e.recepcion, "registrar_gasto", { p_clave: randomUUID(), p_monto: 4000, p_categoria: "insumos", p_medio: "efectivo" });
  await rpc(db, e.recepcion, "registrar_gasto", { p_clave: randomUUID(), p_monto: 6000, p_categoria: "otros", p_medio: "transferencia" });
}

async function citasDeHoy(e: EscenarioAgenda) {
  const hoy = await hoyDe();
  const nueva = async (barbero: string, hora: string, nombre: string) =>
    (await rpc<{ id: string }>(db, e.recepcion, "crear_cita", {
      p_barbero: barbero, p_servicio: e.corte, p_inicio: `${hoy}T${hora}:00Z`, p_cliente_nombre: nombre, p_confirmar: true,
    })).id;
  const ids = {
    camiloAtendida: await nueva(e.camilo, "14:00", "Ana"),
    camiloConfirmada: await nueva(e.camilo, "15:00", "Beto"),
    camiloNoLlego: await nueva(e.camilo, "16:00", "Carla"),
    camiloCancelada: await nueva(e.camilo, "17:00", "Dora"),
    daniAtendida: await nueva(e.dani, "14:00", "Eva"),
    daniEnAtencion: await nueva(e.dani, "15:00", "Fer"),
  };
  await db.query(`update public.citas set estado = 'atendida' where id = any($1)`, [[ids.camiloAtendida, ids.daniAtendida]]);
  await db.query(`update public.citas set estado = 'no_asistio' where id = $1`, [ids.camiloNoLlego]);
  await db.query(`update public.citas set estado = 'en_atencion' where id = $1`, [ids.daniEnAtencion]);
  await rpc(db, e.recepcion, "cancelar_cita", { p_id: ids.camiloCancelada, p_motivo: "Avisó" });
  return ids;
}

describe("las cifras de dinero de Inicio son las del cierre", () => {
  it("el dueño ve vendido, comisiones y gastos iguales a los del cierre; después de cerrar, el cierre guarda lo mismo", async () => {
    const e = await crearEscenarioAgenda(db);
    await diaConDatos(e);
    const hoy = await hoyDe();
    const i = await inicio(e.userId);
    const antes = await rpc<Cierre>(db, e.userId, "obtener_cierre", { p_fecha: hoy });

    expect(i.fecha).toBe(hoy);
    expect(i.ventas).toEqual({ propias: false, cobros: 3, servicios: 55000, propinas: 2000 });
    expect(i.comisiones).toEqual({ propias: false, comisiones: 27500, propinas_barbero: 2000 }); // 9.000 + 11.000 + 7.500
    expect(i.gastos).toEqual({ gastos: 2, total: 10000 });
    // Las mismas cifras del cierre del día.
    expect(i.ventas).toMatchObject({ cobros: antes.resumen.cobros, servicios: antes.resumen.servicios, propinas: antes.resumen.propinas });
    expect(i.comisiones).toMatchObject({ comisiones: antes.resumen.comisiones, propinas_barbero: antes.resumen.propinas_barbero });
    expect(i.gastos!.total).toBe(antes.resumen.gastos_efectivo + antes.resumen.gastos_transferencia);
    expect(i.gastos!.gastos).toBe(antes.resumen.gastos);

    // Al cerrar, lo guardado coincide con lo que Inicio mostraba.
    const cerrado = await rpc<Record<string, number>>(db, e.userId, "registrar_cierre", { p_fecha: hoy, p_efectivo_contado: 0, p_clave: randomUUID() });
    expect(cerrado).toMatchObject({
      cobros: i.ventas!.cobros,
      servicios: i.ventas!.servicios,
      propinas: i.ventas!.propinas,
      comisiones: i.comisiones!.comisiones,
      propinas_barbero: i.comisiones!.propinas_barbero,
      gastos: i.gastos!.gastos,
    });
  });

  it("cuando un cobro o un gasto se anula, Inicio y el cierre cambian juntos", async () => {
    const e = await crearEscenarioAgenda(db);
    const malo = await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    await vender(e, e.dani, [{ servicio_id: e.corte }], [efectivo(15000)]);
    await rpc(db, e.cajero, "anular_cobro", { p_cobro: malo, p_motivo: "Error" });
    const hoy = await hoyDe();
    const i = await inicio(e.userId);
    const c = await rpc<Cierre>(db, e.userId, "obtener_cierre", { p_fecha: hoy });
    expect(i.ventas).toMatchObject({ cobros: 1, servicios: 15000 });
    expect(i.ventas).toMatchObject({ cobros: c.resumen.cobros, servicios: c.resumen.servicios });
    expect(i.comisiones!.comisiones).toBe(c.resumen.comisiones);
  });

  it("después de cerrar hoy, Inicio muestra el día siguiente (vacío) y cuenta cómo salió el cierre", async () => {
    const e = await crearEscenarioAgenda(db);
    await vender(e, e.camilo, [{ servicio_id: e.corte }], [efectivo(18000)]);
    const hoy = await hoyDe();
    const antes = await inicio(e.userId);
    expect(antes.cierre_hoy).toBeNull();
    const cierre = await rpc<{ id: string }>(db, e.userId, "registrar_cierre", { p_fecha: hoy, p_efectivo_contado: 17000, p_clave: randomUUID() });

    const despues = await inicio(e.userId);
    expect(despues.hoy).toBe(hoy);
    expect(despues.fecha).toBe(sumarDias(hoy, 1));
    expect(despues.ventas).toEqual({ propias: false, cobros: 0, servicios: 0, propinas: 0 });
    expect(despues.cierre_hoy).toEqual({ id: cierre.id, efectivo_contado: 17000, diferencia: -1000 });

    await vender(e, e.dani, [{ servicio_id: e.corte }], [efectivo(15000)]);
    expect((await inicio(e.userId)).ventas).toMatchObject({ cobros: 1, servicios: 15000 });
  });
});

describe("las citas de hoy", () => {
  it("cuenta las del día por estado: no llegaron, atendidas, por atender y canceladas", async () => {
    const e = await crearEscenarioAgenda(db);
    await citasDeHoy(e);
    const i = await inicio(e.userId);
    expect(i.citas).toEqual({ total: 5, atendidas: 2, por_atender: 2, no_asistio: 1, canceladas: 1 });
  });

  it("el barbero cuenta solo las suyas; la recepción, todas", async () => {
    const e = await crearEscenarioAgenda(db);
    await citasDeHoy(e);
    expect((await inicio(e.cuentaCamilo)).citas).toEqual({ total: 3, atendidas: 1, por_atender: 1, no_asistio: 1, canceladas: 1 });
    expect((await inicio(e.cuentaDani)).citas).toEqual({ total: 2, atendidas: 1, por_atender: 1, no_asistio: 0, canceladas: 0 });
    expect((await inicio(e.recepcion)).citas).toMatchObject({ total: 5 });
  });

  it("las citas de otro día no cuentan", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    await rpc(db, e.recepcion, "crear_cita", {
      p_barbero: e.camilo, p_servicio: e.corte, p_inicio: `${sumarDias(hoy, 3)}T15:00:00Z`, p_cliente_nombre: "Ana",
    });
    expect((await inicio(e.userId)).citas).toEqual({ total: 0, atendidas: 0, por_atender: 0, no_asistio: 0, canceladas: 0 });
  });
});

describe("cada rol ve lo suyo", () => {
  it("el barbero ve lo que cobró y lo que ganó (comisión y su propina), no el negocio ni los gastos", async () => {
    const e = await crearEscenarioAgenda(db);
    await diaConDatos(e);
    const camilo = await inicio(e.cuentaCamilo);
    expect(camilo.ventas).toEqual({ propias: true, cobros: 2, servicios: 40000, propinas: 2000 });
    expect(camilo.comisiones).toEqual({ propias: true, comisiones: 20000, propinas_barbero: 2000 });
    expect(camilo.gastos).toBeNull();
    expect(camilo.cierre_hoy).toBeNull();

    const dani = await inicio(e.cuentaDani);
    expect(dani.ventas).toEqual({ propias: true, cobros: 1, servicios: 15000, propinas: 0 });
    expect(dani.comisiones).toEqual({ propias: true, comisiones: 7500, propinas_barbero: 0 });
  });

  it("la recepción y la caja ven lo vendido de todos; la recepción también los gastos; ninguna ve comisiones", async () => {
    const e = await crearEscenarioAgenda(db);
    await diaConDatos(e);
    const recepcion = await inicio(e.recepcion);
    expect(recepcion.ventas).toMatchObject({ propias: false, cobros: 3, servicios: 55000 });
    expect(recepcion.gastos).toEqual({ gastos: 2, total: 10000 });
    expect(recepcion.comisiones).toBeNull();

    const cajero = await inicio(e.cajero);
    expect(cajero.ventas).toMatchObject({ cobros: 3, servicios: 55000 });
    expect(cajero.gastos).toBeNull();
    expect(cajero.comisiones).toBeNull();
    expect(cajero.citas).toBeNull();
  });

  it("quien maneja las comisiones ve las de todos y nada más; quien cierra ve cómo salió el cierre", async () => {
    const e = await crearEscenarioAgenda(db);
    await crearRol(db, e.barberiaId, "Contadora", ["comisiones"]);
    await crearRol(db, e.barberiaId, "Contador", ["cierre"]);
    const contadora = await crearMiembro(db, e.barberiaId, "Marta", ["Contadora"]);
    const contador = await crearMiembro(db, e.barberiaId, "Mario", ["Contador"]);
    await diaConDatos(e);

    const c1 = await inicio(contadora);
    expect(c1.comisiones).toEqual({ propias: false, comisiones: 27500, propinas_barbero: 2000 });
    expect(c1.ventas).toBeNull();
    expect(c1.gastos).toBeNull();
    expect(c1.citas).toBeNull();

    const c2 = await inicio(contador);
    expect(c2.ventas).toMatchObject({ cobros: 3 });
    expect(c2.gastos).toMatchObject({ total: 10000 });
    expect(c2.comisiones).toBeNull();
    await rpc(db, contador, "registrar_cierre", { p_fecha: await hoyDe(), p_efectivo_contado: 0, p_clave: randomUUID() });
    expect((await inicio(contador)).cierre_hoy).toMatchObject({ efectivo_contado: 0 });
    expect((await inicio(e.recepcion)).cierre_hoy).toBeNull();
  });

  it("quien no tiene ningún área solo ve que no hay nada que ver", async () => {
    const e = await crearEscenarioAgenda(db);
    await crearRol(db, e.barberiaId, "Visita", []);
    const visita = await crearMiembro(db, e.barberiaId, "Vera", ["Visita"]);
    await diaConDatos(e);
    expect(await inicio(visita)).toMatchObject({ citas: null, ventas: null, comisiones: null, gastos: null, cierre_hoy: null });
  });

  it("un barbero sin cuenta vinculada no ve cifras propias; no se mezclan barberías; sin sesión no hay nada", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    await diaConDatos(a);
    expect((await inicio(b.userId)).ventas).toMatchObject({ cobros: 0, servicios: 0 });
    // Un usuario con rol Barbero que no está vinculado a ningún barbero.
    const suelto = await crearMiembro(db, a.barberiaId, "Suelto", ["Barbero"]);
    expect(await inicio(suelto)).toMatchObject({ citas: null, ventas: null, comisiones: null });
    await expect(inicio(null)).rejects.toMatchObject({ code: "42501" });
  });
});
