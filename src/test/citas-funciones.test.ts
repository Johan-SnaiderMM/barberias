/**
 * Crear, mover y cancelar citas a mano; "llegó sin cita"; estados (tarea 1.6 · migración 0010, SPEC F4).
 * Habla con la API como lo haría la app (`rpc` con un usuario de la barbería) y verifica el estado en la base.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ESTADOS_CITA, puedeCambiar, type EstadoCita } from "@/lib/citas";
import { rpc } from "./base-datos";
import { CASOS_TELEFONO } from "./casos-telefono";
import { crearEscenarioAgenda, en, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  const { crearBase } = await import("./base-datos");
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

type Resultado = {
  ok: boolean;
  id?: string;
  token?: string;
  inicio?: string;
  fin?: string;
  precio?: number;
  cliente_id?: string;
  motivo?: string;
  avisos?: { tipo: string; mensaje: string }[];
};

type Args = Record<string, unknown>;

const crear = (e: EscenarioAgenda, actor: string, args: Args) =>
  rpc<Resultado>(db, actor, "crear_cita", { p_barbero: e.camilo, p_servicio: e.corte, ...args });

const citaDe = async (id: string) =>
  (
    await db.query<{
      estado: string;
      inicio: Date;
      fin: Date;
      precio: number;
      duracion_min: number;
      cliente_id: string;
      notas: string | null;
      recordatorio_enviado_at: Date | null;
      cancelada_motivo: string | null;
      cancelada_por: string | null;
      cancelada_at: Date | null;
      barbero_id: string;
    }>(`select * from public.citas where id = $1`, [id])
  ).rows[0];

const cuantas = async (e: EscenarioAgenda, extra = "") =>
  (await db.query(`select 1 from public.citas where barberia_id = $1 ${extra}`, [e.barberiaId])).rows.length;

const clientes = async (e: EscenarioAgenda) =>
  (await db.query<{ nombre: string; telefono: string | null }>(
    `select nombre, telefono from public.clientes where barberia_id = $1 order by created_at, nombre`,
    [e.barberiaId]
  )).rows;

/** Una cita directa en la base (como dueño de la base), para armar situaciones. */
async function sembrar(
  e: EscenarioAgenda,
  o: { barbero?: string; servicio?: string; inicio: string; estado?: string }
): Promise<string> {
  const c = await db.query<{ id: string }>(
    `insert into public.clientes (barberia_id, nombre) values ($1, $2) returning id`,
    [e.barberiaId, `Cliente de siembra ${Math.random().toString(36).slice(2, 7)}`]
  );
  const estado = o.estado ?? "confirmada";
  const r = await db.query<{ id: string }>(
    `insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio, estado, cancelada_motivo, cancelada_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      e.barberiaId,
      o.barbero ?? e.camilo,
      c.rows[0].id,
      o.servicio ?? e.corte,
      o.inicio,
      estado,
      estado === "cancelada" ? "Prueba" : null,
      estado === "cancelada" ? new Date().toISOString() : null,
    ]
  );
  return r.rows[0].id;
}

describe("fn_normalizar_telefono (misma tabla que el TypeScript)", () => {
  it.each(CASOS_TELEFONO)("%j -> %j", async (entrada, esperado) => {
    if (esperado === "ERROR") {
      await expect(db.query(`select public.fn_normalizar_telefono($1) as t`, [entrada])).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining("El celular no es válido"),
      });
    } else {
      const { rows } = await db.query<{ t: string | null }>(`select public.fn_normalizar_telefono($1) as t`, [entrada]);
      expect(rows[0].t).toBe(esperado);
    }
  });
});

describe("fn_hora_texto", () => {
  it("escribe la hora de Bogotá en 12 horas, igual que horaCorta", async () => {
    const casos: [string, string][] = [
      ["2026-10-15T19:35:00Z", "2:35 p. m."],
      ["2026-10-15T14:00:00Z", "9:00 a. m."],
      ["2026-10-15T05:00:00Z", "12:00 a. m."],
      ["2026-10-15T17:05:00Z", "12:05 p. m."],
      ["2026-10-15T14:05:00Z", "9:05 a. m."],
    ];
    for (const [iso, texto] of casos) {
      const { rows } = await db.query<{ t: string }>(`select public.fn_hora_texto($1::timestamptz) as t`, [iso]);
      expect(rows[0].t).toBe(texto);
    }
  });
});

describe("crear_cita", () => {
  it("agenda la cita con el precio y la duración del barbero y crea al cliente por celular", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await crear(e, e.recepcion, {
      p_inicio: en(0),
      p_cliente_nombre: "  Juan   Pérez ",
      p_cliente_telefono: "300 123 4567",
      p_notas: "  Degradé 2  ",
    });
    expect(r).toMatchObject({ ok: true, precio: 18000 });
    expect(r.token).toBeTruthy();

    const c = await citaDe(r.id!);
    expect(c).toMatchObject({ estado: "confirmada", precio: 18000, duracion_min: 30, notas: "Degradé 2" });
    expect(c.inicio.toISOString()).toBe(en(0));
    expect(c.fin.toISOString()).toBe(en(30));
    expect(await clientes(e)).toEqual([{ nombre: "Juan Pérez", telefono: "+573001234567" }]);
  });

  it("el mismo celular es el mismo cliente (se conserva su nombre)", async () => {
    const e = await crearEscenarioAgenda(db);
    const a = await crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "Juan Pérez", p_cliente_telefono: "3001234567" });
    const b = await crear(e, e.recepcion, {
      p_inicio: en(60),
      p_cliente_nombre: "Juanito",
      p_cliente_telefono: "+57 300-123-4567",
    });
    expect(b.cliente_id).toBe(a.cliente_id);
    expect(await clientes(e)).toEqual([{ nombre: "Juan Pérez", telefono: "+573001234567" }]);
  });

  it("sin celular siempre es un cliente nuevo (dos Juan no son la misma persona)", async () => {
    const e = await crearEscenarioAgenda(db);
    await crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "Juan" });
    await crear(e, e.recepcion, { p_inicio: en(60), p_cliente_nombre: "Juan" });
    expect(await clientes(e)).toHaveLength(2);
  });

  it("acepta un cliente existente por su id", async () => {
    const e = await crearEscenarioAgenda(db);
    const primera = await crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "Ana", p_cliente_telefono: "3109998877" });
    const segunda = await crear(e, e.recepcion, { p_inicio: en(60), p_cliente: primera.cliente_id });
    expect(segunda.cliente_id).toBe(primera.cliente_id);
    expect(await clientes(e)).toHaveLength(1);
  });

  it("ignora los segundos: la cita arranca en minuto cerrado", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await crear(e, e.recepcion, { p_inicio: "2030-03-04T15:00:45Z", p_cliente_nombre: "Ana" });
    expect((await citaDe(r.id!)).inicio.toISOString()).toBe(en(0));
  });

  it.each([
    ["sin nombre de cliente", { p_inicio: en(0) }, /nombre del cliente/],
    ["con nombre en blanco", { p_inicio: en(0), p_cliente_nombre: "   " }, /nombre del cliente/],
    ["sin fecha y hora", { p_inicio: null, p_cliente_nombre: "Ana" }, /fecha y la hora/],
    ["con un celular inválido", { p_inicio: en(0), p_cliente_nombre: "Ana", p_cliente_telefono: "12345" }, /celular no es válido/],
    ["con una nota demasiado larga", { p_inicio: en(0), p_cliente_nombre: "Ana", p_notas: "x".repeat(301) }, /nota es muy larga/],
  ])("rechaza una cita %s", async (_caso, args, mensaje) => {
    const e = await crearEscenarioAgenda(db);
    await expect(crear(e, e.recepcion, args)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(mensaje as RegExp) });
    expect(await cuantas(e)).toBe(0);
  });

  it("un barbero solo recibe lo que hace, y no recibe si está archivado", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(
      crear(e, e.recepcion, { p_barbero: e.dani, p_servicio: e.combo, p_inicio: en(0), p_cliente_nombre: "Ana" })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("Dani no hace el servicio Corte + barba") });

    await rpc(db, e.userId, "fijar_servicio_activo", { p_id: e.combo, p_activo: false });
    await expect(
      crear(e, e.recepcion, { p_servicio: e.combo, p_inicio: en(0), p_cliente_nombre: "Ana" })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("está archivado") });

    await rpc(db, e.userId, "fijar_barbero_activo", { p_id: e.dani, p_activo: false });
    await expect(
      crear(e, e.recepcion, { p_barbero: e.dani, p_inicio: en(0), p_cliente_nombre: "Ana" })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("Dani ya no está activo") });
  });

  it("no mezcla datos de otra barbería", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const clienteDeB = (await crear(b, b.recepcion, { p_inicio: en(0), p_cliente_nombre: "De B" })).cliente_id;
    await expect(crear(a, a.recepcion, { p_inicio: en(0), p_cliente: clienteDeB })).rejects.toMatchObject({
      code: "P0002",
      message: expect.stringContaining("No existe ese cliente"),
    });
    await expect(crear(a, a.recepcion, { p_barbero: b.camilo, p_inicio: en(0), p_cliente_nombre: "Ana" })).rejects.toMatchObject({
      code: "P0002",
    });
    await expect(
      crear(a, a.recepcion, { p_servicio: b.corte, p_inicio: en(0), p_cliente_nombre: "Ana" })
    ).rejects.toMatchObject({ code: "P0002" });
  });

  it("si la hora está ocupada falla con quién la tiene y NO deja un cliente a medias", async () => {
    const e = await crearEscenarioAgenda(db);
    await crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "Juan Pérez", p_cliente_telefono: "3001234567" });
    await expect(
      crear(e, e.recepcion, { p_inicio: en(15), p_cliente_nombre: "Luis Gómez", p_cliente_telefono: "3112223344" })
    ).rejects.toMatchObject({
      code: "P0001",
      message: "Camilo ya tiene a Juan Pérez de 10:00 a. m. a 10:30 a. m. (elige otra hora).",
    });
    expect(await cuantas(e)).toBe(1);
    expect((await clientes(e)).map((c) => c.nombre)).toEqual(["Juan Pérez"]);
  });

  it("una hora ocupada NO se puede forzar con confirmar", async () => {
    const e = await crearEscenarioAgenda(db);
    await crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "Juan" });
    await expect(
      crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "Luis", p_confirmar: true })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("ya tiene a Juan") });
  });

  it("citas pegadas y la misma hora con otro barbero sí se pueden", async () => {
    const e = await crearEscenarioAgenda(db);
    await crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "A" });
    await expect(crear(e, e.recepcion, { p_inicio: en(30), p_cliente_nombre: "B" })).resolves.toMatchObject({ ok: true });
    await expect(crear(e, e.recepcion, { p_inicio: en(-30), p_cliente_nombre: "C" })).resolves.toMatchObject({ ok: true });
    await expect(
      crear(e, e.recepcion, { p_barbero: e.dani, p_inicio: en(0), p_cliente_nombre: "D" })
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("avisos al crear (se pueden confirmar)", () => {
  it("una hora que ya pasó avisa y no guarda hasta confirmar", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await crear(e, e.recepcion, { p_inicio: "2020-01-06T15:00:00Z", p_cliente_nombre: "Ana" });
    expect(r).toMatchObject({ ok: false, motivo: "avisos" });
    expect(r.avisos!.map((a) => a.tipo)).toEqual(["pasado"]);
    expect(await cuantas(e)).toBe(0);
    expect(await clientes(e)).toHaveLength(0);

    const confirmada = await crear(e, e.recepcion, {
      p_inicio: "2020-01-06T15:00:00Z",
      p_cliente_nombre: "Ana",
      p_confirmar: true,
    });
    expect(confirmada).toMatchObject({ ok: true });
    expect(await cuantas(e)).toBe(1);
  });

  it("fuera del horario del barbero avisa con su nombre", async () => {
    const e = await crearEscenarioAgenda(db);
    const dia = new Date(en(0)).getUTCDay(); // el día de la semana de la prueba
    // Camilo solo trabaja de 1:00 p. m. a 5:00 p. m. ese día: las 10:00 a. m. quedan fuera.
    await rpc(db, e.userId, "guardar_horario_barbero", { p_barbero: e.camilo, p_franjas: [{ dia, desde: 780, hasta: 1020 }] });
    const r = await crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "Ana" });
    expect(r.avisos).toEqual([{ tipo: "fuera_de_horario", mensaje: "Camilo no trabaja a esa hora." }]);
    // Dentro de su horario no avisa.
    await expect(crear(e, e.recepcion, { p_inicio: en(4 * 60), p_cliente_nombre: "Ana" })).resolves.toMatchObject({ ok: true });
  });

  it("una cita que se pasa del cierre de la franja también avisa", async () => {
    const e = await crearEscenarioAgenda(db);
    const dia = new Date(en(0)).getUTCDay();
    // Franja de 9:00 a. m. a 10:15 a. m.: una cita de 10:00 (30 min) termina a las 10:30 y se sale.
    await rpc(db, e.userId, "guardar_horario_barbero", { p_barbero: e.camilo, p_franjas: [{ dia, desde: 540, hasta: 615 }] });
    const r = await crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "Ana" });
    expect(r.avisos!.map((a) => a.tipo)).toEqual(["fuera_de_horario"]);
    await expect(crear(e, e.recepcion, { p_inicio: en(-30), p_cliente_nombre: "Ana" })).resolves.toMatchObject({ ok: true });
  });

  it("sobre un bloqueo avisa con su motivo", async () => {
    const e = await crearEscenarioAgenda(db);
    await rpc(db, e.userId, "crear_bloqueo", {
      p_barbero: e.camilo,
      p_inicio: en(-60),
      p_fin: en(120),
      p_motivo: "Cita médica",
      p_confirmar: true,
    });
    const r = await crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "Ana" });
    expect(r.avisos).toEqual([
      { tipo: "bloqueo", mensaje: "Camilo tiene un bloqueo (Cita médica) que se cruza con esa hora." },
    ]);
    const confirmada = await crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "Ana", p_confirmar: true });
    expect(confirmada).toMatchObject({ ok: true });
  });

  it("junta todos los avisos que apliquen", async () => {
    const e = await crearEscenarioAgenda(db);
    await rpc(db, e.userId, "guardar_horario_barbero", { p_barbero: e.camilo, p_franjas: [] });
    const r = await crear(e, e.recepcion, { p_inicio: "2020-01-06T15:00:00Z", p_cliente_nombre: "Ana" });
    expect(r.avisos!.map((a) => a.tipo)).toEqual(["pasado", "fuera_de_horario"]);
  });
});

describe("permisos al crear", () => {
  it("recepción agenda con cualquiera; el barbero solo con él mismo", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "A" })).resolves.toMatchObject({ ok: true });
    await expect(
      crear(e, e.recepcion, { p_barbero: e.dani, p_inicio: en(0), p_cliente_nombre: "B" })
    ).resolves.toMatchObject({ ok: true });
    await expect(crear(e, e.cuentaCamilo, { p_inicio: en(60), p_cliente_nombre: "C" })).resolves.toMatchObject({ ok: true });
    await expect(
      crear(e, e.cuentaCamilo, { p_barbero: e.dani, p_inicio: en(60), p_cliente_nombre: "D" })
    ).rejects.toMatchObject({ code: "42501", message: expect.stringContaining("tu propio horario") });
  });

  it("quien solo cobra, o no tiene sesión, no agenda", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(crear(e, e.cajero, { p_inicio: en(0), p_cliente_nombre: "A" })).rejects.toMatchObject({ code: "42501" });
    await expect(
      rpc(db, null, "crear_cita", { p_barbero: e.camilo, p_servicio: e.corte, p_inicio: en(0), p_cliente_nombre: "A" })
    ).rejects.toMatchObject({ code: "42501" });
    expect(await cuantas(e)).toBe(0);
  });
});

describe("crear_cita_sin_reserva (llegó sin cita)", () => {
  const sinReserva = (e: EscenarioAgenda, actor: string, args: Args = {}) =>
    rpc<Resultado>(db, actor, "crear_cita_sin_reserva", { p_barbero: e.camilo, p_servicio: e.corte, ...args });

  it("empieza ahora, en atención, a minuto cerrado", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await sinReserva(e, e.recepcion, { p_cliente_nombre: "Pedro", p_cliente_telefono: "3205551122" });
    expect(r).toMatchObject({ ok: true, precio: 18000 });
    const c = await citaDe(r.id!);
    expect(c.estado).toBe("en_atencion");
    const atraso = Date.now() - c.inicio.getTime();
    expect(atraso).toBeGreaterThanOrEqual(-2000);
    expect(atraso).toBeLessThan(75_000);
    expect(c.inicio.getUTCSeconds()).toBe(0);
    expect(c.fin.getTime() - c.inicio.getTime()).toBe(30 * 60_000);
  });

  it("no pone avisos: ya está ahí (aunque el barbero no tenga horario)", async () => {
    const e = await crearEscenarioAgenda(db);
    await rpc(db, e.userId, "guardar_horario_barbero", { p_barbero: e.camilo, p_franjas: [] });
    await expect(sinReserva(e, e.recepcion, { p_cliente_nombre: "Pedro" })).resolves.toMatchObject({ ok: true });
  });

  it("si el barbero está ocupado ahora, falla y dice con quién", async () => {
    const e = await crearEscenarioAgenda(db);
    await db.query(
      `insert into public.clientes (barberia_id, nombre) values ($1, 'Marta Ruiz')`, [e.barberiaId]);
    const m = await db.query<{ id: string }>(`select id from public.clientes where barberia_id = $1`, [e.barberiaId]);
    await db.query(
      `insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio)
       values ($1, $2, $3, $4, date_trunc('minute', now()) - interval '5 minutes')`,
      [e.barberiaId, e.camilo, m.rows[0].id, e.corte]
    );
    await expect(sinReserva(e, e.recepcion, { p_cliente_nombre: "Pedro" })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Camilo ya tiene a Marta Ruiz"),
    });
    // Con otro barbero sí.
    await expect(
      sinReserva(e, e.recepcion, { p_barbero: e.dani, p_cliente_nombre: "Pedro" })
    ).resolves.toMatchObject({ ok: true });
  });

  it("el barbero la registra solo para sí mismo", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(sinReserva(e, e.cuentaCamilo, { p_cliente_nombre: "Pedro" })).resolves.toMatchObject({ ok: true });
    await expect(
      sinReserva(e, e.cuentaCamilo, { p_barbero: e.dani, p_cliente_nombre: "Luis" })
    ).rejects.toMatchObject({ code: "42501" });
    await expect(sinReserva(e, e.cajero, { p_cliente_nombre: "Luis" })).rejects.toMatchObject({ code: "42501" });
  });
});

describe("mover_cita", () => {
  const mover = (actor: string, id: string, inicio: string, confirmar = false) =>
    rpc<Resultado>(db, actor, "mover_cita", { p_id: id, p_inicio: inicio, p_confirmar: confirmar });

  it("cambia solo la hora; la hora final se recalcula y el recordatorio se borra", async () => {
    const e = await crearEscenarioAgenda(db);
    const id = await sembrar(e, { inicio: en(0), servicio: e.combo });
    await db.query(`update public.citas set recordatorio_enviado_at = now() where id = $1`, [id]);

    const r = await mover(e.recepcion, id, en(120));
    expect(r).toMatchObject({ ok: true });
    const c = await citaDe(id);
    expect(c.inicio.toISOString()).toBe(en(120));
    expect(c.fin.toISOString()).toBe(en(165)); // 45 min
    expect(c.recordatorio_enviado_at).toBeNull();
    expect(c.precio).toBe(22000);
  });

  it("a una hora ocupada FALLA y la cita no cambia", async () => {
    const e = await crearEscenarioAgenda(db);
    const id = await sembrar(e, { inicio: en(0) });
    await crear(e, e.recepcion, { p_inicio: en(120), p_cliente_nombre: "Luis Gómez" });
    await db.query(`update public.citas set recordatorio_enviado_at = now() where id = $1`, [id]);

    await expect(mover(e.recepcion, id, en(110))).rejects.toMatchObject({
      code: "P0001",
      message: "Camilo ya tiene a Luis Gómez de 12:00 p. m. a 12:30 p. m. (elige otra hora).",
    });
    const c = await citaDe(id);
    expect(c.inicio.toISOString()).toBe(en(0));
    expect(c.recordatorio_enviado_at).not.toBeNull();
  });

  it("moverla a la misma hora no hace nada y no choca consigo misma", async () => {
    const e = await crearEscenarioAgenda(db);
    const id = await sembrar(e, { inicio: en(0) });
    await db.query(`update public.citas set recordatorio_enviado_at = now() where id = $1`, [id]);
    await expect(mover(e.recepcion, id, en(0))).resolves.toMatchObject({ ok: true });
    expect((await citaDe(id)).recordatorio_enviado_at).not.toBeNull();
    // Y correrla unos minutos dentro de su propio rango tampoco choca consigo misma.
    await expect(mover(e.recepcion, id, en(10))).resolves.toMatchObject({ ok: true });
  });

  it("avisa (fuera de horario, bloqueo, pasado) y mueve al confirmar", async () => {
    const e = await crearEscenarioAgenda(db);
    const id = await sembrar(e, { inicio: en(0) });
    const dia = new Date(en(0)).getUTCDay();
    await rpc(db, e.userId, "guardar_horario_barbero", { p_barbero: e.camilo, p_franjas: [{ dia, desde: 540, hasta: 780 }] });

    const aviso = await mover(e.recepcion, id, en(8 * 60)); // 6:00 p. m.: fuera del horario
    expect(aviso).toMatchObject({ ok: false, motivo: "avisos" });
    expect(aviso.avisos!.map((a) => a.tipo)).toEqual(["fuera_de_horario"]);
    expect((await citaDe(id)).inicio.toISOString()).toBe(en(0));

    await expect(mover(e.recepcion, id, en(8 * 60), true)).resolves.toMatchObject({ ok: true });
    expect((await citaDe(id)).inicio.toISOString()).toBe(en(8 * 60));
  });

  it.each(["en_atencion", "atendida", "cancelada", "no_asistio"])("no mueve una cita %s", async (estado) => {
    const e = await crearEscenarioAgenda(db);
    const id = await sembrar(e, { inicio: en(0), estado });
    await expect(mover(e.recepcion, id, en(120))).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Solo se pueden mover las citas confirmadas"),
    });
  });

  it("el barbero mueve las suyas, no las de otro; recepción mueve cualquiera", async () => {
    const e = await crearEscenarioAgenda(db);
    const deCamilo = await sembrar(e, { inicio: en(0) });
    const deDani = await sembrar(e, { barbero: e.dani, inicio: en(0) });

    await expect(mover(e.cuentaCamilo, deCamilo, en(120))).resolves.toMatchObject({ ok: true });
    await expect(mover(e.cuentaCamilo, deDani, en(120))).rejects.toMatchObject({ code: "42501" });
    await expect(mover(e.recepcion, deDani, en(120))).resolves.toMatchObject({ ok: true });
    await expect(mover(e.cajero, deDani, en(180))).rejects.toMatchObject({ code: "42501" });
  });

  it("una cita que no existe o es de otra barbería da P0002", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const deB = await sembrar(b, { inicio: en(0) });
    await expect(mover(a.recepcion, deB, en(60))).rejects.toMatchObject({ code: "P0002" });
    await expect(mover(a.recepcion, "00000000-0000-0000-0000-000000000001", en(60))).rejects.toMatchObject({
      code: "P0002",
    });
    expect((await citaDe(deB)).inicio.toISOString()).toBe(en(0));
  });
});

describe("cancelar_cita", () => {
  const cancelar = (actor: string, id: string, motivo: string | null) =>
    rpc<Resultado>(db, actor, "cancelar_cita", { p_id: id, p_motivo: motivo });

  it("guarda el motivo, quién y cuándo, y deja la hora libre", async () => {
    const e = await crearEscenarioAgenda(db);
    const id = await sembrar(e, { inicio: en(0) });
    await expect(cancelar(e.recepcion, id, "  El cliente   avisó que no puede ")).resolves.toMatchObject({
      ok: true,
      estado: "cancelada",
    });
    const c = await citaDe(id);
    expect(c.estado).toBe("cancelada");
    expect(c.cancelada_motivo).toBe("El cliente avisó que no puede");
    expect(c.cancelada_por).toBe(e.recepcion);
    expect(c.cancelada_at).not.toBeNull();

    // La hora queda libre para otra cita.
    await expect(crear(e, e.recepcion, { p_inicio: en(0), p_cliente_nombre: "Otro" })).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["sin motivo", null, /por qué se cancela/],
    ["con motivo en blanco", "   ", /por qué se cancela/],
    ["con un motivo demasiado largo", "x".repeat(201), /muy largo/],
  ])("rechaza cancelar %s", async (_caso, motivo, mensaje) => {
    const e = await crearEscenarioAgenda(db);
    const id = await sembrar(e, { inicio: en(0) });
    await expect(cancelar(e.recepcion, id, motivo)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringMatching(mensaje as RegExp),
    });
    expect((await citaDe(id)).estado).toBe("confirmada");
  });

  it.each(["en_atencion", "atendida", "cancelada", "no_asistio"])("no cancela una cita %s", async (estado) => {
    const e = await crearEscenarioAgenda(db);
    const id = await sembrar(e, { inicio: en(0), estado });
    await expect(cancelar(e.recepcion, id, "Prueba")).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Solo se pueden cancelar las citas confirmadas"),
    });
  });

  it("el barbero cancela las suyas; no las de otro; quien solo cobra, ninguna", async () => {
    const e = await crearEscenarioAgenda(db);
    const deCamilo = await sembrar(e, { inicio: en(0) });
    const deDani = await sembrar(e, { barbero: e.dani, inicio: en(0) });
    await expect(cancelar(e.cuentaCamilo, deDani, "No es mía")).rejects.toMatchObject({ code: "42501" });
    await expect(cancelar(e.cajero, deCamilo, "No puedo")).rejects.toMatchObject({ code: "42501" });
    await expect(cancelar(e.cuentaCamilo, deCamilo, "Se enfermó")).resolves.toMatchObject({ ok: true });
  });

  it("una cita de otra barbería no se toca", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const deB = await sembrar(b, { inicio: en(0) });
    await expect(cancelar(a.userId, deB, "Prueba")).rejects.toMatchObject({ code: "P0002" });
    expect((await citaDe(deB)).estado).toBe("confirmada");
  });
});

describe("cambiar_estado_cita", () => {
  const cambiar = (actor: string, id: string, estado: string) =>
    rpc<Resultado & { estado?: string }>(db, actor, "cambiar_estado_cita", { p_id: id, p_estado: estado });

  it("sigue exactamente el mapa de TRANSICIONES de TypeScript (todas las combinaciones)", async () => {
    const e = await crearEscenarioAgenda(db);
    const destinos: EstadoCita[] = ["confirmada", "en_atencion", "atendida", "no_asistio"];
    let dia = 0;
    for (const de of ESTADOS_CITA) {
      for (const a of destinos) {
        dia += 1;
        // Días distintos y en el pasado: no chocan entre sí y "no asistió" ya es posible (ya pasó la hora).
        const inicio = new Date(Date.UTC(2020, 0, dia, 15, 0)).toISOString();
        const id = await sembrar(e, { inicio, estado: de });
        const intento = cambiar(e.recepcion, id, a);
        if (puedeCambiar(de, a)) {
          await expect(intento, `${de} -> ${a}`).resolves.toMatchObject({ ok: true, estado: a });
          expect((await citaDe(id)).estado).toBe(a);
        } else {
          await expect(intento, `${de} -> ${a}`).rejects.toMatchObject({
            code: "P0001",
            message: expect.stringContaining("no se puede pasar"),
          });
          expect((await citaDe(id)).estado).toBe(de);
        }
      }
    }
  });

  it("'no asistió' solo cuando ya es la hora de la cita", async () => {
    const e = await crearEscenarioAgenda(db);
    const futura = await sembrar(e, { inicio: en(0) });
    await expect(cambiar(e.recepcion, futura, "no_asistio")).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Todavía no es la hora"),
    });
  });

  it("cancelar no va por aquí, ni un estado inventado", async () => {
    const e = await crearEscenarioAgenda(db);
    const id = await sembrar(e, { inicio: en(0) });
    for (const estado of ["cancelada", "inventado", ""]) {
      await expect(cambiar(e.recepcion, id, estado)).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining("no es válido"),
      });
    }
  });

  it("reactivar una cancelada limpia la cancelación; si otra tomó la hora, falla", async () => {
    const e = await crearEscenarioAgenda(db);
    const id = await sembrar(e, { inicio: en(0), estado: "cancelada" });
    await expect(cambiar(e.recepcion, id, "confirmada")).resolves.toMatchObject({ ok: true });
    const c = await citaDe(id);
    expect(c).toMatchObject({ estado: "confirmada", cancelada_motivo: null, cancelada_por: null, cancelada_at: null });

    const otra = await sembrar(e, { inicio: en(240), estado: "cancelada" });
    await crear(e, e.recepcion, { p_inicio: en(240), p_cliente_nombre: "Luis Gómez" });
    await expect(cambiar(e.recepcion, otra, "confirmada")).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("No se puede reactivar: Camilo ya tiene a Luis Gómez"),
    });
    expect((await citaDe(otra)).estado).toBe("cancelada");
  });

  it("el barbero cambia el estado de las suyas, no las de otro", async () => {
    const e = await crearEscenarioAgenda(db);
    const deCamilo = await sembrar(e, { inicio: en(0) });
    const deDani = await sembrar(e, { barbero: e.dani, inicio: en(0) });
    await expect(cambiar(e.cuentaCamilo, deCamilo, "en_atencion")).resolves.toMatchObject({ ok: true });
    await expect(cambiar(e.cuentaCamilo, deDani, "en_atencion")).rejects.toMatchObject({ code: "42501" });
    await expect(cambiar(e.cajero, deCamilo, "atendida")).rejects.toMatchObject({ code: "42501" });
  });

  it("una cita de otra barbería da P0002", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const deB = await sembrar(b, { inicio: en(0) });
    await expect(cambiar(a.userId, deB, "en_atencion")).rejects.toMatchObject({ code: "P0002" });
  });
});
