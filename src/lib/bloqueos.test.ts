import { describe, expect, it } from "vitest";
import { describirBloqueo } from "./bloqueos";
import { instanteBogota } from "./fechas";

describe("describirBloqueo", () => {
  it("un día completo", () => {
    expect(describirBloqueo(instanteBogota("2026-11-02", 0), instanteBogota("2026-11-02", 1440))).toBe(
      "lun 2 nov · todo el día"
    );
  });

  it("varios días completos (vacaciones)", () => {
    expect(describirBloqueo(instanteBogota("2026-11-02", 0), instanteBogota("2026-11-04", 1440))).toBe(
      "lun 2 nov al mié 4 nov · todo el día"
    );
  });

  it("unas horas del mismo día", () => {
    expect(describirBloqueo(instanteBogota("2026-11-02", 840), instanteBogota("2026-11-02", 960))).toBe(
      "lun 2 nov · 2:00 p. m. a 4:00 p. m."
    );
  });

  it("desde la medianoche hasta una hora (no es día completo)", () => {
    expect(describirBloqueo(instanteBogota("2026-11-02", 0), instanteBogota("2026-11-02", 600))).toBe(
      "lun 2 nov · 12:00 a. m. a 10:00 a. m."
    );
  });

  it("cruzando de un día a otro con horas", () => {
    expect(describirBloqueo(instanteBogota("2026-11-02", 1080), instanteBogota("2026-11-03", 480))).toBe(
      "lun 2 nov 6:00 p. m. → mar 3 nov 8:00 a. m."
    );
  });

  it("usa el día de Bogotá aunque el instante sea del día siguiente en UTC", () => {
    // 22:30 en Bogotá = 03:30 UTC del día siguiente
    expect(describirBloqueo("2026-11-03T03:30:00Z", "2026-11-03T04:30:00Z")).toBe("lun 2 nov · 10:30 p. m. a 11:30 p. m.");
  });
});
