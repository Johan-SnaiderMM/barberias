"use client";

import { useActionState, useState } from "react";
import Link from "@/components/ui/enlace";
import { CalendarClock } from "lucide-react";
import { cancelarMiCita } from "@/app/acciones/reserva";
import { Button, botonVariantes } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EstadoForm } from "@/lib/errores";

/** Cambiar la hora o cancelar la cita desde el enlace. Cancelar pide confirmar y deja escribir un motivo opcional. */
export function AccionesMiCita({ token }: { token: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(cancelarMiCita, { error: null });

  return (
    <div className="space-y-3">
      <Link href={`/cita/${token}/mover`} className={botonVariantes({ tamano: "lg", bloque: true })}>
        <CalendarClock className="size-5" aria-hidden />
        Cambiar la hora
      </Link>

      {!abierto ? (
        <Button variante="fantasma" bloque onClick={() => setAbierto(true)}>
          Cancelar mi cita
        </Button>
      ) : (
        <form action={accion} className="space-y-3 rounded-xl border border-rojo bg-white p-4">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="motivo" value={motivo} />
          <p className="text-base font-medium">¿Seguro que quieres cancelar tu cita?</p>
          <div>
            <Label htmlFor="motivo_cancelacion_publica">Cuéntanos por qué (opcional)</Label>
            <Input
              id="motivo_cancelacion_publica"
              value={motivo}
              maxLength={200}
              autoComplete="off"
              placeholder="No puedo ir"
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          {estado.error && (
            <p role="alert" className="text-base font-semibold text-rojo">
              {estado.error}
            </p>
          )}
          <Button type="submit" variante="peligro" bloque disabled={pendiente}>
            {pendiente ? "Cancelando…" : "Sí, cancelar mi cita"}
          </Button>
          <Button variante="secundario" bloque onClick={() => setAbierto(false)}>
            No, mantenerla
          </Button>
        </form>
      )}
    </div>
  );
}
