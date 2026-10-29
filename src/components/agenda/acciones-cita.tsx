"use client";

import { useActionState, useState } from "react";
import Link from "@/components/ui/enlace";
import { CalendarClock } from "lucide-react";
import { cambiarEstadoCita, cancelarCita } from "@/app/acciones/citas";
import { Button, botonVariantes } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EstadoCita } from "@/lib/citas";
import type { EstadoForm } from "@/lib/errores";

/**
 * Lo que se puede hacer con una cita según su estado. Los botones son los mismos que valida la base
 * (`cambiar_estado_cita` y `cancelar_cita`); si la base dice que no, el mensaje sale debajo.
 */
export function AccionesCita({
  id,
  estado,
  yaEmpezo,
  volver,
  cobrada = false,
}: {
  id: string;
  estado: EstadoCita;
  /** La hora de la cita ya llegó (solo entonces se puede marcar "no llegó"). */
  yaEmpezo: boolean;
  /** Día ('YYYY-MM-DD') al que volver después de cancelar. */
  volver: string;
  /** Tiene un cobro vigente: no se reabre sola, hay que anular el cobro (y entonces se reabre). */
  cobrada?: boolean;
}) {
  const [resultado, accion, pendiente] = useActionState<EstadoForm, FormData>(cambiarEstadoCita, { error: null });

  const paso = (valor: EstadoCita, texto: string, opciones: { principal?: boolean } = {}) => (
    <Button
      type="submit"
      name="estado"
      value={valor}
      tamano="lg"
      bloque
      variante={opciones.principal ? "primario" : "secundario"}
      disabled={pendiente}
    >
      {texto}
    </Button>
  );

  return (
    <div className="space-y-3">
      <form action={accion} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        {estado === "confirmada" && (
          <>
            {paso("en_atencion", "Empezar la atención", { principal: true })}
            {yaEmpezo && paso("no_asistio", "No llegó")}
          </>
        )}
        {estado === "en_atencion" && (
          <>
            {paso("atendida", "Terminar", { principal: true })}
            {paso("confirmada", "Deshacer: volver a confirmada")}
          </>
        )}
        {estado === "atendida" &&
          (cobrada ? (
            <p className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
              Para reabrir la atención, anula el cobro.
            </p>
          ) : (
            paso("en_atencion", "Reabrir la atención")
          ))}
        {estado === "no_asistio" && paso("confirmada", "Deshacer: volver a confirmada")}
        {estado === "cancelada" && paso("confirmada", "Reactivar la cita", { principal: true })}
        {resultado.error && (
          <p role="alert" className="text-base font-semibold text-rojo">
            {resultado.error}
          </p>
        )}
      </form>

      {estado === "confirmada" && (
        <>
          <Link href={`/agenda/cita/${id}/mover`} className={botonVariantes({ variante: "secundario", tamano: "lg", bloque: true })}>
            <CalendarClock className="size-5" aria-hidden />
            Mover a otra hora
          </Link>
          <CancelarCita id={id} volver={volver} />
        </>
      )}
    </div>
  );
}

/** Cancelar con motivo: primero se pide el motivo, después se confirma. */
function CancelarCita({ id, volver }: { id: string; volver: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(cancelarCita, { error: null });

  if (!abierto) {
    return (
      <Button variante="fantasma" bloque onClick={() => setAbierto(true)}>
        Cancelar la cita
      </Button>
    );
  }

  return (
    <form action={accion} className="space-y-3 rounded-xl border border-rojo bg-superficie p-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="volver" value={volver} />
      <input type="hidden" name="motivo" value={motivo} />
      <div>
        <Label htmlFor="motivo_cancelacion">¿Por qué se cancela?</Label>
        <Input
          id="motivo_cancelacion"
          value={motivo}
          maxLength={200}
          autoComplete="off"
          autoFocus
          placeholder="El cliente avisó que no puede venir"
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
      {estado.error && (
        <p role="alert" className="text-base font-semibold text-rojo">
          {estado.error}
        </p>
      )}
      <Button type="submit" variante="peligro" bloque disabled={pendiente || motivo.trim() === ""}>
        {pendiente ? "Cancelando…" : "Sí, cancelar la cita"}
      </Button>
      <Button variante="secundario" bloque onClick={() => setAbierto(false)}>
        No, dejarla como está
      </Button>
    </form>
  );
}
