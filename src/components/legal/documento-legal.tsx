import type { ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import { botonVariantes } from "@/components/ui/button";
import { VERSION_LEGAL } from "@/lib/legal";
import { MARCA } from "@/lib/marca";
import type { BarberiaPublica } from "@/lib/tipos/reserva";
import { enlaceWhatsappA } from "@/lib/whatsapp";

export type Responsable = Pick<BarberiaPublica, "nombre" | "direccion" | "whatsapp"> | null;

/**
 * La hoja de un texto legal (aviso de privacidad, política de datos): marca, título, la advertencia de borrador con su
 * versión y el cuerpo. Se lee en el celular de quien va a reservar: columna angosta, texto de 16 px.
 */
export function DocumentoLegal({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <main className="columna-app px-4 pb-12 pt-[calc(1.5rem+env(safe-area-inset-top,0px))]">
      <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">{MARCA.nombre}</p>
      <h1 className="mt-1 text-3xl font-semibold leading-tight tracking-tight">{titulo}</h1>
      <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
        Borrador pendiente de revisión legal · versión {VERSION_LEGAL.version} · {VERSION_LEGAL.fecha}
      </p>
      <div className="mt-6 space-y-6 text-base leading-relaxed">{children}</div>
    </main>
  );
}

export function SeccionLegal({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{titulo}</h2>
      <div className="mt-1 space-y-2 text-tinta-2">{children}</div>
    </section>
  );
}

/** Quién es el responsable: la barbería (con su dirección y su WhatsApp) o, si no se sabe cuál, la de la reserva. */
export function BloqueResponsable({ responsable }: { responsable: Responsable }) {
  if (!responsable) {
    return (
      <p>
        La barbería donde haces tu reserva. Su nombre, su dirección y la forma de contactarla están en la página desde la que
        llegaste a este texto.
      </p>
    );
  }
  const whatsapp = enlaceWhatsappA(responsable.whatsapp, `Hola, tengo una consulta sobre mis datos personales en ${responsable.nombre}.`);
  return (
    <>
      <p>
        <strong className="font-semibold text-tinta">{responsable.nombre}</strong>
        {responsable.direccion ? ` · ${responsable.direccion}` : ""}
      </p>
      {whatsapp ? (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={botonVariantes({ variante: "secundario", bloque: true })}>
          <MessageCircle className="size-5" aria-hidden />
          Escribirle por WhatsApp
        </a>
      ) : (
        <p>Para contactarla, usa los datos de su página de reservas.</p>
      )}
    </>
  );
}
