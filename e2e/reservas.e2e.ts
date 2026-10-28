/**
 * Reservar de punta a punta (tarea 2.9): dos "celulares" en un Chrome real. El cliente reserva desde su casa; el
 * personal lo ve en su celular; el cliente cambia la hora y cancela; el personal ve que ya no está. Corre contra la
 * app de verdad (`next dev` con una base local aparte), no contra funciones sueltas.
 *
 *   npm run e2e:reservas
 *
 * Usa el Chrome instalado en el equipo (no descarga ningún navegador). Las capturas quedan en e2e-capturas/.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { levantarServidor, type Servidor } from "./servidor";

let servidor: Servidor;
let navegador: Browser;
let cliente: BrowserContext;
let personal: BrowserContext;
let paginaCliente: Page;
let paginaPersonal: Page;

/** El token y la hora de la cita que reserva el cliente (los usan los pasos siguientes). */
const cita = { token: "", inicio: "", fecha: "" };

const CAPTURAS = path.join(process.cwd(), "e2e-capturas");
const NOMBRE = "Laura E2E";
const CELULAR = "321 555 0199";

beforeAll(async () => {
  fs.mkdirSync(CAPTURAS, { recursive: true });
  servidor = await levantarServidor();
  try {
    navegador = await chromium.launch({ channel: "chrome", headless: true });
  } catch (e) {
    await servidor.detener();
    throw new Error(`No se pudo abrir Chrome (¿está instalado?): ${e instanceof Error ? e.message : String(e)}`);
  }
  // Los dos celulares: cliente a 360×640 y personal a 390×844, con hora de Bogotá.
  const comun = { isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "es-CO", timezoneId: "America/Bogota" };
  cliente = await navegador.newContext({ ...comun, viewport: { width: 360, height: 640 } });
  personal = await navegador.newContext({ ...comun, viewport: { width: 390, height: 844 } });
  paginaCliente = await cliente.newPage();
  paginaPersonal = await personal.newPage();
  // La primera visita compila la página en `next dev`: se da margen.
  paginaCliente.setDefaultTimeout(90_000);
  paginaPersonal.setDefaultTimeout(90_000);
});

afterAll(async () => {
  await navegador?.close();
  await servidor?.detener();
});

/**
 * En `next dev` un toque justo después de cargar puede perderse antes de que React termine de engancharse: se
 * repite hasta que pase lo esperado (un máximo de intentos). Es la única "espera" del recorrido.
 */
async function tocar(boton: Locator, esperado: Locator) {
  let ultimo: unknown;
  for (let i = 0; i < 6; i++) {
    await boton.click();
    try {
      await esperado.waitFor({ state: "visible", timeout: 4000 });
      return;
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo;
}

/** Espera a que algo se vea (no hay matchers de Playwright en vitest: se usan sus esperas). */
const verse = (l: Locator) => l.first().waitFor({ state: "visible" });
const seVe = (l: Locator) => l.first().isVisible();

/**
 * Elige el día número `indice` de la lista (0 = el primero con horas libres). Se usa un día lejano a propósito: el
 * cliente solo puede cambiar o cancelar hasta 2 h antes de la cita, y una hora de hoy podría quedar dentro de ese
 * plazo según la hora a la que corra la prueba.
 */
async function elegirDia(page: Page, indice: number) {
  const dias = page.locator("section", { has: page.getByRole("heading", { name: "Día", exact: true }) }).getByRole("button");
  const dia = dias.nth(indice);
  await dia.waitFor();
  const etiqueta = (await dia.textContent())!.trim();
  await tocar(dia, page.locator('button[aria-pressed="true"]', { hasText: etiqueta }));
}

async function captura(page: Page, nombre: string) {
  await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`) });
}

/** Sin scroll horizontal y con objetivos táctiles de al menos 48 px (reglas de diseño del proyecto). */
async function revisarDiseno(page: Page, donde: string) {
  const r = await page.evaluate(() => {
    const ancho = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    const chicos = [
      ...document.querySelectorAll<HTMLElement>("button, a[href], select, textarea, input:not([type=checkbox]):not([name=web])"),
    ]
      .filter((e) => !e.closest("nextjs-portal") && !e.closest("[aria-hidden=true]"))
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 47.5)
      .map(
        ({ e, r }) =>
          `${e.tagName.toLowerCase()} «${(e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30)}» ${Math.round(r.height)}px`
      );
    return { ancho, chicos };
  });
  expect(r.ancho, `${donde}: hay scroll horizontal`).toBe(true);
  expect(r.chicos, `${donde}: objetivos táctiles menores de 48 px`).toEqual([]);
}

async function entrarComoDueno(page: Page) {
  await page.goto(`${servidor.url}/entrar`);
  await page.locator("#correo").fill(servidor.escenario.correo);
  await page.locator("#clave").fill("cualquiera-en-local");
  let ultimo: unknown;
  for (let i = 0; i < 6; i++) {
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    try {
      await page.waitForURL(/\/inicio/, { timeout: 8000 });
      return;
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo;
}

describe("la reserva de punta a punta", () => {
  it("1 · el cliente reserva desde su celular, sin cuenta", async () => {
    const p = paginaCliente;
    await p.goto(`${servidor.url}/reservar/${servidor.escenario.slug}`);
    await p.getByRole("heading", { name: "Reserva tu cita" }).waitFor();
    await revisarDiseno(p, "servicios");
    await captura(p, "1-servicios");

    await tocar(p.getByRole("button", { name: /^Corte 30 min/ }), p.getByText("¿Con quién?"));
    await revisarDiseno(p, "barbero");

    await tocar(p.getByRole("button", { name: /^El primero disponible/ }), p.getByText("¿Cuándo?"));
    const hora = p.getByRole("button", { name: /^\d{1,2}:\d{2} [ap]\. m\.$/ }).first();
    await hora.waitFor();
    await elegirDia(p, 2);
    await hora.waitFor();
    await revisarDiseno(p, "día y hora");
    await captura(p, "2-dia-y-hora");

    await hora.click();
    await tocar(p.getByRole("button", { name: /^Continuar/ }), p.getByText("Tus datos"));
    await p.getByLabel("Tu nombre").fill(NOMBRE);
    await p.getByLabel("Tu celular").fill(CELULAR);

    // Sin aceptar el tratamiento de datos no se puede confirmar.
    const confirmar = p.getByRole("button", { name: "Confirmar reserva" });
    expect(await confirmar.isDisabled()).toBe(true);
    await p.getByRole("checkbox").check();
    expect(await confirmar.isEnabled()).toBe(true);
    await revisarDiseno(p, "datos");
    await captura(p, "3-datos");

    await confirmar.click();
    await p.waitForURL(/\/cita\/[0-9a-f-]{36}\?nueva=1/);
    await verse(p.getByText("Tu cita quedó reservada"));
    await revisarDiseno(p, "mi cita");
    await captura(p, "4-mi-cita");

    cita.token = /\/cita\/([0-9a-f-]{36})/.exec(p.url())![1];
    cita.inicio = (await p.locator("time").getAttribute("datetime"))!;
    // El día en Bogotá (UTC-5, sin horario de verano).
    cita.fecha = new Date(Date.parse(cita.inicio) - 5 * 3600_000).toISOString().slice(0, 10);
    expect(cita.token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("2 · el personal la ve en su agenda, marcada como reserva en línea", async () => {
    const p = paginaPersonal;
    await entrarComoDueno(p);
    await p.goto(`${servidor.url}/agenda?fecha=${cita.fecha}`);
    await verse(p.getByText(NOMBRE));
    await verse(p.getByText("Reservó en línea"));
    await captura(p, "5-agenda-del-personal");
  });

  it("3 · el cliente cambia la hora desde su enlace", async () => {
    const p = paginaCliente;
    await p.goto(`${servidor.url}/cita/${cita.token}/mover`);
    await p.getByRole("heading", { name: "Cambiar la hora" }).waitFor();
    const horas = p.getByRole("button", { name: /^\d{1,2}:\d{2} [ap]\. m\.$/ });
    await horas.first().waitFor();
    await revisarDiseno(p, "mover");

    // Otro día (distinto del de la cita, que está en el tercero) y también lejano.
    await elegirDia(p, 3);
    const n = await horas.count();
    const otra = horas.nth(n > 2 ? 2 : n - 1);
    const textoHora = (await otra.textContent())!.trim();
    await otra.click();
    await tocar(p.getByRole("button", { name: /^Cambiar a las/ }), p.getByText("Cambiamos la hora de tu cita"));
    await verse(p.getByText(textoHora));

    cita.inicio = (await p.locator("time").getAttribute("datetime"))!;
    cita.fecha = new Date(Date.parse(cita.inicio) - 5 * 3600_000).toISOString().slice(0, 10);
  });

  it("4 · el cliente cancela y el personal la ve cancelada, con el motivo", async () => {
    const p = paginaCliente;
    await tocar(p.getByRole("button", { name: "Cancelar mi cita" }), p.getByText("¿Seguro que quieres cancelar tu cita?"));
    await p.getByLabel(/Cuéntanos por qué/).fill("Me salió un viaje");
    await tocar(p.getByRole("button", { name: "Sí, cancelar mi cita" }), p.getByRole("heading", { name: "Cita cancelada" }));
    await captura(p, "6-cita-cancelada");

    await paginaPersonal.goto(`${servidor.url}/agenda?fecha=${cita.fecha}`);
    await verse(paginaPersonal.getByText("Motivo: Me salió un viaje"));
    // Sigue en la lista (anular es con motivo, no se borra), pero ya no está confirmada ni ocupa la hora.
    expect(await seVe(paginaPersonal.getByText("Confirmada", { exact: true }))).toBe(false);
    await captura(paginaPersonal, "7-agenda-con-la-cancelada");
  });

  it("5 · un enlace de cita que no existe no dice nada de nadie", async () => {
    const r = await paginaCliente.goto(`${servidor.url}/cita/00000000-0000-4000-8000-000000000000`);
    expect(r?.status()).toBe(404);
    await verse(paginaCliente.getByText("No encontramos esa página"));
    expect(await paginaCliente.getByText(NOMBRE).count()).toBe(0);
  });

  it("6 · el cartel con el QR: al imprimir sale solo el cartel", async () => {
    const p = paginaPersonal;
    await p.goto(`${servidor.url}/cartel`);
    await p.getByRole("button", { name: "Imprimir el cartel" }).waitFor();
    await verse(p.locator("#cartel svg"));
    expect(await p.locator("#cartel").textContent()).toContain(`/reservar/${servidor.escenario.slug}`);

    await p.emulateMedia({ media: "print" });
    expect(await seVe(p.locator("#cartel"))).toBe(true);
    expect(await seVe(p.getByRole("button", { name: "Imprimir el cartel" }))).toBe(false);
    expect(await seVe(p.getByText("Mandar el enlace por WhatsApp"))).toBe(false);
    expect(await seVe(p.getByText("Cartel de reservas", { exact: true }))).toBe(false);
    await p.emulateMedia({ media: "screen" });
  });

  it("7 · con las reservas apagadas el cliente ve el catálogo y el aviso", async () => {
    const p = paginaPersonal;
    await p.goto(`${servidor.url}/ajustes-agenda`);
    const interruptor = p.getByRole("checkbox", { name: /Recibir reservas en línea/ });
    await interruptor.waitFor();
    let ultimo: unknown = new Error("no se guardó");
    for (let i = 0; i < 6; i++) {
      await interruptor.uncheck();
      await p.getByRole("button", { name: "Guardar ajustes" }).click();
      try {
        await p.waitForURL(/\/mas/, { timeout: 8000 });
        ultimo = null;
        break;
      } catch (e) {
        ultimo = e;
      }
    }
    if (ultimo) throw ultimo;

    await paginaCliente.goto(`${servidor.url}/reservar/${servidor.escenario.slug}`);
    await verse(paginaCliente.getByRole("heading", { name: "Hoy no recibimos reservas" }));
    await verse(paginaCliente.getByText("Corte"));
    await revisarDiseno(paginaCliente, "reservas apagadas");
  });
});
