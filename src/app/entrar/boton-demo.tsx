"use client";

import { useActionState } from "react";
import { Play } from "lucide-react";
import { entrarDemo, type EstadoEntrada } from "@/app/acciones/sesion";
import { Button } from "@/components/ui/button";

/** «Probar la demo»: entra a la barbería de demostración con datos inventados, sin pedir correo ni contraseña. */
export function BotonDemo() {
  const [estado, accion, pendiente] = useActionState<EstadoEntrada>(entrarDemo, { error: null });
  return (
    <form action={accion}>
      <Button type="submit" variante="secundario" tamano="lg" bloque disabled={pendiente}>
        <Play className="size-5" aria-hidden />
        {pendiente ? "Abriendo la demo…" : "Probar la demo"}
      </Button>
      {estado.error && (
        <p role="alert" className="mt-3 text-center text-base font-semibold text-rojo">
          {estado.error}
        </p>
      )}
    </form>
  );
}
