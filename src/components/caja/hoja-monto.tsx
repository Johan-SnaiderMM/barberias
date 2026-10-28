"use client";

import { useState, type ReactNode } from "react";
import { Hoja } from "@/components/ui/hoja";
import { Button } from "@/components/ui/button";
import { TecladoNumerico } from "@/components/ui/teclado-numerico";
import { formatearPesos, type Pesos } from "@/lib/dinero";
import { aplicarTecla } from "@/lib/teclado";
import { cn } from "@/lib/utils";

/**
 * Escribir un monto con el teclado propio dentro de una hoja: lo escrito se ve grande arriba, hay atajos de un toque
 * y "Listo" lo confirma. `max` evita pasarse (el monto se queda en el tope). `children` va entre el monto y los
 * atajos (por ejemplo, el motivo de un descuento).
 */
export function HojaMonto({
  titulo,
  inicial,
  max,
  atajos = [],
  aceptar = "Listo",
  puedeAceptar = () => true,
  alAceptar,
  onCerrar,
  children,
}: {
  titulo: string;
  inicial: Pesos;
  max: Pesos;
  /** Montos de un toque (se muestran con su etiqueta). */
  atajos?: { etiqueta: string; valor: Pesos }[];
  aceptar?: string;
  /** Si devuelve false, "Listo" queda apagado (por ejemplo, falta el motivo). */
  puedeAceptar?: (valor: Pesos) => boolean;
  alAceptar: (valor: Pesos) => void;
  onCerrar: () => void;
  children?: ReactNode;
}) {
  const [valor, setValor] = useState(Math.min(inicial, max));

  return (
    <Hoja titulo={titulo} onCerrar={onCerrar}>
      <div className="space-y-3">
        <p className="rounded-xl border border-linea bg-white px-4 py-3 text-right text-4xl font-semibold tracking-tight" aria-live="polite">
          {formatearPesos(valor)}
        </p>
        {children}
        {atajos.length > 0 && (
          <div className="grid auto-cols-fr grid-flow-col gap-1.5">
            {atajos.map((a) => (
              <button
                key={a.etiqueta}
                type="button"
                onClick={() => setValor(Math.min(a.valor, max))}
                className={cn(
                  "min-h-12 rounded-xl border px-1 text-base font-medium leading-tight",
                  valor === a.valor ? "border-tinta bg-tinta text-white" : "border-linea bg-white active:bg-hueso"
                )}
              >
                {a.etiqueta}
              </button>
            ))}
          </div>
        )}
        <TecladoNumerico onTecla={(t) => setValor((v) => Math.min(aplicarTecla(v, t), max))} />
        <Button tamano="lg" bloque disabled={!puedeAceptar(valor)} onClick={() => alAceptar(valor)}>
          {aceptar}
        </Button>
      </div>
    </Hoja>
  );
}
