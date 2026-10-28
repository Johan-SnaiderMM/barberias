import { describe, expect, it } from "vitest";
import { esquemaReiniciarDemo } from "@/lib/esquemas/demo";
import { textoPinRechazado } from "./demo";

describe("textoPinRechazado", () => {
  it("dice cuántos intentos quedan, en singular y plural", () => {
    expect(textoPinRechazado({ ok: false, motivo: "pin", intentos_restantes: 4 })).toBe("El PIN no es correcto. Te quedan 4 intentos.");
    expect(textoPinRechazado({ ok: false, motivo: "pin", intentos_restantes: 1 })).toBe("El PIN no es correcto. Te queda 1 intento.");
  });

  it("dice cuánto esperar cuando se bloqueó", () => {
    expect(textoPinRechazado({ ok: false, motivo: "bloqueado", minutos: 5 })).toBe("Demasiados intentos. Espera 5 minutos.");
    expect(textoPinRechazado({ ok: false, motivo: "bloqueado", minutos: 1 })).toBe("Demasiados intentos. Espera 1 minuto.");
  });
});

describe("esquemaReiniciarDemo", () => {
  it("acepta el PIN de 4 a 8 dígitos o vacío (la demo sin PIN)", () => {
    expect(esquemaReiniciarDemo.parse({ pin: "" }).pin).toBe("");
    expect(esquemaReiniciarDemo.parse({ pin: " 4821 " }).pin).toBe("4821");
    expect(esquemaReiniciarDemo.parse({ pin: "12345678" }).pin).toBe("12345678");
  });

  it("rechaza lo que no es un PIN", () => {
    for (const pin of ["12", "123", "123456789", "12a45", "12 45"]) {
      const r = esquemaReiniciarDemo.safeParse({ pin });
      expect(r.success, pin).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe("El PIN tiene de 4 a 8 números.");
    }
  });
});
