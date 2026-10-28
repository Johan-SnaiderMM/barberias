/**
 * Clientes: alta, ficha, nota del corte y dedupe por celular (tarea 1.8 · migración 0012, SPEC F10).
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBase, rpc } from "./base-datos";
import { crearEscenarioAgenda, en, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

type Ficha = {
  id: string;
  nombre: string;
  telefono: string | null;
  nota: string | null;
  visitas: number;
  no_asistio: number;
  ultima_visita: string | null;
  citas: { id: string; inicio: string; estado: string; precio: number; servicio: string; barbero: string }[];
};

const crear = (actor: string, args: Record<string, unknown>) => rpc<{ id: string }>(db, actor, "crear_cliente", args);
const ficha = (actor: string, id: string) => rpc<Ficha | null>(db, actor, "obtener_cliente", { p_id: id });

async function cita(e: EscenarioAgenda, cliente: string, o: { barbero?: string; inicio: string; estado?: string }) {
  await db.query(
    `insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio, estado, cancelada_motivo, cancelada_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      e.barberiaId,
      o.barbero ?? e.camilo,
      cliente,
      e.corte,
      o.inicio,
      o.estado ?? "confirmada",
      o.estado === "cancelada" ? "Prueba" : null,
      o.estado === "cancelada" ? new Date().toISOString() : null,
    ]
  );
}

describe("crear_cliente", () => {
  it("crea el cliente con el celular normalizado y la nota limpia", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e.recepcion, {
      p_nombre: "  Juan   Pérez ",
      p_telefono: "300 123 4567",
      p_nota: "  Degradé 2  ",
    });
    expect(await ficha(e.recepcion, id)).toMatchObject({
      nombre: "Juan Pérez",
      telefono: "+573001234567",
      nota: "Degradé 2",
      visitas: 0,
      citas: [],
    });
  });

  it("acepta un cliente sin celular", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e.recepcion, { p_nombre: "Ana" });
    expect(await ficha(e.recepcion, id)).toMatchObject({ nombre: "Ana", telefono: null, nota: null });
  });

  it("un celular repetido dice de quién es (dedupe dentro de la barbería)", async () => {
    const e = await crearEscenarioAgenda(db);
    await crear(e.recepcion, { p_nombre: "Juan Pérez", p_telefono: "3001234567" });
    await expect(crear(e.recepcion, { p_nombre: "Otro Juan", p_telefono: "+57 300 123 4567" })).rejects.toMatchObject({
      code: "P0001",
      message: "Ese celular ya es de Juan Pérez.",
    });
    // En otra barbería sí puede ser cliente.
    const otra = await crearEscenarioAgenda(db);
    await expect(crear(otra.recepcion, { p_nombre: "Juan en otra", p_telefono: "3001234567" })).resolves.toBeTruthy();
  });

  it.each([
    ["nombre vacío", { p_nombre: "   " }, /nombre del cliente/],
    ["nombre largo", { p_nombre: "x".repeat(61) }, /nombre del cliente/],
    ["celular inválido", { p_nombre: "Ana", p_telefono: "123" }, /celular no es válido/],
    ["nota larga", { p_nombre: "Ana", p_nota: "x".repeat(301) }, /nota es muy larga/],
  ])("rechaza %s", async (_caso, args, mensaje) => {
    const e = await crearEscenarioAgenda(db);
    await expect(crear(e.recepcion, args)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringMatching(mensaje as RegExp),
    });
  });

  it("solo recepción (agenda) da de alta; el barbero y quien cobra, no", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(crear(e.cuentaCamilo, { p_nombre: "Ana" })).rejects.toMatchObject({ code: "42501" });
    await expect(crear(e.cajero, { p_nombre: "Ana" })).rejects.toMatchObject({ code: "42501" });
    await expect(rpc(db, null, "crear_cliente", { p_nombre: "Ana" })).rejects.toMatchObject({ code: "42501" });
    await expect(crear(e.userId, { p_nombre: "Ana" })).resolves.toBeTruthy();
  });
});

describe("el mismo celular desde una cita y desde el alta manual", () => {
  it("crear_cita reconoce al cliente dado de alta a mano", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e.recepcion, { p_nombre: "Juan Pérez", p_telefono: "3001234567" });
    const r = await rpc<{ cliente_id: string }>(db, e.recepcion, "crear_cita", {
      p_barbero: e.camilo,
      p_servicio: e.corte,
      p_inicio: en(0),
      p_cliente_nombre: "Juancho",
      p_cliente_telefono: "300-123-4567",
    });
    expect(r.cliente_id).toBe(id);
    const { rows } = await db.query(`select 1 from public.clientes where barberia_id = $1`, [e.barberiaId]);
    expect(rows).toHaveLength(1);
  });
});

describe("actualizar_cliente", () => {
  const actualizar = (actor: string, id: string, args: Record<string, unknown>) =>
    rpc(db, actor, "actualizar_cliente", { p_id: id, ...args });

  it("cambia nombre y celular", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e.recepcion, { p_nombre: "Juan", p_telefono: "3001234567" });
    await actualizar(e.recepcion, id, { p_nombre: " Juan  Pérez ", p_telefono: "311 222 3344" });
    expect(await ficha(e.recepcion, id)).toMatchObject({ nombre: "Juan Pérez", telefono: "+573112223344" });
  });

  it("puede quitar el celular y conservar el propio sin chocar consigo mismo", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e.recepcion, { p_nombre: "Juan", p_telefono: "3001234567" });
    await expect(actualizar(e.recepcion, id, { p_nombre: "Juan P.", p_telefono: "3001234567" })).resolves.toBeTruthy();
    await actualizar(e.recepcion, id, { p_nombre: "Juan P.", p_telefono: null });
    expect((await ficha(e.recepcion, id))!.telefono).toBeNull();
  });

  it("no deja usar el celular de otro cliente", async () => {
    const e = await crearEscenarioAgenda(db);
    await crear(e.recepcion, { p_nombre: "Ana Ruiz", p_telefono: "3109998877" });
    const { id } = await crear(e.recepcion, { p_nombre: "Juan", p_telefono: "3001234567" });
    await expect(actualizar(e.recepcion, id, { p_nombre: "Juan", p_telefono: "310 999 8877" })).rejects.toMatchObject({
      code: "P0001",
      message: "Ese celular ya es de Ana Ruiz.",
    });
    expect((await ficha(e.recepcion, id))!.telefono).toBe("+573001234567");
  });

  it("solo con el área agenda; un cliente de otra barbería no existe", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const { id } = await crear(a.recepcion, { p_nombre: "Juan" });
    await expect(actualizar(a.cuentaCamilo, id, { p_nombre: "X" })).rejects.toMatchObject({ code: "42501" });
    await expect(actualizar(b.recepcion, id, { p_nombre: "X" })).rejects.toMatchObject({ code: "P0002" });
    expect((await ficha(a.recepcion, id))!.nombre).toBe("Juan");
  });
});

describe("guardar_nota_cliente", () => {
  const nota = (actor: string, id: string, texto: string | null) =>
    rpc(db, actor, "guardar_nota_cliente", { p_id: id, p_nota: texto });

  it("la escriben recepción y el barbero; vacía la deja sin nota", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e.recepcion, { p_nombre: "Juan" });
    await nota(e.cuentaCamilo, id, "  Degradé 2 a los lados,  barba al ras ");
    expect((await ficha(e.recepcion, id))!.nota).toBe("Degradé 2 a los lados, barba al ras");
    await nota(e.recepcion, id, "   ");
    expect((await ficha(e.recepcion, id))!.nota).toBeNull();
  });

  it("no acepta más de 300 letras, ni la escribe quien solo cobra", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e.recepcion, { p_nombre: "Juan" });
    await expect(nota(e.recepcion, id, "x".repeat(301))).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("muy larga"),
    });
    await expect(nota(e.cajero, id, "algo")).rejects.toMatchObject({ code: "42501" });
  });

  it("un cliente de otra barbería no existe", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const { id } = await crear(a.recepcion, { p_nombre: "Juan" });
    await expect(nota(b.recepcion, id, "hola")).rejects.toMatchObject({ code: "P0002" });
  });
});

describe("obtener_cliente (la ficha)", () => {
  it("cuenta visitas, no asistió y última visita, con el historial reciente primero", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e.recepcion, { p_nombre: "Juan Pérez", p_telefono: "3001234567" });
    await cita(e, id, { inicio: "2030-01-10T15:00:00Z", estado: "atendida" });
    await cita(e, id, { inicio: "2030-02-10T15:00:00Z", estado: "atendida", barbero: e.dani });
    await cita(e, id, { inicio: "2030-03-10T15:00:00Z", estado: "no_asistio" });
    await cita(e, id, { inicio: "2030-04-10T15:00:00Z", estado: "cancelada" });
    await cita(e, id, { inicio: "2030-05-10T15:00:00Z" });

    const f = (await ficha(e.recepcion, id))!;
    expect(f).toMatchObject({ visitas: 2, no_asistio: 1 });
    expect(new Date(f.ultima_visita!).toISOString()).toBe("2030-02-10T15:00:00.000Z");
    expect(f.citas.map((c) => c.estado)).toEqual(["confirmada", "cancelada", "no_asistio", "atendida", "atendida"]);
    expect(f.citas[3]).toMatchObject({ servicio: "Corte", barbero: "Dani", precio: 15000 });
  });

  it("trae solo las últimas 20 citas", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e.recepcion, { p_nombre: "Juan" });
    for (let i = 0; i < 23; i++) {
      await cita(e, id, { inicio: new Date(Date.UTC(2031, 0, 1 + i, 15, 0)).toISOString(), estado: "atendida" });
    }
    const f = (await ficha(e.recepcion, id))!;
    expect(f.visitas).toBe(23);
    expect(f.citas).toHaveLength(20);
  });

  it("el barbero ve en el historial solo SUS citas; recepción y caja, todas", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await crear(e.recepcion, { p_nombre: "Juan" });
    await cita(e, id, { inicio: "2030-01-10T15:00:00Z", estado: "atendida", barbero: e.camilo });
    await cita(e, id, { inicio: "2030-02-10T15:00:00Z", estado: "atendida", barbero: e.dani });

    expect((await ficha(e.cuentaCamilo, id))!.citas.map((c) => c.barbero)).toEqual(["Camilo"]);
    expect((await ficha(e.cuentaDani, id))!.citas.map((c) => c.barbero)).toEqual(["Dani"]);
    expect((await ficha(e.recepcion, id))!.citas).toHaveLength(2);
    expect((await ficha(e.cajero, id))!.citas).toHaveLength(2);
    // Los totales son de la barbería entera.
    expect((await ficha(e.cuentaCamilo, id))!.visitas).toBe(2);
  });

  it("devuelve null si no existe o es de otra barbería, y exige permiso", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const { id } = await crear(a.recepcion, { p_nombre: "Juan" });
    expect(await ficha(b.recepcion, id)).toBeNull();
    expect(await ficha(a.recepcion, "00000000-0000-0000-0000-000000000001")).toBeNull();
    await expect(rpc(db, null, "obtener_cliente", { p_id: id })).rejects.toMatchObject({ code: "42501" });
  });
});
