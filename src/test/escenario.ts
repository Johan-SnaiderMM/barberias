/**
 * Escenario compartido de las pruebas de agenda: una barbería con dos barberos, dos servicios, el equipo con sus
 * roles y un horario amplio (todos los días de 6:00 a. m. a 10:00 p. m., para que las pruebas no dependan del día
 * de la semana; las que prueban el horario lo reemplazan).
 */
import type { PGlite } from "@electric-sql/pglite";
import { type BarberiaDePrueba, crearBarberia, crearMiembro, crearRol, rpc } from "./base-datos";

export type EscenarioAgenda = BarberiaDePrueba & {
  /** Servicio de 30 min a $ 15.000 (Camilo cobra $ 18.000 por él; Dani tarda 45 min). */
  corte: string;
  /** Servicio de 45 min a $ 22.000 (solo lo hace Camilo). */
  combo: string;
  camilo: string;
  dani: string;
  /** Alguien con el rol Recepción (agenda de todos, caja, gastos). */
  recepcion: string;
  /** Cuenta de Camilo (rol Barbero, vinculada a su barbero): solo ve y maneja lo suyo. */
  cuentaCamilo: string;
  /** Cuenta de Dani (rol Barbero, vinculada a su barbero). */
  cuentaDani: string;
  /** Alguien con solo el área "caja". */
  cajero: string;
};

let contador = 0;

export async function crearEscenarioAgenda(db: PGlite): Promise<EscenarioAgenda> {
  contador += 1;
  const a = await crearBarberia(db, `Barbería de agenda ${contador}`);
  const id = async (fn: string, args: Record<string, unknown>) => (await rpc<{ id: string }>(db, a.userId, fn, args)).id;

  const corte = await id("crear_servicio", { p_nombre: "Corte", p_precio: 15000, p_duracion_min: 30 });
  const combo = await id("crear_servicio", { p_nombre: "Corte + barba", p_precio: 22000, p_duracion_min: 45 });
  const camilo = await id("crear_barbero", { p_nombre: "Camilo" });
  const dani = await id("crear_barbero", { p_nombre: "Dani" });

  await rpc(db, a.userId, "asignar_servicios_barbero", {
    p_barbero: camilo,
    p_servicios: [{ servicio_id: corte, precio_propio: 18000 }, { servicio_id: combo }],
  });
  await rpc(db, a.userId, "asignar_servicios_barbero", {
    p_barbero: dani,
    p_servicios: [{ servicio_id: corte, duracion_propia: 45 }],
  });

  const todosLosDias = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, desde: 360, hasta: 1320 }));
  await rpc(db, a.userId, "guardar_horario_barbero", { p_barbero: camilo, p_franjas: todosLosDias });
  await rpc(db, a.userId, "guardar_horario_barbero", { p_barbero: dani, p_franjas: todosLosDias });

  await crearRol(db, a.barberiaId, "Cajero", ["caja"]);
  const recepcion = await crearMiembro(db, a.barberiaId, "Ruth", ["Recepción"]);
  const cuentaCamilo = await crearMiembro(db, a.barberiaId, "Camilo (cuenta)", ["Barbero"]);
  const cuentaDani = await crearMiembro(db, a.barberiaId, "Dani (cuenta)", ["Barbero"]);
  const cajero = await crearMiembro(db, a.barberiaId, "Caja", ["Cajero"]);
  await rpc(db, a.userId, "vincular_barbero_usuario", { p_barbero: camilo, p_user_id: cuentaCamilo });
  await rpc(db, a.userId, "vincular_barbero_usuario", { p_barbero: dani, p_user_id: cuentaDani });

  return { ...a, corte, combo, camilo, dani, recepcion, cuentaCamilo, cuentaDani, cajero };
}

/** Un instante fijo y lejano (nunca depende del reloj): 2030-03-04 10:00 en Bogotá. */
export const BASE_MS = Date.parse("2030-03-04T15:00:00Z");

/** `BASE` + N minutos, como ISO. */
export const en = (minutos: number): string => new Date(BASE_MS + minutos * 60_000).toISOString();
