/**
 * Los componentes `"use client"` viajan al navegador: no pueden arrastrar (directa ni indirectamente) Zod ni
 * `server-only` ni el código de base de datos. Recorre sus importaciones, deteniéndose en las acciones del servidor
 * (`"use server"`), que el navegador solo ve como una referencia.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");
const PROHIBIDOS = ["zod", "server-only", "@supabase/ssr", "@supabase/supabase-js", "@electric-sql/pglite", "node:"];

function archivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

function empiezaCon(texto: string, directiva: string): boolean {
  return new RegExp(`^\\s*(?:\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/\\s*)*["']${directiva}["']`).test(texto);
}

function resolver(desde: string, especificador: string): string | null {
  const base = especificador.startsWith("@/")
    ? path.join(SRC, especificador.slice(2))
    : especificador.startsWith(".")
      ? path.resolve(path.dirname(desde), especificador)
      : null;
  if (!base) return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx"), base]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function importaciones(texto: string): string[] {
  return [...texto.matchAll(/(?:^|\n)\s*(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map(
    (m) => m[1] ?? m[2]
  );
}

/** Devuelve la cadena de archivos hasta un módulo prohibido, o null si el cliente queda limpio. */
function buscarProhibido(archivo: string, visitados: Set<string>, cadena: string[]): string[] | null {
  if (visitados.has(archivo)) return null;
  visitados.add(archivo);
  const texto = fs.readFileSync(archivo, "utf8");
  if (cadena.length > 0 && empiezaCon(texto, "use server")) return null; // frontera: el cliente solo ve una referencia
  for (const imp of importaciones(texto)) {
    if (PROHIBIDOS.some((p) => imp === p || imp.startsWith(p.endsWith(":") ? p : `${p}/`))) {
      return [...cadena, path.relative(SRC, archivo), imp];
    }
    const destino = resolver(archivo, imp);
    if (destino) {
      const r = buscarProhibido(destino, visitados, [...cadena, path.relative(SRC, archivo)]);
      if (r) return r;
    }
  }
  return null;
}

const clientes = archivos(SRC).filter((f) => empiezaCon(fs.readFileSync(f, "utf8"), "use client"));

describe("componentes de cliente", () => {
  it("existe al menos uno que verificar", () => {
    expect(clientes.length).toBeGreaterThan(0);
  });

  it.each(clientes.map((f) => path.relative(SRC, f)))("%s no arrastra código de servidor", (rel) => {
    const camino = buscarProhibido(path.join(SRC, rel), new Set(), []);
    expect(camino, camino ? `Arrastra código de servidor: ${camino.join(" → ")}` : "").toBeNull();
  });

  it("la detección funciona: un cliente que importa Zod sí se atrapa", () => {
    const dir = fs.mkdtempSync(path.join(SRC, "..", ".peso-"));
    try {
      const f = path.join(dir, "malo.tsx");
      fs.writeFileSync(f, `"use client";\nimport { z } from "zod";\nexport const x = z;\n`);
      expect(buscarProhibido(f, new Set(), [])).not.toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
