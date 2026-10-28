/**
 * Gastos (tarea 3.6 · migración 0024, SPEC F8): registrar con categoría y medio, foto privada, anular con motivo,
 * los totales del día y los permisos (también los del bucket de fotos).
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATEGORIAS_GASTO, GASTO_MAXIMO } from "@/lib/gastos";
import { como, crearMiembro, crearRol, rpc } from "./base-datos";
import { crearEscenarioAgenda, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  const { crearBase } = await import("./base-datos");
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

type Gastado = { ok: boolean; ya_existia: boolean; id: string; monto: number; categoria: string; medio: string; fecha: string; con_foto: boolean; anulado: boolean };
type Dia = {
  fecha: string;
  totales: { gastos: number; total: number; efectivo: number; transferencia: number };
  por_categoria: { categoria: string; total: number; gastos: number }[];
  gastos: { id: string; monto: number; categoria: string; medio: string; nota: string | null; con_foto: boolean; anulado: boolean; anulado_motivo: string | null }[];
};
type Args = Record<string, unknown>;

const filas = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

const registrar = (actor: string | null, args: Args = {}) =>
  rpc<Gastado>(db, actor, "registrar_gasto", { p_clave: randomUUID(), p_monto: 45000, p_categoria: "insumos", p_medio: "efectivo", ...args });

const anular = (actor: string | null, id: string, motivo: string | null = "Se registró dos veces") =>
  rpc<{ ok: boolean; id: string }>(db, actor, "anular_gasto", { p_id: id, p_motivo: motivo });

const dia = (actor: string | null, fecha?: string) => rpc<Dia>(db, actor, "obtener_gastos", fecha ? { p_fecha: fecha } : {});
const enDia = (id: string, fecha: string) => db.query(`update public.gastos set fecha = $2 where id = $1`, [id, fecha]);

const rutaDe = (e: EscenarioAgenda, nombre = randomUUID(), ext = "jpg") => `${e.barberiaId}/${nombre}.${ext}`;

describe("registrar_gasto", () => {
  it("registra el gasto con su categoría y medio, y deja quién lo registró y cuándo", async () => {
    const e = await crearEscenarioAgenda(db);
    const r = await registrar(e.recepcion, { p_monto: 120000, p_categoria: "arriendo", p_medio: "transferencia", p_nota: "  Arriendo   de octubre " });
    expect(r).toMatchObject({ ok: true, ya_existia: false, monto: 120000, categoria: "arriendo", medio: "transferencia", con_foto: false, anulado: false });

    const [g] = await filas<{ nota: string; registrado_por: string; created_at: Date; fecha: Date; foto_ruta: string | null; anulado: boolean }>(
      `select nota, registrado_por, created_at, fecha, foto_ruta, anulado from public.gastos where id = $1`,
      [r.id]
    );
    expect(g).toMatchObject({ nota: "Arriendo de octubre", registrado_por: e.recepcion, foto_ruta: null, anulado: false });
    const [hoy] = await filas<{ hoy: Date }>(`select public.hoy_bogota() as hoy`);
    expect(g.fecha).toEqual(hoy.hoy);
    expect(g.created_at).toBeInstanceOf(Date);
  });

  it("acepta las cinco categorías (las mismas de TypeScript) y ninguna otra", async () => {
    const e = await crearEscenarioAgenda(db);
    expect((await filas<{ c: string[] }>(`select public.fn_categorias_gasto() as c`))[0].c).toEqual([...CATEGORIAS_GASTO]);
    for (const categoria of CATEGORIAS_GASTO) {
      expect(await registrar(e.userId, { p_categoria: categoria })).toMatchObject({ ok: true, categoria });
    }
    for (const mala of ["luz", "ARRIENDO", "", "nomina"]) {
      await expect(registrar(e.userId, { p_categoria: mala })).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("categoría") });
    }
    await expect(registrar(e.userId, { p_categoria: null })).rejects.toMatchObject({ message: expect.stringContaining("categoría") });
  });

  it("el monto va de $ 1 al tope, en pesos enteros", async () => {
    const e = await crearEscenarioAgenda(db);
    expect((await registrar(e.userId, { p_monto: 1 })).monto).toBe(1);
    expect((await registrar(e.userId, { p_monto: GASTO_MAXIMO })).monto).toBe(GASTO_MAXIMO);
    for (const malo of [0, -1, GASTO_MAXIMO + 1, null]) {
      await expect(registrar(e.userId, { p_monto: malo })).rejects.toMatchObject({
        code: "P0001",
        message: "El gasto debe ser de $ 1 a $ 50.000.000.",
      });
    }
  });

  it("el medio es efectivo o transferencia", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const malo of ["fiado", "", null]) {
      await expect(registrar(e.userId, { p_medio: malo })).rejects.toMatchObject({ message: expect.stringContaining("efectivo o transferencia") });
    }
  });

  it("la nota se limpia, se recorta a 120 letras y vacía queda sin nota", async () => {
    const e = await crearEscenarioAgenda(db);
    const larga = await registrar(e.userId, { p_nota: "x".repeat(200) });
    const vacia = await registrar(e.userId, { p_nota: "   " });
    const notas = await filas<{ id: string; nota: string | null }>(`select id, nota from public.gastos where id = any($1)`, [[larga.id, vacia.id]]);
    expect(notas.find((n) => n.id === larga.id)!.nota).toHaveLength(120);
    expect(notas.find((n) => n.id === vacia.id)!.nota).toBeNull();
  });

  it("repetir la clave devuelve el mismo gasto, sin duplicarlo", async () => {
    const e = await crearEscenarioAgenda(db);
    const clave = randomUUID();
    const a = await registrar(e.userId, { p_clave: clave });
    const b = await registrar(e.userId, { p_clave: clave, p_monto: 99999 });
    expect(a.ya_existia).toBe(false);
    expect(b).toMatchObject({ ya_existia: true, id: a.id, monto: 45000 });
    expect((await filas(`select 1 from public.gastos where barberia_id = $1`, [e.barberiaId])).length).toBe(1);
    await expect(registrar(e.userId, { p_clave: null })).rejects.toMatchObject({ message: expect.stringContaining("Falta la clave") });
  });

  it("repetir la clave de un gasto anulado avisa que se anuló y no lo da por hecho", async () => {
    const e = await crearEscenarioAgenda(db);
    const clave = randomUUID();
    const g = await registrar(e.userId, { p_clave: clave });
    await anular(e.userId, g.id);
    await expect(registrar(e.userId, { p_clave: clave })).rejects.toMatchObject({ message: expect.stringContaining("ya se anuló") });
    expect((await registrar(e.userId)).ok).toBe(true);
  });

  describe("la foto", () => {
    it("se guarda la ruta si está en la carpeta de la barbería", async () => {
      const e = await crearEscenarioAgenda(db);
      const ruta = rutaDe(e);
      const r = await registrar(e.userId, { p_foto_ruta: ruta });
      expect(r.con_foto).toBe(true);
      expect((await filas<{ foto_ruta: string }>(`select foto_ruta from public.gastos where id = $1`, [r.id]))[0].foto_ruta).toBe(ruta);
      for (const ext of ["png", "webp"]) expect((await registrar(e.userId, { p_foto_ruta: rutaDe(e, undefined, ext) })).con_foto).toBe(true);
      // Vacía = sin foto.
      expect((await registrar(e.userId, { p_foto_ruta: "  " })).con_foto).toBe(false);
    });

    it("no se acepta una ruta de otra barbería, de otro tipo de archivo ni que se salga de la carpeta", async () => {
      const e = await crearEscenarioAgenda(db);
      const otra = await crearEscenarioAgenda(db);
      const malas = [
        `${otra.barberiaId}/${randomUUID()}.jpg`,
        rutaDe(e, randomUUID(), "gif"),
        rutaDe(e, randomUUID(), "exe"),
        `${e.barberiaId}/../${otra.barberiaId}/${randomUUID()}.jpg`,
        `${e.barberiaId}/${randomUUID()}`,
        `${e.barberiaId}/carpeta/${randomUUID()}.jpg`,
        "foto.jpg",
        `/${e.barberiaId}/${randomUUID()}.jpg`,
      ];
      for (const ruta of malas) {
        await expect(registrar(e.userId, { p_foto_ruta: ruta })).rejects.toMatchObject({ message: expect.stringContaining("foto del gasto no es válida") });
      }
      expect((await filas(`select 1 from public.gastos where barberia_id = $1`, [e.barberiaId])).length).toBe(0);
    });

    it("la base también lo exige si alguien escribe directo", async () => {
      const e = await crearEscenarioAgenda(db);
      const otra = await crearEscenarioAgenda(db);
      const insertar = (ruta: string) =>
        db.query(
          `insert into public.gastos (barberia_id, clave, monto, categoria, medio, foto_ruta) values ($1, $2, 1000, 'otros', 'efectivo', $3)`,
          [e.barberiaId, randomUUID(), ruta]
        );
      await expect(insertar(`${otra.barberiaId}/${randomUUID()}.jpg`)).rejects.toMatchObject({ code: "23514" });
      await expect(insertar("cualquier-cosa.jpg")).rejects.toMatchObject({ code: "23514" });
      await insertar(rutaDe(e));
    });
  });

  it("registran el dueño y quien tiene el área gastos (la recepción); no la caja, el barbero ni un visitante", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const actor of [e.userId, e.recepcion]) expect((await registrar(actor)).ok).toBe(true);
    for (const actor of [e.cajero, e.cuentaCamilo, e.cuentaDani, null]) {
      await expect(registrar(actor)).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("anular_gasto", () => {
  it("lo anula con motivo y deja constancia de quién y cuándo", async () => {
    const e = await crearEscenarioAgenda(db);
    const g = await registrar(e.recepcion);
    expect(await anular(e.userId, g.id, "  Era de otro mes  ")).toEqual({ ok: true, id: g.id });
    const [fila] = await filas<{ anulado: boolean; anulado_motivo: string; anulado_por: string; anulado_at: Date | null; monto: number }>(
      `select anulado, anulado_motivo, anulado_por, anulado_at, monto from public.gastos where id = $1`,
      [g.id]
    );
    expect(fila).toMatchObject({ anulado: true, anulado_motivo: "Era de otro mes", anulado_por: e.userId, monto: 45000 });
    expect(fila.anulado_at).not.toBeNull();
  });

  it.each([["vacío", ""], ["solo espacios", "   "], ["nulo", null]])("el motivo es obligatorio (%s)", async (_nombre, motivo) => {
    const e = await crearEscenarioAgenda(db);
    const g = await registrar(e.userId);
    await expect(anular(e.userId, g.id, motivo)).rejects.toMatchObject({ message: expect.stringContaining("Escribe el motivo de la anulación") });
    expect((await filas<{ anulado: boolean }>(`select anulado from public.gastos where id = $1`, [g.id]))[0].anulado).toBe(false);
  });

  it("no se anula dos veces, ni uno que no existe o es de otra barbería", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const g = await registrar(a.userId);
    await expect(anular(b.userId, g.id)).rejects.toMatchObject({ code: "P0002" });
    await expect(anular(a.userId, randomUUID())).rejects.toMatchObject({ code: "P0002" });
    await anular(a.userId, g.id, "Primero");
    await expect(anular(a.userId, g.id, "Segundo")).rejects.toMatchObject({ message: expect.stringContaining("ya está anulado") });
    expect((await filas<{ anulado_motivo: string }>(`select anulado_motivo from public.gastos where id = $1`, [g.id]))[0].anulado_motivo).toBe("Primero");
  });

  it("anulan el dueño y quien tiene el área gastos; no la caja, el barbero ni quien solo ve el cierre", async () => {
    const e = await crearEscenarioAgenda(db);
    await crearRol(db, e.barberiaId, "Contador", ["cierre"]);
    const contador = await crearMiembro(db, e.barberiaId, "Mario", ["Contador"]);
    const g = await registrar(e.userId);
    for (const actor of [e.cajero, e.cuentaCamilo, contador, null]) {
      await expect(anular(actor, g.id)).rejects.toMatchObject({ code: "42501" });
    }
    expect((await anular(e.recepcion, g.id)).ok).toBe(true);
  });
});

describe("lo registrado no se edita ni se borra", () => {
  it("el monto, la categoría, el medio, la nota y la foto no cambian; la anulación sí (con motivo)", async () => {
    const e = await crearEscenarioAgenda(db);
    const g = await registrar(e.userId, { p_nota: "Nota", p_foto_ruta: rutaDe(e) });
    for (const sql of [
      `update public.gastos set monto = 1 where id = $1`,
      `update public.gastos set categoria = 'otros' where id = $1`,
      `update public.gastos set medio = 'transferencia' where id = $1`,
      `update public.gastos set nota = 'Otra' where id = $1`,
      `update public.gastos set foto_ruta = null where id = $1`,
    ]) {
      await expect(db.query(sql, [g.id])).rejects.toMatchObject({ code: "42501", message: expect.stringContaining("no se edita") });
    }
    await expect(db.query(`delete from public.gastos`)).rejects.toMatchObject({ code: "42501" });

    // Anular exige motivo; y un gasto anulado no se reactiva.
    await expect(db.query(`update public.gastos set anulado = true where id = $1`, [g.id])).rejects.toMatchObject({ code: "23514" });
    await anular(e.userId, g.id);
    await expect(db.query(`update public.gastos set anulado = false, anulado_motivo = null, anulado_at = null where id = $1`, [g.id])).rejects.toMatchObject({
      message: expect.stringContaining("no se reactiva"),
    });
  });

  it("la base no deja montos, categorías o medios fuera de lo permitido aunque alguien escriba directo", async () => {
    const e = await crearEscenarioAgenda(db);
    const insertar = (monto: number, categoria: string, medio: string) =>
      db.query(`insert into public.gastos (barberia_id, clave, monto, categoria, medio) values ($1, $2, $3, $4, $5)`, [e.barberiaId, randomUUID(), monto, categoria, medio]);
    await expect(insertar(0, "otros", "efectivo")).rejects.toMatchObject({ code: "23514" });
    await expect(insertar(GASTO_MAXIMO + 1, "otros", "efectivo")).rejects.toMatchObject({ code: "23514" });
    await expect(insertar(1000, "luz", "efectivo")).rejects.toMatchObject({ code: "23514" });
    await expect(insertar(1000, "otros", "fiado")).rejects.toMatchObject({ code: "23514" });
    await insertar(1000, "otros", "efectivo");
  });
});

describe("obtener_gastos", () => {
  it("los gastos del día con el total, el efectivo, la transferencia y el total por categoría, sin los anulados", async () => {
    const e = await crearEscenarioAgenda(db);
    const A = await registrar(e.userId, { p_monto: 50000, p_categoria: "insumos", p_medio: "efectivo", p_nota: "Cuchillas" });
    const B = await registrar(e.userId, { p_monto: 30000, p_categoria: "insumos", p_medio: "transferencia" });
    const C = await registrar(e.userId, { p_monto: 800000, p_categoria: "arriendo", p_medio: "transferencia", p_foto_ruta: rutaDe(e) });
    const malo = await registrar(e.userId, { p_monto: 999999, p_categoria: "otros" });
    await anular(e.userId, malo.id);

    const r = await dia(e.userId);
    expect(r.totales).toEqual({ gastos: 3, total: 880000, efectivo: 50000, transferencia: 830000 });
    expect(r.por_categoria).toEqual([
      { categoria: "arriendo", total: 800000, gastos: 1 },
      { categoria: "insumos", total: 80000, gastos: 2 },
    ]);
    // Todos salen en la lista (también el anulado, marcado); el más reciente primero.
    expect(r.gastos.map((g) => g.id)).toEqual([malo.id, C.id, B.id, A.id]);
    expect(r.gastos.find((g) => g.id === malo.id)).toMatchObject({ anulado: true, anulado_motivo: "Se registró dos veces" });
    expect(r.gastos.find((g) => g.id === C.id)).toMatchObject({ con_foto: true });
    expect(r.gastos.find((g) => g.id === A.id)).toMatchObject({ nota: "Cuchillas", con_foto: false });
  });

  it("se pide por día; un día sin gastos sale en ceros", async () => {
    const e = await crearEscenarioAgenda(db);
    const hoy = await registrar(e.userId, { p_monto: 1000 });
    const viejo = await registrar(e.userId, { p_monto: 7000 });
    await enDia(viejo.id, "2030-03-04");
    expect((await dia(e.userId)).totales.total).toBe(1000);
    expect(await dia(e.userId, "2030-03-04")).toMatchObject({ fecha: "2030-03-04", totales: { gastos: 1, total: 7000 } });
    expect(await dia(e.userId, "2030-03-05")).toMatchObject({
      totales: { gastos: 0, total: 0, efectivo: 0, transferencia: 0 },
      por_categoria: [],
      gastos: [],
    });
    expect(hoy.ok).toBe(true);
  });

  it("lo ven el dueño, el área gastos y el área cierre; no la caja ni el barbero; no se mezclan barberías", async () => {
    const e = await crearEscenarioAgenda(db);
    const otra = await crearEscenarioAgenda(db);
    await crearRol(db, e.barberiaId, "Contador", ["cierre"]);
    const contador = await crearMiembro(db, e.barberiaId, "Mario", ["Contador"]);
    await registrar(e.userId);
    for (const actor of [e.userId, e.recepcion, contador]) expect((await dia(actor)).totales.gastos).toBe(1);
    for (const actor of [e.cajero, e.cuentaCamilo, null]) await expect(dia(actor)).rejects.toMatchObject({ code: "42501" });
    expect((await dia(otra.userId)).totales.gastos).toBe(0);
  });
});

describe("obtener_gasto", () => {
  it("trae el gasto con la ruta de su foto y quién lo registró", async () => {
    const e = await crearEscenarioAgenda(db);
    const ruta = rutaDe(e);
    const g = await registrar(e.recepcion, { p_foto_ruta: ruta, p_nota: "Toallas" });
    const r = await rpc<Record<string, unknown> | null>(db, e.userId, "obtener_gasto", { p_id: g.id });
    expect(r).toMatchObject({ id: g.id, monto: 45000, categoria: "insumos", medio: "efectivo", nota: "Toallas", foto_ruta: ruta, registrado_por: "Ruth", anulado: false });
    await anular(e.userId, g.id, "Prueba");
    expect(await rpc(db, e.userId, "obtener_gasto", { p_id: g.id })).toMatchObject({ anulado: true, anulado_motivo: "Prueba" });
  });

  it("es null si no existe o es de otra barbería, y se pide con el permiso", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const g = await registrar(a.userId);
    expect(await rpc(db, b.userId, "obtener_gasto", { p_id: g.id })).toBeNull();
    expect(await rpc(db, a.userId, "obtener_gasto", { p_id: randomUUID() })).toBeNull();
    for (const actor of [a.cajero, a.cuentaCamilo, null]) await expect(rpc(db, actor, "obtener_gasto", { p_id: g.id })).rejects.toMatchObject({ code: "42501" });
  });
});

describe("la tabla", () => {
  it("solo la leen el área gastos y el área cierre; nadie escribe directo desde la app", async () => {
    const e = await crearEscenarioAgenda(db);
    await crearRol(db, e.barberiaId, "Contador", ["cierre"]);
    const contador = await crearMiembro(db, e.barberiaId, "Mario", ["Contador"]);
    await registrar(e.userId);
    for (const actor of [e.userId, e.recepcion, contador]) expect((await como(db, actor, `select * from public.gastos`)).length).toBe(1);
    for (const actor of [e.cajero, e.cuentaCamilo]) expect(await como(db, actor, `select * from public.gastos`)).toEqual([]);
    await expect(como(db, null, `select * from public.gastos`)).rejects.toMatchObject({ code: "42501" });
    const otra = await crearEscenarioAgenda(db);
    expect(await como(db, otra.userId, `select * from public.gastos`)).toEqual([]);

    await expect(
      como(db, e.userId, `insert into public.gastos (barberia_id, clave, monto, categoria, medio) values ($1, $2, 1, 'otros', 'efectivo')`, [e.barberiaId, randomUUID()])
    ).rejects.toMatchObject({ code: "42501" });
    await expect(como(db, e.userId, `update public.gastos set anulado = true`)).rejects.toMatchObject({ code: "42501" });
    await expect(como(db, e.userId, `delete from public.gastos`)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("las fotos privadas (bucket gastos-fotos)", () => {
  const subir = (actor: string | null, ruta: string) =>
    como(db, actor, `insert into storage.objects (bucket_id, name) values ('gastos-fotos', $1)`, [ruta]);
  const ver = (actor: string | null) => como(db, actor, `select name from storage.objects where bucket_id = 'gastos-fotos'`);

  it("el bucket existe, es privado, solo admite imágenes y hasta 1 MiB", async () => {
    const [b] = await filas<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'gastos-fotos'`
    );
    expect(b.public).toBe(false);
    expect(Number(b.file_size_limit)).toBe(1_048_576);
    expect(b.allowed_mime_types).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  it("sube y ve las fotos de su barbería quien tiene el área gastos; el cierre solo las ve", async () => {
    const e = await crearEscenarioAgenda(db);
    await crearRol(db, e.barberiaId, "Contador", ["cierre"]);
    const contador = await crearMiembro(db, e.barberiaId, "Mario", ["Contador"]);
    const ruta = rutaDe(e);
    await subir(e.recepcion, ruta);
    await subir(e.userId, rutaDe(e));
    expect((await ver(e.recepcion)).length).toBe(2);
    expect((await ver(contador)).length).toBe(2);
    await expect(subir(contador, rutaDe(e))).rejects.toMatchObject({ code: "42501" });
  });

  it("no sube ni ve fotos de otra barbería, ni sin el permiso, ni sin sesión", async () => {
    const e = await crearEscenarioAgenda(db);
    const otra = await crearEscenarioAgenda(db);
    await subir(e.userId, rutaDe(e));

    // Otra barbería: ni escribir en la carpeta de esta, ni verla.
    await expect(subir(otra.userId, rutaDe(e))).rejects.toMatchObject({ code: "42501" });
    expect(await ver(otra.userId)).toEqual([]);
    // Sin el permiso de gastos o de cierre.
    for (const actor of [e.cajero, e.cuentaCamilo]) {
      await expect(subir(actor, rutaDe(e))).rejects.toMatchObject({ code: "42501" });
      expect(await ver(actor)).toEqual([]);
    }
    // Sin sesión.
    await expect(subir(null, rutaDe(e))).rejects.toMatchObject({ code: "42501" });
    await expect(ver(null)).rejects.toMatchObject({ code: "42501" });
  });

  it("solo el bucket de gastos: en otro, esta política no deja subir nada", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(
      como(db, e.userId, `insert into storage.objects (bucket_id, name) values ('otro-bucket', $1)`, [rutaDe(e)])
    ).rejects.toMatchObject({ code: "42501" });
  });
});
