import type { Area } from "@/lib/areas";
import type { AjustesAgenda } from "@/lib/ajustes-agenda";

/**
 * Lo que devuelve `obtener_contexto()` (migración 0007, que amplía la de 0003): la barbería de quien entra, con los
 * ajustes de su agenda, y su perfil con las áreas que abre. Solo tipos: lo pueden importar componentes `"use client"`.
 */
export type Contexto = {
  barberia: {
    id: string;
    nombre: string;
    slug: string;
    es_demo: boolean;
    /** Solo en una demo: reiniciarla pide el PIN que puso quien la administra (migración 0027). */
    reinicio_con_pin: boolean;
    whatsapp: string | null;
    direccion: string | null;
    agenda: AjustesAgenda;
  } | null;
  perfil: {
    nombre: string;
    rol: "dueno" | "equipo";
    areas: Area[];
    roles: string[];
  } | null;
};
