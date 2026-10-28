import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const obtenerUsuario = vi.fn();
const obtenerGasto = vi.fn();
const leerArchivo = vi.fn();
const bd = vi.fn(async () => ({ leerArchivo }));

vi.mock("@/lib/sesion", () => ({ obtenerUsuario }));
vi.mock("@/lib/datos/gastos", () => ({ obtenerGasto }));
vi.mock("@/lib/datos/bd", () => ({ bd }));

const { GET } = await import("./route");

const BARBERIA = randomUUID();
const RUTA = `${BARBERIA}/${randomUUID()}.jpg`;
const pedir = (id: string) => GET(new Request(`http://localhost/api/foto/gasto/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  bd.mockImplementation(async () => ({ leerArchivo }));
  obtenerUsuario.mockResolvedValue({ id: "u1", email: null });
  obtenerGasto.mockResolvedValue({ foto_ruta: RUTA });
  leerArchivo.mockResolvedValue({ datos: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), tipo: "image/jpeg" });
});

describe("GET /api/foto/gasto/[id]", () => {
  it("sirve la foto de un gasto que la persona puede ver, privada y sin adivinar el tipo", async () => {
    const id = randomUUID();
    const r = await pedir(id);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(obtenerGasto).toHaveBeenCalledWith(id);
    expect(leerArchivo).toHaveBeenCalledWith("gastos-fotos", RUTA);
  });

  it("sin sesión responde 401 y no mira nada", async () => {
    obtenerUsuario.mockResolvedValue(null);
    expect((await pedir(randomUUID())).status).toBe(401);
    expect(obtenerGasto).not.toHaveBeenCalled();
    expect(leerArchivo).not.toHaveBeenCalled();
  });

  it("un id que no es uuid responde 404 sin consultar", async () => {
    for (const id of ["abc", "../../etc/passwd", ""]) expect((await pedir(id)).status).toBe(404);
    expect(obtenerGasto).not.toHaveBeenCalled();
  });

  it("si la base no deja ver el gasto (otro permiso) responde 403, sin leer el archivo", async () => {
    obtenerGasto.mockRejectedValue(new Error("No tienes permiso"));
    expect((await pedir(randomUUID())).status).toBe(403);
    expect(leerArchivo).not.toHaveBeenCalled();
  });

  it("un gasto que no existe, o sin foto, responde 404", async () => {
    obtenerGasto.mockResolvedValue(null);
    expect((await pedir(randomUUID())).status).toBe(404);
    obtenerGasto.mockResolvedValue({ foto_ruta: null });
    expect((await pedir(randomUUID())).status).toBe(404);
    expect(leerArchivo).not.toHaveBeenCalled();
  });

  it("una ruta guardada con una forma rara nunca llega al almacenamiento", async () => {
    for (const ruta of ["../secreto.jpg", `${BARBERIA}/../otra/${randomUUID()}.jpg`, "x.exe"]) {
      obtenerGasto.mockResolvedValue({ foto_ruta: ruta });
      expect((await pedir(randomUUID())).status).toBe(404);
    }
    expect(leerArchivo).not.toHaveBeenCalled();
  });

  it("si el archivo no está en el almacenamiento responde 404", async () => {
    leerArchivo.mockResolvedValue(null);
    expect((await pedir(randomUUID())).status).toBe(404);
  });
});
