import { describe, expect, it } from "vitest";
import { avisoDiasSinCerrar } from "./dias-sin-cerrar";

describe("avisoDiasSinCerrar", () => {
  it("sin días pendientes no hay aviso", () => {
    expect(avisoDiasSinCerrar([])).toBeNull();
  });

  it("con un día, lo nombra y lleva a ese día", () => {
    expect(avisoDiasSinCerrar(["2026-10-12"])).toEqual({ texto: "Falta cerrar el lun 12 oct.", fecha: "2026-10-12" });
  });

  it("con varios, cuenta y lleva al más antiguo (la base los entrega del más reciente al más antiguo)", () => {
    const aviso = avisoDiasSinCerrar(["2026-10-14", "2026-10-12", "2026-10-10"]);
    expect(aviso).toEqual({ texto: "Faltan por cerrar 3 días, desde el sáb 10 oct.", fecha: "2026-10-10" });
  });
});
