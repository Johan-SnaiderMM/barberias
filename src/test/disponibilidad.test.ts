/**
 * Disponibilidad: las horas libres de un barbero (tarea 1.5 · migración 0009, SPEC F5).
 *
 * Esta es LA TABLA DE CASOS DE BORDE, escrita antes que la función (`fn_huecos`). Todas las pruebas usan instantes
 * FIJOS: nunca el reloj. Reglas que fija esta tabla:
 *   - Las horas posibles arrancan en la hora de inicio de cada franja y avanzan de `paso_min` en `paso_min`.
 *   - Una hora vale si el servicio ENTRA completo en la franja (franjas pegadas se unen en una sola).
 *   - Se descartan las que se cruzan con una cita vigente (confirmada, en atención o atendida), con un bloqueo
 *     activo o con el descanso (`colchon_min`) que debe quedar entre dos citas.
 *   - El descanso se pide entre citas, no contra un bloqueo ni contra el cierre de la franja.
 *   - Público: respeta `anticipacion_min` y `dias_adelante` y solo ofrece a quien acepta reservas en línea.
 *     Personal (publico = false): ni límites ni "acepta reservas"; igual nunca ofrece horas que ya pasaron.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BarberiaDePrueba, crearBarberia, crearBase, rpc } from "./base-datos";

let db: PGlite;
let contador = 0;

beforeAll(async () => {
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

// --- Calendario de las pruebas (noviembre de 2026) ---------------------------------------------------------------
// 2026-11-01 domingo · 02 lunes · 03 martes · 04 miércoles · 05 jueves · 06 viernes · 07 sábado · 08 domingo
const LUN = "2026-11-02";
const MAR = "2026-11-03";
const MIE = "2026-11-04";
const JUE = "2026-11-05";
const SAB = "2026-11-07";

/** "Ahora" de las pruebas: domingo 1 de noviembre, 10:00 en Bogotá. Todo lo demás queda en el futuro. */
const AHORA = "2026-11-01T15:00:00Z";

/** Hora de Bogotá -> instante ISO (Colombia no tiene horario de verano: UTC-5). */
const bog = (fecha: string, hora: string) => `${fecha}T${hora}:00-05:00`;

const m = (h: number, min = 0) => h * 60 + min;

type Escenario = BarberiaDePrueba & {
  corte: string; // 30 min
  combo: string; // 45 min
  cejas: string; // 15 min
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
  const cejas = await id("crear_servicio", { p_nombre: "Cejas", p_precio: 5000, p_duracion_min: 15 });
  const camilo = await id("crear_barbero", { p_nombre: "Camilo" });
  const dani = await id("crear_barbero", { p_nombre: "Dani" });

  await rpc(db, a.userId, "asignar_servicios_barbero", {
    p_barbero: camilo,
    p_servicios: [{ servicio_id: corte }, { servicio_id: combo }, { servicio_id: cejas }],
  });
  await rpc(db, a.userId, "asignar_servicios_barbero", { p_barbero: dani, p_servicios: [{ servicio_id: corte }] });

  // Camilo: lunes a viernes 9:00–13:00 y 14:00–19:00; sábado 9:00–14:00. Dani: lunes a viernes 10:00–18:00.
  const camiloFranjas: { dia: number; desde: number; hasta: number }[] = [];
  const daniFranjas: { dia: number; desde: number; hasta: number }[] = [];
  for (const dia of [1, 2, 3, 4, 5]) {
    camiloFranjas.push({ dia, desde: m(9), hasta: m(13) }, { dia, desde: m(14), hasta: m(19) });
    daniFranjas.push({ dia, desde: m(10), hasta: m(18) });
  }
  camiloFranjas.push({ dia: 6, desde: m(9), hasta: m(14) });
  await rpc(db, a.userId, "guardar_horario_barbero", { p_barbero: camilo, p_franjas: camiloFranjas });
  await rpc(db, a.userId, "guardar_horario_barbero", { p_barbero: dani, p_franjas: daniFranjas });

  const c = await db.query<{ id: string }>(
    `insert into public.clientes (barberia_id, nombre, telefono) values ($1, 'Juan', '+573001234567') returning id`,
    [a.barberiaId]
  );
  return { ...a, corte, combo, cejas, camilo, dani, cliente: c.rows[0].id };
}

type Consulta = {
  servicio: string;
  barbero?: string | null;
  desde: string;
  hasta?: string;
  ahora?: string;
  publico?: boolean;
  ignorar?: string | null;
};

type Hueco = { barbero_id: string; hora: string; fin: string; carga_dia: number; orden_barbero: number };

const FORMATO = `'YYYY-MM-DD HH24:MI'`;

/** Todos los huecos (por barbero), con la hora de Bogotá como texto "YYYY-MM-DD HH24:MI". */
async function huecos(e: Escenario, q: Consulta): Promise<Hueco[]> {
  const r = await db.query<Hueco>(
    `select h.barbero_id,
            to_char(h.inicio at time zone 'America/Bogota', ${FORMATO}) as hora,
            to_char(h.fin at time zone 'America/Bogota', ${FORMATO}) as fin,
            h.carga_dia, h.orden_barbero
       from public.fn_huecos(
              p_barberia => $1, p_servicio => $2, p_barbero => $3, p_desde => $4::date, p_hasta => $5::date,
              p_ahora => $6::timestamptz, p_publico => $7, p_ignorar_cita => $8) h
      order by h.inicio, h.orden_barbero`,
    [e.barberiaId, q.servicio, q.barbero ?? null, q.desde, q.hasta ?? q.desde, q.ahora ?? AHORA, q.publico ?? true, q.ignorar ?? null]
  );
  return r.rows;
}

/** Solo las horas "HH:MM" de un día (cómodo cuando se pregunta por un solo barbero y un solo día). */
async function horas(e: Escenario, q: Consulta): Promise<string[]> {
  return (await huecos(e, q)).map((h) => h.hora.slice(11));
}

/** Los huecos de la "primera disponible": una hora por cada instante, con el barbero elegido. */
async function cualquiera(e: Escenario, q: Consulta): Promise<{ barbero_id: string; hora: string }[]> {
  const r = await db.query<{ barbero_id: string; hora: string }>(
    `select h.barbero_id, to_char(h.inicio at time zone 'America/Bogota', ${FORMATO}) as hora
       from public.fn_huecos_cualquiera(
              p_barberia => $1, p_servicio => $2, p_desde => $3::date, p_hasta => $4::date,
              p_ahora => $5::timestamptz, p_publico => $6) h
      order by h.inicio`,
    [e.barberiaId, q.servicio, q.desde, q.hasta ?? q.desde, q.ahora ?? AHORA, q.publico ?? true]
  );
  return r.rows.map((x) => ({ barbero_id: x.barbero_id, hora: x.hora.slice(11) }));
}

async function cita(
  e: Escenario,
  o: { barbero: string; servicio: string; inicio: string; estado?: string }
): Promise<string> {
  const estado = o.estado ?? "confirmada";
  const cancelada = estado === "cancelada";
  const r = await db.query<{ id: string }>(
    `insert into public.citas (barberia_id, barbero_id, cliente_id, servicio_id, inicio, estado, cancelada_motivo, cancelada_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [e.barberiaId, o.barbero, e.cliente, o.servicio, o.inicio, estado, cancelada ? "Prueba" : null, cancelada ? AHORA : null]
  );
  return r.rows[0].id;
}

async function bloqueo(e: Escenario, barbero: string, inicio: string, fin: string, activo = true): Promise<void> {
  await db.query(
    `insert into public.bloqueos (barberia_id, barbero_id, inicio, fin, activo) values ($1, $2, $3, $4, $5)`,
    [e.barberiaId, barbero, inicio, fin, activo]
  );
}

const ajustes = (e: Escenario, a: { paso?: number; dias?: number; antic?: number; colchon?: number }) =>
  rpc(db, e.userId, "actualizar_parametros_agenda", {
    p_paso_min: a.paso ?? 30,
    p_dias_adelante: a.dias ?? 30,
    p_anticipacion_min: a.antic ?? 60,
    p_colchon_min: a.colchon ?? 0,
  });

const horario = (e: Escenario, barbero: string, franjas: { dia: number; desde: number; hasta: number }[]) =>
  rpc(db, e.userId, "guardar_horario_barbero", { p_barbero: barbero, p_franjas: franjas });

// --- Listas de referencia ------------------------------------------------------------------------------------------
const MANANA_30 = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"];
const TARDE_30 = ["14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"];
const MANANA_45 = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"];
const TARDE_45 = ["14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00"];
const sin = (lista: string[], ...quitar: string[]) => lista.filter((h) => !quitar.includes(h));

describe("la rejilla de horas", () => {
  it("servicio de 30 min con paso de 30: cada media hora, hasta que el servicio entra en la franja", async () => {
    const e = await escenario();
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toEqual([...MANANA_30, ...TARDE_30]);
  });

  it("servicio de 45 min con paso de 30: la última hora es la que todavía termina dentro de la franja", async () => {
    const e = await escenario();
    // 12:30 + 45 = 13:15 (se pasa de la franja); 12:00 + 45 = 12:45 sí entra.
    expect(await horas(e, { servicio: e.combo, barbero: e.camilo, desde: LUN })).toEqual([...MANANA_45, ...TARDE_45]);
  });

  it("servicio de 15 min con paso de 15: cada cuarto de hora", async () => {
    const e = await escenario();
    await ajustes(e, { paso: 15 });
    const r = await horas(e, { servicio: e.cejas, barbero: e.camilo, desde: LUN });
    expect(r).toHaveLength(16 + 20);
    expect(r.slice(0, 5)).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00"]);
    expect(r).toContain("12:45"); // 12:45 + 15 = 13:00 entra justo
    expect(r).not.toContain("13:00");
    expect(r[r.length - 1]).toBe("18:45");
  });

  it("la rejilla arranca donde arranca la franja, no en horas redondas", async () => {
    const e = await escenario();
    await horario(e, e.camilo, [{ dia: 1, desde: m(9, 10), hasta: m(11, 10) }]);
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toEqual([
      "09:10",
      "09:40",
      "10:10",
      "10:40",
    ]);
  });

  it("un servicio más largo que la franja no tiene horas", async () => {
    const e = await escenario();
    await horario(e, e.camilo, [{ dia: 1, desde: m(9), hasta: m(9, 20) }]);
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toEqual([]);
    expect(await horas(e, { servicio: e.cejas, barbero: e.camilo, desde: LUN })).toEqual(["09:00"]);
  });

  it("un día sin franjas (domingo) no tiene horas", async () => {
    const e = await escenario();
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: "2026-11-08" })).toEqual([]);
  });

  it("el sábado usa su propio horario (9:00 a 14:00)", async () => {
    const e = await escenario();
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: SAB });
    expect(r).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"]);
  });

  it("cada día de la semana usa el horario de su día", async () => {
    const e = await escenario();
    await horario(e, e.camilo, [
      { dia: 1, desde: m(9), hasta: m(10) }, // lunes
      { dia: 3, desde: m(15), hasta: m(16) }, // miércoles
    ]);
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toEqual(["09:00", "09:30"]);
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: MAR })).toEqual([]);
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: MIE })).toEqual(["15:00", "15:30"]);
  });
});

describe("franjas partidas y pegadas", () => {
  it("el descanso del mediodía no tiene horas, y la última antes de cerrar la franja sí", async () => {
    const e = await escenario();
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN });
    expect(r).toContain("12:30");
    expect(r).not.toContain("13:00");
    expect(r).not.toContain("13:30");
    expect(r).toContain("14:00");
  });

  it("dos franjas pegadas (13:00 y 13:00) se unen: un servicio puede cruzar la unión", async () => {
    const e = await escenario();
    await horario(e, e.camilo, [
      { dia: 1, desde: m(9), hasta: m(13) },
      { dia: 1, desde: m(13), hasta: m(19) },
    ]);
    const r = await horas(e, { servicio: e.combo, barbero: e.camilo, desde: LUN });
    expect(r).toContain("12:30"); // 12:30–13:15 cruza la unión
    expect(r).toContain("13:00");
    expect(r[r.length - 1]).toBe("18:00");
  });

  it("con un hueco de 10 minutos entre franjas NO se pueden unir", async () => {
    const e = await escenario();
    await horario(e, e.camilo, [
      { dia: 1, desde: m(9), hasta: m(13) },
      { dia: 1, desde: m(13, 10), hasta: m(19) },
    ]);
    const r = await horas(e, { servicio: e.combo, barbero: e.camilo, desde: LUN });
    expect(r).not.toContain("12:30");
    expect(r).toContain("13:10");
  });
});

describe("citas", () => {
  it("una cita quita solo la hora que ocupa; las pegadas quedan libres", async () => {
    const e = await escenario();
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "10:00") }); // 10:00–10:30
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN });
    expect(r).toEqual([...sin(MANANA_30, "10:00"), ...TARDE_30]);
    expect(r).toContain("09:30"); // termina justo cuando empieza la cita
    expect(r).toContain("10:30"); // empieza justo cuando termina
  });

  it("un servicio de 45 min también pierde la hora anterior si invade la cita", async () => {
    const e = await escenario();
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "10:00") });
    const r = await horas(e, { servicio: e.combo, barbero: e.camilo, desde: LUN });
    // 9:30 + 45 = 10:15 invade la cita; 9:00 + 45 = 9:45 no; 10:00 está ocupada; 10:30 en adelante libre.
    expect(r).toEqual(["09:00", "10:30", "11:00", "11:30", "12:00", ...TARDE_45]);
  });

  it("una cita de otro barbero no afecta", async () => {
    const e = await escenario();
    await cita(e, { barbero: e.dani, servicio: e.corte, inicio: bog(LUN, "10:00") });
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toEqual([...MANANA_30, ...TARDE_30]);
  });

  it("las citas canceladas y las que no asistieron no ocupan la hora", async () => {
    const e = await escenario();
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "10:00"), estado: "cancelada" });
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "11:00"), estado: "no_asistio" });
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toEqual([...MANANA_30, ...TARDE_30]);
  });

  it.each(["confirmada", "en_atencion", "atendida"])("una cita %s sí ocupa la hora", async (estado) => {
    const e = await escenario();
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "10:00"), estado });
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).not.toContain("10:00");
  });

  it("una cita que se pasa del cierre de la franja también quita la última hora", async () => {
    const e = await escenario();
    // 12:45 + 45 = 13:30: la franja de la mañana cierra a las 13:00, pero la cita existe y estorba.
    await cita(e, { barbero: e.camilo, servicio: e.combo, inicio: bog(LUN, "12:45") });
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN });
    expect(r).toContain("12:00"); // 12:00–12:30 queda libre
    expect(r).not.toContain("12:30"); // 12:30–13:00 invade la cita de 12:45
  });

  it("la hora se cuenta en Bogotá: una cita a las 17:30 (22:30 UTC) quita las 17:30 de ESE día y de ningún otro", async () => {
    const e = await escenario();
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: "2026-11-02T22:30:00Z" }); // lunes 17:30 Bogotá
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).not.toContain("17:30");
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: MAR })).toContain("17:30");
  });

  it("una cita ya movida a otro día libera el día original", async () => {
    const e = await escenario();
    const id = await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "10:00") });
    await db.query(`update public.citas set inicio = $2 where id = $1`, [id, bog(MAR, "10:00")]);
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toContain("10:00");
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: MAR })).not.toContain("10:00");
  });

  it("al reprogramar, la propia cita no cuenta contra sí misma (p_ignorar_cita)", async () => {
    const e = await escenario();
    const id = await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "10:00") });
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).not.toContain("10:00");
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN, ignorar: id })).toContain("10:00");
  });
});

describe("descanso entre citas (colchón)", () => {
  it("deja el descanso ANTES y DESPUÉS de una cita", async () => {
    const e = await escenario();
    await ajustes(e, { colchon: 10 });
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "10:00") }); // 10:00–10:30
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN });
    // 9:00–9:30 (+10 = 9:40) cabe antes de las 10:00; 9:30–10:00 (+10) ya no; después de 10:30 hay que esperar 10 min.
    expect(r).toEqual(["09:00", "11:00", "11:30", "12:00", "12:30", ...TARDE_30]);
  });

  it("con descanso de 0 las citas pegadas siguen siendo posibles", async () => {
    const e = await escenario();
    await ajustes(e, { colchon: 0 });
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "10:00") });
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN });
    expect(r).toContain("09:30");
    expect(r).toContain("10:30");
  });

  it("no se pide descanso contra el cierre de la franja ni contra un bloqueo", async () => {
    const e = await escenario();
    await ajustes(e, { colchon: 15 });
    await bloqueo(e, e.camilo, bog(LUN, "11:00"), bog(LUN, "12:00"));
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN });
    expect(r).toContain("10:30"); // termina a las 11:00, justo cuando empieza el bloqueo
    expect(r).toContain("12:00"); // empieza justo cuando termina
    expect(r).toContain("12:30"); // última hora de la franja: no necesita descanso hasta el cierre
  });
});

describe("bloqueos", () => {
  it("un bloqueo quita las horas que se le cruzan y deja las pegadas", async () => {
    const e = await escenario();
    await bloqueo(e, e.camilo, bog(LUN, "11:00"), bog(LUN, "12:00"));
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toEqual([
      ...sin(MANANA_30, "11:00", "11:30"),
      ...TARDE_30,
    ]);
  });

  it("un bloqueo que no coincide con la rejilla quita todas las horas que toca", async () => {
    const e = await escenario();
    await bloqueo(e, e.camilo, bog(LUN, "10:15"), bog(LUN, "10:45"));
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN });
    expect(r).not.toContain("10:00"); // 10:00–10:30 invade
    expect(r).not.toContain("10:30"); // 10:30–11:00 invade
    expect(r).toContain("09:30");
    expect(r).toContain("11:00");
  });

  it("un día completo bloqueado no tiene horas, y el siguiente sí", async () => {
    const e = await escenario();
    await bloqueo(e, e.camilo, bog(LUN, "00:00"), bog(MAR, "00:00"));
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toEqual([]);
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: MAR })).toHaveLength(18);
  });

  it("un bloqueo de varios días (vacaciones) cubre todos esos días", async () => {
    const e = await escenario();
    await bloqueo(e, e.camilo, bog(LUN, "00:00"), bog(MIE, "00:00")); // lunes y martes
    const r = await huecos(e, { servicio: e.corte, barbero: e.camilo, desde: LUN, hasta: JUE });
    expect(new Set(r.map((h) => h.hora.slice(0, 10)))).toEqual(new Set([MIE, JUE]));
  });

  it("un bloqueo quitado (inactivo) no cuenta", async () => {
    const e = await escenario();
    await bloqueo(e, e.camilo, bog(LUN, "11:00"), bog(LUN, "12:00"), false);
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toEqual([...MANANA_30, ...TARDE_30]);
  });

  it("el bloqueo de otro barbero no afecta", async () => {
    const e = await escenario();
    await bloqueo(e, e.dani, bog(LUN, "00:00"), bog(MAR, "00:00"));
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toHaveLength(18);
    expect(await horas(e, { servicio: e.corte, barbero: e.dani, desde: LUN })).toEqual([]);
  });
});

describe("límites de la reserva en línea", () => {
  it("anticipación mínima: nadie reserva para dentro de menos de una hora", async () => {
    const e = await escenario();
    // Lunes 10:07 + 60 min = 11:07: la primera hora de la rejilla que cumple es 11:30.
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN, ahora: "2026-11-02T15:07:00Z" });
    expect(r).toEqual(["11:30", "12:00", "12:30", ...TARDE_30]);
  });

  it("una hora justo en el límite de anticipación sí se ofrece", async () => {
    const e = await escenario();
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN, ahora: "2026-11-02T15:00:00Z" });
    expect(r[0]).toBe("11:00"); // 10:00 + 60 = 11:00 exacto
  });

  it("el personal (publico = false) ve las horas sin la anticipación, pero nunca las que ya pasaron", async () => {
    const e = await escenario();
    const r = await horas(e, {
      servicio: e.corte,
      barbero: e.camilo,
      desde: LUN,
      ahora: "2026-11-02T15:07:00Z",
      publico: false,
    });
    expect(r).toEqual(["10:30", "11:00", "11:30", "12:00", "12:30", ...TARDE_30]);
  });

  it("la anticipación configurable: con 0 se ofrece desde la siguiente hora de la rejilla", async () => {
    const e = await escenario();
    await ajustes(e, { antic: 0 });
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN, ahora: "2026-11-02T15:07:00Z" });
    expect(r[0]).toBe("10:30");
  });

  it("días hacia adelante: el último día permitido sí, el siguiente no", async () => {
    const e = await escenario();
    await ajustes(e, { dias: 3 }); // hoy es domingo 1: hasta el miércoles 4 inclusive
    expect((await horas(e, { servicio: e.corte, barbero: e.camilo, desde: MIE })).length).toBeGreaterThan(0);
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: JUE })).toEqual([]);
    // El personal puede agendar más allá.
    expect(
      (await horas(e, { servicio: e.corte, barbero: e.camilo, desde: JUE, publico: false })).length
    ).toBeGreaterThan(0);
  });

  it("un día que ya pasó no tiene horas, ni siquiera para el personal", async () => {
    const e = await escenario();
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: "2026-10-30" })).toEqual([]);
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: "2026-10-30", publico: false })).toEqual([]);
  });

  it("hoy, solo quedan las horas que todavía no pasan", async () => {
    const e = await escenario();
    // Es lunes 14:10: el público necesita 1 h de anticipación -> desde las 15:30.
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN, ahora: "2026-11-02T19:10:00Z" });
    expect(r).toEqual(["15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"]);
  });
});

describe("quién ofrece qué", () => {
  it("un barbero no ofrece un servicio que no tiene asignado", async () => {
    const e = await escenario();
    expect(await horas(e, { servicio: e.combo, barbero: e.dani, desde: LUN })).toEqual([]);
  });

  it("sin barbero, solo salen los que sí hacen el servicio", async () => {
    const e = await escenario();
    const r = await huecos(e, { servicio: e.combo, desde: LUN });
    expect(new Set(r.map((h) => h.barbero_id))).toEqual(new Set([e.camilo]));
  });

  it("un servicio archivado no se ofrece", async () => {
    const e = await escenario();
    await rpc(db, e.userId, "fijar_servicio_activo", { p_id: e.corte, p_activo: false });
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toEqual([]);
  });

  it("un barbero archivado no se ofrece", async () => {
    const e = await escenario();
    await rpc(db, e.userId, "fijar_barbero_activo", { p_id: e.camilo, p_activo: false });
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toEqual([]);
    const r = await huecos(e, { servicio: e.corte, desde: LUN });
    expect(new Set(r.map((h) => h.barbero_id))).toEqual(new Set([e.dani]));
  });

  it("quien no acepta reservas en línea no sale al público, pero sí al personal", async () => {
    const e = await escenario();
    await rpc(db, e.userId, "actualizar_barbero", { p_id: e.camilo, p_nombre: "Camilo", p_acepta_reservas: false });
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN })).toEqual([]);
    expect(await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN, publico: false })).toHaveLength(18);
  });

  it("la duración propia del barbero manda sobre la del servicio", async () => {
    const e = await escenario();
    await rpc(db, e.userId, "asignar_servicios_barbero", {
      p_barbero: e.camilo,
      p_servicios: [{ servicio_id: e.corte, duracion_propia: 60 }],
    });
    const r = await horas(e, { servicio: e.corte, barbero: e.camilo, desde: LUN });
    expect(r).toEqual([...MANANA_45, ...TARDE_45]); // con 60 min: última 12:00 y 18:00
    const h = await huecos(e, { servicio: e.corte, barbero: e.camilo, desde: LUN });
    expect(h[0]).toMatchObject({ hora: "2026-11-02 09:00", fin: "2026-11-02 10:00" });
  });

  it("no filtra servicios ni barberos de otra barbería", async () => {
    const a = await escenario();
    const b = await escenario();
    expect(await horas(a, { servicio: b.corte, barbero: a.camilo, desde: LUN })).toEqual([]);
    expect(await horas(a, { servicio: a.corte, barbero: b.camilo, desde: LUN })).toEqual([]);
  });
});

describe("varios días, carga y orden", () => {
  it("devuelve varios días en orden, cada uno con su horario", async () => {
    const e = await escenario();
    const r = await huecos(e, { servicio: e.corte, barbero: e.camilo, desde: LUN, hasta: MAR });
    expect(r).toHaveLength(36);
    expect(r[0].hora).toBe("2026-11-02 09:00");
    expect(r[18].hora).toBe("2026-11-03 09:00");
  });

  it("informa cuántas citas tiene ese día cada barbero (para repartir la carga)", async () => {
    const e = await escenario();
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "09:00") });
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "09:30") });
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(MAR, "09:00") }); // otro día: no cuenta
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "10:00"), estado: "cancelada" });
    const r = await huecos(e, { servicio: e.corte, desde: LUN });
    const camilo = r.find((h) => h.barbero_id === e.camilo)!;
    const dani = r.find((h) => h.barbero_id === e.dani)!;
    expect(camilo).toMatchObject({ carga_dia: 2, orden_barbero: 1 });
    expect(dani).toMatchObject({ carga_dia: 0, orden_barbero: 2 });
  });

  it("rechaza un rango al revés o de más de 62 días", async () => {
    const e = await escenario();
    await expect(huecos(e, { servicio: e.corte, desde: MAR, hasta: LUN })).rejects.toMatchObject({
      message: expect.stringContaining("rango"),
    });
    await expect(huecos(e, { servicio: e.corte, desde: LUN, hasta: "2027-03-01" })).rejects.toMatchObject({
      message: expect.stringContaining("rango"),
    });
  });
});

describe("la primera disponible (cualquier barbero)", () => {
  it("ofrece cada hora una sola vez, con el barbero que menos citas tiene ese día", async () => {
    const e = await escenario();
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "09:00") });
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "14:00") });
    const r = await cualquiera(e, { servicio: e.corte, desde: LUN });

    const horasOfrecidas = r.map((x) => x.hora);
    expect(new Set(horasOfrecidas).size).toBe(horasOfrecidas.length); // sin repetir

    const quien = (hora: string) => r.find((x) => x.hora === hora)?.barbero_id;
    expect(quien("09:30")).toBe(e.camilo); // solo él trabaja a esa hora (Dani entra a las 10:00)
    expect(quien("10:30")).toBe(e.dani); // los dos libres: Dani tiene 0 citas y Camilo 2
    expect(quien("12:30")).toBe(e.dani);
  });

  it("si empatan en carga, gana el de menor orden", async () => {
    const e = await escenario();
    const r = await cualquiera(e, { servicio: e.corte, desde: LUN });
    expect(r.find((x) => x.hora === "10:30")?.barbero_id).toBe(e.camilo);
  });

  it("une las horas de todos: las que solo uno tiene también salen", async () => {
    const e = await escenario();
    const horasUnidas = (await cualquiera(e, { servicio: e.corte, desde: LUN })).map((x) => x.hora);
    // Camilo: 9:00–12:30 y 14:00–18:30 (descansa a mediodía). Dani: 10:00–17:30 de corrido.
    // Unidas: las de Camilo, más 13:00 y 13:30, que solo tiene Dani.
    expect(horasUnidas).toEqual([...MANANA_30, "13:00", "13:30", ...TARDE_30]);
    const r = await cualquiera(e, { servicio: e.corte, desde: LUN });
    expect(r.find((x) => x.hora === "13:00")?.barbero_id).toBe(e.dani);
    expect(r.find((x) => x.hora === "09:00")?.barbero_id).toBe(e.camilo);
  });

  it("si el barbero elegido se ocupa, la hora sigue saliendo con el otro", async () => {
    const e = await escenario();
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "10:00") });
    const r = await cualquiera(e, { servicio: e.corte, desde: LUN });
    expect(r.find((x) => x.hora === "10:00")?.barbero_id).toBe(e.dani);
  });

  it("cuando ninguno tiene la hora, no sale", async () => {
    const e = await escenario();
    await cita(e, { barbero: e.camilo, servicio: e.corte, inicio: bog(LUN, "10:00") });
    await cita(e, { barbero: e.dani, servicio: e.corte, inicio: bog(LUN, "10:00") });
    const r = await cualquiera(e, { servicio: e.corte, desde: LUN });
    expect(r.map((x) => x.hora)).not.toContain("10:00");
  });
});

describe("seguridad", () => {
  it("las funciones de disponibilidad no las ejecuta la app directamente (son internas)", async () => {
    const { rows } = await db.query<{ nombre: string; autenticado: boolean; anon: boolean }>(
      `select p.proname as nombre,
              has_function_privilege('authenticated', p.oid, 'execute') as autenticado,
              has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('fn_huecos', 'fn_huecos_cualquiera')`
    );
    expect(rows.map((r) => r.nombre).sort()).toEqual(["fn_huecos", "fn_huecos_cualquiera"]);
    expect(rows.every((r) => !r.autenticado && !r.anon)).toBe(true);
  });
});
