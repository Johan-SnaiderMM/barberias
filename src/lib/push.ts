import "server-only";
import webpush from "web-push";
import { armarAviso, type CitaDeAviso, type TipoAviso } from "@/lib/avisos-push";
import { consultarPublico } from "@/lib/datos/llamar";

type Suscripcion = { endpoint: string; p256dh: string; auth: string };
type RespuestaAviso = { ok: false } | { ok: true; tipo: TipoAviso; cita: CitaDeAviso; suscripciones: Suscripcion[] };

/**
 * Llaves VAPID del servidor (se generan una vez con `npm run vapid`). Sin las tres, los avisos push no se mandan y
 * la app funciona igual.
 */
export function llavesVapid(): { publica: string; privada: string; asunto: string } | null {
  const publica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privada = process.env.VAPID_PRIVATE_KEY?.trim();
  const asunto = process.env.VAPID_SUBJECT?.trim();
  return publica && privada && asunto ? { publica, privada, asunto } : null;
}

/**
 * Avisa al personal de una reserva o cancelación del cliente. Se llama DESPUÉS de responderle al cliente (con
 * `after`): nunca debe hacerlo esperar ni fallar. Todo error se registra y se traga.
 */
export async function avisarAlPersonal(token: string, tipo: TipoAviso): Promise<void> {
  const llaves = llavesVapid();
  if (!llaves) return;

  try {
    // La base entrega las suscripciones una sola vez por cita y solo si el aviso es de los últimos 10 minutos.
    const r = await consultarPublico<RespuestaAviso>("publico_tomar_aviso", { p_token: token, p_tipo: tipo });
    if (!r.ok || r.suscripciones.length === 0) return;

    webpush.setVapidDetails(llaves.asunto, llaves.publica, llaves.privada);
    const mensaje = JSON.stringify(armarAviso(r.tipo, r.cita));

    const resultados = await Promise.allSettled(
      r.suscripciones.map((s) =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, mensaje, { TTL: 3600, timeout: 5000 })
      )
    );

    // Un celular que ya no existe (404 o 410) se olvida para no insistirle.
    await Promise.allSettled(
      resultados.flatMap((res, i) => {
        if (res.status !== "rejected") return [];
        const codigo = (res.reason as { statusCode?: number })?.statusCode;
        if (codigo !== 404 && codigo !== 410) {
          console.error(`[push] no se pudo avisar (${codigo ?? "sin código"})`);
          return [];
        }
        return [consultarPublico("publico_olvidar_suscripcion_push", { p_endpoint: r.suscripciones[i].endpoint })];
      })
    );
  } catch (e) {
    console.error("[push] falló el aviso:", e instanceof Error ? e.message : e);
  }
}
