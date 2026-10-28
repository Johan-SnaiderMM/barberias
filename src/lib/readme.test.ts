/**
 * El README de puesta en marcha (tarea 4.4) lo sigue un tercero sin preguntar: todo lo que cita tiene que existir. Estas
 * pruebas lo comprueban contra el código (variables, comandos, funciones SQL, archivos y los nombres de las pantallas),
 * para que un cambio que deje el README mintiendo falle aquí y no en la barbería.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const leer = (...partes: string[]) => fs.readFileSync(path.join(process.cwd(), ...partes), "utf8").replace(/\r\n/g, "\n");
const readme = leer("README.md");

function fuentes(dir: string, acumulado: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) fuentes(ruta, acumulado);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) acumulado.push(fs.readFileSync(ruta, "utf8"));
  }
  return acumulado;
}

describe("README: variables de entorno", () => {
  const ejemplo = leer(".env.example");
  const variables = [...ejemplo.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);

  it("cita todas las variables de .env.example", () => {
    expect(variables.length).toBeGreaterThan(5);
    for (const v of variables) expect(readme, v).toContain(v);
  });

  it("cita todas las variables que lee el código (salvo las de Next)", () => {
    const usadas = new Set(
      fuentes(path.join(process.cwd(), "src"))
        .flatMap((f) => [...f.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]))
        .filter((v) => v !== "NODE_ENV")
    );
    for (const v of usadas) {
      expect(readme, v).toContain(v);
      expect(variables, `${v} debe estar en .env.example`).toContain(v);
    }
  });

  it("dice que las variables de Supabase, la llave privada y la de la demo son solo del servidor y que la service_role no se usa", () => {
    expect(readme).toContain("service_role");
    expect(readme).toMatch(/SUPABASE_URL[^\n]*solo servidor/);
    expect(readme).toMatch(/SUPABASE_ANON_KEY[^\n]*solo servidor/);
    expect(readme).toMatch(/VAPID_PRIVATE_KEY[^\n]*solo servidor/);
    expect(readme).toMatch(/DEMO_EMAIL[^\n]*solo servidor/);
    // Las de Supabase ya no llevan NEXT_PUBLIC_: ninguna parte del código ni de la configuración las lee con ese nombre.
    for (const f of [...fuentes(path.join(process.cwd(), "src")), leer("next.config.ts"), leer(".env.example")]) {
      expect(f).not.toContain("NEXT_PUBLIC_SUPABASE");
    }
    // Y de verdad no se usa en la app (el modo local solo declara los roles de Postgres que imita de Supabase).
    for (const f of fuentes(path.join(process.cwd(), "src")).filter((c) => !c.includes("Lo mínimo de Supabase"))) {
      expect(f).not.toMatch(/service_role|SERVICE_ROLE/);
    }
  });
});

describe("README: comandos", () => {
  const scripts = Object.keys(JSON.parse(leer("package.json")).scripts as Record<string, string>);

  it("todos los `npm run X` que cita existen en package.json", () => {
    const citados = [...readme.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((m) => m[1]);
    expect(citados.length).toBeGreaterThan(5);
    for (const c of citados) expect(scripts, c).toContain(c);
  });

  it("explica cómo instalar, correr y compilar", () => {
    expect(readme).toContain("npm install");
    expect(readme).toContain("npm run dev");
    expect(readme).toContain("npm run build");
    expect(scripts).toContain("verificar");
  });
});

describe("README: la base de datos", () => {
  const esquema = leer("supabase", "esquema-completo.sql");

  it("las funciones SQL que manda correr existen (y no las puede ejecutar la app)", () => {
    const citadas = [...new Set([...readme.matchAll(/public\.(fn_[a-z_]+)\(/g)].map((m) => m[1]))];
    expect(citadas).toEqual(expect.arrayContaining(["fn_crear_barberia", "fn_provisionar_demo", "fn_definir_pin_reinicio"]));
    for (const f of citadas) expect(esquema, f).toMatch(new RegExp(`create or replace function public\\.${f}\\(`));
  });

  it("el comando que carga el WhatsApp y la dirección usa columnas que existen y un formato que la base acepta", () => {
    expect(readme).toMatch(/update public\.barberias\s+set whatsapp = '\+573001234567', direccion = '[^']+'\s+where slug = '[a-z0-9-]+';/);
    expect(esquema).toMatch(/whatsapp\s+text check \(whatsapp is null or whatsapp ~ '\^\\\+\[1-9\]\[0-9\]\{7,14\}\$'\)/);
    expect("+573001234567").toMatch(/^\+[1-9][0-9]{7,14}$/);
  });

  it("el bucket privado de los recibos y el paso de los inicios de sesión anónimos están donde dice", () => {
    expect(esquema).toContain("gastos-fotos");
    expect(readme).toContain("gastos-fotos");
    expect(readme).toContain("Allow anonymous sign-ins");
  });
});

describe("README: archivos y pantallas", () => {
  it("los archivos que enlaza existen", () => {
    const enlaces = [...readme.matchAll(/\]\(([^)#\s]+)\)/g)].map((m) => m[1]).filter((e) => !/^https?:/.test(e));
    expect(enlaces).toEqual(expect.arrayContaining(["SPEC.md", "PLAN.md", "CLAUDE.md", ".env.example", "supabase/esquema-completo.sql"]));
    for (const e of enlaces) expect(fs.existsSync(path.join(process.cwd(), e)), e).toBe(true);
  });

  it("los nombres de pantalla que manda tocar existen en la app", () => {
    const codigo = fuentes(path.join(process.cwd(), "src")).join("\n");
    for (const nombre of [
      "Servicios y precios",
      "Barberos y horarios",
      "Porcentajes de comisión",
      "WhatsApp y dirección",
      "Ajustes de la agenda",
      "Cartel y enlace de reservas",
      "Avisos de reservas",
      "Reiniciar la demo",
      "Probar la demo",
      "Cierre del día",
      "Tengo un código de invitación",
      "Falta tu barbería",
    ]) {
      expect(readme, `el README debe nombrar «${nombre}»`).toContain(nombre);
      expect(codigo, `la app debe tener «${nombre}»`).toContain(nombre);
    }
  });

  it("las rutas públicas que cita existen como páginas", () => {
    for (const ruta of ["reservar/[slug]", "cita/[token]", "entrar", "unirme", "privacidad"]) {
      expect(fs.existsSync(path.join(process.cwd(), "src", "app", ...ruta.split("/"), "page.tsx")), ruta).toBe(true);
    }
  });
});
