/**
 * La ficha de venta y precios (tarea 4.5, docs/venta/FICHA-DE-VENTA.md) trae tus costos y tus márgenes: es SOLO LOCAL
 * (está en .gitignore). Estas pruebas cuidan que no se suba por error y que sus cuentas cuadren, para que «lista para
 * cotizar» sea cierto. Si el archivo no está (otra copia del repositorio), las de contenido se saltan.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RUTA = path.join(process.cwd(), "docs", "venta", "FICHA-DE-VENTA.md");
const hayFicha = fs.existsSync(RUTA);
const ficha = hayFicha ? fs.readFileSync(RUTA, "utf8").replace(/\r\n/g, "\n") : "";

/** '1.300.000' -> 1300000 ; '−100.000' -> -100000 */
const pesos = (texto: string): number => {
  const negativo = /^[−-]/.test(texto.trim());
  const n = Number(texto.replace(/[^0-9]/g, ""));
  return negativo ? -n : n;
};
/** Las celdas de una fila de tabla Markdown que empieza con `etiqueta`. */
function fila(etiqueta: string): string[] {
  const linea = ficha.split("\n").find((l) => l.startsWith(`| ${etiqueta}`));
  if (!linea) throw new Error(`no hay una fila «${etiqueta}»`);
  return linea.split("|").slice(1, -1).map((c) => c.trim());
}

describe("la ficha de venta no se sube por error", () => {
  it("docs/venta/ está en .gitignore", () => {
    const ignorado = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf8").split(/\r?\n/);
    expect(ignorado).toContain("/docs/venta/");
  });

  it("el README no manda a nadie a un archivo que no se sube", () => {
    const readme = fs.readFileSync(path.join(process.cwd(), "README.md"), "utf8");
    expect(readme).not.toContain("docs/venta");
  });
});

describe.skipIf(!hayFicha)("las cuentas de la ficha de venta", () => {
  it("el pago anual de cada plan es 10 mensualidades (≈ 2 meses gratis)", () => {
    const mensual = fila("Precio al mes").slice(1).map(pesos);
    const anual = fila("Pago anual (10 meses)").slice(1).map(pesos);
    expect(mensual).toEqual([50_000, 80_000, 130_000]);
    expect(anual).toEqual(mensual.map((m) => m * 10));
  });

  it("el costo base es Vercel Pro + Supabase Pro y el punto de equilibrio cuadra", () => {
    // ~20 USD + ~25 USD a ~4.000 COP = 180.000 COP/mes para todas las barberías juntas.
    const base = (20 + 25) * 4_000;
    expect(base).toBe(180_000);
    expect(ficha).toContain("~180.000 COP/mes, para todas las barberías juntas");
    for (const n of ["1", "2", "3", "6"]) {
      const [, ingreso, costo, margen] = fila(n);
      expect(pesos(ingreso), `${n} barberías: ingreso`).toBe(Number(n) * 80_000);
      expect(pesos(costo), `${n} barberías: costo`).toBe(base);
      expect(pesos(margen), `${n} barberías: margen`).toBe(Number(n) * 80_000 - base);
    }
    // «Con 3 barberías se cubre la infraestructura»: la primera con margen positivo es la tercera.
    expect(pesos(fila("2")[3])).toBeLessThan(0);
    expect(pesos(fila("3")[3])).toBeGreaterThan(0);
    expect(ficha).toContain("Con **3 barberías** en el plan Estándar");
  });

  it("trae la plantilla de cotización con implementación, plan y total", () => {
    const plantilla = ficha.slice(ficha.indexOf("COTIZACIÓN: Barberías"));
    for (const frase of ["1. IMPLEMENTACIÓN (pago único)", "2. MANTENIMIENTO MENSUAL", "[ ] Básico  [ ] Estándar  [ ] Plus", "TOTAL PRIMER MES", "Forma de pago", "No incluye"]) {
      expect(plantilla, frase).toContain(frase);
    }
  });

  it("dice con claridad lo que NO incluye, sin prometer de más", () => {
    expect(ficha).toContain("Lo que NO incluye");
    expect(ficha).toMatch(/necesita internet/);
    expect(ficha).toMatch(/nunca envía mensajes/);
    for (const fuera of ["Fiado", "DIAN", "Renta de silla", "Multi-sede"]) expect(ficha, fuera).toContain(fuera);
  });

  it("avisa lo que todavía no se probó de verdad antes de cotizar", () => {
    const antes = ficha.slice(ficha.indexOf("## 11. Antes de cotizar"));
    expect(antes).toContain("Supabase ni Vercel de verdad");
    for (const tarea of ["README.md", "esquema-completo.sql", "foto del recibo", "avisos push", "abogado", "WhatsApp y la dirección"]) {
      expect(antes, tarea).toContain(tarea);
    }
  });

  it("lo que dice de la app es cierto: la demo y el cartel existen", () => {
    for (const ruta of [["app", "entrar", "boton-demo.tsx"], ["app", "(tarea)", "cartel", "page.tsx"], ["app", "reservar", "[slug]", "page.tsx"]]) {
      expect(fs.existsSync(path.join(process.cwd(), "src", ...ruta)), ruta.join("/")).toBe(true);
    }
    expect(ficha).toContain("Probar la demo");
    expect(ficha).toContain("Reiniciar la demo");
  });
});
