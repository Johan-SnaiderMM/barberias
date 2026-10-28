import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enviar = vi.fn();
const configurar = vi.fn();
const consultarPublico = vi.fn();

vi.mock("web-push", () => ({ default: { sendNotification: enviar, setVapidDetails: configurar } }));
vi.mock("@/lib/datos/llamar", () => ({ consultarPublico }));

const { avisarAlPersonal, llavesVapid } = await import("./push");

const cita = { id: "c1", cliente: "Laura", servicio: "Corte", barbero: "Camilo", inicio: "2030-03-04T15:00:00Z" };
const subs = [
  { endpoint: "https://push.test/a", p256dh: "p1", auth: "a1" },
  { endpoint: "https://push.test/b", p256dh: "p2", auth: "a2" },
];

function conLlaves() {
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "publica");
  vi.stubEnv("VAPID_PRIVATE_KEY", "privada");
  vi.stubEnv("VAPID_SUBJECT", "mailto:prueba@ejemplo.test");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("llavesVapid", () => {
  it("sin las tres variables no hay llaves", () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "publica");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "mailto:x@y.z");
    expect(llavesVapid()).toBeNull();
  });

  it("con las tres, las devuelve", () => {
    conLlaves();
    expect(llavesVapid()).toEqual({ publica: "publica", privada: "privada", asunto: "mailto:prueba@ejemplo.test" });
  });
});

describe("avisarAlPersonal", () => {
  it("sin llaves no consulta ni manda nada", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    await avisarAlPersonal("t", "reserva");
    expect(consultarPublico).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
  });

  it("manda el aviso a cada suscripción, con el texto armado", async () => {
    conLlaves();
    consultarPublico.mockResolvedValueOnce({ ok: true, tipo: "reserva", cita, suscripciones: subs });
    enviar.mockResolvedValue({});
    await avisarAlPersonal("token-1", "reserva");

    expect(consultarPublico).toHaveBeenCalledWith("publico_tomar_aviso", { p_token: "token-1", p_tipo: "reserva" });
    expect(configurar).toHaveBeenCalledWith("mailto:prueba@ejemplo.test", "publica", "privada");
    expect(enviar).toHaveBeenCalledTimes(2);
    const [destino, mensaje, opciones] = enviar.mock.calls[0];
    expect(destino).toEqual({ endpoint: "https://push.test/a", keys: { p256dh: "p1", auth: "a1" } });
    expect(JSON.parse(mensaje)).toMatchObject({ titulo: "Nueva reserva", url: "/agenda/cita/c1" });
    // Un servicio que no responde no deja colgado al servidor: máximo 5 segundos por celular (revisión de seguridad 02, S4).
    expect(opciones).toMatchObject({ TTL: 3600, timeout: 5000 });
  });

  it("si la base no entrega el aviso (ya salió o venció), no manda nada", async () => {
    conLlaves();
    consultarPublico.mockResolvedValueOnce({ ok: false });
    await avisarAlPersonal("t", "reserva");
    expect(enviar).not.toHaveBeenCalled();
  });

  it("sin suscripciones no manda nada", async () => {
    conLlaves();
    consultarPublico.mockResolvedValueOnce({ ok: true, tipo: "cancelacion", cita, suscripciones: [] });
    await avisarAlPersonal("t", "cancelacion");
    expect(enviar).not.toHaveBeenCalled();
  });

  it("un celular que ya no existe (410 o 404) se olvida; otro error no", async () => {
    conLlaves();
    consultarPublico.mockResolvedValueOnce({ ok: true, tipo: "reserva", cita, suscripciones: subs });
    consultarPublico.mockResolvedValue({ ok: true });
    enviar.mockRejectedValueOnce({ statusCode: 410 }).mockRejectedValueOnce({ statusCode: 500 });
    await avisarAlPersonal("t", "reserva");

    const olvidos = consultarPublico.mock.calls.filter(([nombre]) => nombre === "publico_olvidar_suscripcion_push");
    expect(olvidos).toEqual([["publico_olvidar_suscripcion_push", { p_endpoint: "https://push.test/a" }]]);
  });

  it("nunca lanza: un fallo de la base o del servicio de push se registra y se traga", async () => {
    conLlaves();
    consultarPublico.mockRejectedValueOnce(new Error("sin señal"));
    await expect(avisarAlPersonal("t", "reserva")).resolves.toBeUndefined();

    consultarPublico.mockResolvedValueOnce({ ok: true, tipo: "reserva", cita, suscripciones: subs });
    configurar.mockImplementationOnce(() => {
      throw new Error("llaves malas");
    });
    await expect(avisarAlPersonal("t", "reserva")).resolves.toBeUndefined();
  });
});
