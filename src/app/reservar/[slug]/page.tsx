import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { FlujoReserva } from "@/components/reserva/flujo-reserva";
import { botonVariantes } from "@/components/ui/button";
import { textoDuracion } from "@/lib/catalogo";
import { obtenerCatalogoPublico } from "@/lib/datos/publico";
import { formatearPesos } from "@/lib/dinero";
import { hoyBogota } from "@/lib/fechas";
import { enlaceWhatsappA } from "@/lib/whatsapp";

// Lee la base en cada visita (las horas cambian): nunca se prerenderiza.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await obtenerCatalogoPublico(slug).catch(() => null);
  return { title: c?.existe ? `Reserva en ${c.barberia.nombre}` : "Reservar" };
}

/**
 * La reserva pública de una barbería (`/reservar/<slug>`): sin cuenta, desde el celular del cliente. Si el dueño apagó
 * las reservas en línea, se ve el catálogo y el aviso.
 */
export default async function Reservar({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await obtenerCatalogoPublico(slug).catch(() => null);
  if (!c || !c.existe) notFound();

  const { barberia, servicios, barberos } = c;
  const whatsapp = enlaceWhatsappA(barberia.whatsapp, `Hola, quiero reservar una cita en ${barberia.nombre}.`);

  if (!barberia.reservas_en_linea || servicios.length === 0) {
    return (
      <main className="columna-app px-4 pb-10 pt-[calc(1.5rem+env(safe-area-inset-top,0px))]">
        <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">{barberia.nombre}</p>
        <h1 className="mt-1 text-3xl font-semibold leading-tight tracking-tight">Hoy no recibimos reservas</h1>
        <p className="mt-2 text-base text-tinta-2">
          {servicios.length === 0
            ? "Todavía no tenemos servicios para reservar en línea."
            : "Por ahora no tomamos reservas en línea."}
          {whatsapp ? " Escríbenos y te ayudamos." : ""}
        </p>
        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${botonVariantes({ tamano: "lg", bloque: true })} mt-5`}>
            <MessageCircle className="size-5" aria-hidden />
            Escribir por WhatsApp
          </a>
        )}
        {servicios.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-tinta-2">Servicios</h2>
            <ul className="divide-y divide-hueso rounded-xl border border-linea bg-white">
              {servicios.map((s) => (
                <li key={s.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <span className="text-base font-medium">
                    {s.nombre} <span className="font-normal text-tinta-2">· {textoDuracion(s.duracion_min)}</span>
                  </span>
                  <span className="text-base font-medium">{formatearPesos(s.precio)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {barberia.direccion && <p className="mt-6 text-base text-tinta-2">{barberia.direccion}</p>}
      </main>
    );
  }

  return (
    <main className="columna-app">
      <FlujoReserva barberia={barberia} servicios={servicios} barberos={barberos} hoy={hoyBogota()} />
    </main>
  );
}
