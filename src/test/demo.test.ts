/**
 * Barbería de demo (tarea 4.1 · migración 0027, SPEC F12): datos ficticios RELATIVOS A HOY, siempre iguales, y reinicio
 * desde la app (solo el dueño, solo una demo, con PIN opcional).
 *
 * Las pruebas de contenido usan un instante fijo (`fn_cargar_datos_demo` recibe `p_ahora`); las que pasan por la API
 * (`reiniciar_demo`) usan el reloj real, así que no afirman nada que dependa de la hora del día.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { como, crearBarberia, crearBase, rpc } from "./base-datos";
import { crearEscenarioAgenda } from "./escenario";

/** Viernes 3:00 p. m. en Bogotá. */
const AHORA = "2030-03-08T20:00:00Z";
/** El mismo instante, una semana después (mismo día de la semana y misma hora). */
const AHORA_MAS_7 = "2030-03-15T20:00:00Z";
const HOY = "2030-03-08";

let db: PGlite;

beforeAll(async () => {
  db = await crearBase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

const filas = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const contar = async (sql: string, params: unknown[] = []) => Number((await filas<{ n: string | number }>(sql, params))[0].n);

let correos = 0;
/** Crea el usuario y le da de alta una demo cargada en el instante `ahora`. */
async function crearDemo(ahora?: string) {
  correos += 1;
  const correo = `demo-${correos}@ejemplo.test`;
  const u = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [correo]);
  const r = await db.query<{ data: { barberia_id: string; slug: string; enlace_reservas: string } }>(
    ahora
      ? `select public.fn_provisionar_demo($1, 'Barbería Demo', $2) as data`
      : `select public.fn_provisionar_demo($1, 'Barbería Demo') as data`,
    ahora ? [correo, ahora] : [correo]
  );
  const d = r.rows[0].data;
  return { userId: u.rows[0].id, correo, barberiaId: d.barberia_id, slug: d.slug, enlace: d.enlace_reservas };
}
const cargar = (barberiaId: string, ahora: string) => db.query(`select public.fn_cargar_datos_demo($1, $2)`, [barberiaId, ahora]);

/**
 * Todo el contenido de la demo, sin ids ni tokens, con los instantes medidos desde `ahora` y las fechas desde HOY:
 * dos cargas «iguales» tienen la misma huella. (Las claves de idempotencia y los ids son nuevos en cada carga.)
 */
async function huella(barberiaId: string, ahora: string) {
  const r = await db.query<{ h: unknown }>(
    `with p as (select $1::uuid as b, $2::timestamptz as ahora, public.fecha_bogota($2::timestamptz) as hoy)
     select jsonb_build_object(
       'servicios', (select jsonb_agg(jsonb_build_array(s.nombre, s.precio, s.duracion_min, s.activo) order by s.orden)
                       from public.servicios s, p where s.barberia_id = p.b),
       'barberos', (select jsonb_agg(jsonb_build_array(x.nombre, x.orden, x.activo, x.acepta_reservas) order by x.orden)
                      from public.barberos x, p where x.barberia_id = p.b),
       'asignaciones', (select jsonb_agg(jsonb_build_array(b.nombre, s.nombre, bs.precio_propio, bs.duracion_propia) order by b.orden, s.orden)
                          from public.barbero_servicios bs
                          join public.barberos b on b.id = bs.barbero_id
                          join public.servicios s on s.id = bs.servicio_id, p where bs.barberia_id = p.b),
       'horarios', (select jsonb_agg(jsonb_build_array(b.nombre, h.dia_semana, h.desde_min, h.hasta_min) order by b.orden, h.dia_semana, h.desde_min)
                      from public.horarios_barbero h join public.barberos b on b.id = h.barbero_id, p where h.barberia_id = p.b),
       'comisiones', (select jsonb_agg(jsonb_build_array(b.nombre, c.pct) order by b.orden)
                        from public.comisiones_barbero c join public.barberos b on b.id = c.barbero_id, p where c.barberia_id = p.b),
       'excepciones', (select jsonb_agg(jsonb_build_array(b.nombre, s.nombre, e.pct) order by b.orden, s.orden)
                         from public.comisiones_servicio e
                         join public.barberos b on b.id = e.barbero_id
                         join public.servicios s on s.id = e.servicio_id, p where e.barberia_id = p.b),
       'clientes', (select jsonb_agg(jsonb_build_array(c.nombre, c.telefono, c.nota) order by c.telefono)
                      from public.clientes c, p where c.barberia_id = p.b),
       'bloqueos', (select jsonb_agg(jsonb_build_array(b.nombre, extract(epoch from (l.inicio - p.ahora))::bigint,
                                                       extract(epoch from (l.fin - p.ahora))::bigint, l.motivo) order by l.inicio)
                      from public.bloqueos l join public.barberos b on b.id = l.barbero_id, p where l.barberia_id = p.b),
       'citas', (select jsonb_agg(jsonb_build_array(extract(epoch from (c.inicio - p.ahora))::bigint, b.nombre, cl.nombre, s.nombre,
                                                    c.estado, c.origen, c.precio, c.duracion_min, c.notas, c.cancelada_motivo,
                                                    c.recordatorio_enviado_at is not null, extract(epoch from (c.created_at - p.ahora))::bigint)
                                 order by c.inicio, b.orden)
                   from public.citas c
                   join public.barberos b on b.id = c.barbero_id
                   join public.clientes cl on cl.id = c.cliente_id
                   join public.servicios s on s.id = c.servicio_id, p where c.barberia_id = p.b),
       'cobros', (select jsonb_agg(jsonb_build_array(
                           extract(epoch from (k.created_at - p.ahora))::bigint, b.nombre, cl.nombre, k.cita_id is not null,
                           k.subtotal, k.descuento, k.descuento_motivo, k.total, k.propina, k.comision, k.propina_barbero,
                           k.anulado, k.anulado_motivo, k.fecha - p.hoy,
                           (select jsonb_agg(jsonb_build_array(i.tipo, i.nombre, i.precio, i.descuento, i.comision_pct, i.comision) order by i.orden)
                              from public.cobro_items i where i.cobro_id = k.id),
                           (select jsonb_agg(jsonb_build_array(x.medio, x.monto, x.recibido, x.vuelto, x.referencia) order by x.medio, x.monto)
                              from public.cobro_pagos x where x.cobro_id = k.id))
                         order by k.created_at, b.nombre, k.total, k.propina)
                    from public.cobros k
                    join public.barberos b on b.id = k.barbero_id
                    left join public.clientes cl on cl.id = k.cliente_id, p where k.barberia_id = p.b),
       'gastos', (select jsonb_agg(jsonb_build_array(extract(epoch from (g.created_at - p.ahora))::bigint, g.monto, g.categoria, g.medio,
                                                     g.nota, g.anulado, g.anulado_motivo, g.fecha - p.hoy)
                                  order by g.created_at, g.monto, g.nota)
                    from public.gastos g, p where g.barberia_id = p.b),
       'liquidaciones', (select jsonb_agg(jsonb_build_array(extract(epoch from (l.created_at - p.ahora))::bigint, b.nombre, l.hasta - p.hoy,
                                                            l.medio, l.cobros, l.comision, l.propina, l.total, l.nota, l.fecha - p.hoy)
                                         order by l.created_at, b.orden)
                           from public.liquidaciones l join public.barberos b on b.id = l.barbero_id, p where l.barberia_id = p.b),
       'cierres', (select jsonb_agg(jsonb_build_array(c.fecha - p.hoy, c.cobros, c.servicios, c.propinas, c.comisiones, c.propinas_barbero,
                                                      c.efectivo_cobros, c.transferencia_cobros, c.gastos, c.gastos_efectivo,
                                                      c.gastos_transferencia, c.liquidaciones_efectivo, c.liquidaciones_transferencia,
                                                      c.efectivo_esperado, c.efectivo_contado, c.diferencia, c.nota,
                                                      extract(epoch from (c.created_at - p.ahora))::bigint)
                                   order by c.fecha)
                     from public.cierres c, p where c.barberia_id = p.b)
     ) as h from p`,
    [barberiaId, ahora]
  );
  return r.rows[0].h as Record<string, unknown[] | null>;
}

describe("dar de alta la demo", () => {
  it("crea una barbería de demo para un usuario que ya existe, con su dueño y su enlace de reservas", async () => {
    const d = await crearDemo(AHORA);
    const b = (await filas<{ es_demo: boolean; nombre: string; reservas_en_linea: boolean }>(
      `select es_demo, nombre, reservas_en_linea from public.barberias where id = $1`,
      [d.barberiaId]
    ))[0];
    expect(b).toEqual({ es_demo: true, nombre: "Barbería Demo", reservas_en_linea: true });
    const perfiles = await filas<{ user_id: string; rol: string }>(`select user_id, rol from public.perfiles where barberia_id = $1`, [d.barberiaId]);
    expect(perfiles).toEqual([{ user_id: d.userId, rol: "dueno" }]);
    expect(d.enlace).toBe(`/reservar/${d.slug}`);
  });

  it("falla con un mensaje claro si el usuario no existe, si ya tiene una barbería de verdad o si el nombre no sirve", async () => {
    await expect(db.query(`select public.fn_provisionar_demo('nadie@ejemplo.test')`)).rejects.toThrow(/No existe el usuario nadie@ejemplo.test/);

    const real = await crearBarberia(db, "Barbería de verdad");
    await expect(db.query(`select public.fn_provisionar_demo($1)`, [real.correo])).rejects.toThrow(/ya tiene una barbería de verdad/);

    const u = await db.query<{ id: string }>(`insert into auth.users (email) values ('otro-demo@ejemplo.test') returning id`);
    expect(u.rows).toHaveLength(1);
    await expect(db.query(`select public.fn_provisionar_demo('otro-demo@ejemplo.test', '   ')`)).rejects.toThrow(/nombre de la barbería de demo/);
    await expect(db.query(`select public.fn_provisionar_demo('otro-demo@ejemplo.test', $1)`, ["x".repeat(61)])).rejects.toThrow(/máximo 60/);
  });

  it("se puede volver a correr: no duplica la barbería, solo recarga los datos de ejemplo", async () => {
    const d = await crearDemo(AHORA);
    const otra = await db.query<{ data: { barberia_id: string } }>(`select public.fn_provisionar_demo($1, 'Otro nombre', $2) as data`, [d.correo, AHORA]);
    expect(otra.rows[0].data.barberia_id).toBe(d.barberiaId);
    expect(await contar(`select count(*) as n from public.barberias where id = $1`, [d.barberiaId])).toBe(1);
    expect(await contar(`select count(*) as n from public.barberos where barberia_id = $1`, [d.barberiaId])).toBe(3);
    // El nombre que ya tenía se queda (renombrar no es parte de reprovisionar).
    expect((await filas<{ nombre: string }>(`select nombre from public.barberias where id = $1`, [d.barberiaId]))[0].nombre).toBe("Barbería Demo");
  });

  it("las funciones internas no las puede ejecutar nadie de la app", async () => {
    const d = await crearDemo(AHORA);
    for (const sql of [
      `select public.fn_cargar_datos_demo('${d.barberiaId}')`,
      `select public.fn_provisionar_demo('${d.correo}')`,
      `select public.fn_definir_pin_reinicio('1234')`,
      `select public.fn_demo_hash('x', 10)`,
    ]) {
      await expect(como(db, d.userId, sql)).rejects.toThrow(/permission denied/);
      await expect(como(db, null, sql)).rejects.toThrow(/permission denied/);
    }
  });
});

describe("los datos de ejemplo", () => {
  let d: Awaited<ReturnType<typeof crearDemo>>;

  beforeAll(async () => {
    d = await crearDemo(AHORA);
  }, 60_000);

  it("traen un catálogo, tres barberos con horario y comisión, y veinte clientes, todo inventado", async () => {
    const h = await huella(d.barberiaId, AHORA);
    expect(h.servicios).toHaveLength(8);
    expect((h.servicios as unknown[][]).filter((s) => s[3] === false)).toEqual([["Mascarilla facial", 12000, 20, false]]);
    expect((h.barberos as unknown[][]).map((b) => b[0])).toEqual(["Mateo Ríos", "Santiago Vargas", "Julián Cárdenas"]);
    expect(h.comisiones).toEqual([["Mateo Ríos", 60], ["Santiago Vargas", 50], ["Julián Cárdenas", 40]]);
    expect(h.excepciones).toEqual([["Mateo Ríos", "Tinte", 70]]);
    expect(h.clientes).toHaveLength(20);

    // Ningún celular ni WhatsApp real: todos en el rango inventado +57 300 000 10xx.
    const telefonos = (h.clientes as unknown[][]).map((c) => c[1] as string);
    for (const t of telefonos) expect(t).toMatch(/^\+57300000100\d$|^\+5730000010\d\d$/);
    const b = (await filas<{ whatsapp: string; direccion: string }>(`select whatsapp, direccion from public.barberias where id = $1`, [d.barberiaId]))[0];
    expect(b.whatsapp).toBe("+573000001000");

    // Julián no trabaja los lunes; los otros dos, todos los días.
    const dias = (nombre: string) => new Set((h.horarios as unknown[][]).filter((x) => x[0] === nombre).map((x) => x[1]));
    expect([...dias("Mateo Ríos")].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([...dias("Julián Cárdenas")].sort()).toEqual([2, 3, 4, 5, 6]);
  });

  it("el calendario va de hace 14 días a dentro de 7, sin nadie en dos citas a la vez y con todos los estados", async () => {
    const dias = await filas<{ d: number }>(
      `select distinct (public.fecha_bogota(c.inicio) - $2::date) as d from public.citas c where c.barberia_id = $1 order by 1`,
      [d.barberiaId, HOY]
    );
    expect(Math.min(...dias.map((x) => Number(x.d)))).toBe(-14);
    expect(Math.max(...dias.map((x) => Number(x.d)))).toBe(7);

    const estados = await filas<{ estado: string; n: string }>(
      `select estado, count(*) as n from public.citas where barberia_id = $1 group by estado`,
      [d.barberiaId]
    );
    expect(estados.map((e) => e.estado).sort()).toEqual(["atendida", "cancelada", "confirmada", "en_atencion", "no_asistio"].sort());
    const total = estados.reduce((s, e) => s + Number(e.n), 0);
    expect(total).toBeGreaterThan(250);

    // El estado sigue a la hora (la restricción de la tabla ya impide los cruces; aquí se mira que tenga sentido).
    expect(await contar(`select count(*) as n from public.citas where barberia_id = $1 and estado = 'confirmada' and fin <= $2::timestamptz`, [d.barberiaId, AHORA])).toBe(0);
    expect(await contar(`select count(*) as n from public.citas where barberia_id = $1 and estado in ('atendida', 'no_asistio', 'en_atencion') and inicio > $2::timestamptz`, [d.barberiaId, AHORA])).toBe(0);
    expect(await contar(`select count(*) as n from public.citas where barberia_id = $1 and estado = 'cancelada' and fin > $2::timestamptz`, [d.barberiaId, AHORA])).toBe(0);
    expect(await contar(`select count(*) as n from public.citas where barberia_id = $1 and inicio <= $2::timestamptz and fin > $2::timestamptz and estado <> 'en_atencion'`, [d.barberiaId, AHORA])).toBe(0);
    // Las canceladas dicen por qué y cuándo; las reservadas en línea ya traen su consentimiento y su aviso.
    expect(await contar(`select count(*) as n from public.citas where barberia_id = $1 and estado = 'cancelada' and (cancelada_motivo is null or cancelada_at is null)`, [d.barberiaId])).toBe(0);
    expect(await contar(`select count(*) as n from public.citas where barberia_id = $1 and origen = 'cliente' and (consentimiento_at is null or aviso_reserva_at is null)`, [d.barberiaId])).toBe(0);
    expect(await contar(`select count(*) as n from public.citas where barberia_id = $1 and origen = 'cliente'`, [d.barberiaId])).toBeGreaterThan(20);
  });

  it("nada se registra en el futuro y Julián no tiene citas el día del bloqueo", async () => {
    for (const [tabla, columna] of [["citas", "created_at"], ["cobros", "created_at"], ["gastos", "created_at"], ["liquidaciones", "created_at"], ["cierres", "created_at"]]) {
      expect(await contar(`select count(*) as n from public.${tabla} where barberia_id = $1 and ${columna} > $2::timestamptz`, [d.barberiaId, AHORA]), tabla).toBe(0);
    }
    const bloqueo = (await filas<{ inicio: Date; fin: Date; barbero_id: string }>(`select inicio, fin, barbero_id from public.bloqueos where barberia_id = $1`, [d.barberiaId]))[0];
    expect(await contar(`select count(*) as n from public.citas where barbero_id = $1 and inicio < $3 and fin > $2`, [bloqueo.barbero_id, bloqueo.inicio, bloqueo.fin])).toBe(0);
  });

  it("cada cobro cuadra al peso: líneas, descuento, comisión por línea y pagos", async () => {
    const malos = await filas<{ id: string }>(
      `select k.id from public.cobros k
        where k.barberia_id = $1 and (
              k.subtotal <> (select sum(i.precio) from public.cobro_items i where i.cobro_id = k.id)
           or k.descuento <> (select sum(i.descuento) from public.cobro_items i where i.cobro_id = k.id)
           or k.comision <> (select sum(i.comision) from public.cobro_items i where i.cobro_id = k.id)
           or k.total + k.propina <> (select sum(x.monto) from public.cobro_pagos x where x.cobro_id = k.id)
           or exists (select 1 from public.cobro_items i
                       where i.cobro_id = k.id and i.comision <> (i.precio - i.descuento) * i.comision_pct / 100))`,
      [d.barberiaId]
    );
    expect(malos).toEqual([]);
    expect(await contar(`select count(*) as n from public.cobros where barberia_id = $1`, [d.barberiaId])).toBeGreaterThan(200);

    // Hay de todo: efectivo con vuelto, Nequi, pagos mixtos, extras, descuentos con motivo y propinas.
    expect(await contar(`select count(*) as n from public.cobro_pagos where barberia_id = $1 and medio = 'efectivo' and vuelto > 0`, [d.barberiaId])).toBeGreaterThan(5);
    expect(await contar(`select count(*) as n from public.cobro_pagos where barberia_id = $1 and medio = 'transferencia'`, [d.barberiaId])).toBeGreaterThan(5);
    expect(await contar(`select count(*) as n from (select cobro_id from public.cobro_pagos where barberia_id = $1 group by cobro_id having count(*) > 1) t`, [d.barberiaId])).toBeGreaterThan(0);
    expect(await contar(`select count(*) as n from public.cobro_items where barberia_id = $1 and tipo = 'extra'`, [d.barberiaId])).toBeGreaterThan(5);
    expect(await contar(`select count(*) as n from public.cobros where barberia_id = $1 and descuento > 0 and descuento_motivo is not null`, [d.barberiaId])).toBeGreaterThan(0);
    expect(await contar(`select count(*) as n from public.cobros where barberia_id = $1 and propina > 0`, [d.barberiaId])).toBeGreaterThan(20);

    // La comisión usa los porcentajes de cada barbero (Mateo 60 %, Santiago 50 %, Julián 40 %).
    const pcts = await filas<{ barbero: string; pcts: number[] }>(
      `select b.nombre as barbero, array_agg(distinct i.comision_pct order by i.comision_pct) as pcts
         from public.cobro_items i join public.cobros k on k.id = i.cobro_id join public.barberos b on b.id = k.barbero_id
        where i.barberia_id = $1 group by b.nombre`,
      [d.barberiaId]
    );
    const porBarbero = Object.fromEntries(pcts.map((p) => [p.barbero, p.pcts]));
    expect(porBarbero["Santiago Vargas"]).toEqual([50]);
    expect(porBarbero["Julián Cárdenas"]).toEqual([40]);
    expect(porBarbero["Mateo Ríos"]).toEqual(expect.arrayContaining([60]));
  });

  it("cada cita cobrada está atendida; quedan dos atendidas sin cobrar en días pasados (una ayer) y un cobro y un gasto anulados", async () => {
    expect(await contar(`select count(*) as n from public.cobros k join public.citas c on c.id = k.cita_id where k.barberia_id = $1 and c.estado <> 'atendida'`, [d.barberiaId])).toBe(0);
    const sinCobro = await filas<{ dia: number }>(
      `select (public.fecha_bogota(c.inicio) - $2::date) as dia from public.citas c
        where c.barberia_id = $1 and c.estado = 'atendida' and public.fecha_bogota(c.inicio) < $2::date
          and not exists (select 1 from public.cobros k where k.cita_id = c.id and not k.anulado)
        order by 1`,
      [d.barberiaId, HOY]
    );
    expect(sinCobro.map((x) => Number(x.dia))).toEqual([-3, -1]);

    const anulados = await filas<{ cobros: string; gastos: string }>(
      `select (select count(*) from public.cobros where barberia_id = $1 and anulado) as cobros,
              (select count(*) from public.gastos where barberia_id = $1 and anulado) as gastos`,
      [d.barberiaId]
    );
    expect(Number(anulados[0].cobros)).toBe(1);
    expect(Number(anulados[0].gastos)).toBe(1);
    expect(await contar(`select count(*) as n from public.cobros where barberia_id = $1 and anulado and (anulado_motivo is null or anulado_at is null)`, [d.barberiaId])).toBe(0);
    // Los gastos traen de todo: arriendo, servicios públicos, insumos y otros.
    const categorias = await filas<{ categoria: string }>(`select distinct categoria from public.gastos where barberia_id = $1 and not anulado order by 1`, [d.barberiaId]);
    expect(categorias.map((c) => c.categoria)).toEqual(["arriendo", "insumos", "otros", "servicios_publicos"]);
  });

  it("los barberos cobran hasta hace ocho días y lo demás queda pendiente; cada pago suma exactamente sus cobros", async () => {
    const liqs = await filas<{ id: string; barbero: string; hasta: string; total: number; comision: number; propina: number; cobros: number; medio: string }>(
      `select l.id, b.nombre as barbero, to_char(l.hasta, 'YYYY-MM-DD') as hasta, l.total, l.comision, l.propina, l.cobros, l.medio
         from public.liquidaciones l join public.barberos b on b.id = l.barbero_id where l.barberia_id = $1 order by b.orden`,
      [d.barberiaId]
    );
    expect(liqs.map((l) => l.barbero)).toEqual(["Mateo Ríos", "Santiago Vargas", "Julián Cárdenas"]);
    for (const l of liqs) {
      expect(l.hasta).toBe("2030-02-28");
      const suma = (await filas<{ cobros: string; com: string; prop: string; fuera: string }>(
        `select count(*) as cobros, sum(lc.comision) as com, sum(lc.propina_barbero) as prop,
                count(*) filter (where k.fecha > $2::date or k.anulado) as fuera
           from public.liquidacion_cobros lc join public.cobros k on k.id = lc.cobro_id where lc.liquidacion_id = $1 and lc.vigente`,
        [l.id, l.hasta]
      ))[0];
      expect(Number(suma.cobros)).toBe(l.cobros);
      expect(Number(suma.com)).toBe(l.comision);
      expect(Number(suma.prop)).toBe(l.propina);
      expect(Number(suma.fuera)).toBe(0);
      expect(l.total).toBe(l.comision + l.propina);
    }
    // Lo de los últimos 7 días sigue pendiente: Comisiones tiene qué pagar a cada barbero.
    const resumen = await rpc<{ barberos: { nombre: string; pendiente: number; pendiente_cobros: number }[] }>(db, d.userId, "obtener_resumen_comisiones", {
      p_desde: "2030-03-02",
      p_hasta: HOY,
    });
    expect(resumen.barberos.map((b) => b.nombre)).toEqual(["Mateo Ríos", "Santiago Vargas", "Julián Cárdenas"]);
    for (const b of resumen.barberos) {
      expect(b.pendiente, b.nombre).toBeGreaterThan(0);
      expect(b.pendiente_cobros, b.nombre).toBeGreaterThan(0);
    }
  });

  it("los días con movimiento hasta anteayer están cerrados con las cifras de su día; ayer y hoy quedan abiertos", async () => {
    const cierres = await filas<{ fecha: string }>(`select to_char(fecha, 'YYYY-MM-DD') as fecha from public.cierres where barberia_id = $1 order by fecha`, [d.barberiaId]);
    expect(cierres).toHaveLength(13);
    expect(cierres[0].fecha).toBe("2030-02-22");
    expect(cierres[12].fecha).toBe("2030-03-06");

    // Lo guardado en cada cierre es lo mismo que dan hoy las cifras de ese día: nada quedó movido.
    const campos = ["cobros", "servicios", "propinas", "comisiones", "propinas_barbero", "efectivo_cobros", "transferencia_cobros", "gastos",
      "gastos_efectivo", "gastos_transferencia", "liquidaciones_efectivo", "liquidaciones_transferencia", "efectivo_esperado"] as const;
    const guardados = await filas<Record<string, unknown>>(`select to_char(fecha, 'YYYY-MM-DD') as f, * from public.cierres where barberia_id = $1`, [d.barberiaId]);
    for (const c of guardados) {
      const ahora = (await filas<{ r: Record<string, number> }>(`select public.fn_resumen_dia($1, $2::date) as r`, [d.barberiaId, c.f]))[0].r;
      for (const campo of campos) expect(Number(c[campo]), `${c.f} ${campo}`).toBe(ahora[campo]);
      expect(Number(c.diferencia)).toBe(Number(c.efectivo_contado) - Number(c.efectivo_esperado));
    }
    // Hay días que cuadran y días con una diferencia pequeña.
    expect(guardados.filter((c) => Number(c.diferencia) === 0).length).toBeGreaterThan(5);
    expect(guardados.filter((c) => Number(c.diferencia) !== 0).length).toBeGreaterThan(0);
    expect(guardados.every((c) => Number(c.efectivo_contado) >= 0)).toBe(true);

    // Ayer y hoy tienen movimiento y no están cerrados.
    for (const f of ["2030-03-07", HOY]) {
      expect(await contar(`select count(*) as n from public.cobros where barberia_id = $1 and fecha = $2::date and not anulado`, [d.barberiaId, f]), f).toBeGreaterThan(0);
      expect(await contar(`select count(*) as n from public.cierres where barberia_id = $1 and fecha = $2::date`, [d.barberiaId, f]), f).toBe(0);
    }
    // El efectivo esperado de un día nunca es negativo con estos datos.
    expect(guardados.every((c) => Number(c.efectivo_esperado) >= 0)).toBe(true);
  });

  it("hoy hay citas hechas, una en atención o por venir, y algo que cobrar", async () => {
    const hoy = await filas<{ estado: string; cobrada: boolean }>(
      `select c.estado, exists (select 1 from public.cobros k where k.cita_id = c.id and not k.anulado) as cobrada
         from public.citas c where c.barberia_id = $1 and public.fecha_bogota(c.inicio) = $2::date`,
      [d.barberiaId, HOY]
    );
    expect(hoy.length).toBeGreaterThan(10);
    expect(hoy.filter((c) => c.estado === "atendida" && c.cobrada).length).toBeGreaterThan(0);
    expect(hoy.filter((c) => c.estado === "confirmada").length).toBeGreaterThan(0);
  });
});

describe("dos reinicios dan lo mismo", () => {
  it("cargar dos veces en el mismo instante deja exactamente el mismo contenido (los ids cambian, nada más)", async () => {
    const d = await crearDemo(AHORA);
    const primera = await huella(d.barberiaId, AHORA);
    await cargar(d.barberiaId, AHORA);
    const segunda = await huella(d.barberiaId, AHORA);
    expect(segunda).toEqual(primera);
    // …y de verdad se recreó: los ids son otros.
    expect(await contar(`select count(*) as n from public.clientes where barberia_id = $1`, [d.barberiaId])).toBe(20);
  }, 60_000);

  it("la demo es relativa a hoy: una semana después, el mismo día de la semana y la misma hora, queda igual medida desde hoy", async () => {
    const d = await crearDemo(AHORA);
    const antes = await huella(d.barberiaId, AHORA);
    await cargar(d.barberiaId, AHORA_MAS_7);
    const despues = await huella(d.barberiaId, AHORA_MAS_7);
    expect(despues).toEqual(antes);
    // Y las fechas absolutas sí se movieron.
    const primera = (await filas<{ f: string }>(`select to_char(min(public.fecha_bogota(inicio)), 'YYYY-MM-DD') as f from public.citas where barberia_id = $1`, [d.barberiaId]))[0].f;
    expect(primera).toBe("2030-03-01");
  }, 60_000);

  it("un día distinto de la semana arma otro calendario, pero igual de completo (nunca vacío)", async () => {
    const d = await crearDemo(AHORA);
    for (const ahora of ["2030-03-10T17:00:00Z", "2030-03-11T14:30:00Z", "2030-03-13T23:30:00Z"]) {
      await cargar(d.barberiaId, ahora);
      expect(await contar(`select count(*) as n from public.citas where barberia_id = $1`, [d.barberiaId]), ahora).toBeGreaterThan(250);
      expect(await contar(`select count(*) as n from public.cobros where barberia_id = $1`, [d.barberiaId]), ahora).toBeGreaterThan(200);
      expect(await contar(`select count(*) as n from public.cierres where barberia_id = $1`, [d.barberiaId]), ahora).toBe(13);
      expect(await contar(`select count(*) as n from public.liquidaciones where barberia_id = $1`, [d.barberiaId]), ahora).toBe(3);
      // Siempre hay con qué mostrar «Caja»: las dos atendidas de días pasados sin cobrar.
      const sinCobro = await contar(
        `select count(*) as n from public.citas c where c.barberia_id = $1 and c.estado = 'atendida' and c.inicio < $2::timestamptz - interval '1 day'
            and not exists (select 1 from public.cobros k where k.cita_id = c.id and not k.anulado)`,
        [d.barberiaId, ahora]
      );
      expect(sinCobro, ahora).toBeGreaterThanOrEqual(1);
    }
  }, 120_000);

  it("al terminar queda cerrada la puerta del borrado: la excepción de la demo no se queda abierta", async () => {
    const d = await crearDemo(AHORA);
    await expect(db.query(`delete from public.servicios where barberia_id = $1`, [d.barberiaId])).rejects.toThrow(/No se puede borrar/);
    await expect(db.query(`delete from public.cobros where barberia_id = $1`, [d.barberiaId])).rejects.toThrow(/No se puede borrar/);
  });

  it("no se puede cargar en una barbería de verdad", async () => {
    const real = await crearBarberia(db, "Barbería de verdad 2");
    await expect(cargar(real.barberiaId, AHORA)).rejects.toThrow(/Solo la demo se puede reiniciar/);
  });
});

describe("reiniciar la demo desde la app", () => {
  let d: Awaited<ReturnType<typeof crearDemo>>;
  const reiniciar = (pin?: string | null, actor: string | null = d.userId) => rpc<{ ok: boolean; motivo?: string; intentos_restantes?: number; minutos?: number }>(db, actor, "reiniciar_demo", pin === undefined ? {} : { p_pin: pin });

  beforeAll(async () => {
    d = await crearDemo(); // con el reloj real
  }, 60_000);

  it("el dueño reinicia: lo que se hizo en la demo desaparece y vuelve el catálogo de ejemplo", async () => {
    // Una visita juega con la demo: crea un servicio, cobra, registra un gasto y suma a alguien del equipo.
    const servicio = (await rpc<{ id: string }>(db, d.userId, "crear_servicio", { p_nombre: "Cera especial", p_precio: 9000, p_duracion_min: 15 })).id;
    const barbero = (await filas<{ id: string }>(`select id from public.barberos where barberia_id = $1 and nombre = 'Santiago Vargas'`, [d.barberiaId]))[0].id;
    const cobro = (await rpc<{ id: string }>(db, d.userId, "cobrar_venta", {
      p_barbero: barbero, p_clave: randomUUID(), p_items: [{ nombre: "Gel", precio: 10000 }], p_pagos: [{ medio: "efectivo", monto: 10000 }],
    })).id;
    const gasto = (await rpc<{ id: string }>(db, d.userId, "registrar_gasto", { p_clave: randomUUID(), p_monto: 3333, p_categoria: "otros", p_medio: "efectivo" })).id;
    const rolBarbero = (await filas<{ id: string }>(`select id from public.roles_equipo where barberia_id = $1 and nombre = 'Barbero'`, [d.barberiaId]))[0].id;
    const inv = await rpc<{ codigo: string }>(db, d.userId, "crear_invitacion", { p_nombre: "Visita", p_roles: [rolBarbero] });
    const celular = (await db.query<{ id: string }>(`insert into auth.users (email) values (null) returning id`)).rows[0].id;
    await rpc(db, celular, "canjear_invitacion", { p_codigo: inv.codigo });
    expect(await contar(`select count(*) as n from public.perfiles where barberia_id = $1`, [d.barberiaId])).toBe(2);

    expect(await reiniciar()).toEqual({ ok: true });

    expect(await contar(`select count(*) as n from public.servicios where id = $1`, [servicio])).toBe(0);
    expect(await contar(`select count(*) as n from public.cobros where id = $1`, [cobro])).toBe(0);
    expect(await contar(`select count(*) as n from public.gastos where id = $1`, [gasto])).toBe(0);
    expect(await contar(`select count(*) as n from public.invitaciones where barberia_id = $1`, [d.barberiaId])).toBe(0);
    // Quien entró con un código se fue; el dueño sigue con su cuenta.
    const perfiles = await filas<{ user_id: string; rol: string }>(`select user_id, rol from public.perfiles where barberia_id = $1`, [d.barberiaId]);
    expect(perfiles).toEqual([{ user_id: d.userId, rol: "dueno" }]);
    // Y el dueño lo ve todo desde la app: el catálogo de ejemplo.
    const catalogo = await rpc<{ nombre: string }[]>(db, d.userId, "listar_servicios");
    expect(catalogo.map((s) => s.nombre)).toEqual(["Corte clásico", "Degradé", "Barba", "Corte y barba", "Corte niño", "Cejas", "Tinte"]);
  }, 60_000);

  it("dos reinicios seguidos dejan lo mismo en todo lo que no es de hoy (los días pasados no se mueven)", async () => {
    // Medido desde el mismo «hoy» (la fecha de Bogotá de ahora): los instantes pasados no dependen de la hora del reinicio.
    const hoy = (await filas<{ h: string }>(`select to_char(public.hoy_bogota(), 'YYYY-MM-DD') as h`))[0].h;
    const ancla = `${hoy}T05:00:00Z`; // medianoche en Bogotá (UTC−5)
    const pasado = async () => {
      const h = await huella(d.barberiaId, ancla);
      // Solo lo anterior a hoy: lo de hoy depende de la hora a la que se reinicia.
      const antes = (xs: unknown[] | null, pos: number) => (xs ?? []).filter((x) => Number((x as unknown[])[pos]) < 0);
      return {
        catalogo: [h.servicios, h.barberos, h.asignaciones, h.horarios, h.comisiones, h.excepciones, h.clientes],
        citas: antes(h.citas, 0),
        cobros: antes(h.cobros, 0),
        gastos: antes(h.gastos, 0),
        liquidaciones: antes(h.liquidaciones, 0),
        cierres: h.cierres,
      };
    };
    expect(await reiniciar()).toEqual({ ok: true });
    const uno = await pasado();
    expect(await reiniciar()).toEqual({ ok: true });
    expect(await pasado()).toEqual(uno);
    expect(uno.citas.length).toBeGreaterThan(150);
  }, 120_000);

  it("la demo trae lo que la pantalla de Cierre y la Caja necesitan mostrar, sin depender de la hora", async () => {
    const dia = await rpc<{ sin_cerrar: string[]; sin_cobrar: number; jornada: string }>(db, d.userId, "obtener_cierre");
    const ayer = (await filas<{ a: string }>(`select to_char($1::date - 1, 'YYYY-MM-DD') as a`, [dia.jornada]))[0].a;
    expect(dia.sin_cerrar).toContain(ayer);
    const diaAyer = await rpc<{ sin_cobrar: number; cierre: unknown }>(db, d.userId, "obtener_cierre", { p_fecha: ayer });
    expect(diaAyer.cierre).toBeNull();
    expect(diaAyer.sin_cobrar).toBe(1);

    const caja = await rpc<{ atrasadas: unknown[]; cobros: unknown[]; totales: { cobros: number } }>(db, d.userId, "obtener_caja");
    expect(caja.atrasadas).toHaveLength(2);
  });

  it("solo el dueño, solo una demo y solo con sesión", async () => {
    // Una persona del equipo (no dueño) de la demo.
    const rolBarbero = (await filas<{ id: string }>(`select id from public.roles_equipo where barberia_id = $1 and nombre = 'Barbero'`, [d.barberiaId]))[0].id;
    const inv = await rpc<{ codigo: string }>(db, d.userId, "crear_invitacion", { p_nombre: "Pedro", p_roles: [rolBarbero] });
    const celular = (await db.query<{ id: string }>(`insert into auth.users (email) values (null) returning id`)).rows[0].id;
    await rpc(db, celular, "canjear_invitacion", { p_codigo: inv.codigo });
    await expect(reiniciar(undefined, celular)).rejects.toThrow(/Solo el dueño/);
    await expect(reiniciar(undefined, null)).rejects.toThrow(/permission denied/);

    // El dueño de una barbería de verdad.
    const real = await crearBarberia(db, "Barbería real 3");
    await expect(reiniciar(undefined, real.userId)).rejects.toThrow(/Solo la demo se puede reiniciar/);
    // Alguien sin barbería.
    const huerfano = (await db.query<{ id: string }>(`insert into auth.users (email) values (null) returning id`)).rows[0].id;
    await expect(reiniciar(undefined, huerfano)).rejects.toThrow(/no tiene una barbería/);
    // El del equipo sigue ahí (no se reinició nada): lo borra el próximo reinicio del dueño.
    expect(await contar(`select count(*) as n from public.perfiles where barberia_id = $1`, [d.barberiaId])).toBe(2);
  }, 60_000);

  it("reiniciar una demo no toca otras barberías", async () => {
    const otra = await crearEscenarioAgenda(db);
    const cuenta = async () =>
      Object.fromEntries(await Promise.all(["servicios", "barberos", "horarios_barbero", "clientes", "perfiles", "roles_equipo"].map(async (t) => [t, await contar(`select count(*) as n from public.${t} where barberia_id = $1`, [otra.barberiaId])])));
    const antes = await cuenta();
    expect(await reiniciar()).toEqual({ ok: true });
    expect(await cuenta()).toEqual(antes);
  }, 60_000);

  it("está abierta a quien tiene sesión y cerrada a quien no", async () => {
    const r = await filas<{ auth: boolean; anon: boolean }>(
      `select has_function_privilege('authenticated', 'public.reiniciar_demo(text)', 'execute') as auth,
              has_function_privilege('anon', 'public.reiniciar_demo(text)', 'execute') as anon`
    );
    expect(r[0]).toEqual({ auth: true, anon: false });
  });
});

describe("PIN para reiniciar", () => {
  let d: Awaited<ReturnType<typeof crearDemo>>;
  const reiniciar = (pin?: string | null) => rpc<{ ok: boolean; motivo?: string; intentos_restantes?: number; minutos?: number }>(db, d.userId, "reiniciar_demo", pin === undefined ? {} : { p_pin: pin });
  const contexto = () => rpc<{ barberia: { es_demo: boolean; reinicio_con_pin: boolean } }>(db, d.userId, "obtener_contexto");
  const sentinela = async () => contar(`select count(*) as n from public.clientes where barberia_id = $1 and nombre = 'Cliente de prueba'`, [d.barberiaId]);

  beforeAll(async () => {
    d = await crearDemo(AHORA);
  }, 60_000);

  it("sin PIN definido no pide nada, y la app sabe que no lo necesita", async () => {
    expect((await contexto()).barberia).toMatchObject({ es_demo: true, reinicio_con_pin: false });
  });

  it("solo quien administra la base define el PIN, de 4 a 8 dígitos, y la app solo se entera de que existe", async () => {
    await expect(db.query(`select public.fn_definir_pin_reinicio('12')`)).rejects.toThrow(/entre 4 y 8 dígitos/);
    await expect(db.query(`select public.fn_definir_pin_reinicio('12ab56')`)).rejects.toThrow(/entre 4 y 8 dígitos/);
    const n = await db.query<{ n: number }>(`select public.fn_definir_pin_reinicio('4821', $1) as n`, [d.barberiaId]);
    expect(n.rows[0].n).toBe(1);
    expect((await contexto()).barberia.reinicio_con_pin).toBe(true);
    // Nadie lee la tabla del PIN, ni siquiera el dueño.
    await expect(como(db, d.userId, `select * from public.pines_reinicio`)).rejects.toThrow(/permission denied/);
    const guardado = (await filas<{ hash: string }>(`select hash from public.pines_reinicio where barberia_id = $1`, [d.barberiaId]))[0].hash;
    expect(guardado).not.toContain("4821");
  });

  it("sin el PIN, o con uno malo, no se reinicia y los datos quedan como estaban", async () => {
    await db.query(`insert into public.clientes (barberia_id, nombre) values ($1, 'Cliente de prueba')`, [d.barberiaId]);
    expect(await sentinela()).toBe(1);
    expect(await reiniciar()).toEqual({ ok: false, motivo: "pin", intentos_restantes: 4 });
    expect(await reiniciar("0000")).toEqual({ ok: false, motivo: "pin", intentos_restantes: 3 });
    expect(await reiniciar("48210")).toEqual({ ok: false, motivo: "pin", intentos_restantes: 2 });
    expect(await sentinela()).toBe(1);
  });

  it("el PIN correcto reinicia y reinicia también el conteo de intentos", async () => {
    expect(await reiniciar(" 4821 ")).toEqual({ ok: true });
    expect(await sentinela()).toBe(0);
    expect((await filas<{ intentos: number }>(`select intentos from public.pines_reinicio where barberia_id = $1`, [d.barberiaId]))[0].intentos).toBe(0);
  }, 60_000);

  it("a los cinco fallos se bloquea cinco minutos, incluso con el PIN bueno, y después vuelve a servir", async () => {
    for (const esperado of [4, 3, 2, 1]) {
      expect(await reiniciar("1111")).toEqual({ ok: false, motivo: "pin", intentos_restantes: esperado });
    }
    expect(await reiniciar("1111")).toEqual({ ok: false, motivo: "bloqueado", minutos: 5 });
    const seguido = await reiniciar("4821");
    expect(seguido.ok).toBe(false);
    expect(seguido.motivo).toBe("bloqueado");
    expect(seguido.minutos).toBeGreaterThanOrEqual(1);
    expect(seguido.minutos).toBeLessThanOrEqual(5);

    // Pasan los cinco minutos.
    await db.query(`update public.pines_reinicio set bloqueado_hasta = now() - interval '1 minute' where barberia_id = $1`, [d.barberiaId]);
    expect(await reiniciar("4821")).toEqual({ ok: true });
  }, 60_000);

  it("quitar el PIN deja reiniciar sin pedir nada, y un reinicio no borra el PIN", async () => {
    // Un reinicio no toca el PIN.
    expect((await contexto()).barberia.reinicio_con_pin).toBe(true);
    await db.query(`select public.fn_definir_pin_reinicio(null, $1)`, [d.barberiaId]);
    expect((await contexto()).barberia.reinicio_con_pin).toBe(false);
    expect(await contar(`select count(*) as n from public.pines_reinicio where barberia_id = $1`, [d.barberiaId])).toBe(0);
    expect(await reiniciar()).toEqual({ ok: true });
  }, 60_000);

  it("sin barbería indicada, el PIN se pone a todas las demos y a ninguna barbería de verdad", async () => {
    const real = await crearBarberia(db, "Barbería real 4");
    await db.query(`select public.fn_definir_pin_reinicio('9753')`);
    expect((await filas<{ c: boolean }>(`select reinicio_con_pin as c from public.barberias where id = $1`, [real.barberiaId]))[0].c).toBe(false);
    expect(await contar(`select count(*) as n from public.pines_reinicio where barberia_id = $1`, [real.barberiaId])).toBe(0);
    expect((await contexto()).barberia.reinicio_con_pin).toBe(true);
    await db.query(`select public.fn_definir_pin_reinicio(null)`);
  });
});
