"use client";

import { useState } from "react";
import { TarjetaCita } from "@/components/agenda/tarjeta-cita";
import { CampoBusqueda } from "@/components/ui/campo-busqueda";
import { filtrarCitas, MIN_PARA_BUSCAR } from "@/lib/listas";
import type { CitaDia } from "@/lib/tipos/agenda";

/**
 * Las citas del día. Desde unas cuantas, arriba sale un buscador por cliente, servicio, barbero o celular: con el día
 * lleno nadie baja tarjeta por tarjeta.
 */
export function ListaCitas({
  citas,
  ahoraMs,
  mostrarBarbero,
  citaDeLaGuia,
}: {
  citas: CitaDia[];
  ahoraMs: number;
  mostrarBarbero: boolean;
  /** La que resalta el recorrido guiado (data-guia). */
  citaDeLaGuia?: string;
}) {
  const [busqueda, setBusqueda] = useState("");
  const conBuscador = citas.length >= MIN_PARA_BUSCAR;
  const visibles = filtrarCitas(citas, busqueda);
  const nada = busqueda.trim() !== "" && visibles.length === 0;

  return (
    <>
      {conBuscador && (
        <div className="mt-3">
          <CampoBusqueda
            id="buscar-cita"
            etiqueta="Buscar en las citas del día"
            ejemplo="Buscar cliente, servicio o celular"
            valor={busqueda}
            onCambio={setBusqueda}
          />
        </div>
      )}
      {nada && (
        <p className="mt-3 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2" role="status">
          Ninguna cita coincide con «{busqueda.trim()}».
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {visibles.map((c) => (
          <li key={c.id}>
            <TarjetaCita cita={c} ahoraMs={ahoraMs} mostrarBarbero={mostrarBarbero} guia={c.id === citaDeLaGuia ? "cita" : undefined} />
          </li>
        ))}
      </ul>
    </>
  );
}
