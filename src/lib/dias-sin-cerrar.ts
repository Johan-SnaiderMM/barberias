import { fechaCorta } from "./fechas";

/**
 * El aviso de Inicio cuando quedaron días con movimiento sin cerrar (la lista la da `obtener_cierre`, del más reciente al más
 * antiguo). Lleva al día MÁS ANTIGUO: se cierran en orden y así el aviso no desaparece a medias. Sin días, no hay aviso.
 */
export function avisoDiasSinCerrar(fechas: string[]): { texto: string; fecha: string } | null {
  if (fechas.length === 0) return null;
  const masAntiguo = [...fechas].sort()[0];
  const texto = fechas.length === 1 ? `Falta cerrar el ${fechaCorta(masAntiguo)}.` : `Faltan por cerrar ${fechas.length} días, desde el ${fechaCorta(masAntiguo)}.`;
  return { texto, fecha: masAntiguo };
}
