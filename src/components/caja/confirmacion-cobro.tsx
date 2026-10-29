import Link from "@/components/ui/enlace";
import { CircleCheck } from "lucide-react";
import { AvanzaGuia } from "@/components/guia/avanza-guia";
import { BarraAccion } from "@/components/layout/barra-accion";
import { botonVariantes } from "@/components/ui/button";
import { formatearPesos } from "@/lib/dinero";
import type { Cobrado } from "@/lib/tipos/caja";

/** Después de cobrar: lo cobrado, el vuelto que hay que devolver (si hubo) y a dónde seguir. */
export function ConfirmacionCobro({ cobrado, volverA, volverTexto }: { cobrado: Cobrado; volverA: string; volverTexto: string }) {
  return (
    <main className="px-4 pb-40 pt-[calc(2rem+env(safe-area-inset-top,0px))]">
      {/* Si la persona va en el recorrido guiado (paso 4: cobrar), tras ver el cobro la guía sigue sola. */}
      <AvanzaGuia desde={4} espera={2200} />
      <div className="flex items-center gap-2 text-tinta-2">
        <CircleCheck className="size-6" aria-hidden />
        <p className="text-base font-medium">{cobrado.ya_existia ? "Este cobro ya estaba hecho" : "Cobrado"}</p>
      </div>
      <p className="mt-1 text-5xl font-semibold tracking-tight">{formatearPesos(cobrado.cobrado)}</p>

      {cobrado.vuelto > 0 && (
        <section className="mt-5 rounded-xl border border-tinta bg-superficie p-4">
          <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">Devuelve</p>
          <p className="text-4xl font-semibold tracking-tight">{formatearPesos(cobrado.vuelto)}</p>
        </section>
      )}

      <dl className="mt-5 divide-y divide-hueso rounded-xl border border-linea bg-superficie">
        <Fila etiqueta="Servicios" valor={formatearPesos(cobrado.subtotal)} />
        {cobrado.descuento > 0 && <Fila etiqueta="Descuento" valor={`− ${formatearPesos(cobrado.descuento)}`} />}
        {cobrado.propina > 0 && <Fila etiqueta="Propina" valor={formatearPesos(cobrado.propina)} />}
      </dl>

      <BarraAccion>
        <Link href={volverA} className={botonVariantes({ tamano: "lg", bloque: true })}>
          {volverTexto}
        </Link>
        <Link href={`/caja/cobro/${cobrado.id}`} className={botonVariantes({ variante: "secundario", tamano: "lg", bloque: true })}>
          Ver el cobro
        </Link>
      </BarraAccion>
    </main>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="text-sm font-medium uppercase tracking-wider text-tinta-2">{etiqueta}</dt>
      <dd className="text-right text-base font-semibold">{valor}</dd>
    </div>
  );
}
