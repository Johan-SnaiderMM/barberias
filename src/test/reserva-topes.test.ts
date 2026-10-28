/**
 * Anti-abuso de la reserva pública (tarea 2.2 · migración 0016): tope por celular, tope por minuto y campo trampa.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearEscenarioAgenda, en, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  const { crearBase } = await import("./base-datos");
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

/** Viernes 2030-03-01 10:00 en Bogotá. */
const AHORA = "2030-03-01T15:00:00Z";

type R = { ok: boolean; motivo?: string; token?: string };

async function reservar(
  e: EscenarioAgenda,
  o: { inicio: string; telefono?: string; nombre?: string; web?: string | null; ahora?: string; barbero?: string }
): Promise<R> {
  const r = await db.query<{ data: R }>(
    `select public.fn_publico_reservar($1, $2::uuid, $3::uuid, $4::timestamptz, $5, $6, true, $7, $8::timestamptz) as data`,
    [e.slug, e.corte, o.barbero ?? e.camilo, o.inicio, o.nombre ?? "Juan Pérez", o.telefono ?? "300 123 4567", o.web ?? null, o.ahora ?? AHORA]
  );
  return r.rows[0].data;
}

describe("tope por celular", () => {
  it("la cuarta cita por venir del mismo celular se rechaza; otro celular sí puede", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const min of [0, 60, 120]) expect((await reservar(e, { inicio: en(min) })).ok).toBe(true);
    expect(await reservar(e, { inicio: en(180) })).toMatchObject({ ok: false, motivo: "tope_celular" });
    expect((await reservar(e, { inicio: en(180), telefono: "311 222 3344", nombre: "Ana" })).ok).toBe(true);
  });

  it("el mismo celular escrito de otra forma es el mismo celular", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const [i, tel] of ["300 123 4567", "+57 300 123 4567", "3001234567"].entries()) {
      expect((await reservar(e, { inicio: en(i * 60), telefono: tel })).ok).toBe(true);
    }
    expect(await reservar(e, { inicio: en(180), telefono: "(300) 123-4567" })).toMatchObject({ motivo: "tope_celular" });
  });

  it("cancelar una libera el cupo", async () => {
    const e = await crearEscenarioAgenda(db);
    const tokens: string[] = [];
    for (const min of [0, 60, 120]) tokens.push((await reservar(e, { inicio: en(min) })).token!);
    await db.query(`select public.fn_publico_cancelar($1::uuid, null, $2::timestamptz)`, [tokens[0], AHORA]);
    expect((await reservar(e, { inicio: en(180) })).ok).toBe(true);
  });

  it("las citas que ya pasaron no cuentan", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const min of [0, 60, 120]) await reservar(e, { inicio: en(min) });
    // Un "ahora" posterior a las tres: ya no hay citas por venir.
    expect((await reservar(e, { inicio: en(24 * 60 + 60), ahora: en(24 * 60) })).ok).toBe(true);
  });

  it("el tope es por barbería: el mismo celular puede reservar en otra", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    for (const min of [0, 60, 120]) await reservar(a, { inicio: en(min) });
    expect((await reservar(b, { inicio: en(0) })).ok).toBe(true);
  });
});

/** Diez citas ya creadas, de ese origen y hace `antes` (intervalo SQL), para armar el tope del minuto. */
async function sembrarDiez(e: EscenarioAgenda, origen: "cliente" | "personal", antes: string) {
  const cl = await db.query<{ id: string }>(
    `insert into public.clientes (barberia_id, nombre) values ($1, 'Sembrado') returning id`,
    [e.barberiaId]
  );
  for (let i = 0; i < 10; i++) {
    await db.query(
      `insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio, origen, created_at)
       values ($1, $2, $3, $4, $5, $6, now() - $7::interval)`,
      [e.barberiaId, e.camilo, cl.rows[0].id, e.corte, en(i * 30), origen, antes]
    );
  }
}

describe("tope por minuto", () => {
  it("con diez reservas en línea del último minuto, la siguiente se rechaza", async () => {
    const e = await crearEscenarioAgenda(db);
    await sembrarDiez(e, "cliente", "10 seconds");
    expect(await reservar(e, { inicio: en(420) })).toMatchObject({ ok: false, motivo: "tope_minuto" });
  });

  it("pasado el minuto vuelve a funcionar", async () => {
    const e = await crearEscenarioAgenda(db);
    await sembrarDiez(e, "cliente", "2 minutes");
    expect((await reservar(e, { inicio: en(420) })).ok).toBe(true);
  });

  it("las citas que crea el personal a mano no cuentan para el tope", async () => {
    const e = await crearEscenarioAgenda(db);
    await sembrarDiez(e, "personal", "10 seconds");
    expect((await reservar(e, { inicio: en(420) })).ok).toBe(true);
  });

  it("nueve reservas seguidas pasan: el tope es de diez", async () => {
    const e = await crearEscenarioAgenda(db);
    for (let i = 0; i < 9; i++) {
      const r = await reservar(e, { inicio: en(i * 30), telefono: `301 000 00${String(i).padStart(2, "0")}`, nombre: `Persona ${i}` });
      expect(r.ok, `reserva ${i}`).toBe(true);
    }
  });
});

describe("campo trampa", () => {
  it("lleno, rechaza aunque todo lo demás esté bien, y no deja ni cliente", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await reservar(e, { inicio: en(0), web: "https://spam.example", nombre: "Robot" });
    expect(r).toMatchObject({ ok: false, motivo: "rechazada" });
    const n = await db.query(`select 1 from public.clientes where barberia_id = $1`, [e.barberiaId]);
    expect(n.rows.length).toBe(0);
  });

  it("vacío o con solo espacios, pasa", async () => {
    const e = await crearEscenarioAgenda(db);
    expect((await reservar(e, { inicio: en(0), web: "   " })).ok).toBe(true);
  });
});
