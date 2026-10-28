import { describe, expect, it } from "vitest";
import {
  deberiaEstarEnAtencion,
  ESTADOS_CITA,
  esEstadoCita,
  ETIQUETA_ESTADO,
  OCUPAN_LA_HORA,
  porCerrar,
  puedeCambiar,
  puedeMoverOCancelar,
  TRANSICIONES,
} from "./citas";

describe("estados de la cita", () => {
  it("todo estado tiene etiqueta y transiciones", () => {
    expect(Object.keys(ETIQUETA_ESTADO).sort()).toEqual([...ESTADOS_CITA].sort());
    expect(Object.keys(TRANSICIONES).sort()).toEqual([...ESTADOS_CITA].sort());
  });

  it("cancelar no es una transición (tiene su propia función, con motivo)", () => {
    for (const destinos of Object.values(TRANSICIONES)) expect(destinos).not.toContain("cancelada");
  });

  it("esEstadoCita distingue lo válido", () => {
    expect(esEstadoCita("atendida")).toBe(true);
    expect(esEstadoCita("inventada")).toBe(false);
    expect(esEstadoCita(null)).toBe(false);
  });

  it("ocupan la hora las citas vigentes, no las canceladas ni las que no asistieron", () => {
    expect(OCUPAN_LA_HORA).toEqual(["confirmada", "en_atencion", "atendida"]);
  });

  it("puedeCambiar sigue el mapa", () => {
    expect(puedeCambiar("confirmada", "en_atencion")).toBe(true);
    expect(puedeCambiar("confirmada", "atendida")).toBe(false);
    expect(puedeCambiar("cancelada", "confirmada")).toBe(true);
    expect(puedeCambiar("atendida", "no_asistio")).toBe(false);
  });

  it("solo una cita confirmada se mueve o se cancela", () => {
    expect(puedeMoverOCancelar("confirmada")).toBe(true);
    for (const e of ESTADOS_CITA.filter((x) => x !== "confirmada")) expect(puedeMoverOCancelar(e)).toBe(false);
  });
});

describe("pendientes por cerrar", () => {
  const ahora = Date.parse("2026-11-02T16:00:00Z");

  it("una confirmada que ya terminó está por cerrar", () => {
    expect(porCerrar({ estado: "confirmada", fin: "2026-11-02T15:30:00Z" }, ahora)).toBe(true);
    expect(porCerrar({ estado: "confirmada", fin: "2026-11-02T16:00:00Z" }, ahora)).toBe(true); // justo al terminar
  });

  it("no lo está si todavía no termina o ya tiene otro estado", () => {
    expect(porCerrar({ estado: "confirmada", fin: "2026-11-02T16:30:00Z" }, ahora)).toBe(false);
    expect(porCerrar({ estado: "atendida", fin: "2026-11-02T15:30:00Z" }, ahora)).toBe(false);
    expect(porCerrar({ estado: "cancelada", fin: "2026-11-02T15:30:00Z" }, ahora)).toBe(false);
  });

  it("una confirmada cuya hora ya empezó debería estar en atención", () => {
    const c = { estado: "confirmada", inicio: "2026-11-02T15:45:00Z", fin: "2026-11-02T16:15:00Z" };
    expect(deberiaEstarEnAtencion(c, ahora)).toBe(true);
    expect(deberiaEstarEnAtencion({ ...c, estado: "en_atencion" }, ahora)).toBe(false);
    expect(deberiaEstarEnAtencion({ ...c, inicio: "2026-11-02T16:10:00Z" }, ahora)).toBe(false);
    expect(deberiaEstarEnAtencion({ ...c, fin: "2026-11-02T15:55:00Z" }, ahora)).toBe(false);
  });
});
