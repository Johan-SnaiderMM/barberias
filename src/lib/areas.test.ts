import { describe, expect, it } from "vitest";
import type { Contexto } from "./contexto";
import { abre, alcanceAgenda, AREAS, esArea, ETIQUETA_AREA, PANTALLAS, puedeVer, quienEs } from "./areas";

describe("áreas", () => {
  it("toda área tiene su etiqueta", () => {
    expect(Object.keys(ETIQUETA_AREA).sort()).toEqual([...AREAS].sort());
  });

  it("no hay áreas repetidas", () => {
    expect(new Set(AREAS).size).toBe(AREAS.length);
  });

  it("esArea distingue lo válido", () => {
    expect(esArea("caja")).toBe(true);
    expect(esArea("inventada")).toBe(false);
    expect(esArea(null)).toBe(false);
  });
});

describe("abre", () => {
  it("es verdadera si abre ALGUNA de las áreas pedidas", () => {
    expect(abre(["caja", "gastos"], "cierre", "caja")).toBe(true);
    expect(abre(["caja"], "cierre")).toBe(false);
  });

  it("sin áreas (o sin barbería) no abre nada", () => {
    expect(abre([], "caja")).toBe(false);
    expect(abre(null, "caja")).toBe(false);
    expect(abre(undefined, "caja")).toBe(false);
  });
});

describe("alcanceAgenda", () => {
  it("agenda de todos gana sobre la propia", () => {
    expect(alcanceAgenda(["mi_agenda", "agenda"])).toBe("todos");
  });

  it("el barbero ve solo la suya", () => {
    expect(alcanceAgenda(["mi_agenda"])).toBe("propia");
  });

  it("sin ninguna de las dos no ve agenda", () => {
    expect(alcanceAgenda(["caja"])).toBe("ninguna");
    expect(alcanceAgenda(null)).toBe("ninguna");
  });
});

describe("PANTALLAS", () => {
  it("solo usa áreas que existen", () => {
    for (const [pantalla, requeridas] of Object.entries(PANTALLAS)) {
      for (const a of (requeridas ?? []) as readonly string[]) {
        expect(esArea(a), `${pantalla} pide el área inexistente ${a}`).toBe(true);
      }
    }
  });

  it("inicio y más están abiertas a cualquiera de la barbería, incluso sin roles", () => {
    expect(puedeVer({ areas: [] }, "inicio")).toBe(true);
    expect(puedeVer({ areas: [] }, "mas")).toBe(true);
  });

  it("el barbero ve su agenda pero no la caja, el cierre ni el equipo", () => {
    const barbero = { areas: ["mi_agenda"] as const };
    expect(puedeVer(barbero, "agenda")).toBe(true);
    expect(puedeVer(barbero, "comisiones")).toBe(true);
    expect(puedeVer(barbero, "caja")).toBe(false);
    expect(puedeVer(barbero, "cierre")).toBe(false);
    expect(puedeVer(barbero, "equipo")).toBe(false);
  });

  it("el WhatsApp y la dirección (contacto) los abre quien maneja los servicios, como los ajustes; ni el barbero ni recepción", () => {
    expect(puedeVer({ areas: ["servicios"] }, "contacto")).toBe(true);
    expect(puedeVer({ areas: ["mi_agenda"] }, "contacto")).toBe(false);
    expect(puedeVer({ areas: ["agenda", "caja", "gastos"] }, "contacto")).toBe(false);
    expect(PANTALLAS.contacto).toEqual(PANTALLAS.ajustes);
  });

  it("el dueño (todas las áreas) ve todo", () => {
    for (const p of Object.keys(PANTALLAS) as (keyof typeof PANTALLAS)[]) {
      expect(puedeVer({ areas: AREAS }, p)).toBe(true);
    }
  });
});

describe("quienEs", () => {
  const base: Contexto = {
    barberia: {
      id: "b",
      nombre: "Alfa",
      slug: "alfa",
      es_demo: false,
      reinicio_con_pin: false,
      whatsapp: null,
      direccion: null,
      agenda: {
        paso_min: 30,
        dias_adelante: 30,
        anticipacion_min: 60,
        colchon_min: 0,
        reservas_en_linea: true,
        cancelar_hasta_horas: 2,
      },
    },
    perfil: { nombre: "Camilo", rol: "equipo", areas: ["mi_agenda"], roles: ["Barbero"] },
  };

  it("arma quién es a partir del contexto", () => {
    expect(quienEs(base)).toEqual({ nombre: "Camilo", esDueno: false, areas: ["mi_agenda"], roles: ["Barbero"] });
  });

  it("el rol dueño marca esDueno", () => {
    expect(quienEs({ ...base, perfil: { ...base.perfil!, rol: "dueno" } })?.esDueno).toBe(true);
  });

  it("sin perfil no es nadie", () => {
    expect(quienEs({ barberia: null, perfil: null })).toBeNull();
  });
});
