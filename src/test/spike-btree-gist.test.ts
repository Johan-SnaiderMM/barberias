/**
 * SPIKE 0.4 · ¿PGlite soporta la restricción de exclusión que impide dos citas traslapadas?
 *
 *   exclude using gist (barbero_id with =, tstzrange(inicio, fin, '[)') with &&) where (estado in (...))
 *
 * Necesita la extensión btree_gist (para usar "=" sobre uuid dentro de un índice gist). Esta prueba sirve de
 * decisión: si pasa, la migración de citas usa la restricción; si no, el plan B es pg_advisory_xact_lock.
 * Se conserva como prueba de regresión del mecanismo aunque luego exista la migración real.
 */
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BARBERO_A = "00000000-0000-0000-0000-00000000000a";
const BARBERO_B = "00000000-0000-0000-0000-00000000000b";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  // Como en Supabase: la extensión vive en el esquema "extensions", no en public.
  await db.exec(`
    create schema if not exists extensions;
    create extension if not exists btree_gist with schema extensions;
    create table citas (
      id         uuid primary key default gen_random_uuid(),
      barbero_id uuid not null,
      inicio     timestamptz not null,
      fin        timestamptz not null,
      estado     text not null default 'confirmada',
      check (fin > inicio),
      constraint citas_sin_traslape exclude using gist (
        barbero_id extensions.gist_uuid_ops with =,
        tstzrange(inicio, fin, '[)') with &&
      ) where (estado in ('confirmada', 'en_atencion'))
    );
  `);
});

afterAll(async () => {
  await db.close();
});

async function insertar(barbero: string, inicio: string, fin: string, estado = "confirmada") {
  return db.query(`insert into citas (barbero_id, inicio, fin, estado) values ($1, $2, $3, $4) returning id`, [
    barbero,
    inicio,
    fin,
    estado,
  ]);
}

describe("restricción de exclusión de citas (spike btree_gist)", () => {
  it("acepta una cita y rechaza otra que se traslapa con el mismo barbero", async () => {
    await insertar(BARBERO_A, "2026-11-02T14:00:00Z", "2026-11-02T14:30:00Z");
    await expect(insertar(BARBERO_A, "2026-11-02T14:15:00Z", "2026-11-02T14:45:00Z")).rejects.toMatchObject({
      code: "23P01", // exclusion_violation
    });
  });

  it("rechaza una cita contenida dentro de otra", async () => {
    await insertar(BARBERO_A, "2026-11-03T14:00:00Z", "2026-11-03T15:00:00Z");
    await expect(insertar(BARBERO_A, "2026-11-03T14:10:00Z", "2026-11-03T14:20:00Z")).rejects.toMatchObject({
      code: "23P01",
    });
  });

  it("permite citas pegadas (el fin de una es el inicio de la siguiente)", async () => {
    await insertar(BARBERO_A, "2026-11-04T14:00:00Z", "2026-11-04T14:30:00Z");
    await expect(insertar(BARBERO_A, "2026-11-04T14:30:00Z", "2026-11-04T15:00:00Z")).resolves.toBeTruthy();
  });

  it("permite la misma hora con otro barbero", async () => {
    await insertar(BARBERO_A, "2026-11-05T14:00:00Z", "2026-11-05T14:30:00Z");
    await expect(insertar(BARBERO_B, "2026-11-05T14:00:00Z", "2026-11-05T14:30:00Z")).resolves.toBeTruthy();
  });

  it("una cita cancelada no ocupa la hora", async () => {
    await insertar(BARBERO_A, "2026-11-06T14:00:00Z", "2026-11-06T14:30:00Z", "cancelada");
    await expect(insertar(BARBERO_A, "2026-11-06T14:00:00Z", "2026-11-06T14:30:00Z")).resolves.toBeTruthy();
  });

  it("al reactivar una cancelada sobre una hora ya tomada, la base lo impide", async () => {
    const cancelada = await insertar(BARBERO_A, "2026-11-07T14:00:00Z", "2026-11-07T14:30:00Z", "cancelada");
    await insertar(BARBERO_A, "2026-11-07T14:00:00Z", "2026-11-07T14:30:00Z");
    const id = (cancelada.rows[0] as { id: string }).id;
    await expect(db.query(`update citas set estado = 'confirmada' where id = $1`, [id])).rejects.toMatchObject({
      code: "23P01",
    });
  });

  it("mover una cita a una hora ocupada falla y la deja donde estaba", async () => {
    await insertar(BARBERO_A, "2026-11-09T14:00:00Z", "2026-11-09T14:30:00Z");
    const otra = await insertar(BARBERO_A, "2026-11-09T16:00:00Z", "2026-11-09T16:30:00Z");
    const id = (otra.rows[0] as { id: string }).id;
    await expect(
      db.query(`update citas set inicio = '2026-11-09T14:10:00Z', fin = '2026-11-09T14:40:00Z' where id = $1`, [id])
    ).rejects.toMatchObject({ code: "23P01" });
    const { rows } = await db.query<{ inicio: Date }>(`select inicio from citas where id = $1`, [id]);
    expect(new Date(rows[0].inicio).toISOString()).toBe("2026-11-09T16:00:00.000Z");
  });

  it("dos reservas lanzadas a la vez a la misma hora: una gana y la otra recibe exclusion_violation", async () => {
    // PGlite atiende una consulta a la vez (un solo hilo), así que esto prueba el RESULTADO que la base
    // garantiza; la garantía bajo concurrencia real la da Postgres a las restricciones de exclusión.
    const resultados = await Promise.allSettled([
      db.transaction((tx) =>
        tx.query(`insert into citas (barbero_id, inicio, fin) values ($1, $2, $3)`, [
          BARBERO_A,
          "2026-11-10T14:00:00Z",
          "2026-11-10T14:30:00Z",
        ])
      ),
      db.transaction((tx) =>
        tx.query(`insert into citas (barbero_id, inicio, fin) values ($1, $2, $3)`, [
          BARBERO_A,
          "2026-11-10T14:00:00Z",
          "2026-11-10T14:30:00Z",
        ])
      ),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rechazada = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rechazada.reason).toMatchObject({ code: "23P01" });
  });
});
