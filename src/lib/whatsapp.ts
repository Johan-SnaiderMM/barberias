/**
 * WhatsApp de un toque. La app no manda mensajes sola: arma el mensaje y el enlace `https://wa.me/...`, y es la
 * persona quien lo envía desde su WhatsApp. Módulo puro: lo usan componentes `"use client"`.
 */
import { formatearPesos, textoDiferencia } from "./dinero";
import { digitosParaWhatsapp } from "./telefono";
import type { CierreHecho } from "./tipos/cierre";

/** E.164 con el "+": lo que guarda la base (`fn_normalizar_telefono`, migración 0010). */
const E164 = /^\+[1-9][0-9]{7,14}$/;

/** Espacios normales: las horas salen con espacio fino ("2:35 p. m.") y no hace falta llevarlo al mensaje. */
function limpiar(texto: string): string {
  return texto.replace(/[  ]/g, " ");
}

/** Abre WhatsApp con el mensaje escrito y deja elegir a quién mandarlo (las invitaciones del equipo). */
export function enlaceWhatsappSinNumero(mensaje: string): string {
  return `https://wa.me/?text=${encodeURIComponent(limpiar(mensaje))}`;
}

/** Abre el chat de un celular E.164 con el mensaje escrito. `null` si no hay celular válido: no hay a dónde mandarlo. */
export function enlaceWhatsappA(e164: string | null | undefined, mensaje: string): string | null {
  if (!e164 || !E164.test(e164)) return null;
  return `https://wa.me/${digitosParaWhatsapp(e164)}?text=${encodeURIComponent(limpiar(mensaje))}`;
}

/**
 * El resumen de un día cerrado, para mandárselo al dueño o al grupo del negocio. `dia` ya viene escrito para leerse
 * ("Jueves 15 de octubre"). Solo se nombra lo que tuvo movimiento (si no hubo pagos a barberos, no sale la línea).
 */
export function mensajeResumenCierre(d: { barberia: string; dia: string; cierre: CierreHecho }): string {
  const c = d.cierre;
  const pesos = formatearPesos;
  const linea = (texto: string, valor: number) => (valor > 0 ? [`• ${texto}: ${pesos(valor)}`] : []);
  const gastos = c.gastos_efectivo + c.gastos_transferencia;
  const pagos = c.liquidaciones_efectivo + c.liquidaciones_transferencia;
  const lineas = [
    `*Cierre del día · ${d.barberia}*`,
    d.dia,
    "",
    `*Cobrado:* ${pesos(c.servicios + c.propinas)} (${c.cobros === 1 ? "1 cobro" : `${c.cobros} cobros`})`,
    `• Efectivo: ${pesos(c.efectivo_cobros)}`,
    `• Nequi: ${pesos(c.transferencia_cobros)}`,
    `• Servicios ${pesos(c.servicios)} + propinas ${pesos(c.propinas)}`,
    "",
    `*Gastos:* ${pesos(gastos)}${c.gastos > 0 ? ` (${c.gastos === 1 ? "1 gasto" : `${c.gastos} gastos`})` : ""}`,
    ...linea("Efectivo", c.gastos_efectivo),
    ...linea("Nequi", c.gastos_transferencia),
    ...(pagos > 0
      ? ["", `*Pagos a barberos:* ${pesos(pagos)}`, ...linea("Efectivo", c.liquidaciones_efectivo), ...linea("Transferencia", c.liquidaciones_transferencia)]
      : []),
    "",
    "*Efectivo en la caja*",
    `Esperado: ${pesos(c.efectivo_esperado)}`,
    `Contado: ${pesos(c.efectivo_contado)}`,
    `Diferencia: ${textoDiferencia(c.diferencia)}`,
    ...(c.nota ? ["", `Nota: ${c.nota}`] : []),
  ];
  return lineas.join("\n");
}

/**
 * El recordatorio de una cita. `dia` y `hora` ya vienen escritos para leerse ("jueves 15 de octubre",
 * "5:00 p. m."). Se saluda por el primer nombre del cliente.
 */
export function mensajeRecordatorio(d: {
  cliente: string;
  barberia: string;
  servicio: string;
  barbero: string;
  dia: string;
  hora: string;
}): string {
  const hora = limpiar(d.hora);
  const nombre = d.cliente.trim().split(/\s+/)[0] ?? "";
  // "a las 5:00 p. m." pero "a la 1:00 p. m.".
  const articulo = /^1:/.test(hora) ? "a la" : "a las";
  // "p. m." ya termina en punto: no se le agrega otro.
  const punto = hora.endsWith(".") ? "" : ".";
  return (
    `Hola${nombre ? ` ${nombre}` : ""}, te recordamos tu cita en ${d.barberia}: ${d.servicio} con ${d.barbero}, ` +
    `el ${d.dia} ${articulo} ${hora}${punto}\n` +
    `Si no puedes venir, avísanos por aquí para dejar la hora libre. ¡Te esperamos!`
  );
}
