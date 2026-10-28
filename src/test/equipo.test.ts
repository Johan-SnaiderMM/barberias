/**
 * El equipo entra con un código de invitación (tarea 1.9 · migración 0013, SPEC F1).
 * "Barbero ve solo su agenda" se prueba de punta a punta: invitación -> canje -> agenda.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { como, crearBase, crearMiembro, crearRol, rpc } from "./base-datos";
import { crearEscenarioAgenda, en, type EscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

type Equipo = {
  areas: string[];
  roles: { id: string; nombre: string; areas: string[]; personas: number }[];
  personas: {
    user_id: string;
    nombre: string;
    rol: string;
    yo: boolean;
    roles: string[];
    areas: string[];
    barbero: { id: string; nombre: string } | null;
  }[];
  invitaciones: {
    id: string;
    nombre: string;
    codigo: string;
    expira_at: string;
    roles: string[];
    barbero: { id: string; nombre: string } | null;
  }[];
};

type Canje = { barberia: string; nombre: string; areas: string[]; barbero_vinculado: boolean };

/** Una sesión nueva sin perfil, como la que abre el celular de quien llega con un código (sesión anónima). */
async function celularNuevo(): Promise<string> {
  const r = await db.query<{ id: string }>(`insert into auth.users (email) values (null) returning id`);
  return r.rows[0].id;
}

async function idRol(e: EscenarioAgenda, nombre: string): Promise<string> {
  const r = await db.query<{ id: string }>(`select id from public.roles_equipo where barberia_id = $1 and nombre = $2`, [
    e.barberiaId,
    nombre,
  ]);
  return r.rows[0].id;
}

const invitar = (actor: string, args: Record<string, unknown>) =>
  rpc<{ id: string; codigo: string; nombre: string; expira_at: string }>(db, actor, "crear_invitacion", args);

const canjear = (actor: string, codigo: string) => rpc<Canje>(db, actor, "canjear_invitacion", { p_codigo: codigo });

const equipo = (actor: string) => rpc<Equipo>(db, actor, "listar_equipo");

/** Quien administra el equipo pero NO es el dueño: roles "equipo" + "servicios". */
async function encargado(e: EscenarioAgenda): Promise<string> {
  await crearRol(db, e.barberiaId, "Encargado", ["equipo", "servicios"]);
  return crearMiembro(db, e.barberiaId, "Elena", ["Encargado"]);
}

describe("crear_invitacion", () => {
  it("crea un código de 8 caracteres, que sirve 3 días, y lo deja ver a quien administra el equipo", async () => {
    const e = await crearEscenarioAgenda(db);
    const barbero = await idRol(e, "Barbero");
    const r = await invitar(e.userId, { p_nombre: "  Pedro   Rojas ", p_roles: [barbero] });

    expect(r.codigo).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(r.nombre).toBe("Pedro Rojas");
    const horas = (new Date(r.expira_at).getTime() - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(71.9);
    expect(horas).toBeLessThanOrEqual(72);

    const pendientes = (await equipo(e.userId)).invitaciones;
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]).toMatchObject({ nombre: "Pedro Rojas", codigo: r.codigo, roles: [barbero], barbero: null });
  });

  it("puede ser para un barbero que todavía no tiene cuenta", async () => {
    const e = await crearEscenarioAgenda(db);
    const nuevo = (await rpc<{ id: string }>(db, e.userId, "crear_barbero", { p_nombre: "Mateo" })).id;
    const r = await invitar(e.userId, { p_nombre: "Mateo", p_roles: [await idRol(e, "Barbero")], p_barbero: nuevo });
    const inv = (await equipo(e.userId)).invitaciones.find((i) => i.id === r.id)!;
    expect(inv.barbero).toEqual({ id: nuevo, nombre: "Mateo" });
  });

  it.each([
    ["sin nombre", { p_nombre: "  " }, "Escribe el nombre de la persona"],
    ["sin roles", { p_roles: [] }, "Elige al menos un rol"],
  ])("rechaza una invitación %s", async (_caso, extra, mensaje) => {
    const e = await crearEscenarioAgenda(db);
    await expect(
      invitar(e.userId, { p_nombre: "Pedro", p_roles: [await idRol(e, "Barbero")], ...extra })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining(mensaje) });
  });

  it("rechaza roles que no existen o son de otra barbería", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    await expect(
      invitar(a.userId, { p_nombre: "Pedro", p_roles: ["00000000-0000-0000-0000-000000000001"] })
    ).rejects.toMatchObject({ code: "P0002" });
    await expect(invitar(a.userId, { p_nombre: "Pedro", p_roles: [await idRol(b, "Barbero")] })).rejects.toMatchObject({
      code: "P0002",
    });
    await expect(invitar(a.userId, { p_nombre: "Pedro", p_roles: JSON.stringify("barbero") })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("Elige los roles"),
    });
  });

  it("rechaza un barbero inexistente, archivado o que ya tiene cuenta", async () => {
    const e = await crearEscenarioAgenda(db);
    const roles = [await idRol(e, "Barbero")];
    await expect(
      invitar(e.userId, { p_nombre: "X", p_roles: roles, p_barbero: "00000000-0000-0000-0000-000000000001" })
    ).rejects.toMatchObject({ code: "P0002" });
    await expect(invitar(e.userId, { p_nombre: "X", p_roles: roles, p_barbero: e.camilo })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("ya tiene una cuenta"),
    });
    const archivado = (await rpc<{ id: string }>(db, e.userId, "crear_barbero", { p_nombre: "Viejo" })).id;
    await rpc(db, e.userId, "fijar_barbero_activo", { p_id: archivado, p_activo: false });
    await expect(invitar(e.userId, { p_nombre: "X", p_roles: roles, p_barbero: archivado })).rejects.toMatchObject({
      code: "P0002",
    });
  });

  it("limita las invitaciones sin usar (10) y el tamaño del equipo (30)", async () => {
    const e = await crearEscenarioAgenda(db);
    const roles = [await idRol(e, "Barbero")];
    for (let i = 0; i < 10; i++) await invitar(e.userId, { p_nombre: `Persona ${i}`, p_roles: roles });
    await expect(invitar(e.userId, { p_nombre: "Una más", p_roles: roles })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("muchas invitaciones sin usar"),
    });

    const otra = await crearEscenarioAgenda(db);
    const total = (await db.query<{ n: number }>(`select count(*)::int as n from public.perfiles where barberia_id = $1`, [otra.barberiaId])).rows[0].n;
    for (let i = total; i < 30; i++) await crearMiembro(db, otra.barberiaId, `Relleno ${i}`);
    await expect(
      invitar(otra.userId, { p_nombre: "Persona 31", p_roles: [await idRol(otra, "Barbero")] })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("30 personas") });
  });

  it("solo quien tiene el área equipo invita (el dueño y un encargado), no recepción ni el barbero", async () => {
    const e = await crearEscenarioAgenda(db);
    const roles = [await idRol(e, "Barbero")];
    await expect(invitar(e.recepcion, { p_nombre: "X", p_roles: roles })).rejects.toMatchObject({ code: "42501" });
    await expect(invitar(e.cuentaCamilo, { p_nombre: "X", p_roles: roles })).rejects.toMatchObject({ code: "42501" });
    await expect(rpc(db, null, "crear_invitacion", { p_nombre: "X", p_roles: roles })).rejects.toMatchObject({ code: "42501" });
    await expect(invitar(e.userId, { p_nombre: "X", p_roles: roles })).resolves.toBeTruthy();
    const elena = await encargado(e);
    await expect(invitar(elena, { p_nombre: "Y", p_roles: roles })).rejects.toMatchObject({ code: "42501" }); // Barbero = mi_agenda, que ella no tiene
  });

  it("nadie da más permisos de los que tiene", async () => {
    const e = await crearEscenarioAgenda(db);
    const elena = await encargado(e); // equipo + servicios
    const recepcion = await idRol(e, "Recepción"); // agenda, caja, gastos
    await expect(invitar(elena, { p_nombre: "X", p_roles: [recepcion] })).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining("No puedes dar permisos que tú no tienes"),
    });
    // Un rol que cabe entre los suyos sí.
    const ayudante = await crearRol(db, e.barberiaId, "Ayudante", ["servicios"]);
    await expect(invitar(elena, { p_nombre: "Ayuda", p_roles: [ayudante] })).resolves.toBeTruthy();
    // El dueño lo da todo.
    await expect(invitar(e.userId, { p_nombre: "Rece", p_roles: [recepcion] })).resolves.toBeTruthy();
  });
});

describe("canjear_invitacion", () => {
  it("crea a la persona en el equipo con sus roles y deja el código usado", async () => {
    const e = await crearEscenarioAgenda(db);
    const inv = await invitar(e.userId, { p_nombre: "Pedro Rojas", p_roles: [await idRol(e, "Recepción")] });
    const celular = await celularNuevo();

    const r = await canjear(celular, inv.codigo);
    expect(r).toMatchObject({ nombre: "Pedro Rojas", areas: ["agenda", "caja", "gastos"], barbero_vinculado: false });

    const ctx = await rpc<{ barberia: { id: string }; perfil: { nombre: string; rol: string; roles: string[] } }>(
      db,
      celular,
      "obtener_contexto"
    );
    expect(ctx.barberia.id).toBe(e.barberiaId);
    expect(ctx.perfil).toMatchObject({ nombre: "Pedro Rojas", rol: "equipo", roles: ["Recepción"] });
    expect((await equipo(e.userId)).invitaciones).toHaveLength(0);
    const { rows } = await db.query(`select 1 from public.invitaciones where codigo = $1 and usada_por = $2`, [inv.codigo, celular]);
    expect(rows).toHaveLength(1);
  });

  it("un barbero que entra con su código ve y maneja SOLO su agenda (de punta a punta)", async () => {
    const e = await crearEscenarioAgenda(db);
    const nuevo = (await rpc<{ id: string }>(db, e.userId, "crear_barbero", { p_nombre: "Mateo" })).id;
    await rpc(db, e.userId, "asignar_servicios_barbero", { p_barbero: nuevo, p_servicios: [{ servicio_id: e.corte }] });
    const inv = await invitar(e.userId, { p_nombre: "Mateo", p_roles: [await idRol(e, "Barbero")], p_barbero: nuevo });

    // Citas de Mateo y de Dani, creadas por recepción.
    const cm = await rpc<{ id: string }>(db, e.recepcion, "crear_cita", {
      p_barbero: nuevo, p_servicio: e.corte, p_inicio: en(0), p_cliente_nombre: "Cliente de Mateo", p_confirmar: true, // Mateo todavía no tiene horario: avisa y se confirma
    });
    await rpc(db, e.recepcion, "crear_cita", {
      p_barbero: e.dani, p_servicio: e.corte, p_inicio: en(0), p_cliente_nombre: "Cliente de Dani",
    });

    const celular = await celularNuevo();
    const r = await canjear(celular, inv.codigo);
    expect(r).toMatchObject({ areas: ["mi_agenda"], barbero_vinculado: true });

    const vistas = await rpc<{ id: string; cliente: string }[]>(db, celular, "listar_citas", { p_desde: "2030-03-04" });
    expect(vistas.map((c) => c.cliente)).toEqual(["Cliente de Mateo"]);
    expect(vistas[0].id).toBe(cm.id);
    expect(await como<{ id: string }>(db, celular, `select public.mi_barbero() as id`)).toEqual([{ id: nuevo }]);

    // Puede cambiar el estado de la suya, no agendar con Dani.
    await expect(rpc(db, celular, "cambiar_estado_cita", { p_id: cm.id, p_estado: "en_atencion" })).resolves.toBeTruthy();
    await expect(
      rpc(db, celular, "crear_cita", { p_barbero: e.dani, p_servicio: e.corte, p_inicio: en(120), p_cliente_nombre: "X" })
    ).rejects.toMatchObject({ code: "42501" });
    // Y no administra el equipo ni el catálogo.
    await expect(equipo(celular)).rejects.toMatchObject({ code: "42501" });
    await expect(
      rpc(db, celular, "crear_servicio", { p_nombre: "Gratis", p_precio: 0, p_duracion_min: 5 })
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("acepta el código en minúsculas, con guion o con espacios", async () => {
    const e = await crearEscenarioAgenda(db);
    const roles = [await idRol(e, "Barbero")];
    const a = await invitar(e.userId, { p_nombre: "A", p_roles: roles });
    const b = await invitar(e.userId, { p_nombre: "B", p_roles: roles });
    const c = await invitar(e.userId, { p_nombre: "C", p_roles: roles });
    const bonito = (cod: string) => `${cod.slice(0, 4)}-${cod.slice(4)}`;
    await expect(canjear(await celularNuevo(), bonito(a.codigo))).resolves.toMatchObject({ nombre: "A" });
    await expect(canjear(await celularNuevo(), b.codigo.toLowerCase())).resolves.toMatchObject({ nombre: "B" });
    await expect(canjear(await celularNuevo(), `  ${bonito(c.codigo).toLowerCase()} `)).resolves.toMatchObject({ nombre: "C" });
  });

  it("sirve una sola vez", async () => {
    const e = await crearEscenarioAgenda(db);
    const inv = await invitar(e.userId, { p_nombre: "A", p_roles: [await idRol(e, "Barbero")] });
    await canjear(await celularNuevo(), inv.codigo);
    await expect(canjear(await celularNuevo(), inv.codigo)).rejects.toMatchObject({
      code: "P0002",
      message: expect.stringContaining("Ese código no sirve"),
    });
  });

  it("no sirve vencido, anulado, inventado ni vacío", async () => {
    const e = await crearEscenarioAgenda(db);
    const roles = [await idRol(e, "Barbero")];
    const vencido = await invitar(e.userId, { p_nombre: "A", p_roles: roles });
    await db.query(`update public.invitaciones set expira_at = now() - interval '1 minute' where codigo = $1`, [vencido.codigo]);
    const anulado = await invitar(e.userId, { p_nombre: "B", p_roles: roles });
    await rpc(db, e.userId, "anular_invitacion", { p_id: anulado.id });

    for (const codigo of [vencido.codigo, anulado.codigo, "ZZZZ2222", "", "abc"]) {
      await expect(canjear(await celularNuevo(), codigo), codigo).rejects.toMatchObject({ code: "P0002" });
    }
  });

  it("quien ya está en un equipo no se une a otro sin salir", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const inv = await invitar(b.userId, { p_nombre: "A", p_roles: [await idRol(b, "Barbero")] });
    await expect(canjear(a.recepcion, inv.codigo)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("ya está en el equipo"),
    });
    // El código no se gastó.
    await expect(canjear(await celularNuevo(), inv.codigo)).resolves.toBeTruthy();
  });

  it("sin sesión (rol anon) no se puede canjear", async () => {
    const e = await crearEscenarioAgenda(db);
    const inv = await invitar(e.userId, { p_nombre: "A", p_roles: [await idRol(e, "Barbero")] });
    await expect(rpc(db, null, "canjear_invitacion", { p_codigo: inv.codigo })).rejects.toMatchObject({ code: "42501" });
  });

  it("si el barbero ya tiene otra cuenta, la persona entra igual pero sin vincularse", async () => {
    const e = await crearEscenarioAgenda(db);
    const nuevo = (await rpc<{ id: string }>(db, e.userId, "crear_barbero", { p_nombre: "Mateo" })).id;
    const inv = await invitar(e.userId, { p_nombre: "Mateo", p_roles: [await idRol(e, "Barbero")], p_barbero: nuevo });
    // Mientras tanto otra persona del equipo quedó vinculada con ese barbero.
    await rpc(db, e.userId, "vincular_barbero_usuario", { p_barbero: nuevo, p_user_id: e.recepcion });
    const r = await canjear(await celularNuevo(), inv.codigo);
    expect(r).toMatchObject({ barbero_vinculado: false });
    const { rows } = await db.query<{ user_id: string }>(`select user_id from public.barberos where id = $1`, [nuevo]);
    expect(rows[0].user_id).toBe(e.recepcion);
  });
});

describe("anular_invitacion", () => {
  it("anula una pendiente; no una usada ni de otra barbería", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const roles = [await idRol(a, "Barbero")];
    const pendiente = await invitar(a.userId, { p_nombre: "A", p_roles: roles });
    const usada = await invitar(a.userId, { p_nombre: "B", p_roles: roles });
    await canjear(await celularNuevo(), usada.codigo);

    await expect(rpc(db, b.userId, "anular_invitacion", { p_id: pendiente.id })).rejects.toMatchObject({ code: "P0002" });
    await expect(rpc(db, a.userId, "anular_invitacion", { p_id: usada.id })).rejects.toMatchObject({ code: "P0002" });
    await expect(rpc(db, a.userId, "anular_invitacion", { p_id: pendiente.id })).resolves.toBeTruthy();
    await expect(rpc(db, a.userId, "anular_invitacion", { p_id: pendiente.id })).rejects.toMatchObject({ code: "P0002" });
    await expect(rpc(db, a.recepcion, "anular_invitacion", { p_id: pendiente.id })).rejects.toMatchObject({ code: "42501" });
  });
});

describe("listar_equipo", () => {
  it("trae roles con sus áreas, personas con su barbero y solo las invitaciones vigentes", async () => {
    const e = await crearEscenarioAgenda(db);
    const roles = [await idRol(e, "Barbero")];
    const vigente = await invitar(e.userId, { p_nombre: "Vigente", p_roles: roles });
    const vencida = await invitar(e.userId, { p_nombre: "Vencida", p_roles: roles });
    await db.query(`update public.invitaciones set expira_at = now() - interval '1 minute' where codigo = $1`, [vencida.codigo]);
    const usada = await invitar(e.userId, { p_nombre: "Usada", p_roles: roles });
    await canjear(await celularNuevo(), usada.codigo);

    const eq = await equipo(e.userId);
    expect(eq.areas).toHaveLength(8);
    expect(eq.roles.map((r) => r.nombre).sort()).toEqual(["Barbero", "Cajero", "Recepción"]);
    expect(eq.invitaciones.map((i) => i.codigo)).toEqual([vigente.codigo]);

    const dueno = eq.personas[0];
    expect(dueno).toMatchObject({ rol: "dueno", yo: true });
    expect(dueno.areas).toHaveLength(8);
    const camilo = eq.personas.find((p) => p.nombre === "Camilo (cuenta)")!;
    expect(camilo).toMatchObject({ rol: "equipo", yo: false, areas: ["mi_agenda"] });
    expect(camilo.barbero).toEqual({ id: e.camilo, nombre: "Camilo" });
    expect(eq.personas.find((p) => p.nombre === "Usada")).toBeTruthy();
  });

  it("solo para quien administra el equipo", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(equipo(e.recepcion)).rejects.toMatchObject({ code: "42501" });
    await expect(equipo(await encargado(e))).resolves.toBeTruthy();
  });

  it("la tabla de invitaciones no se lee directamente (el código es una llave)", async () => {
    const e = await crearEscenarioAgenda(db);
    await invitar(e.userId, { p_nombre: "A", p_roles: [await idRol(e, "Barbero")] });
    await expect(como(db, e.userId, `select codigo from public.invitaciones`)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("quitar_del_equipo", () => {
  it("quita a la persona: pierde el acceso al instante y su barbero queda sin cuenta", async () => {
    const e = await crearEscenarioAgenda(db);
    await rpc(db, e.userId, "quitar_del_equipo", { p_user_id: e.cuentaCamilo });

    const ctx = await rpc<{ perfil: unknown; barberia: unknown }>(db, e.cuentaCamilo, "obtener_contexto");
    expect(ctx).toEqual({ barberia: null, perfil: null });
    expect(await rpc(db, e.cuentaCamilo, "listar_citas", {})).toEqual([]);
    const { rows } = await db.query<{ nombre: string; user_id: string | null; activo: boolean }>(
      `select nombre, user_id, activo from public.barberos where id = $1`,
      [e.camilo]
    );
    expect(rows[0]).toEqual({ nombre: "Camilo", user_id: null, activo: true });
  });

  it("no quita al dueño, ni a uno mismo, ni a otra barbería", async () => {
    const a = await crearEscenarioAgenda(db);
    const b = await crearEscenarioAgenda(db);
    const elena = await encargado(a);
    await expect(rpc(db, elena, "quitar_del_equipo", { p_user_id: a.userId })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("dueño"),
    });
    await expect(rpc(db, elena, "quitar_del_equipo", { p_user_id: elena })).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("ti mismo"),
    });
    await expect(rpc(db, b.userId, "quitar_del_equipo", { p_user_id: a.recepcion })).rejects.toMatchObject({ code: "P0002" });
  });

  it("un encargado no quita a alguien con más permisos que él", async () => {
    const e = await crearEscenarioAgenda(db);
    const elena = await encargado(e); // equipo + servicios
    await expect(rpc(db, elena, "quitar_del_equipo", { p_user_id: e.recepcion })).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining("más permisos que tú"),
    });
    const ayudante = await crearRol(db, e.barberiaId, "Ayudante", ["servicios"]);
    const juan = await crearMiembro(db, e.barberiaId, "Juan");
    await db.query(`insert into public.perfil_roles (barberia_id, user_id, rol_id) values ($1, $2, $3)`, [e.barberiaId, juan, ayudante]);
    await expect(rpc(db, elena, "quitar_del_equipo", { p_user_id: juan })).resolves.toBeTruthy();
  });

  it("recepción y el barbero no pueden", async () => {
    const e = await crearEscenarioAgenda(db);
    await expect(rpc(db, e.recepcion, "quitar_del_equipo", { p_user_id: e.cuentaDani })).rejects.toMatchObject({ code: "42501" });
    await expect(rpc(db, e.cuentaCamilo, "quitar_del_equipo", { p_user_id: e.cuentaDani })).rejects.toMatchObject({ code: "42501" });
  });
});

describe("cambiar_roles_miembro", () => {
  it("deja a la persona con exactamente esos roles (y sus áreas cambian)", async () => {
    const e = await crearEscenarioAgenda(db);
    const barbero = await idRol(e, "Barbero");
    const recepcion = await idRol(e, "Recepción");
    const r = await rpc<{ areas: string[] }>(db, e.userId, "cambiar_roles_miembro", {
      p_user_id: e.cuentaCamilo,
      p_roles: [barbero, recepcion],
    });
    expect(r.areas).toEqual(["agenda", "mi_agenda", "caja", "gastos"]);
    await rpc(db, e.userId, "cambiar_roles_miembro", { p_user_id: e.cuentaCamilo, p_roles: [recepcion] });
    expect((await rpc<string[]>(db, e.cuentaCamilo, "mis_areas")).sort()).toEqual(["agenda", "caja", "gastos"]);
  });

  it("pide al menos un rol, roles reales, y no toca al dueño ni a uno mismo", async () => {
    const e = await crearEscenarioAgenda(db);
    const barbero = await idRol(e, "Barbero");
    await expect(
      rpc(db, e.userId, "cambiar_roles_miembro", { p_user_id: e.cuentaCamilo, p_roles: [] })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("al menos un rol") });
    await expect(
      rpc(db, e.userId, "cambiar_roles_miembro", { p_user_id: e.cuentaCamilo, p_roles: ["00000000-0000-0000-0000-000000000001"] })
    ).rejects.toMatchObject({ code: "P0002" });
    const elena = await encargado(e);
    await expect(
      rpc(db, elena, "cambiar_roles_miembro", { p_user_id: e.userId, p_roles: [barbero] })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("dueño") });
    await expect(
      rpc(db, elena, "cambiar_roles_miembro", { p_user_id: elena, p_roles: [barbero] })
    ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("tus propios roles") });
  });

  it("un encargado no se puede ascender a otro ni dar roles que él no tiene", async () => {
    const e = await crearEscenarioAgenda(db);
    const elena = await encargado(e);
    const recepcion = await idRol(e, "Recepción");
    const barbero = await idRol(e, "Barbero");
    const ayudante = await crearRol(db, e.barberiaId, "Ayudante", ["servicios"]);
    const juan = await crearMiembro(db, e.barberiaId, "Juan");
    await db.query(`insert into public.perfil_roles (barberia_id, user_id, rol_id) values ($1, $2, $3)`, [e.barberiaId, juan, ayudante]);

    await expect(
      rpc(db, elena, "cambiar_roles_miembro", { p_user_id: juan, p_roles: [recepcion] })
    ).rejects.toMatchObject({ code: "42501", message: expect.stringContaining("No puedes dar permisos que tú no tienes") });
    // Tampoco toca a quien ya tiene un rol que ella no abre.
    await expect(
      rpc(db, elena, "cambiar_roles_miembro", { p_user_id: e.cuentaCamilo, p_roles: [barbero] })
    ).rejects.toMatchObject({ code: "42501" });
  });
});
