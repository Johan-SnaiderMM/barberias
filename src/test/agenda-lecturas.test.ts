/**
 * Lecturas de la agenda (tarea 1.7 · migración 0011): listar_citas, obtener_huecos y buscar_clientes.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { como, crearBase, crearMiembro, crearRol, rpc } from "./base-datos";
import { crearEscenarioAgenda, en, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

type CitaLista = {
  id: string;
  barbero_id: string;
  barbero: string;
  cliente: string;
  telefono: string | null;
  servicio: string;
  inicio: string;
  fin: string;
  duracion_min: number;
  precio: number;
  estado: string;
  origen: string;
  notas: string | null;
};

type Hueco = { barbero_id: string; inicio: string; fin: string };

type ClienteBuscado = {
  id: string;
  nombre: string;
  telefono: string | null;
  nota: string | null;
  visitas: number;
  no_asistio: number;
  ultima_visita: string | null;
};

async function cita(
  e: EscenarioAgenda,
  o: { barbero?: string; servicio?: string; inicio: string; estado?: string; cliente?: string; telefono?: string | null }
): Promise<{ id: string; cliente: string }> {
  const nombre = o.cliente ?? `Cliente ${Math.random().toString(36).slice(2, 7)}`;
  const cl = await db.query<{ id: string }>(
    `insert into public.clientes (barberia_id, nombre, telefono) values ($1, $2, $3) returning id`,
    [e.barberiaId, nombre, o.telefono ?? null]
  );
  const estado = o.estado ?? "confirmada";
  const r = await db.query<{ id: string }>(
    `insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio, estado, cancelada_motivo, cancelada_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      e.barberiaId,
      o.barbero ?? e.camilo,
      cl.rows[0].id,
      o.servicio ?? e.corte,
      o.inicio,
      estado,
      estado === "cancelada" ? "Prueba" : null,
      estado === "cancelada" ? new Date().toISOString() : null,
    ]
  );
  return { id: r.rows[0].id, cliente: cl.rows[0].id };
}

const listar = (actor: string, args: Record<string, unknown> = {}) => rpc<CitaLista[]>(db, actor, "listar_citas", args);

describe("listar_citas", () => {
  it("trae la cita con los nombres de cliente, servicio y barbero, en orden de hora", async () => {
    const e = await crearEscenarioAgenda(db);
    await cita(e, { inicio: en(60), cliente: "Luis Gómez", telefono: "+573112223344" });
    await cita(e, { inicio: en(0), cliente: "Juan Pérez", servicio: e.combo });
    await cita(e, { barbero: e.dani, inicio: en(0), cliente: "Ana Ruiz" });

    const r = await listar(e.recepcion, { p_desde: "2030-03-04" });
    expect(r.map((c) => [c.cliente, c.barbero])).toEqual([
      ["Juan Pérez", "Camilo"], // 10:00, Camilo antes que Dani (orden)
      ["Ana Ruiz", "Dani"],
      ["Luis Gómez", "Camilo"],
    ]);
    expect(r[0]).toMatchObject({ servicio: "Corte + barba", duracion_min: 45, precio: 22000, estado: "confirmada", origen: "personal" });
    expect(r[2]).toMatchObject({ telefono: "+573112223344" });
  });

  it("respeta el día de Bogotá: 11:59 p. m. es de hoy y las 12:00 a. m. ya es del día siguiente", async () => {
    const e = await crearEscenarioAgenda(db);
    // 2030-03-04 23:59 Bogotá = 2030-03-05T04:59Z ; 2030-03-05 00:00 Bogotá = 05:00Z
    await cita(e, { inicio: "2030-03-05T04:29:00Z", cliente: "Tarde" }); // 23:29 del 4
    await cita(e, { inicio: "2030-03-05T05:00:00Z", cliente: "Madrugada" }); // 00:00 del 5
    const del4 = await listar(e.userId, { p_desde: "2030-03-04" });
    const del5 = await listar(e.userId, { p_desde: "2030-03-05" });
    expect(del4.map((c) => c.cliente)).toEqual(["Tarde"]);
    expect(del5.map((c) => c.cliente)).toEqual(["Madrugada"]);
    const ambos = await listar(e.userId, { p_desde: "2030-03-04", p_hasta: "2030-03-05" });
    expect(ambos).toHaveLength(2);
  });

  it("sin fechas devuelve las de hoy (en Bogotá)", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
    await cita(e, { inicio: `${hoy}T12:00:00-05:00`, cliente: "De hoy" });
    await cita(e, { inicio: en(0), cliente: "De 2030" });
    expect((await listar(e.userId)).map((c) => c.cliente)).toEqual(["De hoy"]);
  });

  it("filtra por barbero y deja afuera las canceladas salvo que se pidan", async () => {
    const e = await crearEscenarioAgenda(db);
    await cita(e, { inicio: en(0), cliente: "A" });
    await cita(e, { inicio: en(60), cliente: "B", estado: "cancelada" });
    await cita(e, { barbero: e.dani, inicio: en(0), cliente: "C" });

    expect((await listar(e.userId, { p_desde: "2030-03-04", p_barbero: e.camilo })).map((c) => c.cliente)).toEqual(["A"]);
    expect(
      (await listar(e.userId, { p_desde: "2030-03-04", p_barbero: e.camilo, p_con_canceladas: true })).map((c) => c.cliente)
    ).toEqual(["A", "B"]);
    expect((await listar(e.userId, { p_desde: "2030-03-04" })).map((c) => c.cliente).sort()).toEqual(["A", "C"]);
  });

  it("el barbero solo ve las suyas; recepción y caja ven todas; quien solo lleva gastos, ninguna", async () => {
    const e = await crearEscenarioAgenda(db);
    await crearRol(db, e.barberiaId, "Contador", ["gastos"]);
    const contador = await crearMiembro(db, e.barberiaId, "Contador", ["Contador"]);
    await cita(e, { inicio: en(0), cliente: "De Camilo" });
    await cita(e, { barbero: e.dani, inicio: en(0), cliente: "De Dani" });

    const nombres = async (actor: string) => (await listar(actor, { p_desde: "2030-03-04" })).map((c) => c.cliente).sort();
    expect(await nombres(e.userId)).toEqual(["De Camilo", "De Dani"]);
    expect(await nombres(e.recepcion)).toEqual(["De Camilo", "De Dani"]);
    expect(await nombres(e.cajero)).toEqual(["De Camilo", "De Dani"]);
    expect(await nombres(e.cuentaCamilo)).toEqual(["De Camilo"]);
    expect(await nombres(e.cuentaDani)).toEqual(["De Dani"]);
    expect(await nombres(contador)).toEqual([]);
  });

  it("no ve nada de otra barbería ni sin sesión; rechaza rangos absurdos", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    await cita(a, { inicio: en(0) });
    expect(await listar(b.userId, { p_desde: "2030-03-04" })).toEqual([]);
    await expect(rpc(db, null, "listar_citas", {})).rejects.toMatchObject({ code: "42501" });
    await expect(listar(a.userId, { p_desde: "2030-03-04", p_hasta: "2030-01-01" })).rejects.toMatchObject({
      message: expect.stringContaining("rango"),
    });
    await expect(listar(a.userId, { p_desde: "2030-01-01", p_hasta: "2031-01-01" })).rejects.toMatchObject({
      message: expect.stringContaining("rango"),
    });
  });
});

describe("obtener_huecos (para el personal)", () => {
  const huecos = (actor: string, args: Record<string, unknown>) => rpc<Hueco[]>(db, actor, "obtener_huecos", args);

  const hora = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
      new Date(iso)
    );

  it("devuelve las horas libres del barbero en el día, sin la anticipación del público", async () => {
    const e = await crearEscenarioAgenda(db);
    await cita(e, { inicio: en(0) }); // 10:00–10:30
    const r = await huecos(e.recepcion, { p_servicio: e.corte, p_barbero: e.camilo, p_desde: "2030-03-04" });
    const horas = r.map((h) => hora(h.inicio));
    expect(horas).toContain("09:30");
    expect(horas).not.toContain("10:00");
    expect(horas).toContain("10:30");
    expect(horas[0]).toBe("06:00");
    expect(r.every((h) => h.barbero_id === e.camilo)).toBe(true);
  });

  it("sin barbero ofrece la primera disponible (una hora, un barbero)", async () => {
    const e = await crearEscenarioAgenda(db);
    await cita(e, { inicio: en(0) });
    const r = await huecos(e.recepcion, { p_servicio: e.corte, p_desde: "2030-03-04" });
    const a10 = r.filter((h) => hora(h.inicio) === "10:00");
    expect(a10).toHaveLength(1);
    expect(a10[0].barbero_id).toBe(e.dani); // Camilo está ocupado a esa hora
    const porInicio = new Set(r.map((h) => h.inicio));
    expect(porInicio.size).toBe(r.length);
  });

  it("al mover una cita, la propia no cuenta contra sí misma", async () => {
    const e = await crearEscenarioAgenda(db);
    const { id } = await cita(e, { inicio: en(0) });
    const sin = await huecos(e.recepcion, { p_servicio: e.corte, p_barbero: e.camilo, p_desde: "2030-03-04" });
    const con = await huecos(e.recepcion, {
      p_servicio: e.corte,
      p_barbero: e.camilo,
      p_desde: "2030-03-04",
      p_ignorar_cita: id,
    });
    expect(sin.map((h) => hora(h.inicio))).not.toContain("10:00");
    expect(con.map((h) => hora(h.inicio))).toContain("10:00");
  });

  it("el barbero solo consulta su propio tiempo", async () => {
    const e = await crearEscenarioAgenda(db);
    const propio = await huecos(e.cuentaCamilo, { p_servicio: e.corte, p_desde: "2030-03-04" });
    expect(propio.length).toBeGreaterThan(0);
    expect(propio.every((h) => h.barbero_id === e.camilo)).toBe(true);
    await expect(
      huecos(e.cuentaCamilo, { p_servicio: e.corte, p_barbero: e.dani, p_desde: "2030-03-04" })
    ).rejects.toMatchObject({ code: "42501", message: expect.stringContaining("tu propia agenda") });
  });

  it("quien solo cobra, o no tiene sesión, no consulta", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(huecos(e.cajero, { p_servicio: e.corte, p_desde: "2030-03-04" })).rejects.toMatchObject({ code: "42501" });
    await expect(rpc(db, null, "obtener_huecos", { p_servicio: e.corte })).rejects.toMatchObject({ code: "42501" });
  });

  it("no mezcla barberías", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    expect(await huecos(a.recepcion, { p_servicio: b.corte, p_desde: "2030-03-04" })).toEqual([]);
    expect(await huecos(a.recepcion, { p_servicio: a.corte, p_barbero: b.camilo, p_desde: "2030-03-04" })).toEqual([]);
  });
});

describe("buscar_clientes", () => {
  const buscar = (actor: string, args: Record<string, unknown> = {}) =>
    rpc<ClienteBuscado[]>(db, actor, "buscar_clientes", args);

  async function conHistorial(e: EscenarioAgenda) {
    // Juan: 2 atendidas y 1 no asistió. Ana: 1 atendida. Luis: ninguna.
    const juan = await cita(e, { inicio: "2029-12-01T15:00:00Z", estado: "atendida", cliente: "Juan Pérez", telefono: "+573001234567" });
    await db.query(
      `insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio, estado) values
         ($1, $2, $3, $4, '2030-01-10T15:00:00Z', 'atendida'),
         ($1, $2, $3, $4, '2030-02-10T15:00:00Z', 'no_asistio')`,
      [e.barberiaId, e.camilo, juan.cliente, e.corte]
    );
    await cita(e, { inicio: "2030-01-20T15:00:00Z", estado: "atendida", cliente: "Ana Ruiz", telefono: "+573109998877" });
    await cita(e, { inicio: "2030-04-01T15:00:00Z", cliente: "Luis Gómez", telefono: null });
  }

  it("busca por parte del nombre, sin importar mayúsculas", async () => {
    const e = await crearEscenarioAgenda(db);
    await conHistorial(e);
    expect((await buscar(e.recepcion, { p_texto: "juan" })).map((c) => c.nombre)).toEqual(["Juan Pérez"]);
    expect((await buscar(e.recepcion, { p_texto: "  RUIZ " })).map((c) => c.nombre)).toEqual(["Ana Ruiz"]);
    expect((await buscar(e.recepcion, { p_texto: "zzz" }))).toEqual([]);
  });

  it("busca por dígitos del celular, con o sin formato", async () => {
    const e = await crearEscenarioAgenda(db);
    await conHistorial(e);
    expect((await buscar(e.recepcion, { p_texto: "300 123" })).map((c) => c.nombre)).toEqual(["Juan Pérez"]);
    expect((await buscar(e.recepcion, { p_texto: "3109998877" })).map((c) => c.nombre)).toEqual(["Ana Ruiz"]);
    // Menos de 3 dígitos no busca por celular (evita traer a todos).
    expect(await buscar(e.recepcion, { p_texto: "30" })).toEqual([]);
  });

  it("cuenta visitas (atendidas), no asistió y la última visita; los más recientes primero", async () => {
    const e = await crearEscenarioAgenda(db);
    await conHistorial(e);
    const todos = await buscar(e.recepcion);
    expect(todos.map((c) => c.nombre)).toEqual(["Ana Ruiz", "Juan Pérez", "Luis Gómez"]); // última visita: Ana 20/01 > Juan 10/01 > Luis (ninguna)
    const juan = todos.find((c) => c.nombre === "Juan Pérez")!;
    expect(juan).toMatchObject({ visitas: 2, no_asistio: 1 });
    expect(new Date(juan.ultima_visita!).toISOString()).toBe("2030-01-10T15:00:00.000Z");
    expect(todos.find((c) => c.nombre === "Luis Gómez")).toMatchObject({ visitas: 0, no_asistio: 0, ultima_visita: null });
  });

  it("respeta el límite", async () => {
    const e = await crearEscenarioAgenda(db);
    await conHistorial(e);
    expect(await buscar(e.recepcion, { p_limite: 2 })).toHaveLength(2);
  });

  it("el barbero también busca (para agendar); quien solo lleva gastos, no", async () => {
    const e = await crearEscenarioAgenda(db);
    await crearRol(db, e.barberiaId, "Contador", ["gastos"]);
    const contador = await crearMiembro(db, e.barberiaId, "Contador", ["Contador"]);
    await conHistorial(e);
    expect(await buscar(e.cuentaCamilo)).toHaveLength(3);
    expect(await buscar(e.cajero)).toHaveLength(3);
    await expect(buscar(contador)).rejects.toMatchObject({ code: "42501" });
    await expect(rpc(db, null, "buscar_clientes", {})).rejects.toMatchObject({ code: "42501" });
  });

  it("no ve los clientes de otra barbería", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    await conHistorial(a);
    expect(await buscar(b.recepcion)).toEqual([]);
    const directo = await como(db, b.userId, `select 1 from public.clientes where nombre = 'Juan Pérez'`);
    expect(directo).toHaveLength(0);
  });
});

describe("obtener_cita", () => {
  it("devuelve la cita con sus nombres, y null si no existe o no la puede ver", async () => {
    const e = await crearEscenarioAgenda(db);
    const deDani = await cita(e, { barbero: e.dani, inicio: en(0), cliente: "Ana Ruiz", telefono: "+573109998877" });
    const deCamilo = await cita(e, { inicio: en(60), cliente: "Juan Pérez" });

    const ana = await rpc<CitaLista | null>(db, e.recepcion, "obtener_cita", { p_id: deDani.id });
    expect(ana).toMatchObject({ cliente: "Ana Ruiz", telefono: "+573109998877", barbero: "Dani", servicio: "Corte", estado: "confirmada" });

    // El barbero Camilo no ve la de Dani (RLS): la función responde null, no un error.
    expect(await rpc(db, e.cuentaCamilo, "obtener_cita", { p_id: deDani.id })).toBeNull();
    expect(await rpc<CitaLista | null>(db, e.cuentaCamilo, "obtener_cita", { p_id: deCamilo.id })).toMatchObject({
      cliente: "Juan Pérez",
    });
    expect(await rpc(db, e.recepcion, "obtener_cita", { p_id: "00000000-0000-0000-0000-000000000001" })).toBeNull();

    // Otra barbería tampoco.
    const otra = await crearEscenarioAgenda(db);
    expect(await rpc(db, otra.recepcion, "obtener_cita", { p_id: deDani.id })).toBeNull();
    await expect(rpc(db, null, "obtener_cita", { p_id: deDani.id })).rejects.toMatchObject({ code: "42501" });
  });
});
