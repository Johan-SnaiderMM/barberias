/**
 * Permisos por área: la lista de SQL y la de TypeScript coinciden, el dueño lo abre todo, los roles se suman,
 * y `requerir_area` rechaza a quien no tiene el área. Los roles viven en la base (0003), no en el JWT.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AREAS } from "@/lib/areas";
import { type BarberiaDePrueba, como, comoInterno, crearBarberia, crearBase, crearMiembro, rpc } from "./base-datos";

let db: PGlite;
let a: BarberiaDePrueba;
let b: BarberiaDePrueba;

beforeAll(async () => {
  db = await crearBase();
  a = await crearBarberia(db, "Barbería Alfa");
  b = await crearBarberia(db, "Barbería Beta");
});

afterAll(async () => {
  await db.close();
});

async function areasDe(userId: string): Promise<string[]> {
  const filas = await como<{ areas: string[] }>(db, userId, `select public.mis_areas() as areas`);
  return filas[0].areas;
}

describe("lista de áreas", () => {
  it("SQL (fn_areas) y TypeScript (AREAS) son idénticas y en el mismo orden", async () => {
    const { rows } = await db.query<{ areas: string[] }>(`select public.fn_areas() as areas`);
    expect(rows[0].areas).toEqual([...AREAS]);
  });

  it("una fila de rol no admite un área inventada", async () => {
    await expect(
      db.query(`insert into public.roles_equipo (barberia_id, nombre, areas) values ($1, 'Mago', array['inventada'])`, [
        a.barberiaId,
      ])
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("quién abre qué", () => {
  it("el dueño abre todas las áreas", async () => {
    expect(await areasDe(a.userId)).toEqual([...AREAS]);
  });

  it("la barbería nace con los roles Barbero y Recepción", async () => {
    const { rows } = await db.query<{ nombre: string; areas: string[] }>(
      `select nombre, areas from public.roles_equipo where barberia_id = $1 order by orden`,
      [a.barberiaId]
    );
    expect(rows).toEqual([
      { nombre: "Barbero", areas: ["mi_agenda"] },
      { nombre: "Recepción", areas: ["agenda", "caja", "gastos"] },
    ]);
  });

  it("un barbero solo abre mi_agenda", async () => {
    const id = await crearMiembro(db, a.barberiaId, "Camilo", ["Barbero"]);
    expect(await areasDe(id)).toEqual(["mi_agenda"]);
  });

  it("varios roles suman sus áreas, sin repetir y en el orden de fn_areas", async () => {
    const id = await crearMiembro(db, a.barberiaId, "Dani", ["Recepción", "Barbero"]);
    expect(await areasDe(id)).toEqual(["agenda", "mi_agenda", "caja", "gastos"]);
  });

  it("sin roles no abre ninguna área", async () => {
    const id = await crearMiembro(db, a.barberiaId, "Nuevo");
    expect(await areasDe(id)).toEqual([]);
  });

  it("un rol desactivado ya no cuenta", async () => {
    const id = await crearMiembro(db, a.barberiaId, "Eli", ["Recepción"]);
    await db.query(`update public.roles_equipo set activo = false where barberia_id = $1 and nombre = 'Recepción'`, [
      a.barberiaId,
    ]);
    expect(await areasDe(id)).toEqual([]);
    await db.query(`update public.roles_equipo set activo = true where barberia_id = $1 and nombre = 'Recepción'`, [
      a.barberiaId,
    ]);
    expect(await areasDe(id)).toEqual(["agenda", "caja", "gastos"]);
  });

  it("alguien sin barbería no tiene áreas (null)", async () => {
    const u = await db.query<{ id: string }>(`insert into auth.users (email) values ('sinperfil@ejemplo.test') returning id`);
    const filas = await como<{ areas: string[] | null }>(db, u.rows[0].id, `select public.mis_areas() as areas`);
    expect(filas[0].areas).toBeNull();
  });

  it("el contexto trae las áreas y los nombres de rol", async () => {
    const id = await crearMiembro(db, a.barberiaId, "Fabio", ["Barbero"]);
    const ctx = await rpc<{ perfil: { areas: string[]; roles: string[]; rol: string } }>(db, id, "obtener_contexto");
    expect(ctx.perfil).toMatchObject({ rol: "equipo", areas: ["mi_agenda"], roles: ["Barbero"] });
  });
});

describe("requerir_area y tiene_area", () => {
  it("devuelve la barbería si la persona abre alguna de las áreas pedidas", async () => {
    const id = await crearMiembro(db, a.barberiaId, "Gina", ["Recepción"]);
    const filas = await comoInterno<{ v: string }>(db, id, `select public.requerir_area('caja', 'cierre') as v`);
    expect(filas[0].v).toBe(a.barberiaId);
  });

  it("rechaza con un mensaje claro si no abre ninguna", async () => {
    const id = await crearMiembro(db, a.barberiaId, "Hugo", ["Barbero"]);
    await expect(comoInterno(db, id, `select public.requerir_area('caja')`)).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining("No tienes permiso para cobrar"),
    });
  });

  it("el dueño pasa cualquier área", async () => {
    for (const area of AREAS) {
      const filas = await comoInterno<{ v: string }>(db, a.userId, `select public.requerir_area($1) as v`, [area]);
      expect(filas[0].v).toBe(a.barberiaId);
    }
  });

  it("requerir_dueno rechaza al equipo", async () => {
    const id = await crearMiembro(db, a.barberiaId, "Ines", ["Recepción"]);
    await expect(comoInterno(db, id, `select public.requerir_dueno()`)).rejects.toMatchObject({ code: "42501" });
  });

  it("tiene_area es verdadera solo para las áreas abiertas", async () => {
    const id = await crearMiembro(db, a.barberiaId, "Jairo", ["Barbero"]);
    const filas = await como<{ si: boolean; no: boolean }>(
      db,
      id,
      `select public.tiene_area('mi_agenda') as si, public.tiene_area('agenda', 'caja') as no`
    );
    expect(filas[0]).toEqual({ si: true, no: false });
  });
});

describe("los roles no cruzan barberías", () => {
  it("no se puede asignar un rol de otra barbería", async () => {
    const id = await crearMiembro(db, a.barberiaId, "Karen");
    await expect(
      db.query(
        `insert into public.perfil_roles (barberia_id, user_id, rol_id)
         select $1, $2, id from public.roles_equipo where barberia_id = $3 and nombre = 'Recepción'`,
        [a.barberiaId, id, b.barberiaId]
      )
    ).rejects.toMatchObject({ code: "23503" }); // foreign_key_violation (llave compuesta)
  });
});

describe("toda función de escritura pide su área", () => {
  /**
   * Las funciones de la API que escriben (volátiles) deben empezar pidiendo un área (`requerir_area`), el dueño
   * (`requerir_dueno`) o el permiso de agenda propia/ajena (`fn_requerir_agenda_de`, que a su vez pide área).
   * Esta lista fija las que NO lo hacen: si agregas una función de escritura sin permiso, esta prueba falla; si de
   * verdad no lo necesita, agrégala aquí con una razón.
   */
  const SIN_AREA_PERMITIDAS: string[] = [
    // La llama alguien que todavía NO es del equipo (sesión anónima recién abierta): su "permiso" es un código de
    // invitación válido, de un solo uso y de 3 días. Valida que no pertenezca ya a otra barbería.
    "canjear_invitacion",
  ];

  it("ninguna función volátil de la API queda sin guardia de permiso", async () => {
    const { rows } = await db.query<{ nombre: string; def: string }>(`
      select p.proname as nombre, pg_get_functiondef(p.oid) as def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f' and p.provolatile = 'v'
         and p.proname not like 'fn\_%' and p.proname not like 'requerir\_%' and p.proname not like 'publico\_%'`);
    expect(rows.length).toBeGreaterThan(0);
    const sinGuardia = rows
      .filter((r) => !/requerir_area\(|requerir_dueno\(|fn_requerir_agenda_de\(/.test(r.def))
      .map((r) => r.nombre)
      .sort();
    expect(sinGuardia).toEqual(SIN_AREA_PERMITIDAS);
  });

  it("la API de lectura (estable) no escribe: no hay funciones volátiles ocultas como lectura", async () => {
    const { rows } = await db.query<{ nombre: string }>(`
      select p.proname as nombre
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f' and p.provolatile <> 'v'
         and pg_get_functiondef(p.oid) ~* '\m(insert into|update public|delete from)\M'
         and p.proname not like 'fn\_%'`);
    expect(rows.map((r) => r.nombre)).toEqual([]);
  });
});
