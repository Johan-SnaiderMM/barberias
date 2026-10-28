/**
 * Gastos: categorías, topes y reglas de la foto (el recibo). Módulo puro: lo usan las pantallas, las acciones y las
 * pruebas. Las categorías y los topes son los mismos de la migración 0024 (una prueba los compara).
 */
import type { Pesos } from "@/lib/dinero";

export const CATEGORIAS_GASTO = ["arriendo", "insumos", "servicios_publicos", "comisiones", "otros"] as const;
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number];

export const ETIQUETA_CATEGORIA: Record<CategoriaGasto, string> = {
  arriendo: "Arriendo",
  insumos: "Insumos",
  servicios_publicos: "Servicios públicos",
  comisiones: "Comisiones",
  otros: "Otros",
};

export function esCategoriaGasto(valor: unknown): valor is CategoriaGasto {
  return typeof valor === "string" && (CATEGORIAS_GASTO as readonly string[]).includes(valor);
}

/** Tope de un gasto, igual que el `check` de la base. */
export const GASTO_MAXIMO: Pesos = 50_000_000;
export const NOTA_GASTO_MAXIMA = 120;

/** Nombre del bucket privado de las fotos (migración 0024). */
export const BUCKET_FOTOS_GASTOS = "gastos-fotos";

/**
 * Tamaño máximo de una foto en el servidor. Una acción del servidor acepta 1 MB en total (Next), y el bucket 1 MiB:
 * por eso la app comprime la foto antes de mandarla y aquí se exige bastante menos.
 */
export const FOTO_BYTES_MAXIMOS = 900_000;

const EXTENSION_DE_TIPO = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const TIPO_DE_EXTENSION = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
type Extension = keyof typeof TIPO_DE_EXTENSION;

/** "image/jpeg" -> "jpg"; null si no es una imagen que aceptemos. */
export function extensionDeFoto(tipo: string): Extension | null {
  return (EXTENSION_DE_TIPO as Record<string, Extension | undefined>)[tipo] ?? null;
}

const ascii = (bytes: Uint8Array, desde: number, hasta: number) => String.fromCharCode(...bytes.slice(desde, hasta));

/**
 * Reconoce una imagen por sus primeros bytes, no por el tipo que declaró el navegador ni por el nombre: lo que se
 * guarda y se sirve como foto tiene que SER una foto (jpg, png o webp).
 */
export function reconocerImagen(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** "…/abc.jpg" -> "image/jpeg"; null si la ruta no es de una foto de gasto. */
export function tipoDeRutaFoto(ruta: string): string | null {
  const ext = /\.([a-z]+)$/.exec(ruta)?.[1];
  return ext && ext in TIPO_DE_EXTENSION ? TIPO_DE_EXTENSION[ext as Extension] : null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RUTA_FOTO = new RegExp(`^${UUID}/${UUID}\\.(jpg|png|webp)$`);

/** ¿Tiene la forma de una ruta de foto de gasto (<barberia>/<clave>.<ext>)? Así nada raro llega al disco ni al bucket. */
export function esRutaFotoGasto(ruta: unknown): ruta is string {
  return typeof ruta === "string" && RUTA_FOTO.test(ruta);
}

/** La ruta de la foto de un gasto: dentro de la carpeta de la barbería, con la clave del gasto como nombre. */
export function rutaFotoGasto(barberiaId: string, clave: string, tipo: string): string | null {
  const ext = extensionDeFoto(tipo);
  if (!ext) return null;
  const ruta = `${barberiaId}/${clave}.${ext}`;
  return esRutaFotoGasto(ruta) ? ruta : null;
}
