/**
 * Citas con la restricción anti-doble-reserva, clientes y el aviso de bloqueos (tarea 1.4 · migración 0008).
 * Estas pruebas hablan con la base directo (como dueño de la base) para ejercitar las RESTRICCIONES y los triggers;
 * las funciones de crear / mover / cancelar llegan en la tarea 1.6.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BarberiaDePrueba, como, crearBarberia, crearBase, crearMiembro, crearRol, rpc } from "./base-datos";

let db: PGlite;
let contador = 0;

beforeAll(async () => {
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

/** Instante fijo lejano (nunca depende del reloj): 2030-03-04 10:00 en Bogotá + N minutos. */
const BASE = Date.parse("2030-03-04T15:00:00Z");
const t = (minutos: number) => new Date(BASE + minutos * 60_000).toISOString();

type Escenario = BarberiaDePrueba & {
  corte: string;
  combo: string;
  camilo: string;
  dani: string;
  cliente: string;
};

async function escenario(): Promise<Escenario> {
  contador += 1;
  const a = await crearBarberia(db, `Barbería ${contador}`);
  const id = async (fn: string, args: Record<string, unknown>) => (await rpc<{ id: string }>(db, a.userId, fn, args)).id;
  const corte = await id("crear_servicio", { p_nombre: "Corte", p_precio: 15000, p_duracion_min: 30 });
  const combo = await id("crear_servicio", { p_nombre: "Corte + barba", p_precio: 22000, p_duracion_min: 45 });
  const camilo = await id("crear_barbero", { p_nombre: "Camilo" });
  const dani = await id("crear_barbero", { p_nombre: "Dani" });
  // Camilo cobra más por el corte; Dani tarda más.
  await rpc(db, a.userId, "asignar_servicios_barbero", {
    p_barbero: camilo,
    p_servicios: [{ servicio_id: corte, precio_propio: 18000 }, { servicio_id: combo }],
  });
  await rpc(db, a.userId, "asignar_servicios_barbero", {
    p_barbero: dani,
    p_servicios: [{ servicio_id: corte, duracion_propia: 45 }],
  });
  const cliente = await insertarCliente(a.barberiaId, "Juan Pérez", "+573001234567");
  return { ...a, corte, combo, camilo, dani, cliente };
}

async function insertarCliente(barberiaId: string, nombre: string, telefono: string | null): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.clientes (barberia_id, nombre, telefono) values ($1, $2, $3) returning id`,
    [barberiaId, nombre, telefono]
  );
  return r.rows[0].id;
}

type Opciones = {
  barbero: string;
  servicio: string;
  inicio: string;
  estado?: string;
  cliente?: string;
  extra?: string;
};

type Cita = { id: string; precio: number; duracion_min: number; inicio: Date; fin: Date; estado: string };

async function insertarCita(e: Escenario, o: Opciones): Promise<Cita> {
  const estado = o.estado ?? "confirmada";
  const cancelada = estado === "cancelada";
  const r = await db.query<Cita>(
    `insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio, estado,
                               cancelada_motivo, cancelada_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, precio, duracion_min, inicio, fin, estado`,
    [
      e.barberiaId,
      o.barbero,
      o.cliente ?? e.cliente,
      o.servicio,
      o.inicio,
      estado,
      cancelada ? "Prueba" : null,
      cancelada ? new Date().toISOString() : null,
    ]
  );
  return r.rows[0];
}

const iso = (d: Date) => d.toISOString();

describe("precio y duración se copian del catálogo al crear la cita", () => {
  it("usa el precio y la duración del servicio cuando el barbero no tiene propios", async () => {
    const e = await escenario();
    const c = await insertarCita(e, { barbero: e.camilo, servicio: e.combo, inicio: t(0) });
    expect(c).toMatchObject({ precio: 22000, duracion_min: 45 });
    expect(iso(c.fin)).toBe(t(45));
  });

  it("usa el precio propio y la duración propia del barbero cuando los tiene", async () => {
    const e = await escenario();
    const deCamilo = await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) });
    expect(deCamilo).toMatchObject({ precio: 18000, duracion_min: 30 });
    const deDani = await insertarCita(e, { barbero: e.dani, servicio: e.corte, inicio: t(0) });
    expect(deDani).toMatchObject({ precio: 15000, duracion_min: 45 });
    expect(iso(deDani.fin)).toBe(t(45));
  });

  it("ignora un precio o una duración que se pida en el insert", async () => {
    const e = await escenario();
    const r = await db.query<Cita>(
      `insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio, precio, duracion_min)
       values ($1, $2, $3, $4, $5, 1, 5) returning id, precio, duracion_min, inicio, fin, estado`,
      [e.barberiaId, e.camilo, e.cliente, e.corte, t(0)]
    );
    expect(r.rows[0]).toMatchObject({ precio: 18000, duracion_min: 30 });
  });

  it("cambiar el catálogo después NO reescribe las citas ya hechas", async () => {
    const e = await escenario();
    const c = await insertarCita(e, { barbero: e.dani, servicio: e.corte, inicio: t(0) });
    await rpc(db, e.userId, "actualizar_servicio", { p_id: e.corte, p_nombre: "Corte", p_precio: 99000, p_duracion_min: 60 });
    await rpc(db, e.userId, "asignar_servicios_barbero", {
      p_barbero: e.dani,
      p_servicios: [{ servicio_id: e.corte, precio_propio: 77000, duracion_propia: 90 }],
    });
    const { rows } = await db.query<Cita>(`select id, precio, duracion_min, inicio, fin, estado from public.citas where id = $1`, [c.id]);
    expect(rows[0]).toMatchObject({ precio: 15000, duracion_min: 45 });
    expect(iso(rows[0].fin)).toBe(t(45));
  });

  it("un servicio archivado se conserva en las citas viejas, pero no se puede agendar de nuevo", async () => {
    const e = await escenario();
    await insertarCita(e, { barbero: e.camilo, servicio: e.combo, inicio: t(0) });
    await rpc(db, e.userId, "fijar_servicio_activo", { p_id: e.combo, p_activo: false });
    const { rows } = await db.query<{ nombre: string; activo: boolean }>(
      `select s.nombre, s.activo from public.citas c
         join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
        where c.barberia_id = $1`,
      [e.barberiaId]
    );
    expect(rows).toEqual([{ nombre: "Corte + barba", activo: false }]);
    await expect(insertarCita(e, { barbero: e.camilo, servicio: e.combo, inicio: t(120) })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("está archivado"),
    });
  });
});

describe("quién puede atender qué", () => {
  it("un barbero solo recibe citas de lo que tiene asignado", async () => {
    const e = await escenario();
    await expect(insertarCita(e, { barbero: e.dani, servicio: e.combo, inicio: t(0) })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Dani no hace el servicio Corte + barba"),
    });
  });

  it("no agenda con un barbero archivado ni con uno que no existe", async () => {
    const e = await escenario();
    await rpc(db, e.userId, "fijar_barbero_activo", { p_id: e.camilo, p_activo: false });
    await expect(insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Camilo ya no está activo"),
    });
    await expect(
      insertarCita(e, { barbero: "00000000-0000-0000-0000-000000000001", servicio: e.corte, inicio: t(0) })
    ).rejects.toMatchObject({ code: "P0002" });
  });

  it("no mezcla datos de otra barbería (las llaves foráneas son compuestas)", async () => {
    const a = await escenario();
    const b = await escenario();
    const clienteDeB = await insertarCliente(b.barberiaId, "Cliente de B", "+573009998877");
    await expect(
      insertarCita(a, { barbero: a.camilo, servicio: a.corte, inicio: t(0), cliente: clienteDeB })
    ).rejects.toMatchObject({ code: "23503" });
    // …ni un servicio o un barbero de otra barbería (no existen para esta).
    await expect(insertarCita(a, { barbero: a.camilo, servicio: b.corte, inicio: t(0) })).rejects.toMatchObject({
      code: "P0002",
    });
    await expect(insertarCita(a, { barbero: b.camilo, servicio: a.corte, inicio: t(0) })).rejects.toMatchObject({
      code: "P0002",
    });
  });
});

describe("restricción anti-doble-reserva", () => {
  it("rechaza una cita que se traslapa con otra del mismo barbero", async () => {
    const e = await escenario();
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) }); // 10:00–10:30
    await expect(insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(15) })).rejects.toMatchObject({
      code: "23P01",
    });
    await expect(insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(-15) })).rejects.toMatchObject({
      code: "23P01",
    });
    await expect(insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) })).rejects.toMatchObject({
      code: "23P01",
    });
  });

  it("rechaza una cita contenida dentro de otra más larga", async () => {
    const e = await escenario();
    await insertarCita(e, { barbero: e.camilo, servicio: e.combo, inicio: t(0) }); // 10:00–10:45
    await expect(insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(10) })).rejects.toMatchObject({
      code: "23P01",
    });
  });

  it("permite citas pegadas y la misma hora con otro barbero", async () => {
    const e = await escenario();
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) });
    await expect(insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(30) })).resolves.toBeTruthy();
    await expect(insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(-30) })).resolves.toBeTruthy();
    await expect(insertarCita(e, { barbero: e.dani, servicio: e.corte, inicio: t(0) })).resolves.toBeTruthy();
  });

  it("una cita cancelada o que no asistió libera la hora", async () => {
    const e = await escenario();
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0), estado: "cancelada" });
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(60), estado: "no_asistio" });
    await expect(insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) })).resolves.toBeTruthy();
    await expect(insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(60) })).resolves.toBeTruthy();
  });

  it.each(["en_atencion", "atendida"])("una cita %s sí ocupa la hora", async (estado) => {
    const e = await escenario();
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0), estado });
    await expect(insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) })).rejects.toMatchObject({
      code: "23P01",
    });
  });

  it("no deja reactivar una cita cancelada si su hora ya la tomó otra", async () => {
    const e = await escenario();
    const vieja = await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0), estado: "cancelada" });
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) });
    await expect(
      db.query(`update public.citas set estado = 'confirmada' where id = $1`, [vieja.id])
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("mover una cita cambia la hora final sola; a una hora ocupada falla y la deja donde estaba", async () => {
    const e = await escenario();
    const c = await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) });
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(120) });

    await db.query(`update public.citas set inicio = $2 where id = $1`, [c.id, t(60)]);
    let { rows } = await db.query<Cita>(`select id, precio, duracion_min, inicio, fin, estado from public.citas where id = $1`, [c.id]);
    expect([iso(rows[0].inicio), iso(rows[0].fin)]).toEqual([t(60), t(90)]);

    await expect(db.query(`update public.citas set inicio = $2 where id = $1`, [c.id, t(110)])).rejects.toMatchObject({
      code: "23P01",
    });
    ({ rows } = await db.query<Cita>(`select id, precio, duracion_min, inicio, fin, estado from public.citas where id = $1`, [c.id]));
    expect(iso(rows[0].inicio)).toBe(t(60));
  });

  it("dos reservas lanzadas a la vez a la misma hora: una gana y la otra recibe exclusion_violation", async () => {
    // PGlite atiende una consulta a la vez, así que esto prueba el RESULTADO que la base garantiza; bajo
    // concurrencia real el mismo contrato lo da Postgres a toda restricción de exclusión.
    const e = await escenario();
    const intento = () =>
      db.transaction((tx) =>
        tx.query(
          `insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio) values ($1, $2, $3, $4, $5)`,
          [e.barberiaId, e.camilo, e.cliente, e.corte, t(0)]
        )
      );
    const resultados = await Promise.allSettled([intento(), intento(), intento()]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of resultados) {
      if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "23P01" });
    }
    const { rows } = await db.query(`select 1 from public.citas where barberia_id = $1`, [e.barberiaId]);
    expect(rows).toHaveLength(1);
  });
});

describe("integridad de la cita", () => {
  it("el barbero, el cliente, el servicio y el precio no se cambian después", async () => {
    const e = await escenario();
    const otro = await insertarCliente(e.barberiaId, "Otro", "+573001112233");
    const c = await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) });
    const cambios: [string, unknown][] = [
      ["precio", 1],
      ["duracion_min", 5],
      ["servicio_id", e.combo],
      ["barbero_id", e.dani],
      ["cliente_id", otro],
      ["token", "11111111-1111-4111-8111-111111111111"],
      ["origen", "cliente"],
    ];
    for (const [columna, valor] of cambios) {
      await expect(
        db.query(`update public.citas set ${columna} = $2 where id = $1`, [c.id, valor]),
        columna
      ).rejects.toMatchObject({ message: expect.stringContaining("no se cambian") });
    }
  });

  it("sí se cambian el estado, las notas y el recordatorio", async () => {
    const e = await escenario();
    const c = await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) });
    await db.query(
      `update public.citas set estado = 'en_atencion', notas = 'Degradé 2', recordatorio_enviado_at = now() where id = $1`,
      [c.id]
    );
    const { rows } = await db.query<{ estado: string; notas: string }>(`select estado, notas from public.citas where id = $1`, [c.id]);
    expect(rows[0]).toEqual({ estado: "en_atencion", notas: "Degradé 2" });
  });

  it("una cita cancelada siempre dice por qué y cuándo", async () => {
    const e = await escenario();
    const c = await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) });
    await expect(db.query(`update public.citas set estado = 'cancelada' where id = $1`, [c.id])).rejects.toMatchObject({
      code: "23514",
    });
    await expect(
      db.query(`update public.citas set estado = 'cancelada', cancelada_motivo = '   ', cancelada_at = now() where id = $1`, [c.id])
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query(`update public.citas set estado = 'cancelada', cancelada_motivo = 'El cliente avisó', cancelada_at = now() where id = $1`, [c.id])
    ).resolves.toBeTruthy();
  });

  it("la hora de inicio va a minuto cerrado y el estado es uno conocido", async () => {
    const e = await escenario();
    await expect(
      insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: "2030-03-04T15:00:30Z" })
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0), estado: "inventado" })
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("cada cita tiene su código secreto, distinto y no repetido", async () => {
    const e = await escenario();
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) });
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(30) });
    const { rows } = await db.query<{ token: string }>(`select token from public.citas where barberia_id = $1`, [e.barberiaId]);
    expect(new Set(rows.map((r) => r.token)).size).toBe(2);
  });

  it("el borrado está bloqueado y la app no escribe la tabla", async () => {
    const e = await escenario();
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) });
    await expect(db.query(`delete from public.citas where barberia_id = $1`, [e.barberiaId])).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining("se anula con motivo"),
    });
    await expect(
      como(
        db,
        e.userId,
        `insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio) values ($1, $2, $3, $4, $5)`,
        [e.barberiaId, e.camilo, e.cliente, e.corte, t(300)]
      )
    ).rejects.toMatchObject({ code: "42501" });
    await expect(como(db, e.userId, `update public.citas set estado = 'atendida'`)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("quién ve las citas (RLS)", () => {
  it("agenda y caja ven todas; el barbero (mi_agenda) solo las suyas; gastos, ninguna", async () => {
    const e = await escenario();
    await crearRol(db, e.barberiaId, "Cajero", ["caja"]);
    await crearRol(db, e.barberiaId, "Contador", ["gastos"]);
    const recepcion = await crearMiembro(db, e.barberiaId, "Ruth", ["Recepción"]);
    const cajero = await crearMiembro(db, e.barberiaId, "Cajero", ["Cajero"]);
    const contador = await crearMiembro(db, e.barberiaId, "Contador", ["Contador"]);
    const cuentaCamilo = await crearMiembro(db, e.barberiaId, "Camilo Cuenta", ["Barbero"]);
    const cuentaSinVinculo = await crearMiembro(db, e.barberiaId, "Sin vínculo", ["Barbero"]);
    await rpc(db, e.userId, "vincular_barbero_usuario", { p_barbero: e.camilo, p_user_id: cuentaCamilo });

    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) });
    await insertarCita(e, { barbero: e.dani, servicio: e.corte, inicio: t(0) });

    const cuantas = async (actor: string) => (await como(db, actor, `select 1 from public.citas`)).length;
    expect(await cuantas(e.userId)).toBe(2);
    expect(await cuantas(recepcion)).toBe(2);
    expect(await cuantas(cajero)).toBe(2);
    expect(await cuantas(cuentaCamilo)).toBe(1);
    const suyas = await como<{ barbero_id: string }>(db, cuentaCamilo, `select barbero_id from public.citas`);
    expect(suyas[0].barbero_id).toBe(e.camilo);
    expect(await cuantas(cuentaSinVinculo)).toBe(0);
    expect(await cuantas(contador)).toBe(0);
  });

  it("otra barbería no ve nada y sin sesión no se lee", async () => {
    const a = await escenario();
    const b = await escenario();
    await insertarCita(a, { barbero: a.camilo, servicio: a.corte, inicio: t(0) });
    expect(await como(db, b.userId, `select 1 from public.citas`)).toHaveLength(0);
    expect(await como(db, b.userId, `select 1 from public.clientes where nombre = 'Juan Pérez'`)).toHaveLength(1); // el suyo
    await expect(como(db, null, `select 1 from public.citas`)).rejects.toMatchObject({ code: "42501" });
    await expect(como(db, null, `select 1 from public.clientes`)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("clientes", () => {
  it("el celular debe estar en formato internacional y es único dentro de la barbería", async () => {
    const e = await escenario();
    await expect(insertarCliente(e.barberiaId, "Mal", "3001234567")).rejects.toMatchObject({ code: "23514" });
    await expect(insertarCliente(e.barberiaId, "Mal", "+57 300 123")).rejects.toMatchObject({ code: "23514" });
    await expect(insertarCliente(e.barberiaId, "Repetido", "+573001234567")).rejects.toMatchObject({ code: "23505" });
  });

  it("el mismo celular puede ser cliente en otra barbería; sin celular, varios clientes", async () => {
    const a = await escenario();
    const b = await escenario();
    await expect(insertarCliente(b.barberiaId, "Juan en B", "+573005550000")).resolves.toBeTruthy();
    await expect(insertarCliente(a.barberiaId, "Juan en A", "+573005550000")).resolves.toBeTruthy();
    await expect(insertarCliente(a.barberiaId, "Sin celular 1", null)).resolves.toBeTruthy();
    await expect(insertarCliente(a.barberiaId, "Sin celular 2", null)).resolves.toBeTruthy();
  });

  it("el nombre es obligatorio y el borrado está bloqueado", async () => {
    const e = await escenario();
    await expect(insertarCliente(e.barberiaId, "  ", null)).rejects.toMatchObject({ code: "23514" });
    await expect(db.query(`delete from public.clientes where barberia_id = $1`, [e.barberiaId])).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("bloqueos que caen sobre citas", () => {
  const bloquear = (e: Escenario, barbero: string, inicio: string, fin: string, confirmar?: boolean) =>
    rpc<{ ok: boolean; motivo?: string; id?: string; citas: { id: string; cliente: string; servicio: string; estado: string }[] }>(
      db,
      e.userId,
      "crear_bloqueo",
      { p_barbero: barbero, p_inicio: inicio, p_fin: fin, p_motivo: "Vacaciones", p_confirmar: confirmar ?? false }
    );

  const cuantosBloqueos = async (e: Escenario) =>
    (await db.query(`select 1 from public.bloqueos where barberia_id = $1 and activo`, [e.barberiaId])).rows.length;

  it("avisa qué citas caen encima y NO guarda hasta que se confirme", async () => {
    const e = await escenario();
    const c1 = await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) });
    const c2 = await insertarCita(e, { barbero: e.camilo, servicio: e.combo, inicio: t(60) });

    const aviso = await bloquear(e, e.camilo, t(-10), t(80));
    expect(aviso).toMatchObject({ ok: false, motivo: "hay_citas" });
    expect(aviso.citas.map((c) => c.id)).toEqual([c1.id, c2.id]);
    expect(aviso.citas[0]).toMatchObject({ cliente: "Juan Pérez", servicio: "Corte", estado: "confirmada" });
    expect(await cuantosBloqueos(e)).toBe(0);
  });

  it("con confirmación guarda el bloqueo y deja las citas como están (no las cancela)", async () => {
    const e = await escenario();
    const c = await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0) });
    const r = await bloquear(e, e.camilo, t(-10), t(80), true);
    expect(r).toMatchObject({ ok: true });
    expect(r.id).toBeTruthy();
    expect(r.citas.map((x) => x.id)).toEqual([c.id]);
    expect(await cuantosBloqueos(e)).toBe(1);
    const { rows } = await db.query<{ estado: string }>(`select estado from public.citas where id = $1`, [c.id]);
    expect(rows[0].estado).toBe("confirmada");
  });

  it("sin citas encima se guarda de una vez y la lista de citas viene vacía", async () => {
    const e = await escenario();
    const r = await bloquear(e, e.camilo, t(0), t(60));
    expect(r).toMatchObject({ ok: true, citas: [] });
    expect(await cuantosBloqueos(e)).toBe(1);
  });

  it("solo cuentan las citas del mismo barbero, por venir y que de verdad se cruzan", async () => {
    const e = await escenario();
    await insertarCita(e, { barbero: e.dani, servicio: e.corte, inicio: t(0) }); // otro barbero
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(-30) }); // termina justo al empezar
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(60) }); // empieza justo al terminar
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(180), estado: "cancelada" });
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(210), estado: "atendida" });
    const r = await bloquear(e, e.camilo, t(0), t(60));
    expect(r).toMatchObject({ ok: true, citas: [] });
  });

  it("cuenta las que ya están en atención", async () => {
    const e = await escenario();
    await insertarCita(e, { barbero: e.camilo, servicio: e.corte, inicio: t(0), estado: "en_atencion" });
    const r = await bloquear(e, e.camilo, t(0), t(60));
    expect(r).toMatchObject({ ok: false, motivo: "hay_citas" });
    expect(r.citas[0].estado).toBe("en_atencion");
  });

  it("queda una sola versión de crear_bloqueo", async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from pg_proc where proname = 'crear_bloqueo'`);
    expect(rows[0].n).toBe(1);
  });
});
