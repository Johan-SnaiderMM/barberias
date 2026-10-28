/**
 * Áreas de permiso de una barbería. Es la ÚNICA lista en TypeScript y debe ser idéntica a `fn_areas()` en SQL
 * (migración 0003): una prueba (src/test/permisos-por-area.test.ts) las compara.
 *
 *   agenda      ver y manejar la agenda de TODOS los barberos
 *   mi_agenda   ver y manejar solo MIS citas, mis cobros y mis comisiones (el barbero)
 *   caja        cobrar y anular cobros
 *   gastos      registrar y anular gastos
 *   cierre      el cierre del día y las cifras de plata
 *   comisiones  ver y liquidar las comisiones de TODOS los barberos
 *   servicios   servicios, precios, barberos y horarios
 *   equipo      invitar personas y asignarles roles
 *
 * Quién es quién lo decide la base (RLS y `requerir_area`); esto solo sirve para ESCONDER botones y pantallas.
 * Este módulo no importa nada del servidor: lo pueden usar componentes `"use client"`.
 */
import type { Contexto } from "@/lib/contexto";

export const AREAS = [
  "agenda",
  "mi_agenda",
  "caja",
  "gastos",
  "cierre",
  "comisiones",
  "servicios",
  "equipo",
] as const;

export type Area = (typeof AREAS)[number];

/** Nombre corto para mostrar en la pantalla de equipo. */
export const ETIQUETA_AREA: Record<Area, string> = {
  agenda: "Agenda de todos",
  mi_agenda: "Mi agenda",
  caja: "Cobrar",
  gastos: "Gastos",
  cierre: "Cierre del día",
  comisiones: "Comisiones de todos",
  servicios: "Servicios y horarios",
  equipo: "Equipo",
};

export function esArea(valor: unknown): valor is Area {
  return typeof valor === "string" && (AREAS as readonly string[]).includes(valor);
}

/** ¿Alguna de las `pedidas` está entre las áreas de la persona? (misma semántica que `tiene_area` en SQL). */
export function abre(areas: readonly string[] | null | undefined, ...pedidas: Area[]): boolean {
  if (!areas || areas.length === 0) return false;
  return pedidas.some((a) => areas.includes(a));
}

/** Para las pantallas: ¿ve la agenda de todos, o solo la suya? */
export function alcanceAgenda(areas: readonly string[] | null | undefined): "todos" | "propia" | "ninguna" {
  if (abre(areas, "agenda")) return "todos";
  if (abre(areas, "mi_agenda")) return "propia";
  return "ninguna";
}

/**
 * Pantallas del personal y qué áreas abren cada una (basta con abrir ALGUNA). `null` = cualquier persona de la
 * barbería. Una pantalla nueva se agrega aquí y su `page.tsx` empieza con `revisarPermiso("<pantalla>")`
 * (una prueba lo exige para cada página).
 */
export const PANTALLAS = {
  inicio: null,
  mas: null,
  agenda: ["agenda", "mi_agenda"],
  caja: ["caja"],
  clientes: ["agenda", "mi_agenda", "caja"],
  gastos: ["gastos"],
  cierre: ["cierre"],
  comisiones: ["comisiones", "mi_agenda"],
  // Cuánto gana cada barbero y de quién es la propina: solo quien maneja las comisiones de todos.
  porcentajes: ["comisiones"],
  servicios: ["servicios"],
  barberos: ["servicios"],
  ajustes: ["servicios"],
  // El WhatsApp y la dirección que ven los clientes (reserva, cita y textos legales): como los ajustes, de quien maneja los servicios.
  contacto: ["servicios"],
  // Bloquear tiempo: la base pide "agenda" (de cualquiera) o "mi_agenda" (solo el propio).
  bloqueos: ["agenda", "mi_agenda"],
  equipo: ["equipo"],
  // El cartel con el QR y el enlace de reservas: lo arma quien maneja los servicios y los ajustes.
  cartel: ["servicios"],
} as const satisfies Record<string, readonly Area[] | null>;

export type Pantalla = keyof typeof PANTALLAS;

/** Quién entra, ya resuelto a partir del contexto de la base. */
export type Quien = {
  nombre: string;
  esDueno: boolean;
  areas: readonly Area[];
  roles: readonly string[];
};

/** null si la sesión no pertenece a ninguna barbería (todavía no tiene perfil). */
export function quienEs(contexto: Contexto): Quien | null {
  const p = contexto.perfil;
  if (!p) return null;
  return { nombre: p.nombre, esDueno: p.rol === "dueno", areas: p.areas, roles: p.roles };
}

/** ¿Esta persona puede ver esta pantalla? La base igual rechaza lo que no le toca: esto evita pantallas a medias. */
export function puedeVer(quien: Pick<Quien, "areas">, pantalla: Pantalla): boolean {
  const requeridas = PANTALLAS[pantalla] as readonly Area[] | null;
  if (requeridas === null) return true;
  return abre(quien.areas, ...requeridas);
}
