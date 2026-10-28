"use client";

import { useActionState } from "react";
import { fijarServicioActivo } from "@/app/acciones/servicios";
import { Button } from "@/components/ui/button";
import type { EstadoForm } from "@/lib/errores";

/** Archivar o restaurar un servicio. Si la base lo rechaza (nombre repetido) el mensaje queda debajo del botón. */
export function BotonActivoServicio({
  id,
  activar,
  etiqueta,
  bloque = false,
}: {
  id: string;
  /** true = restaurar; false = archivar. */
  activar: boolean;
  etiqueta: string;
  bloque?: boolean;
}) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(fijarServicioActivo, { error: null });

  return (
    <form action={accion}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="activo" value={String(activar)} />
      <Button type="submit" variante="secundario" bloque={bloque} disabled={pendiente}>
        {pendiente ? "Un momento…" : etiqueta}
      </Button>
      {estado.error && (
        <p role="alert" className="mt-2 text-base font-semibold text-rojo">
          {estado.error}
        </p>
      )}
    </form>
  );
}
