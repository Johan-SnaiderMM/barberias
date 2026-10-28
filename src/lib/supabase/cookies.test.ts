import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cookieDeSesion } from "./cookies";

afterEach(() => vi.unstubAllEnvs());

describe("cookieDeSesion", () => {
  const original = { path: "/", sameSite: "lax", httpOnly: false, maxAge: 34_560_000 } as const;

  it("la cookie no la lee JavaScript y conserva lo demás", () => {
    expect(cookieDeSesion(original)).toMatchObject({ path: "/", sameSite: "lax", httpOnly: true, maxAge: 34_560_000 });
    expect(cookieDeSesion(undefined).httpOnly).toBe(true);
  });

  it("solo viaja por HTTPS en producción (en desarrollo no hay HTTPS)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(cookieDeSesion(original).secure).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(cookieDeSesion(original).secure).toBe(false);
  });

  it("no pisa las cookies que borran la sesión (maxAge 0 sigue en 0)", () => {
    expect(cookieDeSesion({ ...original, maxAge: 0 }).maxAge).toBe(0);
  });
});

describe("quién escribe las cookies de sesión", () => {
  it("el servidor y el proxy las pasan por cookieDeSesion", () => {
    for (const archivo of [["src", "lib", "supabase", "servidor.ts"], ["src", "proxy.ts"]]) {
      const codigo = fs.readFileSync(path.join(process.cwd(), ...archivo), "utf8");
      expect(codigo, archivo.join("/")).toContain("cookieDeSesion(options)");
    }
  });

  it("la app no usa el cliente de Supabase del navegador (por eso se puede cerrar la cookie a JavaScript)", () => {
    const usos: string[] = [];
    (function recorrer(dir: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const ruta = path.join(dir, e.name);
        if (e.isDirectory()) recorrer(ruta);
        else if (/\.(tsx?)$/.test(e.name) && !/\.test\./.test(e.name) && /createBrowserClient|document\.cookie/.test(fs.readFileSync(ruta, "utf8"))) usos.push(ruta);
      }
    })(path.join(process.cwd(), "src"));
    expect(usos).toEqual([]);
  });
});
