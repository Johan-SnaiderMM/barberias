import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FormularioMoverCita } from "@/components/reserva/formulario-mover-cita";
import { obtenerCitaPublica, obtenerHuecosDeCita } from "@/lib/datos/publico";
import { fechaBogota, fechaLarga, horaCorta, hoyBogota, sumarDias } from "@/lib/fechas";

export const metadata: Metadata = { title: "Cambiar la hora" };

// Depende del enlace secreto y de la hora actual: nunca se prerenderiza.
export const dynamic = "force-dynamic";

/** Cambiar la hora de tu cita (`/cita/<token>/mover`): mismo barbero y servicio, otra hora libre. */
export default async function MoverMiCita({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await obtenerCitaPublica(token).catch(() => null);
  if (!c || !c.existe) notFound();
  // Pasado el plazo o ya cancelada: no hay nada que mover aquí.
  if (!c.cita.puede_cambiar) redirect(`/cita/${token}`);

  const hoy = hoyBogota();
  const huecos = await obtenerHuecosDeCita(token, hoy, sumarDias(hoy, 30)).catch(() => []);

  return (
    <main className="columna-app px-4 pb-32 pt-[calc(1rem+env(safe-area-inset-top,0px))]">
      <Link
        href={`/cita/${token}`}
        className="-ml-2 flex min-h-12 items-center gap-2 rounded-xl px-2 text-base font-medium text-tinta-2 active:bg-hueso"
      >
        <ArrowLeft className="size-5" aria-hidden />
        Volver a mi cita
      </Link>
      <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight">Cambiar la hora</h1>
      <p className="mt-1 mb-5 text-base text-tinta-2">
        Ahora: {fechaLarga(fechaBogota(c.cita.inicio)).toLowerCase()}, {horaCorta(c.cita.inicio)}, con {c.cita.barbero}.
      </p>
      <FormularioMoverCita
        token={token}
        huecosIniciales={huecos}
        hoy={hoy}
        diasAdelante={c.barberia.dias_adelante}
      />
    </main>
  );
}
