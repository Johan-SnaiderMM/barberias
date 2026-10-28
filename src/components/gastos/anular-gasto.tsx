"use client";

import { useActionState, useState } from "react";
import { anularGasto } from "@/app/acciones/gastos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearPesos, type Pesos } from "@/lib/dinero";
import type { EstadoForm } from "@/lib/errores";

/**
 * Anular un gasto: primero se pide el motivo, después se confirma. Un gasto no se borra ni se edita; anularlo lo deja
 * en el historial y deja de contar en el cierre.
 */
export function AnularGasto({ id, monto }: { id: string; monto: Pesos }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(anularGasto, { error: null });

  if (!abierto) {
    return (
      <Button variante="fantasma" bloque onClick={() => setAbierto(true)}>
        Anular el gasto
      </Button>
    );
  }

  return (
    <form action={accion} className="space-y-3 rounded-xl border border-rojo bg-white p-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="motivo" value={motivo} />
      <p className="text-base">
        Este gasto de <span className="font-semibold">{formatearPesos(monto)}</span> deja de contar en el cierre del día.
      </p>
      <div>
        <Label htmlFor="motivo_anulacion_gasto">¿Por qué se anula?</Label>
        <Input
          id="motivo_anulacion_gasto"
          value={motivo}
          maxLength={200}
          autoComplete="off"
          autoFocus
          placeholder="Lo registré dos veces"
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
      {estado.error && (
        <p role="alert" className="text-base font-semibold text-rojo">
          {estado.error}
        </p>
      )}
      <Button type="submit" variante="peligro" bloque disabled={pendiente || motivo.trim() === ""}>
        {pendiente ? "Anulando…" : "Sí, anular el gasto"}
      </Button>
      <Button variante="secundario" bloque disabled={pendiente} onClick={() => setAbierto(false)}>
        No, dejarlo como está
      </Button>
    </form>
  );
}
