"use client";

import { useSyncExternalStore } from "react";
import { Segmentado } from "@/components/ui/segmentado";
import { aplicarTema, leerTema, suscribirTema, type Tema } from "@/lib/tema";

const OPCIONES: readonly { valor: Tema; etiqueta: string }[] = [
  { valor: "auto", etiqueta: "Automático" },
  { valor: "claro", etiqueta: "Claro" },
  { valor: "oscuro", etiqueta: "Oscuro" },
];

/** Claro, oscuro o el que tenga el celular. Se recuerda en este celular. */
export function SelectorTema() {
  const tema = useSyncExternalStore(suscribirTema, leerTema, (): Tema => "auto");
  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Apariencia</h2>
      <div className="mt-2">
        <Segmentado etiqueta="Apariencia de la app" opciones={OPCIONES} valor={tema} onCambio={aplicarTema} />
      </div>
      <p className="mt-2 text-base text-tinta-2">Automático sigue el modo claro u oscuro de tu celular.</p>
    </section>
  );
}
