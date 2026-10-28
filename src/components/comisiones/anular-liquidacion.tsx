"use client";

import { useActionState, useState } from "react";
import { anularLiquidacion } from "@/app/acciones/liquidaciones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearPesos, type Pesos } from "@/lib/dinero";
import type { EstadoForm } from "@/lib/errores";

/**
 * Anular una liquidación: primero se pide el motivo, después se confirma. Una liquidación no se borra ni se edita;
 * anularla la deja en el historial y sus cobros vuelven a quedar pendientes de pagar.
 */
export function AnularLiquidacion({ id, total, cobros }: { id: string; total: Pesos; cobros: number }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(anularLiquidacion, { error: null });

  if (!abierto) {
    return (
      <Button variante="fantasma" bloque onClick={() => setAbierto(true)}>
        Anular la liquidación
      </Button>
    );
  }

  return (
    <form action={accion} className="space-y-3 rounded-xl border border-rojo bg-white p-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="motivo" value={motivo} />
      <p className="text-base">
        Esta liquidación de <span className="font-semibold">{formatearPesos(total)}</span> se anula y {cobros === 1 ? "su cobro vuelve" : `sus ${cobros} cobros vuelven`} a
        quedar pendiente{cobros === 1 ? "" : "s"} de pagar.
      </p>
      <div>
        <Label htmlFor="motivo_anulacion_liquidacion">¿Por qué se anula?</Label>
        <Input
          id="motivo_anulacion_liquidacion"
          value={motivo}
          maxLength={200}
          autoComplete="off"
          autoFocus
          placeholder="Se pagó por el medio equivocado"
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
      {estado.error && (
        <p role="alert" className="text-base font-semibold text-rojo">
          {estado.error}
        </p>
      )}
      <Button type="submit" variante="peligro" bloque disabled={pendiente || motivo.trim() === ""}>
        {pendiente ? "Anulando…" : "Sí, anular la liquidación"}
      </Button>
      <Button variante="secundario" bloque disabled={pendiente} onClick={() => setAbierto(false)}>
        No, dejarla como está
      </Button>
    </form>
  );
}
