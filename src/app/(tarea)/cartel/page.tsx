import { headers } from "next/headers";
import { AccionesCartel } from "@/components/cartel/acciones-cartel";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { mensajeEnlaceReservas, origenDeCabeceras, urlReservas } from "@/lib/enlaces";
import { revisarPermiso } from "@/lib/permisos";
import { qrSvg } from "@/lib/qr";
import { enlaceWhatsappSinNumero } from "@/lib/whatsapp";

export const metadata = { title: "Cartel de reservas" };

/**
 * El cartel para pegar en la barbería: el nombre, el código QR y el enlace de reservas. Al imprimir (Ctrl+P o el
 * botón) solo sale el cartel: el encabezado y los botones llevan `print:hidden`.
 */
export default async function Cartel() {
  const { barberia, permitido } = await revisarPermiso("cartel");
  if (!permitido) return <SinPermiso />;

  const cab = await headers();
  const url = urlReservas(
    origenDeCabeceras({
      host: cab.get("host"),
      hostReenviado: cab.get("x-forwarded-host"),
      protoReenviado: cab.get("x-forwarded-proto"),
    }),
    barberia.slug
  );
  const svg = await qrSvg(url);

  return (
    <>
      <div className="print:hidden">
        <EncabezadoTarea titulo="Cartel de reservas" volverA="/mas" />
      </div>
      <main className="space-y-5 px-4 pt-5 print:p-0">
        {/* La hoja: lo único que se imprime. */}
        <section
          id="cartel"
          className="rounded-xl border border-linea bg-white p-6 text-center print:rounded-none print:border-0 print:p-0"
        >
          <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">{barberia.nombre}</p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight">Reserva tu cita desde tu celular</h1>
          <div
            role="img"
            aria-label={`Código QR para reservar en ${barberia.nombre}`}
            className="mx-auto mt-5 w-full max-w-64 print:max-w-md [&>svg]:h-auto [&>svg]:w-full"
            // SVG generado en el servidor por la librería de QR a partir de nuestra propia URL: no lleva texto ajeno.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <p className="mt-4 text-base text-tinta-2">Abre la cámara de tu celular y apunta al código.</p>
          <p className="mt-2 break-all text-base font-medium">{url}</p>
        </section>

        <AccionesCartel url={url} enlaceWhatsapp={enlaceWhatsappSinNumero(mensajeEnlaceReservas(barberia.nombre, url))} />
      </main>
    </>
  );
}
