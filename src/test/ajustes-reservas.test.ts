/**
 * Interruptor de reservas en línea y límite para cancelar (tarea 2.6 · migración 0017, SPEC F5).
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rpc } from "./base-datos";
import { crearEscenarioAgenda, en } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  const { crearBase } = await import("./base-datos");
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

const base = { p_paso_min: 30, p_dias_adelante: 30, p_anticipacion_min: 60, p_colchon_min: 0 };

describe("actualizar_parametros_agenda con el interruptor y el límite", () => {
  it("nace encendido y con 2 horas; el dueño los cambia y el contexto los trae", async () => {
    const e = await crearEscenarioAgenda(db);
    const antes = await rpc<{ barberia: { agenda: Record<string, unknown> } }>(db, e.userId, "obtener_contexto");
    expect(antes.barberia.agenda).toMatchObject({ reservas_en_linea: true, cancelar_hasta_horas: 2 });

    const r = await rpc<Record<string, unknown>>(db, e.userId, "actualizar_parametros_agenda", {
      ...base,
      p_reservas_en_linea: false,
      p_cancelar_hasta_horas: 24,
    });
    expect(r).toMatchObject({ reservas_en_linea: false, cancelar_hasta_horas: 24 });

    const despues = await rpc<{ barberia: { agenda: Record<string, unknown> } }>(db, e.userId, "obtener_contexto");
    expect(despues.barberia.agenda).toMatchObject({ reservas_en_linea: false, cancelar_hasta_horas: 24 });
  });

  it("sin los parámetros nuevos (null) deja lo que había", async () => {
    const e = await crearEscenarioAgenda(db);
    await rpc(db, e.userId, "actualizar_parametros_agenda", { ...base, p_reservas_en_linea: false, p_cancelar_hasta_horas: 12 });
    const r = await rpc<Record<string, unknown>>(db, e.userId, "actualizar_parametros_agenda", { ...base, p_dias_adelante: 14 });
    expect(r).toMatchObject({ dias_adelante: 14, reservas_en_linea: false, cancelar_hasta_horas: 12 });
  });

  it.each([-1, 169])("un límite de %s horas se rechaza", async (horas) => {
    const e = await crearEscenarioAgenda(db);
    await expect(
      rpc(db, e.userId, "actualizar_parametros_agenda", { ...base, p_cancelar_hasta_horas: horas })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("0 a 168 horas") });
  });

  it("solo quien tiene el área de servicios (ni el barbero ni el cajero)", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const actor of [e.cuentaCamilo, e.cajero]) {
      await expect(rpc(db, actor, "actualizar_parametros_agenda", { ...base, p_reservas_en_linea: false })).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("apagado, el catálogo lo dice y reservar responde cerrado; encendido otra vez, vuelve a funcionar", async () => {
    const e = await crearEscenarioAgenda(db);
    await rpc(db, e.userId, "actualizar_parametros_agenda", { ...base, p_reservas_en_linea: false });
    const cat = await rpc<{ barberia: { reservas_en_linea: boolean } }>(db, null, "publico_catalogo", { p_slug: e.slug });
    expect(cat.barberia.reservas_en_linea).toBe(false);

    const reservar = (ahora: string) =>
      db.query<{ data: { ok: boolean; motivo?: string } }>(
        `select public.fn_publico_reservar($1, $2::uuid, $3::uuid, $4::timestamptz, 'Ana', '300 123 4567', true, null, $5::timestamptz) as data`,
        [e.slug, e.corte, e.camilo, en(0), ahora]
      );
    expect((await reservar("2030-03-01T15:00:00Z")).rows[0].data).toMatchObject({ ok: false, motivo: "cerrado" });

    await rpc(db, e.userId, "actualizar_parametros_agenda", { ...base, p_reservas_en_linea: true });
    expect((await reservar("2030-03-01T15:00:00Z")).rows[0].data.ok).toBe(true);
  });
});
