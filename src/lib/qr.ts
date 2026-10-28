import "server-only";
import QRCode from "qrcode";

/**
 * Código QR como SVG (se pinta en el servidor: nada de generarlo en el navegador). Corrección de errores M: sigue
 * leyéndose si el cartel se mancha un poco. Colores de la marca; margen de 1 módulo (el cartel ya deja su espacio).
 */
export async function qrSvg(texto: string): Promise<string> {
  return QRCode.toString(texto, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#18181b", light: "#ffffff" },
  });
}
