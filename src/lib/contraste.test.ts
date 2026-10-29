/**
 * Contraste de la paleta (WCAG 2.x) en modo claro Y en modo oscuro: los pares de color que la app usa de verdad, calculados
 * con la fórmula, no a ojo. Si cambias un token de `globals.css` o un color de foco, de borde o de texto de ejemplo, esto
 * avisa si deja de leerse.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const leer = (...partes: string[]) => fs.readFileSync(path.join(process.cwd(), ...partes), "utf8").replace(/\r\n/g, "\n");

const css = leer("src", "app", "globals.css");
const bloque = (re: RegExp): string => {
  const m = css.match(re);
  if (!m) throw new Error(`globals.css no tiene ${re}`);
  return m[1];
};
const colores = (texto: string): Record<string, string> =>
  Object.fromEntries([...texto.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [m[1], m[2]]));

const CLARO = colores(bloque(/@theme \{([^}]*)\}/));
const BLOQUE_AUTO = bloque(/:root:not\(\[data-tema="claro"\]\) \{([^}]*)\}/);
const BLOQUE_FIJO = bloque(/:root\[data-tema="oscuro"\] \{([^}]*)\}/);
// El modo oscuro solo cambia algunos tokens: el resto (oro, rojo-solido…) vale igual.
const OSCURO = { ...CLARO, ...colores(BLOQUE_FIJO) };
const BLANCO = "#ffffff";
const TINTA_SOBRE_ORO = "#18181b";

function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

const MODOS: [string, Record<string, string>][] = [
  ["claro", CLARO],
  ["oscuro", OSCURO],
];

describe("la paleta de globals.css", () => {
  it("trae los tokens que usa la app, en claro y en oscuro", () => {
    for (const [, t] of MODOS) {
      for (const n of ["tinta", "tinta-2", "papel", "hueso", "superficie", "linea", "borde-campo", "oro", "rojo", "rojo-solido", "azul"]) {
        expect(t[n], n).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("calcula bien: negro sobre blanco es 21:1 y #777 sobre blanco no llega a 4,5", () => {
    expect(contraste("#000000", BLANCO)).toBeCloseTo(21, 5);
    expect(contraste("#777777", BLANCO)).toBeLessThan(4.5);
  });

  it("el modo oscuro de «seguir al celular» y el de «fijarlo» llevan los mismos colores", () => {
    const normal = (t: string) => t.replace(/\s+/g, " ").trim();
    expect(normal(BLOQUE_AUTO)).toBe(normal(BLOQUE_FIJO));
  });

  it("el texto llega a AA (4,5:1) sobre cada fondo donde se usa", () => {
    for (const [modo, t] of MODOS) {
      for (const f of [t.superficie, t.papel, t.hueso]) {
        for (const texto of ["tinta", "tinta-2", "rojo", "azul"]) {
          expect(contraste(t[texto], f), `${texto} sobre ${f} (${modo})`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("la letra de los botones llega a AA: papel sobre tinta, blanco sobre rojo sólido y tinta sobre oro", () => {
    for (const [modo, t] of MODOS) {
      expect(contraste(t.papel, t.tinta), `papel sobre tinta (${modo})`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(BLANCO, t["rojo-solido"]), `blanco sobre rojo sólido (${modo})`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(TINTA_SOBRE_ORO, t.oro), `tinta sobre oro (${modo})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("el borde de los campos y el anillo de foco llegan a 3:1 sobre la superficie y sobre el papel", () => {
    for (const [modo, t] of MODOS) {
      for (const f of [t.superficie, t.papel]) {
        expect(contraste(t["borde-campo"], f), `borde-campo sobre ${f} (${modo})`).toBeGreaterThanOrEqual(3);
        expect(contraste(t.tinta, f), `foco (tinta) sobre ${f} (${modo})`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("las clases que no deben volver", () => {
  const fuentes: [string, string][] = [];
  (function recorrer(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.(tsx|css)$/.test(e.name)) fuentes.push([ruta, fs.readFileSync(ruta, "utf8")]);
    }
  })(path.join(process.cwd(), "src"));

  it("ningún anillo de foco ni texto de ejemplo en zinc-400 (2,5:1), ni campos con el borde tenue", () => {
    for (const [ruta, codigo] of fuentes) {
      expect(codigo, ruta).not.toMatch(/focus-visible:(outline|ring|border)-zinc-400|placeholder:text-zinc-400/);
      // Un campo (input, select, textarea) con borde `linea` se pierde sobre la superficie: lleva `borde-campo`.
      expect(codigo, ruta).not.toMatch(/min-h-12 (?:w-full|min-w-0 flex-1) rounded-xl border border-linea bg-superficie px-3 text-base/);
    }
  });

  it("nada de letra de 12 px (`text-xs`) ni del guion largo en el texto de la app", () => {
    for (const [ruta, codigo] of fuentes) {
      expect(codigo, ruta).not.toMatch(/text-xs/);
      expect(codigo, ruta).not.toContain("—");
    }
  });

  it("nadie pinta con blanco o negro fijos: se usan los tokens para que el modo oscuro funcione", () => {
    for (const [ruta, codigo] of fuentes) {
      expect(codigo, ruta).not.toMatch(/\b(?:bg|border|divide|ring|outline|fill|stroke)-(?:white|black)\b/);
      for (const linea of codigo.split("\n")) {
        // La única letra blanca que queda es sobre un relleno sólido de color (`rojo-solido`, `verde-solido`).
        if (/\btext-white\b/.test(linea)) expect(linea, ruta).toMatch(/-solido/);
      }
    }
  });
});
