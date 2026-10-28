import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { qrSvg } from "./qr";

describe("qrSvg", () => {
  it("devuelve un SVG con los colores de la marca", async () => {
    const svg = await qrSvg("https://barberias.ejemplo.com/reservar/mi-barberia");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox=");
    expect(svg).toContain("#18181b");
    expect(svg).toContain("<path");
  });

  it("codifica exactamente el enlace (se lee de vuelta de los bytes del código)", () => {
    const url = "https://barberias.ejemplo.com/reservar/mi-barberia";
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const texto = qr.segments.map((s) => (typeof s.data === "string" ? s.data : new TextDecoder().decode(s.data))).join("");
    expect(texto).toBe(url);
  });

  it("un enlace más largo da un código más grande", async () => {
    const corto = QRCode.create("https://a.co/r/x", { errorCorrectionLevel: "M" }).modules.size;
    const largo = QRCode.create("https://barberias.ejemplo.com/reservar/una-barberia-con-nombre-largo", {
      errorCorrectionLevel: "M",
    }).modules.size;
    expect(largo).toBeGreaterThan(corto);
  });
});
