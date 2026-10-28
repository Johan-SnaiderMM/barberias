/**
 * Recordatorio de cita por WhatsApp (tarea 1.10 · migración 0014, SPEC F4): la app no manda el mensaje, solo deja
 * constancia (`recordatorio_enviado_at`) de que se abrió. Habla con la API como lo haría la app.
 */
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

type Creada = { ok: boolean; id: string };
type Recordada = { ok: boolean; id: string; recordatorio_enviado_at: string };

/** Una cita de Camilo con celular, creada por la API (por defecto a las 10:00 del día base). */
const crear = (e: EscenarioAgenda, args: Record<string, unknown> = {}) =>
  rpc<Creada>(db, e.recepcion, "crear_cita", {
    p_barbero: e.camilo,
    p_servicio: e.corte,
    p_inicio: en(0),
    p_cliente_nombre: "Juan Pérez",
    p_cliente_telefono: "300 123 4567",
    ...args,
  });

const recordar = (actor: string, id: string) => rpc<Recordada>(db, actor, "registrar_recordatorio_cita", { p_id: id });

const fila = async (id: string) =>
  (
    await db.query<{ recordatorio_enviado_at: Date | null; estado: string; inicio: Date; precio: number }>(
      `select recordatorio_enviado_at, estado, inicio, precio from public.citas where id = $1`,
      [id]
    )
  ).rows[0];

describe("registrar_recordatorio_cita", () => {
  it("deja la marca con la hora del servidor y no toca nada más de la cita", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e);
    const antes = await fila(id);
    expect(antes.recordatorio_enviado_at).toBeNull();

    const r = await recordar(e.recepcion, id);
    expect(r.ok).toBe(true);
    expect(r.id).toBe(id);

    const despues = await fila(id);
    expect(despues.recordatorio_enviado_at).not.toBeNull();
    expect(Math.abs(Date.now() - despues.recordatorio_enviado_at!.getTime())).toBeLessThan(5 * 60_000);
    expect(new Date(r.recordatorio_enviado_at).getTime()).toBe(despues.recordatorio_enviado_at!.getTime());
    expect(despues.estado).toBe(antes.estado);
    expect(despues.inicio.getTime()).toBe(antes.inicio.getTime());
    expect(despues.precio).toBe(antes.precio);
  });

  it("registrarlo otra vez es válido: solo cambia la hora", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e);
    await recordar(e.recepcion, id);
    await db.query(`update public.citas set recordatorio_enviado_at = '2020-01-01T00:00:00Z' where id = $1`, [id]);

    await recordar(e.recepcion, id);
    expect((await fila(id)).recordatorio_enviado_at!.getFullYear()).toBeGreaterThan(2020);
  });

  it("mover la cita borra la marca: el aviso era de otra hora", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e);
    await recordar(e.recepcion, id);
    expect((await fila(id)).recordatorio_enviado_at).not.toBeNull();

    await rpc(db, e.recepcion, "mover_cita", { p_id: id, p_inicio: en(120) });
    expect((await fila(id)).recordatorio_enviado_at).toBeNull();
  });

  it("el barbero lo registra en sus citas, no en las de otro", async () => {
    const e = await crearEscenarioAgenda(db);
    const deCamilo = (await crear(e)).id;
    const deDani = (await crear(e, { p_barbero: e.dani, p_inicio: en(240) })).id;

    expect((await recordar(e.cuentaCamilo, deCamilo)).ok).toBe(true);
    await expect(recordar(e.cuentaCamilo, deDani)).rejects.toMatchObject({ code: "42501" });
    await expect(recordar(e.cuentaDani, deCamilo)).rejects.toMatchObject({ code: "42501" });
    expect((await fila(deDani)).recordatorio_enviado_at).toBeNull();
  });

  it("quien no tiene agenda (solo caja) no puede", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e);
    await expect(recordar(e.cajero, id)).rejects.toMatchObject({ code: "42501" });
    expect((await fila(id)).recordatorio_enviado_at).toBeNull();
  });

  it("sin celular no hay a dónde mandarlo", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e, { p_cliente_nombre: "Ana Ruiz", p_cliente_telefono: null });
    await expect(recordar(e.recepcion, id)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("no tiene celular"),
    });
    expect((await fila(id)).recordatorio_enviado_at).toBeNull();
  });

  it.each([
    ["en atención", async (e: EscenarioAgenda, id: string) => {
      await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: id, p_estado: "en_atencion" });
    }],
    ["atendida", async (e: EscenarioAgenda, id: string) => {
      await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: id, p_estado: "en_atencion" });
      await rpc(db, e.recepcion, "cambiar_estado_cita", { p_id: id, p_estado: "atendida" });
    }],
    ["cancelada", async (e: EscenarioAgenda, id: string) => {
      await rpc(db, e.recepcion, "cancelar_cita", { p_id: id, p_motivo: "El cliente avisó" });
    }],
    ["no llegó", async (_e: EscenarioAgenda, id: string) => {
      // La API solo deja marcar "no llegó" cuando la hora ya pasó: se arma directo en la base.
      await db.query(`update public.citas set estado = 'no_asistio' where id = $1`, [id]);
    }],
  ])("solo se recuerdan las citas confirmadas (%s no)", async (_nombre, dejarEnEseEstado) => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e);
    await dejarEnEseEstado(e, id);
    await expect(recordar(e.recepcion, id)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Solo se recuerdan las citas confirmadas"),
    });
    expect((await fila(id)).recordatorio_enviado_at).toBeNull();
  });

  it("una cita de otra barbería no existe para quien la pide", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const deA = (await crear(a)).id;
    await expect(recordar(b.recepcion, deA)).rejects.toMatchObject({ code: "P0002" });
    expect((await fila(deA)).recordatorio_enviado_at).toBeNull();
  });

  it("un visitante sin cuenta no puede ejecutarla", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec(`set local role anon`);
        await tx.query(`select public.registrar_recordatorio_cita($1)`, [id]);
      })
    ).rejects.toMatchObject({ code: "42501" });
  });
});
