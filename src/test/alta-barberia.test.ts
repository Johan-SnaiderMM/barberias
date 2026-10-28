/** Alta de una barbería de verdad (migración 0004) y su slug público. */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBase } from "./base-datos";

let db: PGlite;

beforeAll(async () => {
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

async function usuario(correo: string): Promise<string> {
  const r = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [correo]);
  return r.rows[0].id;
}

type Alta = { barberia_id: string; nombre: string; dueno: string; slug: string; enlace_reservas: string };

async function crear(correo: string, nombre: string, dueno = "Pepe Pérez"): Promise<Alta> {
  const r = await db.query<{ data: Alta }>(`select public.fn_crear_barberia($1, $2, $3) as data`, [correo, nombre, dueno]);
  return r.rows[0].data;
}

describe("fn_crear_barberia", () => {
  it("crea la barbería, el perfil del dueño y los roles iniciales", async () => {
    const id = await usuario("pepe@ejemplo.test");
    const alta = await crear("PEPE@ejemplo.test ", "  La Barbería   de Don Pepe ");
    expect(alta).toMatchObject({
      nombre: "La Barbería de Don Pepe",
      slug: "la-barberia-de-don-pepe",
      enlace_reservas: "/reservar/la-barberia-de-don-pepe",
    });
    const perfil = await db.query<{ rol: string; nombre: string }>(
      `select rol, nombre from public.perfiles where user_id = $1 and barberia_id = $2`,
      [id, alta.barberia_id]
    );
    expect(perfil.rows).toEqual([{ rol: "dueno", nombre: "Pepe Pérez" }]);
    const roles = await db.query(`select 1 from public.roles_equipo where barberia_id = $1`, [alta.barberia_id]);
    expect(roles.rows).toHaveLength(2);
    const barb = await db.query<{ es_demo: boolean }>(`select es_demo from public.barberias where id = $1`, [
      alta.barberia_id,
    ]);
    expect(barb.rows[0].es_demo).toBe(false);
  });

  it("no da de alta dos veces al mismo usuario", async () => {
    await usuario("doble@ejemplo.test");
    await crear("doble@ejemplo.test", "Primera");
    await expect(crear("doble@ejemplo.test", "Segunda")).rejects.toThrow(/ya tiene una barbería/);
  });

  it("pide que el usuario exista en Authentication", async () => {
    await expect(crear("noexiste@ejemplo.test", "Fantasma")).rejects.toThrow(/No existe el usuario/);
  });

  it("valida el nombre de la barbería y del dueño", async () => {
    await usuario("val@ejemplo.test");
    await expect(crear("val@ejemplo.test", "   ")).rejects.toThrow(/nombre de la barbería/);
    await expect(crear("val@ejemplo.test", "x".repeat(61))).rejects.toThrow(/nombre de la barbería/);
    await expect(crear("val@ejemplo.test", "Válida", " ")).rejects.toThrow(/nombre del dueño/);
  });
});

describe("slug público", () => {
  it("normaliza tildes y símbolos", async () => {
    const { rows } = await db.query<{ s: string }>(`select public.fn_slug('  ¡Corte & Barba — Ñandú Ñ! ') as s`);
    expect(rows[0].s).toBe("corte-barba-nandu-n");
  });

  it("agrega -2, -3… cuando el nombre ya existe", async () => {
    await usuario("u1@ejemplo.test");
    await usuario("u2@ejemplo.test");
    await usuario("u3@ejemplo.test");
    const uno = await crear("u1@ejemplo.test", "Estilo Real");
    const dos = await crear("u2@ejemplo.test", "Estilo Real");
    const tres = await crear("u3@ejemplo.test", "Estilo-Real!");
    expect([uno.slug, dos.slug, tres.slug]).toEqual(["estilo-real", "estilo-real-2", "estilo-real-3"]);
  });

  it("no usa palabras reservadas de la app", async () => {
    await usuario("r1@ejemplo.test");
    const alta = await crear("r1@ejemplo.test", "Reservar");
    expect(alta.slug).toBe("reservar-2");
  });

  it("un nombre muy corto recibe un sufijo para llegar a 3 letras", async () => {
    await usuario("c1@ejemplo.test");
    const alta = await crear("c1@ejemplo.test", "Ab");
    expect(alta.slug).toBe("ab-barberia");
  });

  it("un slug escrito a mano debe ser válido", async () => {
    await expect(db.query(`insert into public.barberias (nombre, slug) values ('X', 'Mal Slug')`)).rejects.toMatchObject({
      code: "23514",
    });
  });
});
