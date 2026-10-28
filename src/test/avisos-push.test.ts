/**
 * Avisos push al personal (tarea 2.7 · migración 0018, SPEC F11): quién se suscribe, quién recibe cada aviso y que
 * salga una sola vez. El envío real (web-push) se prueba aparte, con el servicio de push simulado.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { esEndpointPush } from "../lib/avisos-push";
import { como, rpc } from "./base-datos";
import { crearEscenarioAgenda, en, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  const { crearBase } = await import("./base-datos");
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

const AHORA = "2030-03-01T15:00:00Z";
let n = 0;
const sub = (nombre: string) => ({
  p_endpoint: `https://fcm.googleapis.com/fcm/send/${nombre}-${++n}-aaaaaaaaaaaaaaaaaaaa`,
  p_p256dh: "BPxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  p_auth: "authauthauthauth",
});

type Aviso = {
  ok: boolean;
  tipo?: string;
  cita?: { id: string; cliente: string; reservo_como?: string | null; servicio: string; barbero: string };
  suscripciones?: { endpoint: string; p256dh: string; auth: string }[];
};

async function reservar(e: EscenarioAgenda, o: { barbero?: string; inicio?: string; telefono?: string } = {}) {
  const r = await db.query<{ data: { ok: boolean; token: string } }>(
    `select public.fn_publico_reservar($1, $2::uuid, $3::uuid, $4::timestamptz, 'Laura Prueba', $5, true, null, $6::timestamptz) as data`,
    [e.slug, e.corte, o.barbero ?? e.camilo, o.inicio ?? en(0), o.telefono ?? "321 555 0100", AHORA]
  );
  return r.rows[0].data.token;
}

const tomar = async (token: string, tipo: string) =>
  (await rpc<Aviso>(db, null, "publico_tomar_aviso", { p_token: token, p_tipo: tipo })) as Aviso;

/** Suscribe a cada quien y devuelve endpoint -> nombre. */
async function suscribirA(e: EscenarioAgenda) {
  const quienes: [string, string][] = [
    ["dueno", e.userId],
    ["recepcion", e.recepcion],
    ["camilo", e.cuentaCamilo],
    ["dani", e.cuentaDani],
    ["cajero", e.cajero],
  ];
  const mapa = new Map<string, string>();
  for (const [nombre, actor] of quienes) {
    if (nombre === "cajero") continue; // sin agenda no puede suscribirse (se prueba aparte)
    const s = sub(nombre);
    await rpc(db, actor, "guardar_suscripcion_push", s);
    mapa.set(s.p_endpoint, nombre);
  }
  return mapa;
}

const quienes = (a: Aviso, mapa: Map<string, string>) => (a.suscripciones ?? []).map((s) => mapa.get(s.endpoint)).sort();

describe("guardar_suscripcion_push y quitar_suscripcion_push", () => {
  it("la guardan quienes ven citas (el dueño, la recepción y el barbero), no quien solo cobra", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const actor of [e.userId, e.recepcion, e.cuentaCamilo]) {
      expect(await rpc(db, actor, "guardar_suscripcion_push", sub("x"))).toEqual({ ok: true });
    }
    await expect(rpc(db, e.cajero, "guardar_suscripcion_push", sub("caja"))).rejects.toMatchObject({ code: "42501" });
  });

  it("una dirección que no es https o un dato corto se rechaza con un mensaje claro", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(
      rpc(db, e.recepcion, "guardar_suscripcion_push", { ...sub("a"), p_endpoint: "http://inseguro.test/aaaaaaaaaaaaaaaaaaaa" })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("no pudo activar los avisos") });
    await expect(rpc(db, e.recepcion, "guardar_suscripcion_push", { ...sub("a"), p_auth: "x" })).rejects.toMatchObject({
      code: "P0001",
    });
  });

  it("el mismo celular guardado dos veces es una sola suscripción, y pasa a quien lo guardó último", async () => {
    const e = await crearEscenarioAgenda(db);
    const s = sub("compartido");
    await rpc(db, e.recepcion, "guardar_suscripcion_push", s);
    await rpc(db, e.cuentaCamilo, "guardar_suscripcion_push", s);
    const filas = await db.query<{ user_id: string }>(`select user_id from public.suscripciones_push where endpoint = $1`, [s.p_endpoint]);
    expect(filas.rows).toEqual([{ user_id: e.cuentaCamilo }]);
  });

  it("cada quien quita solo la suya", async () => {
    const e = await crearEscenarioAgenda(db);
    const mia = sub("mia");
    const ajena = sub("ajena");
    await rpc(db, e.recepcion, "guardar_suscripcion_push", mia);
    await rpc(db, e.cuentaCamilo, "guardar_suscripcion_push", ajena);
    await rpc(db, e.recepcion, "quitar_suscripcion_push", { p_endpoint: ajena.p_endpoint });
    expect((await db.query(`select 1 from public.suscripciones_push where endpoint = $1`, [ajena.p_endpoint])).rows.length).toBe(1);
    await rpc(db, e.recepcion, "quitar_suscripcion_push", { p_endpoint: mia.p_endpoint });
    expect((await db.query(`select 1 from public.suscripciones_push where endpoint = $1`, [mia.p_endpoint])).rows.length).toBe(0);
  });

  it("sacar a alguien del equipo borra sus suscripciones", async () => {
    const e = await crearEscenarioAgenda(db);
    await rpc(db, e.recepcion, "guardar_suscripcion_push", sub("ruth"));
    await rpc(db, e.userId, "quitar_del_equipo", { p_user_id: e.recepcion });
    const n = await db.query(`select 1 from public.suscripciones_push where user_id = $1`, [e.recepcion]);
    expect(n.rows.length).toBe(0);
  });
});

describe("publico_tomar_aviso · reserva", () => {
  it("avisa al dueño, a la recepción y al barbero de ESA cita; no al otro barbero ni a caja", async () => {
    const e = await crearEscenarioAgenda(db);
    const mapa = await suscribirA(e);
    const token = await reservar(e, { barbero: e.camilo });
    const a = await tomar(token, "reserva");
    expect(a.ok).toBe(true);
    expect(a.cita).toMatchObject({ cliente: "Laura Prueba", servicio: "Corte", barbero: "Camilo" });
    expect(quienes(a, mapa)).toEqual(["camilo", "dueno", "recepcion"]);

    const otra = await reservar(e, { barbero: e.dani, inicio: en(60), telefono: "322 000 0000" });
    expect(quienes(await tomar(otra, "reserva"), mapa)).toEqual(["dani", "dueno", "recepcion"]);
  });

  it("sale una sola vez por cita", async () => {
    const e = await crearEscenarioAgenda(db);
    await suscribirA(e);
    const token = await reservar(e);
    expect((await tomar(token, "reserva")).ok).toBe(true);
    expect(await tomar(token, "reserva")).toEqual({ ok: false });
  });

  it("sin suscripciones responde ok con la lista vacía", async () => {
    const e = await crearEscenarioAgenda(db);
    const a = await tomar(await reservar(e), "reserva");
    expect(a).toMatchObject({ ok: true, suscripciones: [] });
  });

  it("no avisa de una cita que creó el equipo, ni de un tipo raro, ni de un token que no existe", async () => {
    const e = await crearEscenarioAgenda(db);
    await suscribirA(e);
    const manual = await rpc<{ token: string }>(db, e.recepcion, "crear_cita", {
      p_barbero: e.camilo,
      p_servicio: e.corte,
      p_inicio: en(0),
      p_cliente_nombre: "Pedro",
    });
    expect(await tomar(manual.token, "reserva")).toEqual({ ok: false });
    const token = await reservar(e, { inicio: en(60) });
    expect(await tomar(token, "otro")).toEqual({ ok: false });
    expect(await tomar("00000000-0000-4000-8000-000000000000", "reserva")).toEqual({ ok: false });
  });

  it("una reserva de hace más de 10 minutos ya no se avisa", async () => {
    const e = await crearEscenarioAgenda(db);
    const cl = await db.query<{ id: string }>(
      `insert into public.clientes (barberia_id, nombre) values ($1, 'Vieja') returning id`,
      [e.barberiaId]
    );
    const c = await db.query<{ token: string }>(
      `insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio, origen, created_at)
       values ($1, $2, $3, $4, $5, 'cliente', now() - interval '11 minutes') returning token`,
      [e.barberiaId, e.camilo, cl.rows[0].id, e.corte, en(0)]
    );
    expect(await tomar(c.rows[0].token, "reserva")).toEqual({ ok: false });
  });

  it("no mezcla barberías: solo salen las suscripciones de la del cliente", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const mapaA = await suscribirA(a);
    await suscribirA(b);
    const aviso = await tomar(await reservar(a), "reserva");
    expect((aviso.suscripciones ?? []).every((s) => mapaA.has(s.endpoint))).toBe(true);
    expect(aviso.suscripciones?.length).toBe(3);
  });
});

describe("publico_tomar_aviso · cancelación", () => {
  const cancelarCliente = (token: string) =>
    db.query(`select public.fn_publico_cancelar($1::uuid, 'No puedo ir', $2::timestamptz)`, [token, AHORA]);

  it("avisa cuando el CLIENTE cancela, una sola vez", async () => {
    const e = await crearEscenarioAgenda(db);
    const mapa = await suscribirA(e);
    const token = await reservar(e);
    await cancelarCliente(token);
    const a = await tomar(token, "cancelacion");
    expect(a.ok).toBe(true);
    expect(quienes(a, mapa)).toEqual(["camilo", "dueno", "recepcion"]);
    expect(await tomar(token, "cancelacion")).toEqual({ ok: false });
  });

  it("no avisa si la cita sigue confirmada ni si la canceló el equipo", async () => {
    const e = await crearEscenarioAgenda(db);
    await suscribirA(e);
    const token = await reservar(e);
    expect(await tomar(token, "cancelacion")).toEqual({ ok: false });

    const otra = await reservar(e, { inicio: en(60), telefono: "322 000 0000" });
    const id = (await db.query<{ id: string }>(`select id from public.citas where token = $1`, [otra])).rows[0].id;
    await rpc(db, e.recepcion, "cancelar_cita", { p_id: id, p_motivo: "Se enfermó el barbero" });
    expect(await tomar(otra, "cancelacion")).toEqual({ ok: false });
  });
});

describe("publico_olvidar_suscripcion_push y permisos", () => {
  it("olvida una suscripción muerta", async () => {
    const e = await crearEscenarioAgenda(db);
    const s = sub("muerta");
    await rpc(db, e.recepcion, "guardar_suscripcion_push", s);
    expect(await rpc(db, null, "publico_olvidar_suscripcion_push", { p_endpoint: s.p_endpoint })).toMatchObject({ ok: true, borradas: 1 });
    expect(await rpc(db, null, "publico_olvidar_suscripcion_push", { p_endpoint: s.p_endpoint })).toMatchObject({ borradas: 0 });
  });

  it("un visitante no lee la tabla de suscripciones", async () => {
    await crearEscenarioAgenda(db);
    await expect(como(db, null, `select * from public.suscripciones_push`)).rejects.toMatchObject({ code: "42501" });
    await expect(como(db, "00000000-0000-4000-8000-000000000001", `select * from public.suscripciones_push`)).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("publico_tomar_aviso · reservó con otro nombre (0030)", () => {
  it("el aviso dice el nombre que escribió quien reservó cuando no es el de la ficha del celular", async () => {
    const e = await crearEscenarioAgenda(db);
    await reservar(e, { inicio: en(60), telefono: "321 555 0100" });
    const r = await db.query<{ data: { ok: boolean; token: string } }>(
      `select public.fn_publico_reservar($1, $2::uuid, $3::uuid, $4::timestamptz, 'Otra Persona', '321 555 0100', true, null, $5::timestamptz) as data`,
      [e.slug, e.corte, e.camilo, en(120), AHORA]
    );
    const a = await tomar(r.rows[0].data.token, "reserva");
    expect(a.cita).toMatchObject({ cliente: "Laura Prueba", reservo_como: "Otra Persona" });
  });
});

describe("guardar_suscripcion_push · solo servicios push de navegadores y un tope por persona (0031)", () => {
  const VALIDAS = [
    "https://fcm.googleapis.com/fcm/send/abc123-aaaaaaaaaaaaaaaaaaaa",
    "https://updates.push.services.mozilla.com/wpush/v2/abc123aaaaaaaaaaaaaaaaaaaa",
    "https://web.push.apple.com/QAbc123aaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "https://wns2-par02p.notify.windows.com/w/?token=abc123aaaaaaaaaaaaaaaaaa",
  ];
  const AJENAS = [
    "https://sitio-ajeno.test/push/aaaaaaaaaaaaaaaaaaaaaaaa",
    "https://fcm.googleapis.com.ajeno.test/fcm/send/aaaaaaaaaaaaaa",
    "https://fcm.googleapis.com@ajeno.test/fcm/send/aaaaaaaaaaaaaaaa",
    "https://ajeno.test/fcm.googleapis.com/fcm/send/aaaaaaaaaaaaaaaa",
    "http://fcm.googleapis.com/fcm/send/aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "https://169.254.169.254/latest/meta-data/aaaaaaaaaaaaaaaaaaaaaa",
    "https://localhost/fcm/send/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ];
  const llave = { p_p256dh: "BPxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", p_auth: "authauthauthauth" };
  const guardar = (actor: string, endpoint: string) => rpc(db, actor, "guardar_suscripcion_push", { p_endpoint: endpoint, ...llave });

  it("acepta los servicios push de Chrome, Firefox, Safari y Windows", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const url of VALIDAS) await expect(guardar(e.recepcion, url), url).resolves.toMatchObject({ ok: true });
  });

  it("rechaza cualquier otra dirección: un sitio ajeno, un truco con @ o con el nombre dentro, http, una IP interna", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const url of AJENAS) await expect(guardar(e.recepcion, url), url).rejects.toThrow(/no pudo activar los avisos/);
    const n = await db.query(`select 1 from public.suscripciones_push where user_id = $1`, [e.recepcion]);
    expect(n.rows.length).toBe(0);
  });

  it("la prueba de TypeScript y la restricción de la base dicen lo mismo", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const url of [...VALIDAS, ...AJENAS]) {
      const base = await guardar(e.recepcion, url).then(
        () => true,
        () => false
      );
      expect(esEndpointPush(url), url).toBe(base);
    }
  });

  it("máximo 5 celulares por persona: el sexto se rechaza, pero se puede renovar uno que ya estaba", async () => {
    const e = await crearEscenarioAgenda(db);
    const urls = Array.from({ length: 5 }, (_, i) => `https://fcm.googleapis.com/fcm/send/tope-${++n}-${i}-aaaaaaaaaaaaaaaa`);
    for (const u of urls) await guardar(e.recepcion, u);
    await expect(guardar(e.recepcion, `https://fcm.googleapis.com/fcm/send/tope-${++n}-seis-aaaaaaaaaaaaaaaa`)).rejects.toThrow(/Ya hay 5 celulares/);
    await expect(guardar(e.recepcion, urls[0])).resolves.toMatchObject({ ok: true });
    // Apagar uno libera el cupo; y el tope es por persona, no por barbería.
    await rpc(db, e.recepcion, "quitar_suscripcion_push", { p_endpoint: urls[1] });
    await expect(guardar(e.recepcion, `https://fcm.googleapis.com/fcm/send/tope-${++n}-nueva-aaaaaaaaaaaaaaaa`)).resolves.toMatchObject({ ok: true });
    await expect(guardar(e.userId, `https://fcm.googleapis.com/fcm/send/tope-${++n}-dueno-aaaaaaaaaaaaaaaa`)).resolves.toMatchObject({ ok: true });
  });
});
