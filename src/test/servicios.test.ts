/** Servicios y precios (tarea 1.1 · migración 0005). */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BarberiaDePrueba, como, crearBarberia, crearBase, crearMiembro, crearRol, rpc } from "./base-datos";

type Servicio = { id: string; nombre: string; precio: number; duracion_min: number; activo: boolean };

let db: PGlite;
let contador = 0;

beforeAll(async () => {
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

/** Una barbería nueva por grupo de pruebas: cada grupo parte de un catálogo vacío. */
async function nueva(): Promise<BarberiaDePrueba> {
  contador += 1;
  return crearBarberia(db, `Barbería ${contador}`);
}

const crear = (actor: string, nombre: string, precio = 15000, duracion = 30) =>
  rpc<{ id: string }>(db, actor, "crear_servicio", { p_nombre: nombre, p_precio: precio, p_duracion_min: duracion });

const listar = (actor: string, conArchivados = false) =>
  rpc<Servicio[]>(db, actor, "listar_servicios", { p_con_archivados: conArchivados });

describe("crear_servicio", () => {
  it("crea servicios con orden consecutivo y los lista en ese orden", async () => {
    const a = await nueva();
    await crear(a.userId, "Corte", 15000, 30);
    await crear(a.userId, "Barba", 8000, 15);
    await crear(a.userId, "Corte + barba", 22000, 45);
    const lista = await listar(a.userId);
    expect(lista.map((s) => s.nombre)).toEqual(["Corte", "Barba", "Corte + barba"]);
    expect(lista[2]).toMatchObject({ precio: 22000, duracion_min: 45, activo: true });
    const { rows } = await db.query<{ orden: number }>(
      `select orden from public.servicios where barberia_id = $1 order by orden`,
      [a.barberiaId]
    );
    expect(rows.map((r) => r.orden)).toEqual([1, 2, 3]);
  });

  it("limpia los espacios del nombre", async () => {
    const a = await nueva();
    await crear(a.userId, "  Corte    y   barba ");
    expect((await listar(a.userId))[0].nombre).toBe("Corte y barba");
  });

  it("acepta precio cero (cortesía) y los límites de duración", async () => {
    const a = await nueva();
    await crear(a.userId, "Cortesía", 0, 5);
    await crear(a.userId, "Tratamiento largo", 10000000, 480);
    expect(await listar(a.userId)).toHaveLength(2);
  });

  it.each([
    ["nombre vacío", "   ", 15000, 30, /nombre del servicio/],
    ["nombre muy largo", "x".repeat(61), 15000, 30, /nombre del servicio/],
    ["precio negativo", "Corte", -1, 30, /precio/],
    ["precio exagerado", "Corte", 10000001, 30, /precio/],
    ["duración que no es de 5 en 5", "Corte", 15000, 7, /duración/],
    ["duración cero", "Corte", 15000, 0, /duración/],
    ["duración mayor a 8 horas", "Corte", 15000, 485, /duración/],
  ])("rechaza %s", async (_caso, nombre, precio, duracion, mensaje) => {
    const a = await nueva();
    await expect(crear(a.userId, nombre as string, precio as number, duracion as number)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringMatching(mensaje as RegExp),
    });
  });

  it("no acepta dos activos con el mismo nombre, sin importar mayúsculas", async () => {
    const a = await nueva();
    await crear(a.userId, "Corte");
    await expect(crear(a.userId, "  CORTE ")).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Ya tienes un servicio con ese nombre"),
    });
  });

  it("el mismo nombre puede existir en otra barbería", async () => {
    const a = await nueva();
    const b = await nueva();
    await crear(a.userId, "Corte");
    await expect(crear(b.userId, "Corte")).resolves.toBeTruthy();
  });
});

describe("actualizar_servicio", () => {
  it("cambia nombre, precio y duración", async () => {
    const a = await nueva();
    const { id } = await crear(a.userId, "Corte", 15000, 30);
    await rpc(db, a.userId, "actualizar_servicio", {
      p_id: id,
      p_nombre: "Corte clásico",
      p_precio: 18000,
      p_duracion_min: 45,
    });
    expect(await listar(a.userId)).toEqual([
      { id, nombre: "Corte clásico", precio: 18000, duracion_min: 45, activo: true },
    ]);
  });

  it("no deja renombrar a un nombre que ya usa otro activo", async () => {
    const a = await nueva();
    await crear(a.userId, "Corte");
    const { id } = await crear(a.userId, "Barba");
    await expect(
      rpc(db, a.userId, "actualizar_servicio", { p_id: id, p_nombre: "corte", p_precio: 8000, p_duracion_min: 15 })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("Ya tienes un servicio") });
  });

  it("guardar un servicio con su mismo nombre no choca consigo mismo", async () => {
    const a = await nueva();
    const { id } = await crear(a.userId, "Corte", 15000, 30);
    await expect(
      rpc(db, a.userId, "actualizar_servicio", { p_id: id, p_nombre: "Corte", p_precio: 16000, p_duracion_min: 30 })
    ).resolves.toBeTruthy();
  });

  it("un id que no existe da P0002", async () => {
    const a = await nueva();
    await expect(
      rpc(db, a.userId, "actualizar_servicio", {
        p_id: "00000000-0000-0000-0000-000000000001",
        p_nombre: "X",
        p_precio: 1,
        p_duracion_min: 5,
      })
    ).rejects.toMatchObject({ code: "P0002" });
  });

  it("no puede tocar el servicio de otra barbería (y no le revela que existe)", async () => {
    const a = await nueva();
    const b = await nueva();
    const { id } = await crear(a.userId, "Corte", 15000, 30);
    await expect(
      rpc(db, b.userId, "actualizar_servicio", { p_id: id, p_nombre: "Robado", p_precio: 1, p_duracion_min: 5 })
    ).rejects.toMatchObject({ code: "P0002" });
    expect((await listar(a.userId))[0]).toMatchObject({ nombre: "Corte", precio: 15000 });
    await expect(rpc(db, b.userId, "fijar_servicio_activo", { p_id: id, p_activo: false })).rejects.toMatchObject({
      code: "P0002",
    });
  });
});

describe("archivar y restaurar", () => {
  it("un servicio archivado deja de listarse, pero la fila se conserva", async () => {
    const a = await nueva();
    const { id } = await crear(a.userId, "Corte");
    await crear(a.userId, "Barba", 8000, 15);
    await rpc(db, a.userId, "fijar_servicio_activo", { p_id: id, p_activo: false });
    expect((await listar(a.userId)).map((s) => s.nombre)).toEqual(["Barba"]);
    const todos = await listar(a.userId, true);
    expect(todos.map((s) => [s.nombre, s.activo])).toEqual([
      ["Barba", true],
      ["Corte", false],
    ]);
    const { rows } = await db.query(`select 1 from public.servicios where id = $1`, [id]);
    expect(rows).toHaveLength(1);
  });

  it("al archivar uno, su nombre queda libre para uno nuevo", async () => {
    const a = await nueva();
    const { id } = await crear(a.userId, "Corte", 15000, 30);
    await rpc(db, a.userId, "fijar_servicio_activo", { p_id: id, p_activo: false });
    await expect(crear(a.userId, "Corte", 20000, 40)).resolves.toBeTruthy();
  });

  it("restaurar falla con un mensaje claro si ya hay otro activo con ese nombre", async () => {
    const a = await nueva();
    const viejo = await crear(a.userId, "Corte");
    await rpc(db, a.userId, "fijar_servicio_activo", { p_id: viejo.id, p_activo: false });
    await crear(a.userId, "Corte", 20000, 40);
    await expect(rpc(db, a.userId, "fijar_servicio_activo", { p_id: viejo.id, p_activo: true })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Ya hay un servicio activo con ese nombre"),
    });
  });

  it("restaura un servicio archivado", async () => {
    const a = await nueva();
    const { id } = await crear(a.userId, "Corte");
    await rpc(db, a.userId, "fijar_servicio_activo", { p_id: id, p_activo: false });
    await rpc(db, a.userId, "fijar_servicio_activo", { p_id: id, p_activo: true });
    expect((await listar(a.userId)).map((s) => s.nombre)).toEqual(["Corte"]);
  });
});

describe("permisos y aislamiento", () => {
  it("quien abre el área servicios puede administrar; recepción y barbero solo leen", async () => {
    const a = await nueva();
    await crearRol(db, a.barberiaId, "Encargado", ["servicios"]);
    const encargado = await crearMiembro(db, a.barberiaId, "Elena", ["Encargado"]);
    const recepcion = await crearMiembro(db, a.barberiaId, "Ruth", ["Recepción"]);
    const barbero = await crearMiembro(db, a.barberiaId, "Camilo", ["Barbero"]);

    const { id } = await crear(encargado, "Corte");
    for (const actor of [recepcion, barbero]) {
      await expect(crear(actor, "Otro")).rejects.toMatchObject({ code: "42501" });
      await expect(
        rpc(db, actor, "actualizar_servicio", { p_id: id, p_nombre: "X", p_precio: 1, p_duracion_min: 5 })
      ).rejects.toMatchObject({ code: "42501" });
      await expect(rpc(db, actor, "fijar_servicio_activo", { p_id: id, p_activo: false })).rejects.toMatchObject({
        code: "42501",
      });
      // …pero ven el catálogo (lo necesitan para la agenda).
      expect((await listar(actor)).map((s) => s.nombre)).toEqual(["Corte"]);
    }
  });

  it("sin sesión no se lista ni se escribe", async () => {
    await expect(rpc(db, null, "listar_servicios")).rejects.toMatchObject({ code: "42501" });
    await expect(
      rpc(db, null, "crear_servicio", { p_nombre: "X", p_precio: 1, p_duracion_min: 5 })
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("alguien sin barbería no puede crear servicios", async () => {
    const u = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('suelto-servicios@ejemplo.test') returning id`
    );
    await expect(crear(u.rows[0].id, "Corte")).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining("no tiene una barbería"),
    });
  });

  it("cada barbería ve solo su catálogo", async () => {
    const a = await nueva();
    const b = await nueva();
    await crear(a.userId, "Corte de A");
    await crear(b.userId, "Corte de B");
    expect((await listar(a.userId)).map((s) => s.nombre)).toEqual(["Corte de A"]);
    expect((await listar(b.userId)).map((s) => s.nombre)).toEqual(["Corte de B"]);
    const directo = await como<{ nombre: string }>(db, b.userId, `select nombre from public.servicios`);
    expect(directo.map((s) => s.nombre)).toEqual(["Corte de B"]);
  });

  it("el borrado está bloqueado aunque se intente con todos los privilegios", async () => {
    const a = await nueva();
    await crear(a.userId, "Corte");
    await expect(db.query(`delete from public.servicios where barberia_id = $1`, [a.barberiaId])).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining("se anula con motivo"),
    });
  });

  it("la app no escribe la tabla directamente", async () => {
    const a = await nueva();
    await expect(
      como(
        db,
        a.userId,
        `insert into public.servicios (barberia_id, nombre, precio, duracion_min) values ($1, 'Directo', 1, 5)`,
        [a.barberiaId]
      )
    ).rejects.toMatchObject({ code: "42501" });
  });
});
