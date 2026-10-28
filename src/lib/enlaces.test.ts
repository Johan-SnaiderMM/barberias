import { describe, expect, it } from "vitest";
import { mensajeEnlaceReservas, origenDeCabeceras, urlReservas } from "./enlaces";

describe("origenDeCabeceras", () => {
  it("en producción usa https y el host", () => {
    expect(origenDeCabeceras({ host: "barberias.ejemplo.com" })).toBe("https://barberias.ejemplo.com");
  });

  it("en local usa http", () => {
    expect(origenDeCabeceras({ host: "localhost:3000" })).toBe("http://localhost:3000");
    expect(origenDeCabeceras({ host: "127.0.0.1:3100" })).toBe("http://127.0.0.1:3100");
  });

  it("detrás de un proxy manda lo reenviado", () => {
    expect(
      origenDeCabeceras({ host: "interno:8080", hostReenviado: "reservas.ejemplo.com", protoReenviado: "https" })
    ).toBe("https://reservas.ejemplo.com");
  });

  it("si vienen varios valores reenviados, toma el primero", () => {
    expect(origenDeCabeceras({ hostReenviado: "a.com, b.com", protoReenviado: "https, http" })).toBe("https://a.com");
  });

  it("sin nada, es el servidor local de desarrollo", () => {
    expect(origenDeCabeceras({})).toBe("http://localhost:3000");
  });
});

describe("urlReservas y mensajeEnlaceReservas", () => {
  it("arma /reservar/<slug> sin barras de más", () => {
    expect(urlReservas("https://a.com/", "mi-barberia")).toBe("https://a.com/reservar/mi-barberia");
  });

  it("el mensaje lleva el nombre y el enlace", () => {
    const m = mensajeEnlaceReservas("Barbería Don José", "https://a.com/reservar/x");
    expect(m).toContain("Barbería Don José");
    expect(m).toContain("https://a.com/reservar/x");
  });
});
