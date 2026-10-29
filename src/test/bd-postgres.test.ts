/**
 * La demo pública sobre una base Postgres COMPARTIDA (p. ej. Neon): lo que hace que varias copias del servidor (Vercel)
 * vean lo mismo. Se prueba por red de verdad: PGlite expuesto por un socket TCP y `pg` como cliente, igual que en
 * producción. Cada "copia del servidor" de estas pruebas es un grupo de conexiones propio contra la misma base.
 */
import net from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archivosEnPostgres } from "@/lib/local/archivos";
import { construirBd, type AlmacenCookies } from "@/lib/local/bd-local";
import { motorDePostgres, type Motor } from "@/lib/local/motor";
import { MARCA_DEMO, prepararBasePostgres, renovarDemoSiHaceFalta } from "@/lib/local/preparar";

const puertoLibre = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

/** Una base "en la red" y la forma de abrir más grupos de conexiones contra ella (cada uno, una copia del servidor). */
async function baseEnLaRed() {
  const db = await PGlite.create({ extensions: { btree_gist } });
  const port = await puertoLibre();
  const servidor = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 12 });
  await servidor.start();
  const pools: Pool[] = [];
  const copia = (): Motor => {
    const pool = new Pool({ host: "127.0.0.1", port, user: "postgres", database: "postgres", max: 4 });
    pool.on("error", () => undefined);
    pools.push(pool);
    return motorDePostgres(pool);
  };
  return {
    db,
    copia,
    async cerrar() {
      await Promise.all(pools.map((p) => p.end()));
      await servidor.stop();
      await db.close();
    },
  };
}

function galletas(inicial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(inicial));
  const almacen: AlmacenCookies = {
    get: (n) => (jar.has(n) ? { value: jar.get(n)! } : undefined),
    set: (n, v) => jar.set(n, v),
    delete: (n) => jar.delete(n),
  };
  return { jar, almacen };
}

const bdDe = (motor: Motor, cookies: ReturnType<typeof galletas>) =>
  construirBd({ almacen: cookies.almacen, motor, archivos: archivosEnPostgres(motor, 1024), publica: true, compartida: true });

const crearCliente = (bd: ReturnType<typeof construirBd>, nombre: string, telefono: string) =>
  bd.rpc<{ id: string }>("crear_cliente", { p_nombre: nombre, p_telefono: telefono });

describe("base Postgres compartida", () => {
  let red: Awaited<ReturnType<typeof baseEnLaRed>>;
  let servidorA: Motor;
  let servidorB: Motor;

  beforeAll(async () => {
    red = await baseEnLaRed();
    servidorA = red.copia();
    servidorB = red.copia();
    await prepararBasePostgres(servidorA);
  }, 120_000);

  afterAll(async () => {
    await red.cerrar();
  });

  it("arma el esquema, la marca y la demo", async () => {
    const estado = await servidorA.query<{ marca: string }>(`select marca from demo.estado`);
    expect(estado.rows.map((r) => r.marca)).toEqual([MARCA_DEMO]);
    const barberias = await servidorA.query<{ es_demo: boolean }>(`select es_demo from public.barberias order by es_demo`);
    expect(barberias.rows.map((r) => r.es_demo)).toEqual([false, true]);
    const usuarios = await servidorA.query<{ n: number }>(`select count(*)::int as n from auth.users`);
    expect(usuarios.rows[0].n).toBe(2);
    // La migración de las citas necesita btree_gist: tiene que haberse instalado.
    const ext = await servidorA.query<{ n: number }>(`select count(*)::int as n from pg_extension where extname = 'btree_gist'`);
    expect(ext.rows[0].n).toBe(1);
  });

  it("volver a prepararla desde otra copia del servidor no cambia nada", async () => {
    const antes = await servidorA.query<{ t: string }>(`select sembrado_en::text as t from demo.estado`);
    await prepararBasePostgres(servidorB);
    const despues = await servidorA.query<{ t: string }>(`select sembrado_en::text as t from demo.estado`);
    expect(despues.rows[0].t).toBe(antes.rows[0].t);
    expect((await servidorA.query<{ n: number }>(`select count(*)::int as n from auth.users`)).rows[0].n).toBe(2);
  });

  it("la sesión de una copia vale en la otra, y lo que escribe una lo lee la otra", async () => {
    const galletasA = galletas();
    const a = bdDe(servidorA, galletasA);
    expect(await a.usuario()).toBeNull();
    expect((await a.entrarDemo()).error).toBeNull();
    expect((await a.usuario())?.email).toBe("demo@local.test");

    // Otra copia del servidor, otro grupo de conexiones: recibe la misma cookie que el navegador mandó.
    const galletasB = galletas({ bd_local_uid: galletasA.jar.get("bd_local_uid")! });
    const b = bdDe(servidorB, galletasB);
    expect((await b.usuario())?.email).toBe("demo@local.test");

    const nuevo = await crearCliente(a, "Cliente de la base compartida", "3001239999");
    expect(nuevo.error).toBeNull();
    const leido = await b.rpc<{ nombre: string } | null>("obtener_cliente", { p_id: nuevo.data!.id });
    expect(leido.error).toBeNull();
    expect(leido.data?.nombre).toBe("Cliente de la base compartida");
  });

  it("no hay entrada por contraseña", async () => {
    const bd = bdDe(servidorA, galletas());
    const r = await bd.entrarConClave("dueno@local.test", "cualquiera");
    expect(r.error).toMatch(/demo pública/);
    expect(await bd.usuario()).toBeNull();
  });

  it("las fotos viven en la base: las ve otra copia, con tope y sin rutas raras", async () => {
    const a = bdDe(servidorA, galletas());
    await a.entrarDemo();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect((await a.subirArchivo("gastos", "barberia/gasto/uno.jpg", bytes, "image/jpeg")).error).toBeNull();
    // Subir otra vez la misma ruta no es un error ni duplica.
    expect((await a.subirArchivo("gastos", "barberia/gasto/uno.jpg", bytes, "image/jpeg")).error).toBeNull();

    // Otra copia, con la misma sesión (los recibos son privados: se leen con sesión).
    const galletasA = galletas();
    const b = bdDe(servidorB, galletasA);
    await b.entrarDemo();
    const leida = await b.leerArchivo("gastos", "barberia/gasto/uno.jpg");
    expect(leida?.tipo).toBe("image/jpeg");
    expect(Array.from(leida!.datos)).toEqual([1, 2, 3, 4]);
    // Sin sesión no se lee.
    expect(await bdDe(servidorB, galletas()).leerArchivo("gastos", "barberia/gasto/uno.jpg")).toBeNull();

    expect((await a.subirArchivo("gastos", "../fuera.jpg", bytes, "image/jpeg")).error).toMatch(/ruta/);
    // El tope de estas pruebas es de 1 KB.
    expect((await a.subirArchivo("gastos", "barberia/gasto/grande.jpg", new Uint8Array(2048), "image/jpeg")).error).toMatch(/llenó/);
  });

  it("renueva la demo cuando pasa el tiempo, una sola vez, y borra lo que se hizo", async () => {
    const a = bdDe(servidorA, galletas());
    await a.entrarDemo();
    const creado = await crearCliente(a, "Cliente que debe desaparecer", "3001238888");
    expect(creado.error).toBeNull();
    const hay = () =>
      servidorA.query<{ n: number }>(`select count(*)::int as n from public.clientes where nombre = 'Cliente que debe desaparecer'`);
    expect((await hay()).rows[0].n).toBe(1);

    // Recién sembrada: no toca nada.
    expect(await renovarDemoSiHaceFalta(servidorA)).toBe(false);
    expect((await hay()).rows[0].n).toBe(1);

    await servidorA.query(`update demo.estado set sembrado_en = now() - interval '5 hours'`);
    expect(await renovarDemoSiHaceFalta(servidorA)).toBe(true);
    expect((await hay()).rows[0].n).toBe(0);
    expect((await servidorA.query<{ n: number }>(`select count(*)::int as n from demo.archivos`)).rows[0].n).toBe(0);

    // Y ya no vuelve a hacerlo hasta que pase otro rato.
    expect(await renovarDemoSiHaceFalta(servidorB)).toBe(false);
  });

  it("si las migraciones cambian, recrea lo suyo y vuelve a dejar la demo lista", async () => {
    await servidorA.query(`update demo.estado set huella = 'migraciones-viejas'`);
    await prepararBasePostgres(servidorB);
    const estado = await servidorA.query<{ huella: string }>(`select huella from demo.estado`);
    expect(estado.rows[0].huella).not.toBe("migraciones-viejas");
    const demo = await servidorA.query<{ n: number }>(`select count(*)::int as n from public.barberias where es_demo`);
    expect(demo.rows[0].n).toBe(1);
  });
});

describe("base Postgres compartida: seguridad", () => {
  it("no toca una base que ya tiene tablas de otra cosa", async () => {
    const red = await baseEnLaRed();
    try {
      const motor = red.copia();
      await motor.exec(`create table public.clientes_reales (id int primary key, nombre text); insert into public.clientes_reales values (1, 'Ana');`);
      await expect(prepararBasePostgres(motor)).rejects.toThrow(/ya tiene tablas que no son de la demo/);
      const sigue = await motor.query<{ nombre: string }>(`select nombre from public.clientes_reales`);
      expect(sigue.rows).toEqual([{ nombre: "Ana" }]);
      // Y no dejó nada a medias: ni la marca ni el esquema.
      expect((await motor.query<{ hay: boolean }>(`select to_regclass('demo.estado') is not null as hay`)).rows[0].hay).toBe(false);
    } finally {
      await red.cerrar();
    }
  }, 120_000);

  it("no pisa la demo de OTRA app si se conecta la misma base por error", async () => {
    const red = await baseEnLaRed();
    try {
      const motor = red.copia();
      await prepararBasePostgres(motor);
      await motor.query(`update demo.estado set marca = 'otra-app-demo', huella = 'otra-huella'`);
      await expect(prepararBasePostgres(motor)).rejects.toThrow(/pertenece a otra demo/);
      // Sus datos siguen ahí, intactos.
      expect((await motor.query<{ n: number }>(`select count(*)::int as n from public.barberias where es_demo`)).rows[0].n).toBe(1);
      expect((await motor.query<{ marca: string }>(`select marca from demo.estado`)).rows[0].marca).toBe("otra-app-demo");
    } finally {
      await red.cerrar();
    }
  }, 120_000);

  it("varias copias del servidor que arrancan a la vez dejan UNA sola demo", async () => {
    const red = await baseEnLaRed();
    try {
      const copias = [red.copia(), red.copia(), red.copia()];
      await Promise.all(copias.map((c) => prepararBasePostgres(c)));
      const m = copias[0];
      expect((await m.query<{ n: number }>(`select count(*)::int as n from demo.estado`)).rows[0].n).toBe(1);
      expect((await m.query<{ n: number }>(`select count(*)::int as n from auth.users`)).rows[0].n).toBe(2);
      expect((await m.query<{ n: number }>(`select count(*)::int as n from public.barberias where es_demo`)).rows[0].n).toBe(1);
    } finally {
      await red.cerrar();
    }
  }, 120_000);
});
