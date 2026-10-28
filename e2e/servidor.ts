/**
 * Prepara y levanta la app para las pruebas de punta a punta: una base LOCAL aparte (`.local-e2e/`, nunca la de
 * desarrollo) con una barbería de prueba lista para reservar, y `next dev` apuntando a ella.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { huellaMigraciones, leerMigraciones, SUPABASE_MINIMO } from "@/lib/local/esquema-supabase";
import { crearEscenarioAgenda, type EscenarioAgenda } from "../src/test/escenario";

const RAIZ = process.cwd();
export const DIR_E2E = path.join(RAIZ, ".local-e2e");

export type Servidor = {
  url: string;
  escenario: EscenarioAgenda;
  detener: () => Promise<void>;
};

async function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

/**
 * Crea la base desde cero con TODAS las migraciones y una barbería con servicios, dos barberos y horario todos los
 * días (el mismo escenario de las pruebas de agenda). Escribe la huella para que el servidor no la recree.
 */
async function prepararBase(): Promise<EscenarioAgenda> {
  fs.rmSync(DIR_E2E, { recursive: true, force: true });
  fs.mkdirSync(DIR_E2E, { recursive: true });

  const db = new PGlite(path.join(DIR_E2E, "pglite"), { extensions: { btree_gist } });
  await db.waitReady;
  await db.exec(SUPABASE_MINIMO);
  for (const [, sql] of leerMigraciones()) await db.exec(sql);

  const escenario = await crearEscenarioAgenda(db);
  await db.query(`update public.barberias set whatsapp = '+573001112233', direccion = 'Calle 1 # 2-3, Bogotá' where id = $1`, [
    escenario.barberiaId,
  ]);
  await db.close();

  fs.writeFileSync(path.join(DIR_E2E, "huella.txt"), huellaMigraciones());
  return escenario;
}

async function esperarListo(url: string, proceso: ChildProcess, salida: () => string, limiteMs: number) {
  const hasta = Date.now() + limiteMs;
  while (Date.now() < hasta) {
    if (proceso.exitCode !== null) {
      throw new Error(
        `next dev se cerró al arrancar. ¿Hay otro \`npm run dev\` corriendo en este proyecto? Ciérralo e intenta de nuevo.\n${salida()}`
      );
    }
    try {
      const r = await fetch(`${url}/entrar`, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
      if (r.status < 500) return;
    } catch {
      // todavía no responde
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`La app no respondió en ${Math.round(limiteMs / 1000)} s.\n${salida()}`);
}

export async function levantarServidor(): Promise<Servidor> {
  const escenario = await prepararBase();
  const puerto = await puertoLibre();
  const url = `http://localhost:${puerto}`;

  let salida = "";
  const proceso = spawn(process.execPath, [path.join(RAIZ, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(puerto)], {
    cwd: RAIZ,
    env: { ...process.env, DEMO_BD: "local", DEMO_BD_DIR: ".local-e2e", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const guardar = (b: Buffer) => {
    salida = (salida + b.toString()).slice(-4000);
  };
  proceso.stdout?.on("data", guardar);
  proceso.stderr?.on("data", guardar);

  const detener = async () => {
    if (proceso.exitCode === null && proceso.pid) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proceso.pid), "/T", "/F"]);
      else proceso.kill("SIGTERM");
    }
    // Espera a que suelte los archivos de la base antes de borrarla.
    await new Promise((r) => setTimeout(r, 1500));
    fs.rmSync(DIR_E2E, { recursive: true, force: true });
  };

  try {
    await esperarListo(url, proceso, () => salida, 200_000);
  } catch (e) {
    await detener();
    throw e;
  }
  return { url, escenario, detener };
}
