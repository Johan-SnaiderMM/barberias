import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CATEGORIAS_GASTO,
  esCategoriaGasto,
  esRutaFotoGasto,
  ETIQUETA_CATEGORIA,
  extensionDeFoto,
  FOTO_BYTES_MAXIMOS,
  reconocerImagen,
  rutaFotoGasto,
  tipoDeRutaFoto,
} from "./gastos";

describe("categorías", () => {
  it("son las cinco del SPEC, y todas tienen su nombre", () => {
    expect(CATEGORIAS_GASTO).toEqual(["arriendo", "insumos", "servicios_publicos", "comisiones", "otros"]);
    for (const c of CATEGORIAS_GASTO) expect(ETIQUETA_CATEGORIA[c].length).toBeGreaterThan(0);
    expect(ETIQUETA_CATEGORIA.servicios_publicos).toBe("Servicios públicos");
  });

  it("esCategoriaGasto", () => {
    for (const c of CATEGORIAS_GASTO) expect(esCategoriaGasto(c)).toBe(true);
    for (const x of ["", "Arriendo", "luz", null, undefined, 3]) expect(esCategoriaGasto(x)).toBe(false);
  });
});

describe("la foto", () => {
  it("solo se aceptan jpg, png y webp", () => {
    expect(extensionDeFoto("image/jpeg")).toBe("jpg");
    expect(extensionDeFoto("image/png")).toBe("png");
    expect(extensionDeFoto("image/webp")).toBe("webp");
    for (const t of ["image/gif", "image/svg+xml", "application/pdf", "text/html", ""]) expect(extensionDeFoto(t)).toBeNull();
  });

  it("la ruta es <barbería>/<clave>.<extensión>", () => {
    const barberia = randomUUID();
    const clave = randomUUID();
    expect(rutaFotoGasto(barberia, clave, "image/jpeg")).toBe(`${barberia}/${clave}.jpg`);
    expect(rutaFotoGasto(barberia, clave, "image/png")).toBe(`${barberia}/${clave}.png`);
    expect(rutaFotoGasto(barberia, clave, "image/gif")).toBeNull();
    expect(rutaFotoGasto("../etc", clave, "image/jpeg")).toBeNull();
    expect(rutaFotoGasto(barberia, "../../x", "image/jpeg")).toBeNull();
  });

  it("esRutaFotoGasto rechaza lo que no tiene exactamente esa forma (nada de salirse de la carpeta)", () => {
    const a = randomUUID();
    const b = randomUUID();
    expect(esRutaFotoGasto(`${a}/${b}.jpg`)).toBe(true);
    for (const x of [
      `${a}/${b}.gif`,
      `${a}/${b}`,
      `${a}/../${b}.jpg`,
      `../${a}/${b}.jpg`,
      `${a}/${b}.jpg/x`,
      `${a}\\${b}.jpg`,
      `/${a}/${b}.jpg`,
      `${a.toUpperCase()}/${b}.jpg`,
      "",
      null,
      undefined,
      42,
    ]) {
      expect(esRutaFotoGasto(x)).toBe(false);
    }
  });

  it("reconocerImagen mira los primeros bytes, no lo que diga el nombre", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const webp = Uint8Array.from([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WEBPVP8 ")]);
    expect(reconocerImagen(jpeg)).toBe("image/jpeg");
    expect(reconocerImagen(png)).toBe("image/png");
    expect(reconocerImagen(webp)).toBe("image/webp");
    for (const malo of [
      Buffer.from("<html><script>alert(1)</script></html>"),
      Buffer.from("GIF89a"),
      Buffer.from("%PDF-1.4"),
      Buffer.from("MZ"),
      Buffer.from("RIFF1234WAVEfmt "),
      Buffer.alloc(0),
      Uint8Array.from([0xff, 0xd8]),
    ]) {
      expect(reconocerImagen(new Uint8Array(malo))).toBeNull();
    }
  });

  it("tipoDeRutaFoto devuelve el tipo para servirla", () => {
    expect(tipoDeRutaFoto("a/b.jpg")).toBe("image/jpeg");
    expect(tipoDeRutaFoto("a/b.png")).toBe("image/png");
    expect(tipoDeRutaFoto("a/b.webp")).toBe("image/webp");
    expect(tipoDeRutaFoto("a/b.exe")).toBeNull();
    expect(tipoDeRutaFoto("sin-extension")).toBeNull();
  });

  it("el tope del servidor deja espacio bajo el límite de 1 MB de una acción", () => {
    expect(FOTO_BYTES_MAXIMOS).toBeLessThan(1_000_000);
  });
});
