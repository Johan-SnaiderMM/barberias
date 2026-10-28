/** Barberos y qué servicios hace cada uno (tarea 1.2 · migración 0006). */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BarberiaDePrueba, como, crearBarberia, crearBase, crearMiembro, crearRol, rpc } from "./base-datos";

type Barbero = {
  id: string;
  nombre: string;
  user_id: string | null;
  acepta_reservas: boolean;
  activo: boolean;
  orden: number;
  servicios: { servicio_id: string; precio_propio: number | null; duracion_propia: number | null }[];
};

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

const servicio = async (actor: string, nombre: string, precio = 15000, duracion = 30) =>
  (await rpc<{ id: string }>(db, actor, "crear_servicio", { p_nombre: nombre, p_precio: precio, p_duracion_min: duracion })).id;

const barbero = async (actor: string, nombre: string) =>
  (await rpc<{ id: string }>(db, actor, "crear_barbero", { p_nombre: nombre })).id;

const listar = (actor: string, conArchivados = false) =>
  rpc<Barbero[]>(db, actor, "listar_barberos", { p_con_archivados: conArchivados });

const asignar = (actor: string, barberoId: string, servicios: unknown) =>
  rpc(db, actor, "asignar_servicios_barbero", { p_barbero: barberoId, p_servicios: servicios });

describe("crear y actualizar barberos", () => {
  it("crea barberos con orden consecutivo, activos y aceptando reservas", async () => {
    const a = await nueva();
    await barbero(a.userId, "Camilo");
    await barbero(a.userId, "  Dani   Ruiz ");
    const lista = await listar(a.userId);
    expect(lista.map((b) => b.nombre)).toEqual(["Camilo", "Dani Ruiz"]);
    expect(lista[0]).toMatchObject({ activo: true, acepta_reservas: true, user_id: null, orden: 1, servicios: [] });
    expect(lista[1].orden).toBe(2);
  });

  it.each([
    ["nombre vacío", "   "],
    ["nombre largo", "x".repeat(41)],
  ])("rechaza %s", async (_caso, nombre) => {
    const a = await nueva();
    await expect(barbero(a.userId, nombre)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("nombre del barbero"),
    });
  });

  it("no acepta dos barberos activos con el mismo nombre, pero sí en otra barbería", async () => {
    const a = await nueva();
    const b = await nueva();
    await barbero(a.userId, "Camilo");
    await expect(barbero(a.userId, "CAMILO")).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Ya tienes un barbero con ese nombre"),
    });
    await expect(barbero(b.userId, "Camilo")).resolves.toBeTruthy();
  });

  it("actualiza el nombre y si acepta reservas en línea", async () => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    await rpc(db, a.userId, "actualizar_barbero", { p_id: id, p_nombre: "Camilo A.", p_acepta_reservas: false });
    expect((await listar(a.userId))[0]).toMatchObject({ nombre: "Camilo A.", acepta_reservas: false });
  });

  it("no deja renombrar a un nombre en uso, ni tocar barberos de otra barbería", async () => {
    const a = await nueva();
    const b = await nueva();
    await barbero(a.userId, "Camilo");
    const dani = await barbero(a.userId, "Dani");
    await expect(
      rpc(db, a.userId, "actualizar_barbero", { p_id: dani, p_nombre: "camilo", p_acepta_reservas: true })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("Ya tienes un barbero") });
    await expect(
      rpc(db, b.userId, "actualizar_barbero", { p_id: dani, p_nombre: "Robado", p_acepta_reservas: true })
    ).rejects.toMatchObject({ code: "P0002" });
    expect((await listar(a.userId)).map((x) => x.nombre)).toEqual(["Camilo", "Dani"]);
  });
});

describe("archivar y restaurar", () => {
  it("un barbero archivado no se lista por defecto pero se conserva", async () => {
    const a = await nueva();
    const id = await barbero(a.userId, "Camilo");
    await barbero(a.userId, "Dani");
    await rpc(db, a.userId, "fijar_barbero_activo", { p_id: id, p_activo: false });
    expect((await listar(a.userId)).map((b) => b.nombre)).toEqual(["Dani"]);
    expect((await listar(a.userId, true)).map((b) => [b.nombre, b.activo])).toEqual([
      ["Dani", true],
      ["Camilo", false],
    ]);
  });

  it("su nombre queda libre al archivarlo, y restaurar choca si ya lo usa otro activo", async () => {
    const a = await nueva();
    const viejo = await barbero(a.userId, "Camilo");
    await rpc(db, a.userId, "fijar_barbero_activo", { p_id: viejo, p_activo: false });
    await barbero(a.userId, "Camilo");
    await expect(rpc(db, a.userId, "fijar_barbero_activo", { p_id: viejo, p_activo: true })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Ya hay un barbero activo con ese nombre"),
    });
  });

  it("el borrado está bloqueado", async () => {
    const a = await nueva();
    await barbero(a.userId, "Camilo");
    await expect(db.query(`delete from public.barberos where barberia_id = $1`, [a.barberiaId])).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining("se anula con motivo"),
    });
  });
});

describe("servicios de cada barbero", () => {
  it("un barbero solo ofrece lo que tiene asignado", async () => {
    const a = await nueva();
    const corte = await servicio(a.userId, "Corte");
    const barba = await servicio(a.userId, "Barba", 8000, 15);
    const combo = await servicio(a.userId, "Corte + barba", 22000, 45);
    const camilo = await barbero(a.userId, "Camilo");
    const dani = await barbero(a.userId, "Dani");

    await asignar(a.userId, camilo, [{ servicio_id: corte }, { servicio_id: combo }]);
    await asignar(a.userId, dani, [{ servicio_id: corte }, { servicio_id: barba }]);

    const lista = await listar(a.userId);
    const deCamilo = lista.find((b) => b.id === camilo)!;
    const deDani = lista.find((b) => b.id === dani)!;
    expect(deCamilo.servicios.map((s) => s.servicio_id)).toEqual([corte, combo]);
    expect(deDani.servicios.map((s) => s.servicio_id)).toEqual([corte, barba]);
    expect(deCamilo.servicios.map((s) => s.servicio_id)).not.toContain(barba);
  });

  it("guarda precio y duración propios, y null cuando se usa el del catálogo", async () => {
    const a = await nueva();
    const corte = await servicio(a.userId, "Corte");
    const camilo = await barbero(a.userId, "Camilo");
    await asignar(a.userId, camilo, [{ servicio_id: corte, precio_propio: 20000, duracion_propia: 45 }]);
    expect((await listar(a.userId))[0].servicios).toEqual([
      { servicio_id: corte, precio_propio: 20000, duracion_propia: 45 },
    ]);
    await asignar(a.userId, camilo, [{ servicio_id: corte, precio_propio: null, duracion_propia: null }]);
    expect((await listar(a.userId))[0].servicios).toEqual([
      { servicio_id: corte, precio_propio: null, duracion_propia: null },
    ]);
  });

  it("reemplaza la lista: lo que no viene se quita", async () => {
    const a = await nueva();
    const corte = await servicio(a.userId, "Corte");
    const barba = await servicio(a.userId, "Barba", 8000, 15);
    const camilo = await barbero(a.userId, "Camilo");
    await asignar(a.userId, camilo, [{ servicio_id: corte }, { servicio_id: barba }]);
    await asignar(a.userId, camilo, [{ servicio_id: barba }]);
    expect((await listar(a.userId))[0].servicios.map((s) => s.servicio_id)).toEqual([barba]);
    await asignar(a.userId, camilo, []);
    expect((await listar(a.userId))[0].servicios).toEqual([]);
  });

  it("conserva la asignación a un servicio archivado (vuelve si se restaura)", async () => {
    const a = await nueva();
    const corte = await servicio(a.userId, "Corte");
    const barba = await servicio(a.userId, "Barba", 8000, 15);
    const camilo = await barbero(a.userId, "Camilo");
    await asignar(a.userId, camilo, [{ servicio_id: corte, precio_propio: 19000 }, { servicio_id: barba }]);
    await rpc(db, a.userId, "fijar_servicio_activo", { p_id: corte, p_activo: false });
    // Se guarda la lista sin el archivado (la pantalla solo ofrece los activos): la fila archivada sobrevive.
    await asignar(a.userId, camilo, [{ servicio_id: barba }]);
    await rpc(db, a.userId, "fijar_servicio_activo", { p_id: corte, p_activo: true });
    const servicios = (await listar(a.userId))[0].servicios;
    expect(servicios.find((s) => s.servicio_id === corte)).toMatchObject({ precio_propio: 19000 });
  });

  it("no asigna servicios archivados, ajenos ni repetidos", async () => {
    const a = await nueva();
    const b = await nueva();
    const corte = await servicio(a.userId, "Corte");
    const archivado = await servicio(a.userId, "Viejo");
    await rpc(db, a.userId, "fijar_servicio_activo", { p_id: archivado, p_activo: false });
    const ajeno = await servicio(b.userId, "Corte de B");
    const camilo = await barbero(a.userId, "Camilo");

    await expect(asignar(a.userId, camilo, [{ servicio_id: archivado }])).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("no existe o está archivado"),
    });
    await expect(asignar(a.userId, camilo, [{ servicio_id: ajeno }])).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("no existe o está archivado"),
    });
    await expect(asignar(a.userId, camilo, [{ servicio_id: corte }, { servicio_id: corte }])).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("dos veces"),
    });
    // Nada se guardó a medias.
    expect((await listar(a.userId))[0].servicios).toEqual([]);
  });

  it.each([
    ["precio negativo", { precio_propio: -1 }, /precio propio/],
    ["precio exagerado", { precio_propio: 10000001 }, /precio propio/],
    ["precio decimal", { precio_propio: 1500.5 }, /número entero/],
    ["duración fuera de paso", { duracion_propia: 7 }, /duración propia/],
    ["duración enorme", { duracion_propia: 600 }, /duración propia/],
    ["precio que no es número", { precio_propio: "mucho" }, /número entero/],
  ])("rechaza %s", async (_caso, extra, mensaje) => {
    const a = await nueva();
    const corte = await servicio(a.userId, "Corte");
    const camilo = await barbero(a.userId, "Camilo");
    await expect(asignar(a.userId, camilo, [{ servicio_id: corte, ...extra }])).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringMatching(mensaje as RegExp),
    });
  });

  it.each([
    ["no es una lista", { servicio_id: "x" }],
    ["trae un elemento que no es objeto", ["hola"]],
    ["trae un id que no es uuid", [{ servicio_id: "no-es-uuid" }]],
    ["no trae servicio_id", [{ precio_propio: 1 }]],
  ])("rechaza una lista que %s", async (_caso, lista) => {
    const a = await nueva();
    const camilo = await barbero(a.userId, "Camilo");
    await expect(asignar(a.userId, camilo, lista)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("no es válida"),
    });
  });

  it("no asigna a barberos de otra barbería", async () => {
    const a = await nueva();
    const b = await nueva();
    const corteB = await servicio(b.userId, "Corte");
    const camiloA = await barbero(a.userId, "Camilo");
    await expect(asignar(b.userId, camiloA, [{ servicio_id: corteB }])).rejects.toMatchObject({ code: "P0002" });
  });
});

describe("vincular con una cuenta del equipo", () => {
  it("vincula, expone mi_barbero() y suelta con null", async () => {
    const a = await nueva();
    const camilo = await barbero(a.userId, "Camilo");
    const cuenta = await crearMiembro(db, a.barberiaId, "Camilo Cuenta", ["Barbero"]);

    await rpc(db, a.userId, "vincular_barbero_usuario", { p_barbero: camilo, p_user_id: cuenta });
    expect((await listar(a.userId))[0].user_id).toBe(cuenta);
    const yo = await como<{ id: string | null }>(db, cuenta, `select public.mi_barbero() as id`);
    expect(yo[0].id).toBe(camilo);

    await rpc(db, a.userId, "vincular_barbero_usuario", { p_barbero: camilo, p_user_id: null });
    const sinVinculo = await como<{ id: string | null }>(db, cuenta, `select public.mi_barbero() as id`);
    expect(sinVinculo[0].id).toBeNull();
  });

  it("solo vincula a gente del propio equipo y una persona es un solo barbero", async () => {
    const a = await nueva();
    const b = await nueva();
    const camilo = await barbero(a.userId, "Camilo");
    const dani = await barbero(a.userId, "Dani");
    const cuenta = await crearMiembro(db, a.barberiaId, "Cuenta", ["Barbero"]);

    await expect(
      rpc(db, a.userId, "vincular_barbero_usuario", { p_barbero: camilo, p_user_id: b.userId })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("no es de tu equipo") });

    await rpc(db, a.userId, "vincular_barbero_usuario", { p_barbero: camilo, p_user_id: cuenta });
    await expect(
      rpc(db, a.userId, "vincular_barbero_usuario", { p_barbero: dani, p_user_id: cuenta })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("ya está vinculada") });
  });

  it("si la persona sale del equipo, el barbero se conserva sin cuenta", async () => {
    const a = await nueva();
    const camilo = await barbero(a.userId, "Camilo");
    const cuenta = await crearMiembro(db, a.barberiaId, "Cuenta", ["Barbero"]);
    await rpc(db, a.userId, "vincular_barbero_usuario", { p_barbero: camilo, p_user_id: cuenta });
    await db.query(`delete from public.perfiles where user_id = $1`, [cuenta]);
    expect((await listar(a.userId))[0]).toMatchObject({ nombre: "Camilo", user_id: null, activo: true });
  });

  it("pide el área equipo (el área servicios no basta)", async () => {
    const a = await nueva();
    await crearRol(db, a.barberiaId, "Encargado", ["servicios"]);
    const encargado = await crearMiembro(db, a.barberiaId, "Elena", ["Encargado"]);
    const camilo = await barbero(encargado, "Camilo");
    await expect(
      rpc(db, encargado, "vincular_barbero_usuario", { p_barbero: camilo, p_user_id: null })
    ).rejects.toMatchObject({ code: "42501", message: expect.stringContaining("manejar el equipo") });
  });
});

describe("permisos y aislamiento", () => {
  it("administra quien abre servicios; recepción y barbero solo ven la lista", async () => {
    const a = await nueva();
    await crearRol(db, a.barberiaId, "Encargado", ["servicios"]);
    const encargado = await crearMiembro(db, a.barberiaId, "Elena", ["Encargado"]);
    const recepcion = await crearMiembro(db, a.barberiaId, "Ruth", ["Recepción"]);
    const corte = await servicio(a.userId, "Corte");
    const id = await barbero(encargado, "Camilo");

    for (const actor of [recepcion]) {
      await expect(barbero(actor, "Otro")).rejects.toMatchObject({ code: "42501" });
      await expect(
        rpc(db, actor, "actualizar_barbero", { p_id: id, p_nombre: "X", p_acepta_reservas: true })
      ).rejects.toMatchObject({ code: "42501" });
      await expect(rpc(db, actor, "fijar_barbero_activo", { p_id: id, p_activo: false })).rejects.toMatchObject({
        code: "42501",
      });
      await expect(asignar(actor, id, [{ servicio_id: corte }])).rejects.toMatchObject({ code: "42501" });
      expect((await listar(actor)).map((b) => b.nombre)).toEqual(["Camilo"]);
    }
  });

  it("sin sesión no se lista ni se escribe", async () => {
    await expect(rpc(db, null, "listar_barberos")).rejects.toMatchObject({ code: "42501" });
    await expect(rpc(db, null, "crear_barbero", { p_nombre: "X" })).rejects.toMatchObject({ code: "42501" });
  });

  it("cada barbería ve solo sus barberos y sus asignaciones", async () => {
    const a = await nueva();
    const b = await nueva();
    const corteA = await servicio(a.userId, "Corte");
    const camiloA = await barbero(a.userId, "Camilo A");
    await asignar(a.userId, camiloA, [{ servicio_id: corteA }]);
    await barbero(b.userId, "Camilo B");

    expect((await listar(b.userId)).map((x) => x.nombre)).toEqual(["Camilo B"]);
    const directas = await como(db, b.userId, `select 1 from public.barbero_servicios`);
    expect(directas).toHaveLength(0);
  });

  it("la app no escribe las tablas directamente", async () => {
    const a = await nueva();
    await expect(
      como(db, a.userId, `insert into public.barberos (barberia_id, nombre) values ($1, 'Directo')`, [a.barberiaId])
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      como(db, a.userId, `delete from public.barbero_servicios`)
    ).rejects.toMatchObject({ code: "42501" });
  });
});
