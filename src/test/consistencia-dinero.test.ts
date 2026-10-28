/**
 * Consistencia del dinero (tarea 3.9 · SPEC F6, F7, F9): lo que calcula TypeScript (`src/lib/dinero.ts`, lo que ve la
 * pantalla) y lo que calcula SQL (lo que se guarda) tienen que dar el MISMO resultado, al peso, con datos variados.
 * Al final, un día completo simulado (reservar → atender → cobrar → gastar → liquidar → cerrar) que cuadra al peso.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  calcularCobro,
  calcularEfectivo,
  compararCaja,
  COMISION_POR_DEFECTO,
  efectivoEsperado,
  formatearPesos,
  LINEAS_MAXIMAS,
  type PagoPlan,
  planDePagos,
  porcentajeDe,
  PRECIO_MAXIMO,
  PROPINA_MAXIMA,
  repartoDeCobro,
  sumar,
  validarCobro,
} from "@/lib/dinero";
import { sumarDias } from "@/lib/fechas";
import { mensajeResumenCierre } from "@/lib/whatsapp";
import { como, rpc } from "./base-datos";
import { crearEscenarioAgenda, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  const { crearBase } = await import("./base-datos");
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

const filas = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const hoyDe = async () => (await filas<{ d: string }>(`select to_char(public.hoy_bogota(), 'YYYY-MM-DD') as d`))[0].d;

/** Un generador determinista: mismas combinaciones en cada corrida. */
function azar(semilla: number) {
  let s = semilla >>> 0;
  const siguiente = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  return { siguiente, entero: (max: number) => Math.floor(siguiente() * (max + 1)) };
}

const venta = (e: EscenarioAgenda, barbero: string, args: Record<string, unknown>) =>
  rpc<{ id: string; vuelto: number; cobrado: number }>(db, e.cajero, "cobrar_venta", { p_barbero: barbero, p_clave: randomUUID(), ...args });

describe("los mismos números en TypeScript y en SQL", () => {
  it("las constantes y los topes son los mismos", async () => {
    const e = await crearEscenarioAgenda(db);
    expect((await filas<{ d: number }>(`select public.fn_comision_defecto() as d`))[0].d).toBe(COMISION_POR_DEFECTO);

    // Precio máximo de una línea.
    const pagar = (monto: number) => [{ medio: "efectivo", monto }];
    expect((await venta(e, e.camilo, { p_items: [{ nombre: "Máximo", precio: PRECIO_MAXIMO }], p_pagos: pagar(PRECIO_MAXIMO) })).cobrado).toBe(PRECIO_MAXIMO);
    await expect(venta(e, e.camilo, { p_items: [{ nombre: "Pasado", precio: PRECIO_MAXIMO + 1 }], p_pagos: pagar(PRECIO_MAXIMO + 1) })).rejects.toMatchObject({
      code: "P0001",
    });
    // Propina máxima.
    expect(
      (await venta(e, e.camilo, { p_items: [{ nombre: "Corte", precio: 1000 }], p_propina: PROPINA_MAXIMA, p_pagos: pagar(1000 + PROPINA_MAXIMA) })).cobrado
    ).toBe(1000 + PROPINA_MAXIMA);
    await expect(
      venta(e, e.camilo, { p_items: [{ nombre: "Corte", precio: 1000 }], p_propina: PROPINA_MAXIMA + 1, p_pagos: pagar(1001 + PROPINA_MAXIMA) })
    ).rejects.toMatchObject({ message: "La propina no es válida." });
    // Máximo de líneas.
    const lineas = (n: number) => Array.from({ length: n }, (_, i) => ({ nombre: `Extra ${i}`, precio: 100 }));
    expect((await venta(e, e.camilo, { p_items: lineas(LINEAS_MAXIMAS), p_pagos: pagar(100 * LINEAS_MAXIMAS) })).cobrado).toBe(100 * LINEAS_MAXIMAS);
    await expect(venta(e, e.camilo, { p_items: lineas(LINEAS_MAXIMAS + 1), p_pagos: pagar(100 * (LINEAS_MAXIMAS + 1)) })).rejects.toMatchObject({
      message: expect.stringContaining("máximo 20 líneas"),
    });
  });

  it("formatearPesos escribe igual que los mensajes de la base (fn_pesos)", async () => {
    const r = azar(7);
    const valores = [0, 1, 9, 10, 99, 100, 999, 1000, 1001, 9999, 10000, 12500, 99999, 100000, 999999, 1000000, 99_999_999];
    for (let i = 0; i < 300; i++) valores.push(r.entero(r.siguiente() < 0.5 ? 100_000 : 99_999_999));
    const sql = await filas<{ n: number; texto: string }>(`select n, public.fn_pesos(n) as texto from unnest($1::int[]) as n`, [valores]);
    expect(sql).toHaveLength(valores.length);
    for (const { n, texto } of sql) expect(formatearPesos(n)).toBe(texto);
  });

  it("porcentajeDe es floor(valor × % ÷ 100) como en SQL, para 3000 pares", async () => {
    const r = azar(11);
    const valores = Array.from({ length: 3000 }, () => r.entero(PRECIO_MAXIMO));
    const porcentajes = Array.from({ length: 3000 }, () => r.entero(100));
    const sql = await filas<{ v: number; p: number; c: number }>(
      `select v, p, floor(v::bigint * p / 100)::int as c from unnest($1::int[], $2::int[]) as t(v, p)`,
      [valores, porcentajes]
    );
    for (const { v, p, c } of sql) expect(porcentajeDe(v, p)).toBe(c);
  });
});

describe("un cobro: lo que calcula la pantalla es lo que guarda la base", () => {
  it("en 60 cobros con descuentos, propinas, porcentajes, excepciones y pagos variados", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = azar(39);
    let propinaDelBarbero = true;

    for (let i = 0; i < 60; i++) {
      const barbero = r.siguiente() < 0.5 ? e.camilo : e.dani;
      const base = r.entero(100);
      const exCorte = r.siguiente() < 0.5 ? r.entero(100) : null;
      const exCombo = r.siguiente() < 0.3 ? r.entero(100) : null;
      await rpc(db, e.userId, "guardar_comisiones_barbero", {
        p_barbero: barbero,
        p_pct: base,
        p_excepciones: [
          ...(exCorte !== null ? [{ servicio_id: e.corte, pct: exCorte }] : []),
          ...(exCombo !== null ? [{ servicio_id: e.combo, pct: exCombo }] : []),
        ],
      });
      const delBarbero = r.siguiente() < 0.7;
      if (delBarbero !== propinaDelBarbero) {
        await rpc(db, e.userId, "fijar_propina_del_barbero", { p_del_barbero: delBarbero });
        propinaDelBarbero = delBarbero;
      }

      // Las líneas: servicios (con su precio, a veces distinto del de lista) y extras.
      const lineas: { item: Record<string, unknown>; precio: number; pct: number }[] = [];
      for (let k = 1 + r.entero(3); k > 0; k--) {
        const precio = 1000 + r.entero(60000);
        if (r.siguiente() < 0.6) {
          const esCorte = r.siguiente() < 0.5;
          lineas.push({ item: { servicio_id: esCorte ? e.corte : e.combo, precio }, precio, pct: (esCorte ? exCorte : exCombo) ?? base });
        } else {
          lineas.push({ item: { nombre: `Extra ${i}-${k}`, precio }, precio, pct: base });
        }
      }
      const subtotal = sumar(lineas.map((l) => l.precio));
      const descuento = r.siguiente() < 0.5 ? r.entero(subtotal) : 0;
      const propina = r.siguiente() < 0.5 ? r.entero(r.siguiente() < 0.1 ? PROPINA_MAXIMA : 8000) : 0;

      // Lo que calcula la pantalla.
      const ts = calcularCobro({
        lineas: lineas.map((l) => ({ precio: l.precio, comisionPct: l.pct })),
        descuento,
        propina,
        propinaDelBarbero: propinaDelBarbero,
      });
      const medio = r.siguiente() < 0.5 ? "efectivo" : "transferencia";
      const pagos = planDePagos({
        medio,
        aCobrar: ts.aCobrar,
        recibido: ts.aCobrar + r.entero(30000),
        referencia: r.siguiente() < 0.5 ? ` M${i} ` : "",
        pagaAhora: medio === "transferencia" && ts.aCobrar > 1 && r.siguiente() < 0.5 ? 1 + r.entero(ts.aCobrar - 2) : 0,
      });
      const validado = validarCobro(ts.total, propina, pagos);
      expect(validado.ok, `cobro ${i}`).toBe(true);

      // Lo que guarda la base.
      const cobro = await venta(e, barbero, {
        p_items: lineas.map((l) => l.item),
        p_descuento: descuento,
        p_descuento_motivo: descuento > 0 ? "Promo" : null,
        p_propina: propina,
        p_pagos: pagos,
      });

      const [c] = await filas<{ subtotal: number; descuento: number; total: number; propina: number; comision: number; propina_barbero: number }>(
        `select subtotal, descuento, total, propina, comision, propina_barbero from public.cobros where id = $1`,
        [cobro.id]
      );
      const items = await filas<{ precio: number; descuento: number; comision_pct: number; comision: number }>(
        `select precio, descuento, comision_pct, comision from public.cobro_items where cobro_id = $1 order by orden`,
        [cobro.id]
      );
      const registro = `cobro ${i}`;
      expect(c, registro).toEqual({
        subtotal: ts.subtotal,
        descuento: ts.descuento,
        total: ts.total,
        propina: ts.propina,
        comision: ts.comision,
        propina_barbero: ts.propinaBarbero,
      });
      expect(items, registro).toEqual(ts.lineas.map((l, k) => ({ precio: l.precio, descuento: l.descuento, comision_pct: lineas[k].pct, comision: l.comision })));
      expect(cobro.cobrado, registro).toBe(ts.aCobrar);
      expect(cobro.vuelto, registro).toBe(validado.ok ? validado.vuelto : -1);

      // Las partes suman lo que entró, al peso.
      const reparto = repartoDeCobro({ total: c.total, comision: c.comision, propina: c.propina, propinaBarbero: c.propina_barbero });
      expect(reparto.barbero + reparto.barberia, registro).toBe(ts.aCobrar);
      expect(ts.comision + ts.parteBarberia, registro).toBe(ts.total);
      const pagado = (await filas<{ s: string }>(`select coalesce(sum(monto), 0) as s from public.cobro_pagos where cobro_id = $1`, [cobro.id]))[0].s;
      expect(Number(pagado), registro).toBe(ts.aCobrar);
    }
  }, 120_000);

  it("una cortesía (todo en cero) tampoco se separa", async () => {
    const e = await crearEscenarioAgenda(db);
    const ts = calcularCobro({ lineas: [{ precio: 0, comisionPct: 50 }], descuento: 0, propina: 0 });
    const cobro = await venta(e, e.camilo, { p_items: [{ servicio_id: e.corte, precio: 0 }], p_pagos: planDePagos({ medio: "efectivo", aCobrar: 0, recibido: 0, referencia: "", pagaAhora: 0 }) });
    expect(ts).toMatchObject({ total: 0, aCobrar: 0, comision: 0 });
    expect(cobro.cobrado).toBe(0);
    expect((await filas<{ comision: number }>(`select comision from public.cobros where id = $1`, [cobro.id]))[0].comision).toBe(0);
  });
});

describe("los pagos: la pantalla y la base aceptan y rechazan lo mismo", () => {
  it("en 120 combinaciones de pagos buenos y malos de un mismo cobro", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = azar(5);
    const precio = 18000;
    let aceptados = 0;
    let rechazados = 0;

    for (let i = 0; i < 120; i++) {
      const propina = r.siguiente() < 0.4 ? r.entero(5000) : 0;
      const ts = calcularCobro({ lineas: [{ precio, comisionPct: 50 }], descuento: 0, propina });
      let pagos: PagoPlan[] = planDePagos({
        medio: r.siguiente() < 0.5 ? "efectivo" : "transferencia",
        aCobrar: ts.aCobrar,
        recibido: ts.aCobrar + r.entero(20000),
        referencia: "",
        pagaAhora: ts.aCobrar > 1 && r.siguiente() < 0.5 ? 1 + r.entero(ts.aCobrar - 2) : 0,
      });
      // Una sola descompostura a la vez, o ninguna.
      switch (r.entero(6)) {
        case 1: // los pagos suman de más o de menos
          pagos = pagos.map((p, k) => (k === 0 ? { ...p, monto: p.monto + 1 + r.entero(2000), recibido: p.recibido === undefined ? undefined : p.recibido + 5000 } : p));
          break;
        case 2: // el efectivo recibido no alcanza
          pagos = pagos.map((p) => (p.medio === "efectivo" ? { ...p, recibido: Math.max(1, p.monto - 1 - r.entero(Math.max(0, p.monto - 2))) } : p));
          break;
        case 3: // un pago en cero
          pagos = [...pagos, { medio: "transferencia", monto: 0 }];
          break;
        case 4: // sin pagos, habiendo qué cobrar
          pagos = [];
          break;
        default: // sin cambios
      }
      // En SQL el valor de un pago se manda como viene; el efectivo recibido solo cuenta en efectivo.
      const validado = validarCobro(ts.total, propina, pagos);

      let sql: { ok: true; vuelto: number } | { ok: false; error: string };
      try {
        const cobro = await venta(e, e.camilo, { p_items: [{ nombre: "Corte", precio }], p_propina: propina, p_pagos: pagos });
        sql = { ok: true, vuelto: cobro.vuelto };
      } catch (error) {
        sql = { ok: false, error: (error as { message: string }).message };
      }

      const registro = `combinación ${i}: ${JSON.stringify(pagos)} (propina ${propina})`;
      expect(sql.ok, registro).toBe(validado.ok);
      if (validado.ok && sql.ok) {
        aceptados++;
        expect(sql.vuelto, registro).toBe(validado.vuelto);
        // Un solo pago en efectivo: el vuelto es recibido − monto.
        const unico = pagos.length === 1 && pagos[0].medio === "efectivo" ? pagos[0] : null;
        if (unico) expect(sql.vuelto, registro).toBe(calcularEfectivo(unico.recibido ?? unico.monto, unico.monto).vuelto);
      }
      if (!validado.ok && !sql.ok) {
        rechazados++;
        // Mismo motivo: la base lo dice con más detalle, pero empieza igual.
        expect(sql.error.startsWith(validado.error.replace(/\.$/, "")), `${registro} → «${sql.error}» no empieza como «${validado.error}»`).toBe(true);
      }
    }
    // La prueba tiene que haber visto de las dos cosas.
    expect(aceptados).toBeGreaterThan(20);
    expect(rechazados).toBeGreaterThan(20);
  }, 120_000);
});

describe("el efectivo del cierre", () => {
  it("lo esperado y la diferencia que calcula la pantalla son los que guarda el cierre, en días variados", async () => {
    const r = azar(21);
    for (let dia = 0; dia < 8; dia++) {
      const e = await crearEscenarioAgenda(db);
      let efectivoCobros = 0;
      let transferenciaCobros = 0;
      let gastosEfectivo = 0;
      let gastosTransferencia = 0;

      for (let k = r.entero(6); k > 0; k--) {
        const precio = 1000 + r.entero(50000);
        const propina = r.siguiente() < 0.5 ? r.entero(4000) : 0;
        const aCobrar = precio + propina;
        const enEfectivo = r.siguiente() < 0.5 ? aCobrar : r.siguiente() < 0.5 ? 0 : r.entero(aCobrar);
        const pagos: unknown[] = [];
        if (enEfectivo > 0) pagos.push({ medio: "efectivo", monto: enEfectivo, recibido: enEfectivo + r.entero(20000) });
        if (aCobrar - enEfectivo > 0) pagos.push({ medio: "transferencia", monto: aCobrar - enEfectivo });
        await venta(e, r.siguiente() < 0.5 ? e.camilo : e.dani, { p_items: [{ nombre: "Servicio", precio }], p_propina: propina, p_pagos: pagos });
        efectivoCobros += enEfectivo;
        transferenciaCobros += aCobrar - enEfectivo;
      }
      for (let k = r.entero(4); k > 0; k--) {
        const monto = 500 + r.entero(40000);
        const medio = r.siguiente() < 0.5 ? "efectivo" : "transferencia";
        await rpc(db, e.recepcion, "registrar_gasto", { p_clave: randomUUID(), p_monto: monto, p_categoria: "insumos", p_medio: medio });
        if (medio === "efectivo") gastosEfectivo += monto;
        else gastosTransferencia += monto;
      }
      // Le paga a un barbero (lo que haya pendiente), en efectivo o por transferencia.
      let liquidacionesEfectivo = 0;
      const hoy = await hoyDe();
      const pendiente = (await filas<{ t: string }>(`select coalesce(sum(comision + propina_barbero), 0) as t from public.cobros where barberia_id = $1 and barbero_id = $2`, [e.barberiaId, e.camilo]))[0].t;
      if (Number(pendiente) > 0 || (await filas(`select 1 from public.cobros where barberia_id = $1 and barbero_id = $2`, [e.barberiaId, e.camilo])).length > 0) {
        const medioPago = r.siguiente() < 0.5 ? "efectivo" : "transferencia";
        const liquidado = await rpc<{ total: number }>(db, e.userId, "liquidar_comisiones", { p_barbero: e.camilo, p_hasta: hoy, p_medio: medioPago, p_clave: randomUUID() });
        expect(liquidado.total).toBe(Number(pendiente));
        if (medioPago === "efectivo") liquidacionesEfectivo = liquidado.total;
      }

      const esperado = efectivoEsperado({ efectivoCobros, gastosEfectivo, liquidacionesEfectivo });
      const contado = Math.max(0, esperado + r.entero(2000) - 1000);
      const cierre = await rpc<{
        efectivo_cobros: number;
        transferencia_cobros: number;
        gastos_efectivo: number;
        gastos_transferencia: number;
        liquidaciones_efectivo: number;
        efectivo_esperado: number;
        diferencia: number;
      }>(db, e.userId, "registrar_cierre", { p_fecha: hoy, p_efectivo_contado: contado, p_clave: randomUUID() });

      const registro = `día ${dia}`;
      expect(cierre.efectivo_cobros, registro).toBe(efectivoCobros);
      expect(cierre.transferencia_cobros, registro).toBe(transferenciaCobros);
      expect(cierre.gastos_efectivo, registro).toBe(gastosEfectivo);
      expect(cierre.gastos_transferencia, registro).toBe(gastosTransferencia);
      expect(cierre.liquidaciones_efectivo, registro).toBe(liquidacionesEfectivo);
      expect(cierre.efectivo_esperado, registro).toBe(esperado);
      expect(cierre.diferencia, registro).toBe(compararCaja(contado, esperado).diferencia);
    }
  }, 120_000);
});

describe("un día completo: reservar → atender → cobrar → gastar → liquidar → cerrar, al peso", () => {
  it("cuadra todo, de punta a punta, y las cifras no se mueven después de cerrar", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await hoyDe();
    const D = sumarDias(hoy, 2); // día de las citas (cerca, para que entre en el horizonte de la reserva en línea)
    const A = (hora: string) => `${D}T${hora}:00Z`;

    // Porcentajes: Camilo 60 % (70 % en el corte); Dani, el de por defecto. La propina es del barbero.
    await rpc(db, e.userId, "guardar_comisiones_barbero", { p_barbero: e.camilo, p_pct: 60, p_excepciones: [{ servicio_id: e.corte, pct: 70 }] });

    // 1. RESERVAR: dos clientes desde su casa y tres citas que carga el equipo.
    const reservar = async (nombre: string, telefono: string, barbero: string, inicio: string) => {
      const r = await rpc<{ ok: boolean; token: string }>(db, null, "publico_reservar", {
        p_slug: e.slug, p_servicio: e.corte, p_barbero: barbero, p_inicio: inicio, p_nombre: nombre, p_telefono: telefono, p_consentimiento: true,
      });
      expect(r.ok, nombre).toBe(true);
      return (await filas<{ id: string }>(`select id from public.citas where token = $1`, [r.token]))[0].id;
    };
    const juan = await reservar("Juan", "3001110001", e.camilo, A("15:00"));
    const maria = await reservar("María", "3001110002", e.dani, A("16:00"));
    const crear = async (nombre: string, barbero: string, servicio: string, inicio: string) =>
      (await rpc<{ id: string }>(db, e.recepcion, "crear_cita", { p_barbero: barbero, p_servicio: servicio, p_inicio: inicio, p_cliente_nombre: nombre })).id;
    const pedro = await crear("Pedro", e.camilo, e.combo, A("17:00"));
    const luis = await crear("Luis", e.dani, e.corte, A("18:00"));
    const rosa = await crear("Rosa", e.camilo, e.corte, A("19:00"));
    await rpc(db, e.recepcion, "cancelar_cita", { p_id: rosa, p_motivo: "Avisó que no viene" });
    await db.query(`update public.citas set estado = 'no_asistio' where id = $1`, [luis]);

    // 2. ATENDER.
    for (const cita of [juan, maria, pedro]) {
      await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: cita, p_estado: "en_atencion" });
      await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: cita, p_estado: "atendida" });
    }

    // 3. COBRAR (a mano, sin ayuda de dinero.ts: es la vara con la que se mide).
    //   Juan: corte 18.000 (70 %) + gel 5.000 (60 %), descuento 3.000 repartido 2.348 / 652, propina 2.000.
    //         Se cobra 20.000 + 2.000 = 22.000 en efectivo (le dio 50.000, vuelto 28.000).
    //         Comisión: floor(15.652 × 0,7) = 10.956 + floor(4.348 × 0,6) = 2.608 = 13.564.
    const cobroJuan = await rpc<{ id: string; vuelto: number; cobrado: number }>(db, e.cajero, "cobrar_cita", {
      p_cita: juan,
      p_clave: randomUUID(),
      p_items: [{ servicio_id: e.corte }, { nombre: "Gel", precio: 5000 }],
      p_descuento: 3000,
      p_descuento_motivo: "Cliente frecuente",
      p_propina: 2000,
      p_pagos: [{ medio: "efectivo", monto: 22000, recibido: 50000 }],
    });
    expect(cobroJuan).toMatchObject({ cobrado: 22000, vuelto: 28000 });
    //   Pedro: combo 22.000 (60 %) por Nequi → comisión 13.200.
    await rpc(db, e.cajero, "cobrar_cita", { p_cita: pedro, p_clave: randomUUID(), p_pagos: [{ medio: "transferencia", monto: 22000, referencia: "M1" }] });
    //   María: corte de Dani 15.000 (50 %) + propina 1.000: 6.000 en efectivo y 10.000 por Nequi → comisión 7.500.
    await rpc(db, e.cajero, "cobrar_cita", {
      p_cita: maria,
      p_clave: randomUUID(),
      p_propina: 1000,
      p_pagos: [{ medio: "efectivo", monto: 6000 }, { medio: "transferencia", monto: 10000 }],
    });
    for (const cita of [juan, pedro, maria]) {
      expect((await filas<{ estado: string }>(`select estado from public.citas where id = $1`, [cita]))[0].estado).toBe("atendida");
    }

    // GASTOS: insumos en efectivo 8.000 y servicios públicos por Nequi 5.000.
    await rpc(db, e.recepcion, "registrar_gasto", { p_clave: randomUUID(), p_monto: 8000, p_categoria: "insumos", p_medio: "efectivo" });
    await rpc(db, e.recepcion, "registrar_gasto", { p_clave: randomUUID(), p_monto: 5000, p_categoria: "servicios_publicos", p_medio: "transferencia" });

    // 4. LIQUIDAR: Camilo por transferencia (13.564 + 13.200 de comisión + 2.000 de propina) y Dani en efectivo (7.500 + 1.000).
    const camilo = await rpc<{ total: number; comision: number; propina: number; cobros: number }>(db, e.userId, "liquidar_comisiones", {
      p_barbero: e.camilo, p_hasta: hoy, p_medio: "transferencia", p_clave: randomUUID(),
    });
    expect(camilo).toMatchObject({ cobros: 2, comision: 26764, propina: 2000, total: 28764 });
    const dani = await rpc<{ total: number }>(db, e.userId, "liquidar_comisiones", { p_barbero: e.dani, p_hasta: hoy, p_medio: "efectivo", p_clave: randomUUID() });
    expect(dani.total).toBe(8500);

    // Las cifras del día, a mano:
    //   cobrado:  servicios 20.000 + 22.000 + 15.000 = 57.000 · propinas 3.000 · efectivo 28.000 · Nequi 32.000
    //   comisiones 13.564 + 13.200 + 7.500 = 34.264 · parte de la barbería 57.000 − 34.264 = 22.736
    //   debe haber en la caja: 28.000 − 8.000 (gasto) − 8.500 (pago a Dani) = 11.500
    const esperadoDia = {
      cobros: 3, servicios: 57000, propinas: 3000, comisiones: 34264, propinas_barbero: 3000,
      efectivo_cobros: 28000, transferencia_cobros: 32000,
      gastos: 2, gastos_efectivo: 8000, gastos_transferencia: 5000,
      liquidaciones_efectivo: 8500, liquidaciones_transferencia: 28764,
      efectivo_esperado: 11500,
    };

    // Inicio muestra lo mismo que el cierre mostrará.
    const inicio = await rpc<{ ventas: Record<string, number>; comisiones: Record<string, number>; gastos: Record<string, number> }>(db, e.userId, "obtener_inicio");
    expect(inicio.ventas).toMatchObject({ cobros: 3, servicios: 57000, propinas: 3000 });
    expect(inicio.comisiones).toMatchObject({ comisiones: 34264, propinas_barbero: 3000 });
    expect(inicio.gastos).toMatchObject({ gastos: 2, total: 13000 });
    const caja = await rpc<{ totales: Record<string, number> }>(db, e.cajero, "obtener_caja", { p_fecha: hoy });
    expect(caja.totales).toEqual({ cobros: 3, servicios: 57000, propinas: 3000, efectivo: 28000, transferencia: 32000 });
    const previo = await rpc<{ resumen: Record<string, number>; sin_cobrar: number }>(db, e.userId, "obtener_cierre", { p_fecha: hoy });
    expect(previo.resumen).toEqual(esperadoDia);
    expect(previo.sin_cobrar).toBe(0);

    // 5. CERRAR: se cuentan 11.500 y cuadra al peso.
    const cierre = await rpc<Record<string, unknown> & { id: string; diferencia: number; efectivo_contado: number }>(db, e.userId, "registrar_cierre", {
      p_fecha: hoy, p_efectivo_contado: 11500, p_clave: randomUUID(),
    });
    expect(cierre).toMatchObject({ ...esperadoDia, efectivo_contado: 11500, diferencia: 0 });
    // Nada se pierde: lo cobrado es lo que entró por los dos medios, y la barbería y los barberos se reparten el resto.
    expect(esperadoDia.servicios + esperadoDia.propinas).toBe(esperadoDia.efectivo_cobros + esperadoDia.transferencia_cobros);
    expect(esperadoDia.comisiones + (esperadoDia.servicios - esperadoDia.comisiones)).toBe(esperadoDia.servicios);
    expect(camilo.total + dani.total).toBe(esperadoDia.comisiones + esperadoDia.propinas_barbero);

    // El resumen por WhatsApp lleva esas mismas cifras.
    const mensaje = mensajeResumenCierre({ barberia: "Barbería", dia: "Hoy", cierre: cierre as never });
    for (const texto of ["$ 60.000 (3 cobros)", "Efectivo: $ 28.000", "Nequi: $ 32.000", "*Gastos:* $ 13.000", "$ 37.264", "Esperado: $ 11.500", "Contado: $ 11.500", "Diferencia: Cuadra"]) {
      expect(mensaje, texto).toContain(texto);
    }

    // Lo que se registra después es del día siguiente, y el cierre no se mueve.
    await venta(e, e.camilo, { p_items: [{ nombre: "Cera", precio: 8000 }], p_pagos: [{ medio: "efectivo", monto: 8000 }] });
    await rpc(db, e.recepcion, "registrar_gasto", { p_clave: randomUUID(), p_monto: 1000, p_categoria: "otros", p_medio: "efectivo" });
    const despues = await rpc<{ cierre: Record<string, number>; resumen: Record<string, number> }>(db, e.userId, "obtener_cierre", { p_fecha: hoy });
    expect(despues.cierre).toMatchObject({ ...esperadoDia, efectivo_contado: 11500, diferencia: 0 });
    expect(despues.resumen).toMatchObject(esperadoDia);
    const siguiente = await rpc<{ resumen: Record<string, number> }>(db, e.userId, "obtener_cierre", { p_fecha: sumarDias(hoy, 1) });
    expect(siguiente.resumen).toMatchObject({ cobros: 1, servicios: 8000, efectivo_cobros: 8000, gastos: 1, gastos_efectivo: 1000, efectivo_esperado: 7000 });

    // Y nadie puede tocar lo del día cerrado.
    await expect(rpc(db, e.cajero, "anular_cobro", { p_cobro: cobroJuan.id, p_motivo: "Error" })).rejects.toMatchObject({ code: "P0001" });
    expect(await como(db, e.userId, `select count(*)::int as n from public.cierres where not anulado`)).toEqual([{ n: 1 }]);
  }, 60_000);
});
