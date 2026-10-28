/**
 * WhatsApp y dirección de la barbería, desde la app (migración 0028): `actualizar_contacto_barberia` los guarda con las
 * mismas reglas que la tabla, solo la persona con el área «servicios» (el dueño siempre) y solo de SU barbería. Los
 * demás lo leen donde ya estaban: `obtener_contexto`, el catálogo público y la página de la cita.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBarberia, crearBase, crearMiembro, crearRol, rpc } from "./base-datos";
import { crearEscenarioAgenda } from "./escenario";

let db: PGlite;

beforeAll(async () => {
  db = await crearBase();
});

afterAll(async () => {
  await db.close();
});

let contador = 0;
/** Una barbería nueva con nombre único (el correo del dueño sale del nombre). */
const nueva = (prefijo: string) => crearBarberia(db, `${prefijo} ${++contador}`);

type Contacto = { whatsapp: string | null; direccion: string | null };
const contactoDe = async (actor: string) =>
  (await rpc<{ barberia: Contacto }>(db, actor, "obtener_contexto")).barberia;
const guardar = (actor: string, whatsapp: string | null, direccion: string | null) =>
  rpc<Contacto>(db, actor, "actualizar_contacto_barberia", { p_whatsapp: whatsapp, p_direccion: direccion });

describe("actualizar_contacto_barberia", () => {
  it("una barbería nueva nace sin WhatsApp ni dirección", async () => {
    const a = await nueva("Barbería sin contacto");
    expect(await contactoDe(a.userId)).toMatchObject({ whatsapp: null, direccion: null });
  });

  it("guarda el WhatsApp en E.164 y la dirección, y el contexto los trae", async () => {
    const a = await nueva("Barbería con contacto");
    const r = await guardar(a.userId, "300 123 4567", "Carrera 9 #12-34, Centro");
    expect(r).toEqual({ whatsapp: "+573001234567", direccion: "Carrera 9 #12-34, Centro" });
    expect(await contactoDe(a.userId)).toMatchObject({ whatsapp: "+573001234567", direccion: "Carrera 9 #12-34, Centro" });
  });

  it.each([
    ["+573001234567", "+573001234567"],
    ["573001234567", "+573001234567"],
    ["(300) 123-4567", "+573001234567"],
    ["0034 612 345 678", "+34612345678"],
    ["+1 415 555 2671", "+14155552671"],
  ])("entiende el WhatsApp «%s»", async (escrito, guardado) => {
    const a = await nueva("Barbería de formatos");
    expect((await guardar(a.userId, escrito, null)).whatsapp).toBe(guardado);
  });

  it("lo que guarda siempre cumple el check de la tabla", async () => {
    const a = await nueva("Barbería del check");
    await guardar(a.userId, "310 555 0000", "Calle 1 # 2-3");
    const { rows } = await db.query<{ ok: boolean }>(
      `select whatsapp ~ '^\\+[1-9][0-9]{7,14}$' as ok from public.barberias where id = $1`,
      [a.barberiaId]
    );
    expect(rows[0].ok).toBe(true);
  });

  it.each(["123", "300 123 456", "abc", "+0123456789", "+12", "600 123 4567", "30012345678901234"])(
    "rechaza el WhatsApp «%s» con un mensaje en español",
    async (malo) => {
      const a = await nueva("Barbería que rechaza");
      await guardar(a.userId, "300 123 4567", "Calle 1");
      await expect(guardar(a.userId, malo, "Otra")).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining("El WhatsApp no es válido"),
      });
      // Falló: no se cambió nada.
      expect(await contactoDe(a.userId)).toMatchObject({ whatsapp: "+573001234567", direccion: "Calle 1" });
    }
  );

  it("quita el dato que llega vacío o null, y los espacios de sobra de la dirección", async () => {
    const a = await nueva("Barbería que quita");
    await guardar(a.userId, "300 123 4567", "Calle 1");
    expect(await guardar(a.userId, "   ", "  Carrera   9   #12-34  ")).toEqual({
      whatsapp: null,
      direccion: "Carrera 9 #12-34",
    });
    expect(await guardar(a.userId, null, "")).toEqual({ whatsapp: null, direccion: null });
    expect(await contactoDe(a.userId)).toMatchObject({ whatsapp: null, direccion: null });
  });

  it("la dirección llega hasta 120 caracteres y no más", async () => {
    const a = await nueva("Dirección larga");
    expect((await guardar(a.userId, null, "x".repeat(120))).direccion).toHaveLength(120);
    await expect(guardar(a.userId, null, "x".repeat(121))).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("La dirección es muy larga"),
    });
  });

  it("solo el dueño o quien tiene el área «servicios»; ni el barbero, ni recepción, ni la caja", async () => {
    const e = await crearEscenarioAgenda(db);
    for (const actor of [e.cuentaCamilo, e.recepcion, e.cajero]) {
      await expect(guardar(actor, "300 123 4567", "Calle 1")).rejects.toMatchObject({ code: "42501" });
    }
    expect(await contactoDe(e.userId)).toMatchObject({ whatsapp: null, direccion: null });

    await crearRol(db, e.barberiaId, "Administrador", ["servicios"]);
    const admin = await crearMiembro(db, e.barberiaId, "Admin", ["Administrador"]);
    expect((await guardar(admin, "300 123 4567", "Calle 1")).whatsapp).toBe("+573001234567");
  });

  it("alguien sin barbería y quien no inició sesión no pueden", async () => {
    const u = await db.query<{ id: string }>(`insert into auth.users (email) values ('sinperfil-contacto@ejemplo.test') returning id`);
    await expect(guardar(u.rows[0].id, "300 123 4567", "Calle 1")).rejects.toMatchObject({ code: "42501" });
    await expect(
      rpc(db, null, "actualizar_contacto_barberia", { p_whatsapp: "300 123 4567", p_direccion: "Calle 1" })
    ).rejects.toThrow();
  });

  it("cambia solo la barbería de quien llama", async () => {
    const a = await nueva("Barbería Alfa del contacto");
    const b = await nueva("Barbería Beta del contacto");
    await guardar(b.userId, "311 000 0000", "Calle de Beta");
    await guardar(a.userId, "300 123 4567", "Calle de Alfa");
    expect(await contactoDe(a.userId)).toMatchObject({ whatsapp: "+573001234567", direccion: "Calle de Alfa" });
    expect(await contactoDe(b.userId)).toMatchObject({ whatsapp: "+573110000000", direccion: "Calle de Beta" });
  });

  it("lo nuevo lo ven la reserva pública y la página de la cita (sin cambiar sus funciones)", async () => {
    const e = await crearEscenarioAgenda(db);
    await guardar(e.userId, "300 123 4567", "Carrera 9 #12-34");
    const cat = await rpc<{ barberia: Contacto }>(db, null, "publico_catalogo", { p_slug: e.slug });
    expect(cat.barberia).toMatchObject({ whatsapp: "+573001234567", direccion: "Carrera 9 #12-34" });

    await guardar(e.userId, null, null);
    const sin = await rpc<{ barberia: Contacto }>(db, null, "publico_catalogo", { p_slug: e.slug });
    expect(sin.barberia).toMatchObject({ whatsapp: null, direccion: null });
  });
});
