/** Horarios semanales, bloqueos y ajustes de la agenda (tarea 1.3 · migración 0007). */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BarberiaDePrueba, como, crearBarberia, crearBase, crearMiembro, crearRol, rpc } from "./base-datos";

type Franja = { dia: number; desde: number; hasta: number };
type Barbero = { id: string; nombre: string; horario: Franja[] };
type Bloqueo = { id: string; barbero_id: string; inicio: string; fin: string; motivo: string | null };

let db: PGlite;
let contador = 0;

beforeAll(async () => {
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

async function nueva(): Promise<BarberiaDePrueba> {
  contador += 1;
  return crearBarberia(db, `Barbería ${contador}`);
}

const barbero = async (actor: string, nombre: string) =>
  (await rpc<{ id: string }>(db, actor, "crear_barbero", { p_nombre: nombre })).id;

const horarioDe = async (actor: string, id: string) =>
  (await rpc<Barbero[]>(db, actor, "listar_barberos", { p_con_archivados: true })).find((b) => b.id === id)!.horario;

const guardar = (actor: string, id: string, franjas: unknown) =>
  rpc(db, actor, "guardar_horario_barbero", { p_barbero: id, p_franjas: franjas });

const m = (h: number, min = 0) => h * 60 + min; // minutos desde medianoche

describe("guardar_horario_barbero", () => {
  it("guarda las franjas y las lista ordenadas por día y hora", async () => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    await guardar(a.userId, id, [
      { dia: 2, desde: m(14, 30), hasta: m(19) },
      { dia: 1, desde: m(9), hasta: m(13) },
      { dia: 2, desde: m(9), hasta: m(13) },
      { dia: 1, desde: m(14, 30), hasta: m(19) },
    ]);
    expect(await horarioDe(a.userId, id)).toEqual([
      { dia: 1, desde: 540, hasta: 780 },
      { dia: 1, desde: 870, hasta: 1140 },
      { dia: 2, desde: 540, hasta: 780 },
      { dia: 2, desde: 870, hasta: 1140 },
    ]);
  });

  it("reemplaza todo lo anterior, y la lista vacía deja al barbero sin horario", async () => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    await guardar(a.userId, id, [{ dia: 1, desde: m(9), hasta: m(13) }]);
    await guardar(a.userId, id, [{ dia: 3, desde: m(10), hasta: m(18) }]);
    expect(await horarioDe(a.userId, id)).toEqual([{ dia: 3, desde: 600, hasta: 1080 }]);
    await guardar(a.userId, id, []);
    expect(await horarioDe(a.userId, id)).toEqual([]);
  });

  it("acepta franjas pegadas, el domingo (0) y el día completo hasta la medianoche (1440)", async () => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    await guardar(a.userId, id, [
      { dia: 0, desde: 0, hasta: 1440 },
      { dia: 1, desde: m(9), hasta: m(13) },
      { dia: 1, desde: m(13), hasta: m(19) },
    ]);
    expect(await horarioDe(a.userId, id)).toHaveLength(3);
  });

  it("rechaza franjas que se cruzan, con el nombre del día", async () => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    await expect(
      guardar(a.userId, id, [
        { dia: 3, desde: m(9), hasta: m(13) },
        { dia: 3, desde: m(12), hasta: m(15) },
      ])
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("Las franjas del miércoles se cruzan") });
    // …y dos iguales también se cruzan.
    await expect(
      guardar(a.userId, id, [
        { dia: 0, desde: m(9), hasta: m(13) },
        { dia: 0, desde: m(9), hasta: m(13) },
      ])
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("domingo") });
    expect(await horarioDe(a.userId, id)).toEqual([]);
  });

  it("al fallar no se pierde el horario anterior", async () => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    await guardar(a.userId, id, [{ dia: 1, desde: m(9), hasta: m(13) }]);
    await expect(
      guardar(a.userId, id, [
        { dia: 1, desde: m(9), hasta: m(13) },
        { dia: 1, desde: m(10), hasta: m(11) },
      ])
    ).rejects.toMatchObject({ code: "P0001" });
    expect(await horarioDe(a.userId, id)).toEqual([{ dia: 1, desde: 540, hasta: 780 }]);
  });

  it.each([
    ["una franja que termina antes de empezar", [{ dia: 1, desde: 600, hasta: 540 }], /termina antes de empezar/],
    ["una franja vacía", [{ dia: 1, desde: 600, hasta: 600 }], /termina antes de empezar/],
    ["un día que no existe", [{ dia: 7, desde: 540, hasta: 600 }], /día de la semana/],
    ["un día negativo", [{ dia: -1, desde: 540, hasta: 600 }], /día de la semana/],
    ["una hora fuera del día", [{ dia: 1, desde: 540, hasta: 1500 }], /entre las 12:00/],
    ["minutos decimales", [{ dia: 1, desde: 540.5, hasta: 600 }], /número entero/],
    ["un dato que falta", [{ dia: 1, desde: 540 }], /Falta el dato "hasta"/],
    ["un dato que no es número", [{ dia: 1, desde: "nueve", hasta: 600 }], /número entero/],
    ["un elemento que no es objeto", ["lunes"], /no es válido/],
    ["algo que no es una lista", { dia: 1 }, /no es válido/],
  ])("rechaza %s", async (_caso, franjas, mensaje) => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    await expect(guardar(a.userId, id, franjas)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringMatching(mensaje as RegExp),
    });
  });

  it("rechaza más de 4 franjas en un día", async () => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    const cinco = [0, 1, 2, 3, 4].map((i) => ({ dia: 1, desde: m(6 + i * 3), hasta: m(7 + i * 3) }));
    await expect(guardar(a.userId, id, cinco)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("más de 4 franjas"),
    });
  });

  it("la restricción de la tabla es la última barrera aunque se escriba directo", async () => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    await db.query(
      `insert into public.horarios_barbero (barberia_id, barbero_id, dia_semana, desde_min, hasta_min)
       values ($1, $2, 1, 540, 780)`,
      [a.barberiaId, id]
    );
    await expect(
      db.query(
        `insert into public.horarios_barbero (barberia_id, barbero_id, dia_semana, desde_min, hasta_min)
         values ($1, $2, 1, 700, 800)`,
        [a.barberiaId, id]
      )
    ).rejects.toMatchObject({ code: "23P01" });
    // Otro día o pegada: sí.
    await expect(
      db.query(
        `insert into public.horarios_barbero (barberia_id, barbero_id, dia_semana, desde_min, hasta_min)
         values ($1, $2, 1, 780, 900), ($1, $2, 2, 700, 800)`,
        [a.barberiaId, id]
      )
    ).resolves.toBeTruthy();
  });

  it("no toca barberos de otra barbería", async () => {
    const a = await nueva();
    const b = await nueva();
    const camilo = await barbero(a.userId, "Camilo");
    await expect(guardar(b.userId, camilo, [{ dia: 1, desde: m(9), hasta: m(13) }])).rejects.toMatchObject({
      code: "P0002",
    });
  });

  it("pide el área servicios; los demás solo leen", async () => {
    const a = await nueva();
    await crearRol(db, a.barberiaId, "Encargado", ["servicios"]);
    const encargado = await crearMiembro(db, a.barberiaId, "Elena", ["Encargado"]);
    const recepcion = await crearMiembro(db, a.barberiaId, "Ruth", ["Recepción"]);
    const barberoCuenta = await crearMiembro(db, a.barberiaId, "Camilo", ["Barbero"]);
    const id = await barbero(a.userId, "Camilo");

    await expect(guardar(encargado, id, [{ dia: 1, desde: m(9), hasta: m(13) }])).resolves.toBeTruthy();
    for (const actor of [recepcion, barberoCuenta]) {
      await expect(guardar(actor, id, [])).rejects.toMatchObject({ code: "42501" });
      expect(await horarioDe(actor, id)).toHaveLength(1);
    }
    await expect(rpc(db, null, "guardar_horario_barbero", { p_barbero: id, p_franjas: [] })).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("ajustes de la agenda", () => {
  const ajustes = (actor: string, paso: number, dias: number, antic: number, colchon: number) =>
    rpc(db, actor, "actualizar_parametros_agenda", {
      p_paso_min: paso,
      p_dias_adelante: dias,
      p_anticipacion_min: antic,
      p_colchon_min: colchon,
    });

  const contexto = (actor: string) =>
    rpc<{ barberia: { agenda: Record<string, number> } }>(db, actor, "obtener_contexto").then((c) => c.barberia.agenda);

  it("una barbería nueva arranca con los valores del spec", async () => {
    const a = await nueva();
    expect(await contexto(a.userId)).toEqual({
      paso_min: 30,
      dias_adelante: 30,
      anticipacion_min: 60,
      colchon_min: 0,
      reservas_en_linea: true,
      cancelar_hasta_horas: 2,
    });
  });

  it("guarda los ajustes y el contexto los refleja", async () => {
    const a = await nueva();
    await ajustes(a.userId, 15, 60, 120, 10);
    expect(await contexto(a.userId)).toEqual({
      paso_min: 15,
      dias_adelante: 60,
      anticipacion_min: 120,
      colchon_min: 10,
      // Los ajustes de 4 argumentos no tocan el interruptor ni el límite para cancelar.
      reservas_en_linea: true,
      cancelar_hasta_horas: 2,
    });
  });

  it.each([
    ["paso de 20 minutos", [20, 30, 60, 0], /15 o cada 30/],
    ["cero días adelante", [30, 0, 60, 0], /1 a 90 días/],
    ["más de 90 días", [30, 91, 60, 0], /1 a 90 días/],
    ["anticipación negativa", [30, 30, -1, 0], /anticipación/],
    ["anticipación de más de un día", [30, 30, 1441, 0], /anticipación/],
    ["colchón negativo", [30, 30, 60, -5], /descanso/],
    ["colchón de más de una hora", [30, 30, 60, 61], /descanso/],
  ])("rechaza %s", async (_caso, [paso, dias, antic, colchon], mensaje) => {
    const a = await nueva();
    await expect(ajustes(a.userId, paso, dias, antic, colchon)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringMatching(mensaje as RegExp),
    });
    expect(await contexto(a.userId)).toMatchObject({ paso_min: 30 });
  });

  it("solo los cambia quien abre servicios, y solo en su barbería", async () => {
    const a = await nueva();
    const b = await nueva();
    const recepcion = await crearMiembro(db, a.barberiaId, "Ruth", ["Recepción"]);
    await expect(ajustes(recepcion, 15, 30, 60, 0)).rejects.toMatchObject({ code: "42501" });
    await ajustes(a.userId, 15, 30, 60, 0);
    expect((await contexto(a.userId)).paso_min).toBe(15);
    expect((await contexto(b.userId)).paso_min).toBe(30);
  });

  it("la tabla rechaza valores fuera de rango aunque se escriban directo", async () => {
    const a = await nueva();
    await expect(db.query(`update public.barberias set paso_min = 20 where id = $1`, [a.barberiaId])).rejects.toMatchObject({
      code: "23514",
    });
  });
});

describe("bloqueos", () => {
  const futuro = (horas: number) => new Date(Date.now() + horas * 3_600_000).toISOString();
  const bloquear = (actor: string, barberoId: string | null, inicio: string, fin: string, motivo?: string) =>
    rpc<{ ok: boolean; id: string }>(db, actor, "crear_bloqueo", {
      p_barbero: barberoId,
      p_inicio: inicio,
      p_fin: fin,
      p_motivo: motivo ?? null,
    });
  const listar = (actor: string, barberoId: string | null = null) =>
    rpc<Bloqueo[]>(db, actor, "listar_bloqueos", { p_barbero: barberoId });

  it("crea un bloqueo, lo lista en orden y lo quita sin borrarlo", async () => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    const tarde = await bloquear(a.userId, id, futuro(48), futuro(50), "Cita médica");
    const temprano = await bloquear(a.userId, id, futuro(24), futuro(30), "  Día   libre ");
    expect(tarde.ok).toBe(true);

    const lista = await listar(a.userId);
    expect(lista.map((b) => b.motivo)).toEqual(["Día libre", "Cita médica"]);

    await rpc(db, a.userId, "quitar_bloqueo", { p_id: temprano.id });
    expect((await listar(a.userId)).map((b) => b.motivo)).toEqual(["Cita médica"]);
    const { rows } = await db.query(`select 1 from public.bloqueos where id = $1 and not activo`, [temprano.id]);
    expect(rows).toHaveLength(1);
  });

  it("filtra por barbero y no lista los que ya terminaron", async () => {
    const a = await nueva();
    const camilo = await barbero(a.userId, "Camilo");
    const dani = await barbero(a.userId, "Dani");
    await bloquear(a.userId, camilo, futuro(24), futuro(26), "De Camilo");
    await bloquear(a.userId, dani, futuro(24), futuro(26), "De Dani");
    // Uno ya pasado, insertado directo (la función no deja crear bloqueos que ya terminaron).
    await db.query(
      `insert into public.bloqueos (barberia_id, barbero_id, inicio, fin, motivo)
       values ($1, $2, now() - interval '3 hours', now() - interval '2 hours', 'Pasado')`,
      [a.barberiaId, camilo]
    );
    expect((await listar(a.userId, camilo)).map((b) => b.motivo)).toEqual(["De Camilo"]);
    expect(await listar(a.userId)).toHaveLength(2);
  });

  it.each([
    ["termina antes de empezar", () => [futuro(30), futuro(24)], /terminar después de empezar/],
    ["ya terminó", () => [futuro(-5), futuro(-2)], /ya terminó/],
    ["dura más de 90 días", () => [futuro(24), futuro(24 + 24 * 91)], /90 días/],
  ])("rechaza un bloqueo que %s", async (_caso, rango, mensaje) => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    const [inicio, fin] = (rango as () => string[])();
    await expect(bloquear(a.userId, id, inicio, fin)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringMatching(mensaje as RegExp),
    });
  });

  it("rechaza un motivo demasiado largo y un barbero archivado o inexistente", async () => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    await expect(bloquear(a.userId, id, futuro(24), futuro(26), "x".repeat(101))).rejects.toMatchObject({
      code: "P0001",
    });
    await rpc(db, a.userId, "fijar_barbero_activo", { p_id: id, p_activo: false });
    await expect(bloquear(a.userId, id, futuro(24), futuro(26))).rejects.toMatchObject({ code: "P0002" });
  });

  it("recepción (agenda) bloquea a cualquiera; el barbero (mi_agenda) solo a sí mismo", async () => {
    const a = await nueva();
    const camilo = await barbero(a.userId, "Camilo");
    const dani = await barbero(a.userId, "Dani");
    const cuentaCamilo = await crearMiembro(db, a.barberiaId, "Camilo Cuenta", ["Barbero"]);
    await rpc(db, a.userId, "vincular_barbero_usuario", { p_barbero: camilo, p_user_id: cuentaCamilo });
    const recepcion = await crearMiembro(db, a.barberiaId, "Ruth", ["Recepción"]);

    await expect(bloquear(recepcion, dani, futuro(24), futuro(26), "Lo pidió")).resolves.toMatchObject({ ok: true });
    const propio = await bloquear(cuentaCamilo, camilo, futuro(24), futuro(26), "Mío");
    await expect(bloquear(cuentaCamilo, dani, futuro(24), futuro(26))).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining("tu propio horario"),
    });

    // Quitar: el barbero quita el suyo, no el de otro.
    const deDani = (await listar(a.userId, dani))[0];
    await expect(rpc(db, cuentaCamilo, "quitar_bloqueo", { p_id: deDani.id })).rejects.toMatchObject({ code: "42501" });
    await expect(rpc(db, cuentaCamilo, "quitar_bloqueo", { p_id: propio.id })).resolves.toMatchObject({ ok: true });
  });

  it("alguien sin área de agenda (solo gastos) no puede bloquear", async () => {
    const a = await nueva();
    await crearRol(db, a.barberiaId, "Cajero", ["caja"]);
    const cajero = await crearMiembro(db, a.barberiaId, "Cajero", ["Cajero"]);
    const id = await barbero(a.userId, "Camilo");
    await expect(bloquear(cajero, id, futuro(24), futuro(26))).rejects.toMatchObject({ code: "42501" });
    await expect(rpc(db, null, "crear_bloqueo", { p_barbero: id, p_inicio: futuro(24), p_fin: futuro(26), p_motivo: null }))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("cada barbería ve y toca solo lo suyo", async () => {
    const a = await nueva();
    const b = await nueva();
    const camilo = await barbero(a.userId, "Camilo");
    const bloqueo = await bloquear(a.userId, camilo, futuro(24), futuro(26), "Privado");
    expect(await listar(b.userId)).toEqual([]);
    await expect(rpc(db, b.userId, "quitar_bloqueo", { p_id: bloqueo.id })).rejects.toMatchObject({ code: "P0002" });
    await expect(bloquear(b.userId, camilo, futuro(24), futuro(26))).rejects.toMatchObject({ code: "P0002" });
    const directo = await como(db, b.userId, `select 1 from public.bloqueos`);
    expect(directo).toHaveLength(0);
  });

  it("el borrado está bloqueado", async () => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    await bloquear(a.userId, id, futuro(24), futuro(26));
    await expect(db.query(`delete from public.bloqueos where barberia_id = $1`, [a.barberiaId])).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining("se anula con motivo"),
    });
  });
});
