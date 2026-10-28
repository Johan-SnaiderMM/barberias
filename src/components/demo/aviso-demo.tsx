import { FlaskConical, Route } from "lucide-react";
import { BotonGuia } from "@/components/guia/boton-guia";

/**
 * Lo que avisa que esta barbería es de ejemplo: así nadie confunde la demo con una barbería de verdad ni se asusta al
 * ver tanta plata. Borde punteado y fondo gris (lo «distinto» nunca se marca con opacity). Con `conRecorrido` ofrece el
 * recorrido guiado de dos minutos (y se esconde mientras el recorrido está en marcha).
 */
export function AvisoDemo({ className = "", conRecorrido = false }: { className?: string; conRecorrido?: boolean }) {
  return (
    <div role="note" className={`rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 ${className}`}>
      <div className="flex items-start gap-3">
        <FlaskConical className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p className="text-base leading-snug">
          <strong className="font-semibold">Barbería de demostración.</strong> Los clientes, las citas y el dinero que ves son inventados.
        </p>
      </div>
      {conRecorrido && (
        <BotonGuia className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-linea bg-white px-4 text-base font-medium active:bg-hueso">
          <Route className="size-5" aria-hidden />
          Recorrido de 2 minutos
        </BotonGuia>
      )}
    </div>
  );
}
