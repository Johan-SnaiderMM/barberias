"use client";

import { cn } from "@/lib/utils";

type Opcion<V extends string | number> = { valor: V; etiqueta: string };

/**
 * Elegir UNA opción entre pocas (2 a 4), con botones grandes. Es un grupo de radios: `nombre` manda el valor en
 * un formulario. La opción elegida se ve con fondo oscuro; no se apoya solo en el color (lleva marca de elegido).
 */
export function Segmentado<V extends string | number>({
  opciones,
  valor,
  onCambio,
  nombre,
  etiqueta,
}: {
  opciones: readonly Opcion<V>[];
  valor: V;
  onCambio: (valor: V) => void;
  nombre?: string;
  /** Texto para lectores de pantalla. */
  etiqueta: string;
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="grid auto-cols-fr grid-flow-col gap-2">
      {nombre && <input type="hidden" name={nombre} value={String(valor)} />}
      {opciones.map((o) => {
        const elegido = o.valor === valor;
        return (
          <button
            key={String(o.valor)}
            type="button"
            role="radio"
            aria-checked={elegido}
            onClick={() => onCambio(o.valor)}
            className={cn(
              "min-h-12 rounded-xl border px-3 text-base font-semibold leading-tight",
              elegido ? "border-tinta bg-tinta text-papel" : "border-linea bg-papel text-tinta active:bg-hueso"
            )}
          >
            {elegido ? "✓ " : ""}
            {o.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
