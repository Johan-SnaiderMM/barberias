"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { guardarNotaCliente, type EstadoNota } from "@/app/acciones/clientes";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * La nota del corte del cliente ("degradé 2 a los lados, barba al ras"). La escriben recepción y el barbero.
 * Se guarda sin salir de la ficha y lo dice.
 */
export function FormularioNota({ clienteId, nota }: { clienteId: string; nota: string | null }) {
  const [estado, accion, pendiente] = useActionState<EstadoNota, FormData>(guardarNotaCliente, { error: null });
  const [texto, setTexto] = useState(nota ?? "");

  return (
    <form action={accion} className="space-y-3">
      <input type="hidden" name="id" value={clienteId} />
      <input type="hidden" name="nota" value={texto} />
      <div>
        <Label htmlFor="nota_corte">Nota del corte</Label>
        <textarea
          id="nota_corte"
          value={texto}
          maxLength={300}
          rows={3}
          placeholder="Degradé 2 a los lados, barba al ras…"
          onChange={(e) => setTexto(e.target.value)}
          className="w-full rounded-xl border border-borde-campo bg-white p-3 text-base text-tinta placeholder:text-tinta-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
        />
        <p className="text-right text-base text-tinta-2">{texto.length}/300</p>
      </div>
      {estado.error && (
        <p role="alert" className="text-base font-semibold text-rojo">
          {estado.error}
        </p>
      )}
      <Button type="submit" variante="secundario" bloque disabled={pendiente || texto === (nota ?? "")}>
        {pendiente ? "Guardando…" : "Guardar nota"}
      </Button>
      {estado.guardado && texto === (nota ?? "") && (
        <p role="status" className="flex items-center gap-1 text-base font-semibold">
          <Check className="size-5" aria-hidden />
          Nota guardada
        </p>
      )}
    </form>
  );
}
