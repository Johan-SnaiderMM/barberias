/**
 * Aislamiento entre barberías y escrituras cerradas. Si una de estas pruebas falla, una barbería puede
 * ver o tocar los datos de otra: es la regla de seguridad más importante del producto.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BarberiaDePrueba, como, crearBarberia, crearBase, crearMiembro, rpc } from "./base-datos";

let db: PGlite;
let a: BarberiaDePrueba;
let b: BarberiaDePrueba;
let miembroA: string;

beforeAll(async () => {
  db = await crearBase();
  a = await crearBarberia(db, "Barbería Alfa");
  b = await crearBarberia(db, "Barbería Beta");
  miembroA = await crearMiembro(db, a.barberiaId, "Camilo", ["Barbero"]);
});

afterAll(async () => {
  await db.close();
});

describe("lectura aislada por barbería", () => {
  it("cada dueño ve solo su barbería", async () => {
    const deA = await como<{ id: string }>(db, a.userId, `select id from public.barberias`);
    expect(deA.map((f) => f.id)).toEqual([a.barberiaId]);
    const deB = await como<{ id: string }>(db, b.userId, `select id from public.barberias`);
    expect(deB.map((f) => f.id)).toEqual([b.barberiaId]);
  });

  it("los perfiles son solo los de la propia barbería", async () => {
    const filas = await como<{ barberia_id: string }>(db, a.userId, `select barberia_id from public.perfiles`);
    expect(filas).toHaveLength(2); // el dueño y Camilo
    expect(filas.every((f) => f.barberia_id === a.barberiaId)).toBe(true);
    const deB = await como(db, b.userId, `select 1 from public.perfiles`);
    expect(deB).toHaveLength(1);
  });

  it("los roles y sus asignaciones son solo los de la propia barbería", async () => {
    const roles = await como<{ barberia_id: string }>(db, b.userId, `select barberia_id from public.roles_equipo`);
    expect(roles).toHaveLength(2);
    expect(roles.every((f) => f.barberia_id === b.barberiaId)).toBe(true);
    const asignaciones = await como(db, b.userId, `select 1 from public.perfil_roles`);
    expect(asignaciones).toHaveLength(0); // Camilo es de A: B no ve esa asignación
  });

  it("el contexto trae solo la barbería de quien pregunta", async () => {
    const ctx = await rpc<{ barberia: { slug: string }; perfil: { rol: string } }>(db, a.userId, "obtener_contexto");
    expect(ctx.barberia.slug).toBe(a.slug);
    expect(ctx.perfil.rol).toBe("dueno");
  });

  it("alguien sin perfil no ve ninguna barbería", async () => {
    const u = await db.query<{ id: string }>(`insert into auth.users (email) values ('suelto@ejemplo.test') returning id`);
    const filas = await como(db, u.rows[0].id, `select 1 from public.barberias`);
    expect(filas).toHaveLength(0);
  });
});

describe("sin sesión no se lee nada", () => {
  it.each(["barberias", "perfiles", "roles_equipo", "perfil_roles"])("anon no lee %s", async (tabla) => {
    await expect(como(db, null, `select * from public.${tabla}`)).rejects.toMatchObject({ code: "42501" });
  });

  it("anon no ejecuta obtener_contexto", async () => {
    await expect(rpc(db, null, "obtener_contexto")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("el cliente no escribe tablas directamente", () => {
  it("authenticated no puede insertar, actualizar ni borrar", async () => {
    await expect(
      como(db, a.userId, `insert into public.barberias (nombre) values ('Pirata')`)
    ).rejects.toMatchObject({ code: "42501" });
    await expect(como(db, a.userId, `update public.barberias set nombre = 'Hackeada'`)).rejects.toMatchObject({
      code: "42501",
    });
    await expect(como(db, a.userId, `delete from public.perfiles`)).rejects.toMatchObject({ code: "42501" });
    await expect(
      como(db, a.userId, `update public.perfiles set rol = 'dueno' where user_id = $1`, [miembroA])
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("nadie puede pasarse a sí mismo a otra barbería", async () => {
    await expect(
      como(db, miembroA, `update public.perfiles set barberia_id = $1 where user_id = $2`, [b.barberiaId, miembroA])
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("borrado bloqueado por trigger", () => {
  it("fn_bloquear_borrado impide el DELETE aunque se tengan privilegios", async () => {
    await db.exec(`
      create table public.prueba_borrado (id int primary key, barberia_id uuid not null);
      create trigger trg_bloquear_borrado before delete on public.prueba_borrado
        for each row execute function public.fn_bloquear_borrado();
      insert into public.prueba_borrado values (1, '${a.barberiaId}');
    `);
    await expect(db.query(`delete from public.prueba_borrado where id = 1`)).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining("se anula con motivo"),
    });
    // Única excepción: el reinicio de la demo.
    await db.transaction(async (tx) => {
      await tx.exec(`set local app.reiniciando_demo = 'on'`);
      await tx.exec(`delete from public.prueba_borrado where id = 1`);
    });
    expect((await db.query(`select 1 from public.prueba_borrado`)).rows).toHaveLength(0);
    await db.exec(`drop table public.prueba_borrado`);
  });
});
