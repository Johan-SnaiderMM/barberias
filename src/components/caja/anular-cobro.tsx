"use client";

import { useActionState, useState } from "react";
import { anularCobro } from "@/app/acciones/caja";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearPesos, type Pesos } from "@/lib/dinero";
import type { EstadoForm } from "@/lib/errores";

/**
 * Anular un cobro: primero se pide el motivo, después se confirma. Un cobro no se borra ni se edita; anularlo lo deja
 * en el historial y, si era de una cita, la reabre para cobrarla bien.
 */
export function AnularCobro({ id, entro, reabreCita }: { id: string; entro: Pesos; reabreCita: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(anularCobro, { error: null });

  if (!abierto) {
    return (
      <Button variante="fantasma" bloque onClick={() => setAbierto(true)}>
        Anular el cobro
      </Button>
    );
  }

  return (
    <form action={accion} className="space-y-3 rounded-xl border border-rojo bg-superficie p-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="motivo" value={motivo} />
      <p className="text-base">
        Este cobro de <span className="font-semibold">{formatearPesos(entro)}</span> deja de contar en la caja.
        {reabreCita && " La cita vuelve a «en atención» para cobrarla otra vez."}
      </p>
      <div>
        <Label htmlFor="motivo_anulacion">¿Por qué se anula?</Label>
        <Input
          id="motivo_anulacion"
          value={motivo}
          maxLength={200}
          autoComplete="off"
          autoFocus
          placeholder="Se cobró un servicio equivocado"
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
      {estado.error && (
        <p role="alert" className="text-base font-semibold text-rojo">
          {estado.error}
        </p>
      )}
      <Button type="submit" variante="peligro" bloque disabled={pendiente || motivo.trim() === ""}>
        {pendiente ? "Anulando…" : "Sí, anular el cobro"}
      </Button>
      <Button variante="secundario" bloque disabled={pendiente} onClick={() => setAbierto(false)}>
        No, dejarlo como está
      </Button>
    </form>
  );
}
