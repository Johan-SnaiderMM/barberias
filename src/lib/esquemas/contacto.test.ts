import { describe, expect, it } from "vitest";
import { esquemaContacto } from "./contacto";

const mensaje = (entrada: unknown) => {
  const r = esquemaContacto.safeParse(entrada);
  return r.success ? null : r.error.issues[0].message;
};

describe("esquemaContacto", () => {
  it("acepta los dos datos, uno solo o ninguno (vacío quita el dato)", () => {
    expect(esquemaContacto.safeParse({ whatsapp: "300 123 4567", direccion: "Carrera 9 #12-34" }).success).toBe(true);
    expect(esquemaContacto.safeParse({ whatsapp: "", direccion: "Carrera 9 #12-34" }).success).toBe(true);
    expect(esquemaContacto.safeParse({ whatsapp: "300 123 4567", direccion: "" }).success).toBe(true);
    expect(esquemaContacto.safeParse({ whatsapp: "", direccion: "" }).success).toBe(true);
  });

  it("recorta los espacios de los extremos", () => {
    const r = esquemaContacto.safeParse({ whatsapp: "  300 123 4567 ", direccion: "  Calle 1  " });
    expect(r.success && r.data).toEqual({ whatsapp: "300 123 4567", direccion: "Calle 1" });
  });

  it("la dirección llega a 120 caracteres y no más", () => {
    expect(esquemaContacto.safeParse({ whatsapp: "", direccion: "x".repeat(120) }).success).toBe(true);
    expect(mensaje({ whatsapp: "", direccion: "x".repeat(121) })).toBe("La dirección es muy larga (máximo 120 caracteres).");
  });

  it("un WhatsApp absurdamente largo se corta antes de llegar a la base", () => {
    expect(mensaje({ whatsapp: "3".repeat(31), direccion: "" })).toBe("El WhatsApp es muy largo.");
  });
});
