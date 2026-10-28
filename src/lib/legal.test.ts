import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { enlacesLegales, PLAZOS_LEGALES, slugDeLaDireccion, VERSION_LEGAL } from "./legal";

const leer = (...partes: string[]) => fs.readFileSync(path.join(process.cwd(), ...partes), "utf8").replace(/\r\n/g, "\n");
/** Sin saltos de línea ni sangrías: una frase partida en dos líneas del archivo sigue siendo la misma frase. */
const plano = (texto: string) => texto.replace(/\s+/g, " ");

describe("slugDeLaDireccion", () => {
  it("acepta un nombre corto de barbería", () => {
    expect(slugDeLaDireccion("la-fina")).toBe("la-fina");
    expect(slugDeLaDireccion("barberia-demo")).toBe("barberia-demo");
    expect(slugDeLaDireccion(["don-pepe", "otro"])).toBe("don-pepe");
  });

  it("rechaza lo que no es un nombre corto (nada raro llega a la base)", () => {
    for (const v of [undefined, null, "", "ab", "La Fina", "la fina", "-x-y", "a--b", "x".repeat(41), "a/b", "../etc", "a;drop", 42, {}]) {
      expect(slugDeLaDireccion(v), String(v)).toBeNull();
    }
  });
});

describe("enlacesLegales", () => {
  it("lleva a la barbería de la reserva, o a los textos sin personalizar", () => {
    expect(enlacesLegales("la-fina")).toEqual({ aviso: "/aviso-de-privacidad?b=la-fina", politica: "/privacidad?b=la-fina" });
    expect(enlacesLegales(null)).toEqual({ aviso: "/aviso-de-privacidad", politica: "/privacidad" });
  });
});

describe("los textos legales (borradores, tarea 4.3)", () => {
  const politica = plano(leer("src", "app", "privacidad", "page.tsx"));
  const aviso = plano(leer("src", "app", "aviso-de-privacidad", "page.tsx"));
  const cuerpo = leer("src", "components", "legal", "documento-legal.tsx");

  it("avisan en cada hoja que son un borrador pendiente de revisión, con su versión", () => {
    expect(cuerpo).toContain("Borrador pendiente de revisión legal");
    expect(cuerpo).toContain("VERSION_LEGAL.version");
    expect(politica).toContain("VERSION_LEGAL");
  });

  it("la política trae lo que pide el art. 13 del Decreto 1377 de 2013", () => {
    // 1. responsable y contacto  2. tratamiento y finalidad  3. derechos  4. quién atiende  5. procedimiento  6. vigencia
    expect(politica).toContain("Quién es el responsable");
    expect(politica).toContain("BloqueResponsable");
    expect(politica).toContain("Para qué los usamos");
    expect(politica).toContain("Tus derechos");
    expect(politica).toContain("La persona que atiende estas solicitudes");
    expect(politica).toContain("Cómo hacer una consulta o un reclamo");
    expect(politica).toContain("PLAZOS_LEGALES.consulta");
    expect(politica).toContain("PLAZOS_LEGALES.reclamo");
    expect(politica).toContain("Vigencia y cambios");
    expect(politica).toContain("Superintendencia de Industria y Comercio");
    // Quién es el encargado, dónde se guardan los datos y que puede haber transmisión al exterior.
    expect(politica).toContain("encargado");
    expect(politica).toContain("Supabase");
    expect(politica).toContain("fuera de Colombia");
    // Menores y datos sensibles.
    expect(politica).toContain("menor de edad");
    expect(politica).toContain("datos sensibles");
  });

  it("el aviso de privacidad trae lo del art. 15 y manda a la política", () => {
    expect(aviso).toContain("Quién es el responsable");
    expect(aviso).toContain("Para qué los usamos");
    expect(aviso).toContain("Tus derechos");
    expect(aviso).toContain("PLAZOS_LEGALES.consulta");
    expect(aviso).toContain("PLAZOS_LEGALES.reclamo");
    expect(aviso).toContain("Tu autorización es voluntaria");
    expect(aviso).toContain("enlacesLegales");
    expect(aviso).toContain("Leer la política de datos");
  });

  it("los plazos son los de la Ley 1581 (arts. 14 y 15)", () => {
    expect(PLAZOS_LEGALES).toEqual({ consulta: 10, consultaProrroga: 5, reclamo: 15, reclamoProrroga: 8 });
  });

  it("la reserva y la página de la cita los enlazan (con la barbería)", () => {
    const flujo = leer("src", "components", "reserva", "flujo-reserva.tsx");
    expect(flujo).toContain("<PieLegal slug={barberia.slug}");
    expect(flujo).toContain("aviso de privacidad");
    // La casilla de autorización sigue siendo obligatoria para confirmar.
    expect(flujo).toMatch(/disabled=\{[^}]*!consentimiento/);
    const cita = leer("src", "app", "cita", "[token]", "page.tsx");
    expect(cita).toContain("<PieLegal slug={barberia.slug}");
    const pie = leer("src", "components", "legal", "pie-legal.tsx");
    expect(pie).toContain("Aviso de privacidad");
    expect(pie).toContain("Política de datos");
  });
});

describe("el paquete para el abogado (docs/legal/PAQUETE-PARA-EL-ABOGADO.md)", () => {
  const paquete = plano(leer("docs", "legal", "PAQUETE-PARA-EL-ABOGADO.md"));
  const clausula = leer("docs", "legal", "encargo-de-datos.md");

  it("trae la cláusula de encargo tal cual está hoy", () => {
    const cuerpo = clausula.slice(clausula.indexOf("**CLÁUSULA [X]"), clausula.indexOf("## Cómo usarla")).replace(/\n---\s*$/, "").trim();
    expect(cuerpo.length).toBeGreaterThan(3000);
    expect(paquete).toContain(plano(cuerpo));
  });

  it("trae el aviso y la política con las mismas secciones que las páginas", () => {
    const politica = plano(leer("src", "app", "privacidad", "page.tsx"));
    const aviso = plano(leer("src", "app", "aviso-de-privacidad", "page.tsx"));
    for (const titulo of [...politica.matchAll(/<SeccionLegal titulo="([^"]+)"/g)].map((m) => m[1])) {
      expect(paquete, `política: ${titulo}`).toContain(`### ${titulo}`);
    }
    for (const titulo of [...aviso.matchAll(/<SeccionLegal titulo="([^"]+)"/g)].map((m) => m[1])) {
      expect(paquete, `aviso: ${titulo}`).toContain(`### ${titulo}`);
    }
  });

  it("lleva la misma versión, los mismos plazos y la casilla literal de la reserva", () => {
    expect(paquete).toContain(`versión ${VERSION_LEGAL.version} · ${VERSION_LEGAL.fecha}`);
    expect(paquete).toContain(`máximo ${PLAZOS_LEGALES.consulta} días hábiles`);
    expect(paquete).toContain(`máximo ${PLAZOS_LEGALES.reclamo} días hábiles`);
    expect(paquete).toContain(`máximo ${PLAZOS_LEGALES.consultaProrroga} días hábiles más`);
    expect(paquete).toContain(`${PLAZOS_LEGALES.reclamoProrroga} días hábiles más`);
    const flujo = plano(leer("src", "components", "reserva", "flujo-reserva.tsx"));
    expect(flujo).toContain("Autorizo a {barberia.nombre} a tratar mi nombre y mi celular para gestionar mi cita, según el aviso de privacidad y la política de datos.");
    expect(paquete).toContain("Autorizo a **[nombre de la barbería]** a tratar mi nombre y mi celular para gestionar mi cita, según el aviso de privacidad y la política de datos.");
  });

  it("recoge las preguntas del LEEME y las que se agregaron, con las urgentes marcadas", () => {
    const leeme = plano(leer("docs", "legal", "LEEME.md"));
    for (const tema of ["Menores de edad", "Supresión", "Autorización en el local", "Transmisión internacional", "Conservación de cobros", "RNBD", "Plazos de la cláusula", "WhatsApp", "Quién firma"]) {
      expect(leeme, tema).toContain(tema);
    }
    const preguntas = [...paquete.matchAll(/(?:^| )(\d{1,2})\. (?:★ )?\*\*[^*]+\*\*/g)].length;
    expect(preguntas).toBeGreaterThanOrEqual(18);
    expect(paquete).toContain("★ **Supresión.**");
    expect(paquete).toContain("★ **Menores de edad.**");
    expect(paquete).toContain("★ **Transmisión internacional.**");
    // Dice con honestidad lo que la aplicación no hace todavía.
    expect(paquete).toContain("No existe hoy una función para suprimir o anonimizar a un cliente");
    expect(paquete).toContain("No hay casilla ni constancia de autorización");
    expect(paquete).toContain("Nada se ha usado todavía con datos reales");
  });
});

describe("el contrato de servicio (borrador)", () => {
  const contrato = leer("docs", "legal", "contrato-de-servicio.md");
  const paquete = plano(leer("docs", "legal", "PAQUETE-PARA-EL-ABOGADO.md"));

  it("tiene sus 17 numerales, las condiciones del equipo y remite a la cláusula de datos", () => {
    for (let n = 1; n <= 17; n++) expect(contrato, `numeral ${n}`).toMatch(new RegExp(`\\*\\*${n}\\. [A-ZÁÉÍÓÚ]`));
    expect(contrato).toContain("No es asesoría jurídica");
    expect(contrato).toContain("Anexo 1 · Condiciones de uso para el equipo");
    expect(contrato).toContain("encargo-de-datos.md");
    expect(contrato).toContain("cláusula [X]");
  });

  it("no lleva precios ni márgenes (este archivo sube al repositorio): solo corchetes", () => {
    expect(contrato).toContain("$ [___] COP por mes");
    expect(contrato).not.toMatch(/\$\s?\d/);
    expect(contrato).not.toMatch(/\d{2,3}\.\d{3}/);
  });

  it("es honesto con lo que la app no hace (sin conexión, WhatsApp, facturación)", () => {
    const llano = plano(contrato);
    expect(llano).toContain("todavía no funciona sin conexión");
    expect(llano).toContain("**no** envía mensajes de WhatsApp");
    expect(llano).toContain("**No** factura electrónicamente");
  });

  it("el paquete para el abogado lo trae tal cual está hoy", () => {
    const cuerpo = contrato.slice(contrato.indexOf("**CONTRATO DE PRESTACIÓN"), contrato.indexOf("## Cómo usarlo")).replace(/\n---\s*$/, "").trim();
    expect(cuerpo.length).toBeGreaterThan(5000);
    expect(paquete).toContain(plano(cuerpo));
    expect(paquete).toContain("# 7. Texto 4 · Contrato de servicio y condiciones de uso");
  });
});

describe("docs/legal", () => {
  const clausula = leer("docs", "legal", "encargo-de-datos.md");
  const leeme = leer("docs", "legal", "LEEME.md");
  const version = `Versión ${VERSION_LEGAL.version} · ${VERSION_LEGAL.fecha}`;

  it("la cláusula de encargo tiene sus 14 numerales, los roles y los subencargados", () => {
    for (let n = 1; n <= 14; n++) expect(clausula, `numeral ${n}`).toMatch(new RegExp(`\\*\\*${n}\\. [A-ZÁÉÍÓÚ]`));
    expect(clausula).toContain("Ley 1581 de 2012");
    expect(clausula).toContain("**responsable**");
    expect(clausula).toContain("**encargado**");
    expect(clausula).toContain("Supabase");
    expect(clausula).toContain("Vercel");
    expect(clausula).toContain("fuera de Colombia");
    expect(clausula).toContain("No es asesoría jurídica");
  });

  it("los documentos llevan la misma versión que las páginas", () => {
    expect(clausula).toContain(version);
    expect(leeme).toContain(version);
  });

  it("el LEEME lista lo que el abogado debe mirar (incluida la supresión, que la app todavía no tiene)", () => {
    expect(leeme).toContain("Menores de edad");
    expect(leeme).toContain("Supresión");
    expect(leeme).toContain("no tiene");
    expect(leeme).toContain("RNBD");
    expect(leeme).toContain("Transmisión internacional");
  });
});
