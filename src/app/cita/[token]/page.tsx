import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleCheck, MapPin, MessageCircle } from "lucide-react";
import { PieLegal } from "@/components/legal/pie-legal";
import { AccionesMiCita } from "@/components/reserva/acciones-mi-cita";
import { botonVariantes } from "@/components/ui/button";
import { textoDuracion } from "@/lib/catalogo";
import { obtenerCitaPublica } from "@/lib/datos/publico";
import { formatearPesos } from "@/lib/dinero";
import { fechaBogota, fechaLarga, horaCorta } from "@/lib/fechas";
import { enlaceWhatsappA } from "@/lib/whatsapp";

export const metadata: Metadata = { title: "Tu cita" };

// Depende del enlace secreto y de la hora actual: nunca se prerenderiza.
export const dynamic = "force-dynamic";

const ESTADO_TEXTO: Record<string, string> = {
  confirmada: "Confirmada",
  en_atencion: "En atención",
  atendida: "Atendida",
  cancelada: "Cancelada",
  no_asistio: "No asististe",
};

/**
 * Tu cita (`/cita/<token>`): la ve, la cancela o la mueve quien tiene el enlace. El token es el único permiso: uno
 * que no existe da 404, igual que uno vencido, y no se filtra nada de nadie más.
 */
export default async function MiCita({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ nueva?: string; movida?: string }>;
}) {
  const { token } = await params;
  const { nueva, movida } = await searchParams;
  const c = await obtenerCitaPublica(token).catch(() => null);
  if (!c || !c.existe) notFound();

  const { barberia, cita } = c;
  const fecha = fechaBogota(cita.inicio);
  const vigente = cita.estado === "confirmada";
  const mensaje = `Hola, tengo una cita en ${barberia.nombre} el ${fechaLarga(fecha).toLowerCase()} a las ${horaCorta(cita.inicio)}.`;
  const whatsapp = enlaceWhatsappA(barberia.whatsapp, mensaje);

  return (
    <main className="columna-app px-4 pb-10 pt-[calc(1.5rem+env(safe-area-inset-top,0px))]">
      <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">{barberia.nombre}</p>

      {vigente && (nueva || movida) && (
        <div className="mt-3 flex items-start gap-3 rounded-xl border border-linea bg-white p-4">
          <CircleCheck className="mt-0.5 size-6 shrink-0" aria-hidden />
          <p className="text-base">
            <span className="font-semibold">{movida ? "Cambiamos la hora de tu cita." : "¡Listo! Tu cita quedó reservada."}</span>{" "}
            Guarda este enlace: desde aquí la puedes cambiar o cancelar.
          </p>
        </div>
      )}

      <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight">
        {vigente ? "Tu cita" : `Cita ${ESTADO_TEXTO[cita.estado]?.toLowerCase() ?? ""}`}
      </h1>

      <section className="mt-4 rounded-xl border border-linea bg-white p-4">
        <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">{fechaLarga(fecha)}</p>
        <p className="mt-1 whitespace-nowrap text-2xl font-semibold leading-tight tracking-tight">
          <time dateTime={cita.inicio}>{horaCorta(cita.inicio)}</time> – {horaCorta(cita.fin)}
        </p>
        <dl className="mt-4 divide-y divide-hueso border-t border-hueso">
          <Fila etiqueta="Servicio" valor={`${cita.servicio} · ${textoDuracion(cita.duracion_min)}`} />
          <Fila etiqueta="Con" valor={cita.barbero} />
          <Fila etiqueta="Precio" valor={formatearPesos(cita.precio)} />
          <Fila etiqueta="Estado" valor={ESTADO_TEXTO[cita.estado] ?? cita.estado} />
        </dl>
        {barberia.direccion && (
          <p className="mt-3 flex items-start gap-2 border-t border-hueso pt-3 text-base text-tinta-2">
            <MapPin className="mt-0.5 size-5 shrink-0" aria-hidden />
            {barberia.direccion}
          </p>
        )}
      </section>

      <div className="mt-5 space-y-3">
        {cita.puede_cambiar && <AccionesMiCita token={token} />}

        {vigente && !cita.puede_cambiar && (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
            Ya pasó el plazo para cambiar o cancelar desde aquí ({barberia.cancelar_hasta_horas} h antes). Si necesitas algo,
            escríbenos.
          </p>
        )}

        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className={botonVariantes({ variante: "secundario", tamano: "lg", bloque: true })}
          >
            <MessageCircle className="size-5" aria-hidden />
            Escribir a la barbería
          </a>
        )}
      </div>

      <PieLegal slug={barberia.slug} className="mt-6" />
    </main>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm font-medium uppercase tracking-wider text-tinta-2">{etiqueta}</dt>
      <dd className="text-right text-base font-medium">{valor}</dd>
    </div>
  );
}
