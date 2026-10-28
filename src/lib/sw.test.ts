/**
 * El service worker de los avisos push (`public/sw.js`) se ejecuta aquí con un `self` de mentira: solo debe abrir
 * direcciones de la propia app (revisión de seguridad 02, hallazgo S7).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const codigo = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGEN = "https://barberias.test";

/** Toca un aviso cuyo `data.url` es `url` y devuelve a qué dirección abrió la ventana. */
async function abrirAlTocar(url: string | undefined, ventanas: { navigate: (u: string) => void; focus: () => unknown }[] = []): Promise<string[]> {
  const abiertas: string[] = [];
  const manejadores: Record<string, (e: unknown) => void> = {};
  const self = {
    location: { origin: ORIGEN },
    addEventListener: (tipo: string, fn: (e: unknown) => void) => (manejadores[tipo] = fn),
    registration: { showNotification: () => Promise.resolve() },
    clients: {
      matchAll: () => Promise.resolve(ventanas),
      openWindow: (u: string) => {
        abiertas.push(u);
        return Promise.resolve();
      },
    },
  };
  vm.runInNewContext(codigo, { self, URL, console });
  let pendiente: Promise<unknown> = Promise.resolve();
  manejadores.notificationclick({
    notification: { close: () => {}, data: url === undefined ? undefined : { url } },
    waitUntil: (p: Promise<unknown>) => (pendiente = p),
  });
  await pendiente;
  return abiertas;
}

describe("public/sw.js · al tocar un aviso", () => {
  it("abre la cita de la propia app", async () => {
    expect(await abrirAlTocar("/agenda/cita/123")).toEqual([`${ORIGEN}/agenda/cita/123`]);
    expect(await abrirAlTocar(`${ORIGEN}/agenda/cita/123`)).toEqual([`${ORIGEN}/agenda/cita/123`]);
  });

  it("sin dirección abre la agenda", async () => {
    expect(await abrirAlTocar(undefined)).toEqual([`${ORIGEN}/agenda`]);
  });

  it("una dirección de otro sitio (o rara) cae en la agenda y nunca se abre", async () => {
    for (const url of ["https://sitio-ajeno.test/robar", "//sitio-ajeno.test/x", "javascript:alert(1)", "http://barberias.test/agenda", "https://barberias.test.ajeno.test/x"]) {
      const abiertas = await abrirAlTocar(url);
      expect(abiertas, url).toEqual(["/agenda"]);
    }
  });

  it("si ya hay una ventana abierta la lleva a la dirección segura, no a la ajena", async () => {
    const llevada: string[] = [];
    await abrirAlTocar("https://sitio-ajeno.test/x", [{ navigate: (u) => llevada.push(u), focus: () => undefined }]);
    expect(llevada).toEqual(["/agenda"]);
  });
});
