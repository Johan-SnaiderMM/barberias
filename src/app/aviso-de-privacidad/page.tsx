import type { Metadata } from "next";
import Link from "next/link";
import { BloqueResponsable, DocumentoLegal, SeccionLegal } from "@/components/legal/documento-legal";
import { obtenerResponsable } from "@/lib/datos/publico";
import { enlacesLegales, PLAZOS_LEGALES, slugDeLaDireccion } from "@/lib/legal";
import { MARCA } from "@/lib/marca";

export const metadata: Metadata = { title: "Aviso de privacidad" };

// Muestra los datos de la barbería que se indica en la dirección (?b=<nombre-corto>): se lee en cada visita.
export const dynamic = "force-dynamic";

/**
 * Aviso de privacidad (Ley 1581 de 2012 y Decreto 1377 de 2013): el resumen corto que se lee ANTES de reservar y que
 * manda a la política completa. BORRADOR: lo revisa un abogado antes de un piloto con clientes reales (tarea 4.3).
 */
export default async function AvisoDePrivacidad({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const slug = slugDeLaDireccion((await searchParams).b);
  const responsable = await obtenerResponsable(slug);
  const { politica } = enlacesLegales(slug);

  return (
    <DocumentoLegal titulo="Aviso de privacidad">
      <p className="text-tinta-2">Antes de reservar, esto es lo que debes saber sobre tus datos personales.</p>

      <SeccionLegal titulo="Quién es el responsable">
        <p>La barbería donde reservas decide qué se hace con tus datos: es la responsable de su tratamiento.</p>
        <BloqueResponsable responsable={responsable} />
        <p>
          {MARCA.nombre} es la herramienta que la barbería usa para llevar su agenda y sus cuentas. Guarda tus datos por
          encargo de la barbería y no los usa para nada más.
        </p>
      </SeccionLegal>

      <SeccionLegal titulo="Qué datos tratamos">
        <p>
          Tu nombre y tu celular, y los datos de tu cita: servicio, barbero, día y hora. No pedimos documento, correo,
          dirección ni datos sensibles.
        </p>
        <p>Si reservas para un menor de edad, escribe tu nombre y tu celular (los de su representante), no los del menor.</p>
      </SeccionLegal>

      <SeccionLegal titulo="Para qué los usamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Agendar tu cita y avisarte si algo cambia.</li>
          <li>Recordártela por WhatsApp o por llamada.</li>
          <li>Llevar el historial de tus visitas y tus preferencias en esa barbería.</li>
          <li>Registrar el cobro del servicio en las cuentas de la barbería.</li>
        </ul>
        <p>No los usamos para publicidad y no los vendemos ni los cedemos a terceros.</p>
      </SeccionLegal>

      <SeccionLegal titulo="Tus derechos">
        <p>
          Como titular de tus datos puedes conocerlos, actualizarlos y corregirlos; pedir prueba de tu autorización; saber
          cómo se usan; pedir que se supriman o retirar tu autorización; consultarlos gratis; y quejarte ante la
          Superintendencia de Industria y Comercio.
        </p>
        <p>
          Para ejercerlos, escríbele a la barbería. Debe responder tus consultas en máximo {PLAZOS_LEGALES.consulta} días
          hábiles y tus reclamos en máximo {PLAZOS_LEGALES.reclamo} días hábiles.
        </p>
      </SeccionLegal>

      <SeccionLegal titulo="Tu autorización es voluntaria">
        <p>
          Al marcar la casilla de la reserva autorizas este tratamiento. Es voluntario, pero sin tu nombre y tu celular no
          podemos agendar tu cita. Puedes retirar tu autorización cuando quieras.
        </p>
      </SeccionLegal>

      <SeccionLegal titulo="La política completa">
        <p>
          El detalle (qué guardamos, por cuánto tiempo, quién lo ve y cómo hacer una consulta o un reclamo) está en la
          política de tratamiento de datos. Si cambia de forma importante, lo publicaremos allí.
        </p>
        <Link href={politica} className="inline-flex min-h-12 items-center font-medium text-tinta underline underline-offset-4">
          Leer la política de datos
        </Link>
      </SeccionLegal>
    </DocumentoLegal>
  );
}
