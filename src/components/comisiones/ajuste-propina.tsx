"use client";

import { useActionState, useState } from "react";
import { fijarPropinaDelBarbero } from "@/app/acciones/comisiones";
import { Button } from "@/components/ui/button";
import { Segmentado } from "@/components/ui/segmentado";
import type { EstadoForm } from "@/lib/errores";

type Dueno = "barbero" | "barberia";

/** De quién es la propina. Vale para los cobros que vienen: los ya hechos conservan lo que se guardó. */
export function AjustePropina({ delBarbero }: { delBarbero: boolean }) {
  const guardado: Dueno = delBarbero ? "barbero" : "barberia";
  const [dueno, setDueno] = useState<Dueno>(guardado);
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(fijarPropinaDelBarbero, { error: null });

  return (
    <form action={accion} className="space-y-3">
      <input type="hidden" name="del_barbero" value={String(dueno === "barbero")} />
      <Segmentado<Dueno>
        etiqueta="De quién es la propina"
        valor={dueno}
        onCambio={setDueno}
        opciones={[
          { valor: "barbero", etiqueta: "Del barbero" },
          { valor: "barberia", etiqueta: "De la barbería" },
        ]}
      />
      <p className="text-base text-tinta-2">
        {dueno === "barbero"
          ? "Lo que dejan los clientes se le paga a quien los atendió, además de su comisión."
          : "La propina se queda en la barbería: no se le suma al barbero."}
      </p>
      {estado.error && (
        <p role="alert" className="text-base font-semibold text-rojo">
          {estado.error}
        </p>
      )}
      {dueno !== guardado && (
        <Button type="submit" variante="secundario" bloque disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar cambio"}
        </Button>
      )}
    </form>
  );
}
