/**
 * Reserva pública: la API sin cuenta (tarea 2.1 · migración 0015, SPEC F5).
 * Las funciones `fn_publico_*` reciben un "ahora" fijo; los `publico_*` son envoltorios con now(). La lista exacta
 * de lo que `anon` puede ejecutar queda fijada aquí.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

/** Viernes 2030-03-01 10:00 en Bogotá: tres días antes de `en(0)` (lunes 4, 10:00). */
const AHORA = "2030-03-01T15:00:00Z";
const DIA = "2030-03-04";

type Reserva = {
  ok: boolean;
  motivo?: string;
  mensaje?: string;
  token?: string;
  inicio?: string;
  fin?: string;
  precio?: number;
  servicio?: string;
  barbero?: string;
  barberia?: string;
};
type Hueco = { barbero_id: string; inicio: string; fin: string };

async function reservar(
  e: EscenarioAgenda,
  o: {
    servicio?: string;
    barbero?: string | null;
    inicio?: string;
    nombre?: string;
    telefono?: string;
    consentimiento?: boolean;
    web?: string | null;
    ahora?: string;
    slug?: string;
  } = {}
): Promise<Reserva> {
  const r = await db.query<{ data: Reserva }>(
    `select public.fn_publico_reservar($1, $2::uuid, $3::uuid, $4::timestamptz, $5, $6, $7::boolean, $8, $9::timestamptz) as data`,
    [
      o.slug ?? e.slug,
      o.servicio ?? e.corte,
      o.barbero === undefined ? e.camilo : o.barbero,
      o.inicio ?? en(0),
      o.nombre ?? "Juan Pérez",
      o.telefono ?? "300 123 4567",
      o.consentimiento ?? true,
      o.web ?? null,
      o.ahora ?? AHORA,
    ]
  );
  return r.rows[0].data;
}

async function huecos(e: EscenarioAgenda, o: { servicio?: string; barbero?: string | null; ahora?: string } = {}) {
  const r = await db.query<{ data: Hueco[] }>(
    `select public.fn_publico_huecos($1, $2::uuid, $3::uuid, $4::date, $5::date, $6::timestamptz) as data`,
    [e.slug, o.servicio ?? e.corte, o.barbero === undefined ? e.camilo : o.barbero, DIA, DIA, o.ahora ?? AHORA]
  );
  return r.rows[0].data;
}

const horas = (hs: Hueco[]) => hs.map((h) => new Date(h.inicio).getTime());
const ms = (iso: string) => new Date(iso).getTime();

const cita = async (token: string) =>
  (
    await db.query<{
      estado: string;
      origen: string;
      inicio: Date;
      precio: number;
      consentimiento_at: Date | null;
      cancelada_motivo: string | null;
      cancelada_por: string | null;
      recordatorio_enviado_at: Date | null;
      cliente: string;
      telefono: string | null;
    }>(
      `select c.estado, c.origen, c.inicio, c.precio, c.consentimiento_at, c.cancelada_motivo, c.cancelada_por,
              c.recordatorio_enviado_at, cl.nombre as cliente, cl.telefono
         from public.citas c join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
        where c.token = $1`,
      [token]
    )
  ).rows[0];

const consultar = async (token: string, ahora = AHORA) =>
  (
    await db.query<{ data: Record<string, unknown> }>(`select public.fn_publico_consultar($1::uuid, $2::timestamptz) as data`, [
      token,
      ahora,
    ])
  ).rows[0].data as { existe: boolean; cita?: { puede_cambiar: boolean; cliente: string }; barberia?: Record<string, unknown> };

const cancelar = async (token: string, motivo: string | null = null, ahora = AHORA) =>
  (
    await db.query<{ data: Reserva }>(`select public.fn_publico_cancelar($1::uuid, $2, $3::timestamptz) as data`, [
      token,
      motivo,
      ahora,
    ])
  ).rows[0].data;

const reprogramar = async (token: string, inicio: string, ahora = AHORA) =>
  (
    await db.query<{ data: Reserva }>(`select public.fn_publico_reprogramar($1::uuid, $2::timestamptz, $3::timestamptz) as data`, [
      token,
      inicio,
      ahora,
    ])
  ).rows[0].data;

describe("publico_catalogo", () => {
  it("lista los servicios y barberos con el precio y la duración de cada uno, y nada del equipo ni de los clientes", async () => {
    const e = await crearEscenarioAgenda(db);
    const c = await rpc<{
      existe: boolean;
      barberia: { nombre: string; slug: string; reservas_en_linea: boolean; dias_adelante: number };
      servicios: { id: string; nombre: string; precio: number; duracion_min: number }[];
      barberos: { id: string; nombre: string; servicios: { servicio_id: string; precio: number; duracion_min: number }[] }[];
    }>(db, null, "publico_catalogo", { p_slug: e.slug });

    expect(c.existe).toBe(true);
    expect(c.barberia).toMatchObject({ slug: e.slug, reservas_en_linea: true, dias_adelante: 30 });
    expect(c.servicios.map((s) => s.nombre)).toEqual(["Corte", "Corte + barba"]);
    const camilo = c.barberos.find((b) => b.nombre === "Camilo")!;
    const dani = c.barberos.find((b) => b.nombre === "Dani")!;
    expect(camilo.servicios.find((s) => s.servicio_id === e.corte)).toMatchObject({ precio: 18000, duracion_min: 30 });
    expect(camilo.servicios.find((s) => s.servicio_id === e.combo)).toMatchObject({ precio: 22000, duracion_min: 45 });
    expect(dani.servicios).toEqual([{ servicio_id: e.corte, precio: 15000, duracion_min: 45 }]);

    const texto = JSON.stringify(c);
    for (const privado of ["telefono", "user_id", "barberia_id", "correo", "perfil"]) {
      expect(texto).not.toContain(privado);
    }
  });

  it("un servicio archivado y un barbero que no acepta reservas no salen", async () => {
    const e = await crearEscenarioAgenda(db);
    await db.query(`update public.servicios set activo = false where id = $1`, [e.combo]);
    await db.query(`update public.barberos set acepta_reservas = false where id = $1`, [e.dani]);
    const c = await rpc<{ servicios: { nombre: string }[]; barberos: { nombre: string }[] }>(db, null, "publico_catalogo", {
      p_slug: e.slug,
    });
    expect(c.servicios.map((s) => s.nombre)).toEqual(["Corte"]);
    expect(c.barberos.map((b) => b.nombre)).toEqual(["Camilo"]);
  });

  it("un slug que no existe responde que no existe (sin error)", async () => {
    expect(await rpc(db, null, "publico_catalogo", { p_slug: "no-existe-esta-barberia" })).toEqual({ existe: false });
  });

  it("con las reservas apagadas igual muestra el catálogo y lo dice", async () => {
    const e = await crearEscenarioAgenda(db);
    await db.query(`update public.barberias set reservas_en_linea = false where id = $1`, [e.barberiaId]);
    const c = await rpc<{ barberia: { reservas_en_linea: boolean }; servicios: unknown[] }>(db, null, "publico_catalogo", {
      p_slug: e.slug,
    });
    expect(c.barberia.reservas_en_linea).toBe(false);
    expect(c.servicios.length).toBe(2);
  });
});

describe("publico_huecos", () => {
  it("ofrece la hora libre y deja de ofrecer la que ya tomaron", async () => {
    const e = await crearEscenarioAgenda(db);
    expect(horas(await huecos(e))).toContain(ms(en(0)));
    expect((await reservar(e)).ok).toBe(true);
    const despues = horas(await huecos(e));
    expect(despues).not.toContain(ms(en(0)));
    expect(despues).toContain(ms(en(30)));
  });

  it("respeta la anticipación mínima y los días hacia adelante", async () => {
    const e = await crearEscenarioAgenda(db);
    // 30 min antes: la anticipación es de 60 -> la de las 10:00 no, la de las 11:00 sí.
    const casi = horas(await huecos(e, { ahora: en(-30) }));
    expect(casi).not.toContain(ms(en(0)));
    expect(casi).toContain(ms(en(60)));
    // 31 días antes: más allá de los 30 días hacia adelante.
    expect(await huecos(e, { ahora: en(-31 * 24 * 60) })).toEqual([]);
  });

  it("'la primera disponible' ofrece una sola hora por instante", async () => {
    const e = await crearEscenarioAgenda(db);
    const todos = await huecos(e, { barbero: null });
    const instantes = horas(todos);
    expect(new Set(instantes).size).toBe(instantes.length);
  });

  it("apagadas las reservas, no hay horas", async () => {
    const e = await crearEscenarioAgenda(db);
    await db.query(`update public.barberias set reservas_en_linea = false where id = $1`, [e.barberiaId]);
    expect(await huecos(e)).toEqual([]);
  });

  it("un slug que no existe da lista vacía", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await db.query<{ data: Hueco[] }>(
      `select public.fn_publico_huecos('nada-por-aqui', $1::uuid, null, $2::date, $2::date, $3::timestamptz) as data`,
      [e.corte, DIA, AHORA]
    );
    expect(r.rows[0].data).toEqual([]);
  });
});

describe("publico_reservar", () => {
  it("agenda la cita confirmada, de origen cliente, con precio copiado, celular normalizado y consentimiento", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e);
    expect(r).toMatchObject({ ok: true, servicio: "Corte", barbero: "Camilo", precio: 18000 });
    expect(r.token).toMatch(/^[0-9a-f-]{36}$/);

    const c = await cita(r.token!);
    expect(c).toMatchObject({
      estado: "confirmada",
      origen: "cliente",
      precio: 18000,
      cliente: "Juan Pérez",
      telefono: "+573001234567",
    });
    expect(c.consentimiento_at).not.toBeNull();
    expect(c.inicio.getTime()).toBe(ms(en(0)));
  });

  it("el mismo celular es el mismo cliente (no se duplica)", async () => {
    const e = await crearEscenarioAgenda(db);
    await reservar(e, { inicio: en(0) });
    await reservar(e, { inicio: en(60), nombre: "Juan P.", telefono: "+57 300 123 4567" });
    const n = await db.query(`select 1 from public.clientes where barberia_id = $1 and telefono = '+573001234567'`, [
      e.barberiaId,
    ]);
    expect(n.rows.length).toBe(1);
  });

  it("'la primera disponible' reparte: el siguiente va con quien queda libre y al final no hay", async () => {
    const e = await crearEscenarioAgenda(db);
    const a = await reservar(e, { barbero: null, nombre: "Ana", telefono: "301 000 0001" });
    const b = await reservar(e, { barbero: null, nombre: "Beto", telefono: "301 000 0002" });
    expect([a.barbero, b.barbero].sort()).toEqual(["Camilo", "Dani"]);
    const c = await reservar(e, { barbero: null, nombre: "Carla", telefono: "301 000 0003" });
    expect(c).toMatchObject({ ok: false, motivo: "hora_ocupada" });
  });

  it("una hora tomada responde hora_ocupada, sin decir quién la tiene", async () => {
    const e = await crearEscenarioAgenda(db);
    expect((await reservar(e, { nombre: "Juan Pérez", telefono: "300 123 4567" })).ok).toBe(true);
    const otro = await reservar(e, { nombre: "Ana Gómez", telefono: "311 222 3344" });
    expect(otro).toMatchObject({ ok: false, motivo: "hora_ocupada" });
    const texto = JSON.stringify(otro);
    for (const secreto of ["Juan", "Pérez", "3001234567", "10:00"]) expect(texto).not.toContain(secreto);
    // y la cita de Ana no existió: ni cliente nuevo
    const ana = await db.query(`select 1 from public.clientes where barberia_id = $1 and nombre = 'Ana Gómez'`, [e.barberiaId]);
    expect(ana.rows.length).toBe(0);
  });

  it.each([
    ["fuera del horario del barbero", () => "2030-03-04T03:00:00Z"],
    ["una hora que no cae en la rejilla", () => en(7)],
    ["antes de la anticipación mínima", () => en(-3 * 24 * 60 + 30)],
    ["una hora que ya pasó", () => en(-4 * 24 * 60)],
    ["más allá de los días hacia adelante", () => en(40 * 24 * 60)],
  ])("%s -> hora_ocupada", async (_nombre, inicio) => {
    const e = await crearEscenarioAgenda(db);
    expect(await reservar(e, { inicio: inicio() })).toMatchObject({ ok: false, motivo: "hora_ocupada" });
  });

  it("un barbero que no hace ese servicio -> hora_ocupada", async () => {
    const e = await crearEscenarioAgenda(db);
    expect(await reservar(e, { barbero: e.dani, servicio: e.combo })).toMatchObject({ ok: false, motivo: "hora_ocupada" });
  });

  it("sobre un bloqueo -> hora_ocupada", async () => {
    const e = await crearEscenarioAgenda(db);
    await rpc(db, e.userId, "crear_bloqueo", { p_barbero: e.camilo, p_inicio: en(-60), p_fin: en(60), p_motivo: "Almuerzo" });
    expect(await reservar(e)).toMatchObject({ ok: false, motivo: "hora_ocupada" });
  });

  it.each([
    ["sin consentimiento", { consentimiento: false }, "consentimiento"],
    ["con el campo trampa lleno", { web: "http://spam.example" }, "rechazada"],
    ["sin nombre", { nombre: "   " }, "datos"],
    ["con un nombre larguísimo", { nombre: "x".repeat(61) }, "datos"],
    ["con un celular que no es", { telefono: "12345" }, "celular_invalido"],
    ["sin celular", { telefono: "" }, "celular_invalido"],
  ])("%s -> rechazada con un mensaje en español", async (_n, o, motivo) => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e, o);
    expect(r).toMatchObject({ ok: false, motivo });
    expect(r.mensaje).toEqual(expect.any(String));
    const n = await db.query(`select 1 from public.citas where barberia_id = $1`, [e.barberiaId]);
    expect(n.rows.length).toBe(0);
  });

  it("con las reservas apagadas -> cerrado; slug desconocido -> no_existe", async () => {
    const e = await crearEscenarioAgenda(db);
    expect(await reservar(e, { slug: "nada-por-aqui" })).toMatchObject({ ok: false, motivo: "no_existe" });
    await db.query(`update public.barberias set reservas_en_linea = false where id = $1`, [e.barberiaId]);
    expect(await reservar(e)).toMatchObject({ ok: false, motivo: "cerrado" });
  });

  it("la cita reservada por el cliente aparece en la agenda del personal", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e);
    const lista = await rpc<{ cliente: string; origen: string }[]>(db, e.recepcion, "listar_citas", {
      p_desde: DIA,
      p_hasta: DIA,
    });
    expect(lista.find((c) => c.cliente === "Juan Pérez")).toMatchObject({ origen: "cliente" });
    expect(r.ok).toBe(true);
  });
});

describe("publico_consultar_cita", () => {
  it("devuelve la cita y los datos de contacto de la barbería; un token ajeno, que no existe", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e);
    const c = await consultar(r.token!);
    expect(c.existe).toBe(true);
    expect(c.cita).toMatchObject({ puede_cambiar: true });
    // El nombre no sale (ver el caso del celular ajeno, más abajo): el cliente ya sabe cómo se llama.
    expect(c.cita).not.toHaveProperty("cliente");
    expect(c.barberia).toMatchObject({ nombre: expect.any(String), slug: e.slug });
    expect(await consultar("00000000-0000-4000-8000-000000000000")).toEqual({ existe: false });
  });

  it("no filtra el celular, el id interno ni otras citas", async () => {
    const e = await crearEscenarioAgenda(db);
    await reservar(e, { inicio: en(60), nombre: "Otra Persona", telefono: "311 999 8877" });
    const r = await reservar(e);
    const texto = JSON.stringify(await consultar(r.token!));
    for (const privado of ["3001234567", "Otra Persona", "3119998877", "barberia_id", "cliente_id", "registrado_por"]) {
      expect(texto).not.toContain(privado);
    }
  });

  it("con el celular de otra persona no se averigua el nombre que esa persona tiene guardado (0029)", async () => {
    const e = await crearEscenarioAgenda(db);
    await reservar(e, { inicio: en(60), nombre: "Ana Gómez", telefono: "311 999 8877" });
    // Misma barbería, mismo celular, otro nombre: queda ligado a la ficha de Ana (el celular identifica al cliente).
    const intruso = await reservar(e, { inicio: en(120), nombre: "Intruso", telefono: "311 999 8877" });
    expect(intruso.ok).toBe(true);
    const texto = JSON.stringify(await consultar(intruso.token!));
    expect(texto).not.toContain("Ana");
    expect(texto).not.toContain("Gómez");
  });

  it("pasado el límite ya no se puede cambiar", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e);
    expect((await consultar(r.token!, en(-121))).cita!.puede_cambiar).toBe(true);
    expect((await consultar(r.token!, en(-119))).cita!.puede_cambiar).toBe(false);
  });
});

describe("publico_cancelar_cita", () => {
  it("cancela con el motivo por defecto, libera la hora y no se puede cancelar dos veces", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e);
    expect(await cancelar(r.token!)).toEqual({ ok: true });
    expect(await cita(r.token!)).toMatchObject({
      estado: "cancelada",
      cancelada_motivo: "Canceló el cliente",
      cancelada_por: null,
    });
    expect(horas(await huecos(e))).toContain(ms(en(0)));
    expect(await cancelar(r.token!)).toMatchObject({ ok: false, motivo: "no_se_puede" });
  });

  it("guarda el motivo que escribe el cliente", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e);
    await cancelar(r.token!, "  Me salió un viaje  ");
    expect((await cita(r.token!)).cancelada_motivo).toBe("Me salió un viaje");
  });

  it("hasta el límite sí; después no, y la cita queda como estaba", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e);
    expect(await cancelar(r.token!, null, en(-119))).toMatchObject({ ok: false, motivo: "fuera_de_plazo" });
    expect((await cita(r.token!)).estado).toBe("confirmada");
    expect(await cancelar(r.token!, null, en(-120))).toEqual({ ok: true });
  });

  it("respeta el límite configurado por la barbería", async () => {
    const e = await crearEscenarioAgenda(db);
    await db.query(`update public.barberias set cancelar_hasta_horas = 24 where id = $1`, [e.barberiaId]);
    const r = await reservar(e);
    expect(await cancelar(r.token!, null, en(-23 * 60))).toMatchObject({ ok: false, motivo: "fuera_de_plazo" });
    expect(await cancelar(r.token!, null, en(-25 * 60))).toEqual({ ok: true });
  });

  it("un token que no existe no cancela nada", async () => {
    expect(await cancelar("00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false, motivo: "no_existe" });
  });

  it("una cita que el personal ya pasó a otro estado no se cancela por aquí", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e);
    await db.query(`update public.citas set estado = 'en_atencion' where token = $1`, [r.token]);
    expect(await cancelar(r.token!)).toMatchObject({ ok: false, motivo: "no_se_puede" });
  });
});

describe("publico_reprogramar_cita", () => {
  async function huecosDeLaCita(token: string) {
    const r = await db.query<{ data: Hueco[] }>(
      `select public.fn_publico_huecos_cita($1::uuid, $2::date, $2::date, $3::timestamptz) as data`,
      [token, DIA, AHORA]
    );
    return r.rows[0].data;
  }

  it("ofrece las horas del mismo barbero, contando como libre la que ya tiene la propia cita", async () => {
    const e = await crearEscenarioAgenda(db);
    const mia = await reservar(e);
    await reservar(e, { inicio: en(120), nombre: "Ana", telefono: "301 000 0001" });
    const libres = horas(await huecosDeLaCita(mia.token!));
    expect(libres).toContain(ms(en(0)));
    expect(libres).not.toContain(ms(en(120)));
    expect(libres).toContain(ms(en(60)));
  });

  it("mueve la cita a otra hora libre y borra el recordatorio", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e);
    await db.query(`update public.citas set recordatorio_enviado_at = now() where token = $1`, [r.token]);
    const m = await reprogramar(r.token!, en(180));
    expect(m).toMatchObject({ ok: true });
    const c = await cita(r.token!);
    expect(c.inicio.getTime()).toBe(ms(en(180)));
    expect(c.recordatorio_enviado_at).toBeNull();
    expect(c.estado).toBe("confirmada");
    expect(horas(await huecos(e))).toContain(ms(en(0)));
  });

  it("a una hora ocupada responde hora_ocupada y la cita se queda donde estaba", async () => {
    const e = await crearEscenarioAgenda(db);
    const mia = await reservar(e);
    await reservar(e, { inicio: en(120), nombre: "Ana", telefono: "301 000 0001" });
    const r = await reprogramar(mia.token!, en(120));
    expect(r).toMatchObject({ ok: false, motivo: "hora_ocupada" });
    expect(JSON.stringify(r)).not.toContain("Ana");
    expect((await cita(mia.token!)).inicio.getTime()).toBe(ms(en(0)));
  });

  it("a una hora que no es de ese barbero o que no cae en la rejilla -> hora_ocupada", async () => {
    const e = await crearEscenarioAgenda(db);
    const mia = await reservar(e);
    expect(await reprogramar(mia.token!, en(7))).toMatchObject({ ok: false, motivo: "hora_ocupada" });
    expect(await reprogramar(mia.token!, en(-5 * 24 * 60))).toMatchObject({ ok: false, motivo: "hora_ocupada" });
  });

  it("fuera de plazo, cancelada o con token ajeno no se mueve", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e);
    expect(await reprogramar(r.token!, en(180), en(-119))).toMatchObject({ ok: false, motivo: "fuera_de_plazo" });
    expect(await huecosDeLaCita("00000000-0000-4000-8000-000000000000")).toEqual([]);
    expect(await reprogramar("00000000-0000-4000-8000-000000000000", en(180))).toMatchObject({
      ok: false,
      motivo: "no_existe",
    });
    await cancelar(r.token!);
    expect(await reprogramar(r.token!, en(180))).toMatchObject({ ok: false, motivo: "no_se_puede" });
  });
});

describe("lo que ve un visitante sin cuenta (anon)", () => {
  it("la lista EXACTA de funciones que puede ejecutar", async () => {
    const { rows } = await db.query<{ nombre: string }>(`
      select p.proname as nombre
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
       order by 1`);
    expect(rows.map((r) => r.nombre)).toEqual([
      "publico_cancelar_cita",
      "publico_catalogo",
      "publico_consultar_cita",
      "publico_huecos",
      "publico_huecos_cita",
      "publico_olvidar_suscripcion_push",
      "publico_reprogramar_cita",
      "publico_reservar",
      "publico_tomar_aviso",
    ]);
  });

  it("no lee ninguna tabla", async () => {
    await crearEscenarioAgenda(db);
    for (const tabla of ["citas", "clientes", "barberias", "barberos", "servicios", "perfiles", "invitaciones"]) {
      await expect(como(db, null, `select * from public.${tabla}`)).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("no puede ejecutar la API del personal ni las funciones internas", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(rpc(db, null, "crear_cita", { p_barbero: e.camilo, p_servicio: e.corte, p_inicio: en(0), p_cliente_nombre: "X" }))
      .rejects.toMatchObject({ code: "42501" });
    await expect(como(db, null, `select public.fn_publico_reservar('x', null, null, null, 'a', 'b', true, null, now())`))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("las envolturas con now() funcionan sin sesión (catálogo, campo trampa, consentimiento y token ajeno)", async () => {
    const e = await crearEscenarioAgenda(db);
    const base = { p_slug: e.slug, p_servicio: e.corte, p_barbero: e.camilo, p_inicio: en(0), p_nombre: "Juan", p_telefono: "3001234567" };
    expect(await rpc(db, null, "publico_reservar", { ...base, p_consentimiento: true, p_web: "spam" })).toMatchObject({
      ok: false,
      motivo: "rechazada",
    });
    expect(await rpc(db, null, "publico_reservar", { ...base, p_consentimiento: false })).toMatchObject({
      ok: false,
      motivo: "consentimiento",
    });
    expect(await rpc(db, null, "publico_consultar_cita", { p_token: "00000000-0000-4000-8000-000000000000" })).toEqual({
      existe: false,
    });
    expect(await rpc(db, null, "publico_huecos", { p_slug: e.slug, p_servicio: e.corte })).toEqual(expect.any(Array));
  });
});

describe("el nombre escrito en la reserva (0030)", () => {
  type CitaAgenda = { id: string; cliente: string; reservo_como: string | null };
  const agenda = (e: EscenarioAgenda, actor: string) =>
    rpc<CitaAgenda[]>(db, actor, "listar_citas", { p_desde: DIA, p_hasta: DIA });

  it("con el celular de otra persona, la agenda dice cómo se anotó quien reservó (y la ficha sigue siendo la de su dueño)", async () => {
    const e = await crearEscenarioAgenda(db);
    await reservar(e, { inicio: en(60), nombre: "Ana Gómez", telefono: "311 999 8877" });
    const intruso = await reservar(e, { inicio: en(120), nombre: "Intruso", telefono: "311 999 8877" });
    expect(intruso.ok).toBe(true);

    for (const actor of [e.recepcion, e.userId, e.cuentaCamilo]) {
      const citas = await agenda(e, actor);
      expect(citas.map((c) => c.cliente)).toEqual(["Ana Gómez", "Ana Gómez"]);
      expect(citas.map((c) => c.reservo_como)).toEqual([null, "Intruso"]);
    }

    const detalle = await rpc<CitaAgenda>(db, e.recepcion, "obtener_cita", { p_id: (await agenda(e, e.recepcion))[1].id });
    expect(detalle).toMatchObject({ cliente: "Ana Gómez", reservo_como: "Intruso" });
  });

  it("si escribió el mismo nombre (aunque cambien las mayúsculas o los espacios), no se muestra nada", async () => {
    const e = await crearEscenarioAgenda(db);
    await reservar(e, { inicio: en(60), nombre: "Juan Pérez", telefono: "300 123 4567" });
    await reservar(e, { inicio: en(120), nombre: "  juan pérez ", telefono: "300 123 4567" });
    expect((await agenda(e, e.recepcion)).map((c) => c.reservo_como)).toEqual([null, null]);
  });

  it("una reserva de una persona nueva no lleva aviso (el nombre de la ficha es el que escribió)", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e, { nombre: "Laura Prueba", telefono: "321 555 0100" });
    expect((await agenda(e, e.recepcion)).map((c) => c.reservo_como)).toEqual([null]);
    const guardado = await db.query<{ nombre_reserva: string }>(`select nombre_reserva from public.citas where token = $1`, [r.token]);
    expect(guardado.rows[0].nombre_reserva).toBe("Laura Prueba");
  });

  it("lo que anota el equipo no guarda nombre de reserva", async () => {
    const e = await crearEscenarioAgenda(db);
    await rpc(db, e.recepcion, "crear_cita", {
      p_barbero: e.camilo,
      p_servicio: e.corte,
      p_inicio: en(0),
      p_cliente_nombre: "Pedro",
      p_cliente_telefono: "302 000 0000",
      p_confirmar: true,
    });
    const filas = await db.query<{ nombre_reserva: string | null }>(`select nombre_reserva from public.citas where barberia_id = $1`, [e.barberiaId]);
    expect(filas.rows.every((f) => f.nombre_reserva === null)).toBe(true);
  });
});
