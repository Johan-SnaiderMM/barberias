"use client";

import { useActionState } from "react";
import { quitarBloqueo } from "@/app/acciones/horarios";
import { Button } from "@/components/ui/button";
import type { EstadoForm } from "@/lib/errores";

/** Quita un bloqueo (queda inactivo; las horas vuelven a ofrecerse). */
export function BotonQuitarBloqueo({ id, barberoId }: { id: string; barberoId: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(quitarBloqueo, { error: null });

  return (
    <form action={accion}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="barbero_id" value={barberoId} />
      <Button type="submit" variante="secundario" bloque disabled={pendiente}>
        {pendiente ? "Quitando…" : "Quitar bloqueo"}
      </Button>
      {estado.error && (
        <p role="alert" className="mt-2 text-base font-semibold text-rojo">
          {estado.error}
        </p>
      )}
    </form>
  );
}
