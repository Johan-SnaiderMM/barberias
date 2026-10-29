"use client";

import { useState } from "react";
import { CampoBusqueda } from "@/components/ui/campo-busqueda";
import { EnlaceFila } from "@/components/layout/enlace-fila";
import { formatearPesos } from "@/lib/dinero";
import { horaCorta } from "@/lib/fechas";
import { filtrarCitas, MIN_PARA_BUSCAR } from "@/lib/listas";
import type { CitaPorCobrar } from "@/lib/tipos/caja";

/**
 * Las citas del día que se pueden cobrar. Desde unas cuantas, arriba sale un buscador por cliente, servicio o barbero:
 * con el día lleno nadie baja fila por fila para encontrar a quien va a pagar.
 */
export function ListaPorCobrar({ citas, citaDeLaGuia }: { citas: CitaPorCobrar[]; citaDeLaGuia?: string }) {
  const [busqueda, setBusqueda] = useState("");
  const conBuscador = citas.length >= MIN_PARA_BUSCAR;
  const visibles = filtrarCitas(citas, busqueda);
  const nada = busqueda.trim() !== "" && visibles.length === 0;

  return (
    <>
      {conBuscador && (
        <div className="mt-2">
          <CampoBusqueda
            id="buscar-por-cobrar"
            etiqueta="Buscar entre lo que falta por cobrar"
            ejemplo="Buscar cliente o servicio"
            valor={busqueda}
            onCambio={setBusqueda}
          />
        </div>
      )}
      {nada && (
        <p className="mt-3 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2" role="status">
          Nada por cobrar coincide con «{busqueda.trim()}».
        </p>
      )}
      <ul className="mt-2 space-y-3">
        {visibles.map((c) => (
          <li key={c.id}>
            <EnlaceFila
              href={`/caja/cobrar/${c.id}`}
              titulo={`${horaCorta(c.inicio)} · ${c.cliente}`}
              detalle={`${c.servicio} · con ${c.barbero} · ${formatearPesos(c.precio)}`}
              guia={c.id === citaDeLaGuia ? "cobrar" : undefined}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
