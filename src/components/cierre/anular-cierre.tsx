"use client";

import { useActionState, useState } from "react";
import { anularCierre } from "@/app/acciones/cierre";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EstadoForm } from "@/lib/errores";

/**
 * Anular un cierre: primero se pide el motivo, después se confirma. Reabre el día: se puede volver a registrar,
 * corregir y cerrar de nuevo. Solo se anula el cierre más reciente (si no, la base lo explica).
 */
export function AnularCierre({ id, dia }: { id: string; dia: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(anularCierre, { error: null });

  if (!abierto) {
    return (
      <Button variante="fantasma" bloque onClick={() => setAbierto(true)}>
        Anular el cierre
      </Button>
    );
  }

  return (
    <form action={accion} className="space-y-3 rounded-xl border border-rojo bg-white p-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="motivo" value={motivo} />
      <p className="text-base">
        El cierre de <span className="font-semibold">{dia}</span> se anula y el día queda abierto: lo que se registró después vuelve a
        este día y se puede corregir antes de cerrar de nuevo.
      </p>
      <div>
        <Label htmlFor="motivo_anulacion_cierre">¿Por qué se anula?</Label>
        <Input
          id="motivo_anulacion_cierre"
          value={motivo}
          maxLength={200}
          autoComplete="off"
          autoFocus
          placeholder="Conté mal el efectivo"
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
      {estado.error && (
        <p role="alert" className="text-base font-semibold text-rojo">
          {estado.error}
        </p>
      )}
      <Button type="submit" variante="peligro" bloque disabled={pendiente || motivo.trim() === ""}>
        {pendiente ? "Anulando…" : "Sí, anular el cierre"}
      </Button>
      <Button variante="secundario" bloque disabled={pendiente} onClick={() => setAbierto(false)}>
        No, dejarlo como está
      </Button>
    </form>
  );
}
