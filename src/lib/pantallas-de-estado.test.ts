/**
 * Pantallas de carga y de error (auditoría antislop 001, hallazgo 7). Las de carga van SOLO en las pantallas del personal:
 * en una página pública, `loading.tsx` hace que el servidor responda 200 antes de saber si la cita o la barbería existe,
 * y el 404 de un enlace que no existe se pierde (lo comprueba la prueba de punta a punta).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const app = (...partes: string[]) => path.join(process.cwd(), "src", "app", ...partes);
const hay = (...partes: string[]) => fs.existsSync(app(...partes));

describe("pantallas de carga y de error", () => {
  it("hay carga en las pantallas del personal y error en la raíz y en el diseño raíz", () => {
    expect(hay("(app)", "loading.tsx")).toBe(true);
    expect(hay("(tarea)", "loading.tsx")).toBe(true);
    expect(hay("error.tsx")).toBe(true);
    expect(hay("global-error.tsx")).toBe(true);
  });

  it("no hay `loading.tsx` en las páginas públicas (perderían el 404)", () => {
    for (const ruta of [["reservar"], ["reservar", "[slug]"], ["cita"], ["cita", "[token]"], ["aviso-de-privacidad"], ["privacidad"]]) {
      expect(hay(...ruta, "loading.tsx"), ruta.join("/")).toBe(false);
    }
  });

  it("los textos están en español y no muestran el mensaje técnico del error", () => {
    for (const archivo of ["error.tsx", "global-error.tsx"]) {
      const codigo = fs.readFileSync(app(archivo), "utf8");
      expect(codigo, archivo).toContain("Reintentar");
      expect(codigo, archivo).not.toMatch(/\{error\.message\}|Something went wrong/);
    }
  });
});
