"use client";

import { useActionState, useState } from "react";
import { moverCita } from "@/app/acciones/citas";
import { PanelAvisos } from "@/components/agenda/panel-avisos";
import { SelectorHora, type HoraElegida } from "@/components/agenda/selector-hora";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EstadoFormCita } from "@/lib/tipos/agenda";

/**
 * Mover una cita a otra hora (mismo barbero y mismo servicio). La cita que se mueve no cuenta contra sí misma al
 * buscar horas libres. Si la nueva hora cae fuera de horario o sobre un bloqueo, avisa y deja confirmar.
 */
export function FormularioMover({
  citaId,
  servicioId,
  barberoId,
  barbero,
  fechaInicial,
  hoy,
}: {
  citaId: string;
  servicioId: string;
  barberoId: string;
  barbero: string;
  fechaInicial: string;
  hoy: string;
}) {
  const [estado, accion, pendiente] = useActionState<EstadoFormCita, FormData>(moverCita, { error: null });
  const [fecha, setFecha] = useState(fechaInicial);
  const [elegida, setElegida] = useState<HoraElegida | null>(null);
  const [descartado, setDescartado] = useState<EstadoFormCita | null>(null);

  const avisos = estado.avisos && estado.avisos.length > 0 && descartado !== estado ? estado.avisos : null;

  return (
    <form action={accion} className="space-y-5 px-4 pt-5">
      <input type="hidden" name="id" value={citaId} />
      <input type="hidden" name="inicio" value={elegida?.inicio ?? ""} />

      <div>
        <Label htmlFor="fecha">Nuevo día</Label>
        <Input
          id="fecha"
          type="date"
          min={hoy}
          value={fecha}
          required
          onChange={(e) => {
            setFecha(e.target.value);
            setElegida(null);
            setDescartado(estado);
          }}
        />
      </div>

      <div>
        <Label>Nueva hora (con {barbero})</Label>
        <SelectorHora
          servicioId={servicioId}
          barberoId={barberoId}
          fecha={fecha}
          elegida={elegida}
          onElegir={(h) => {
            setElegida(h);
            setDescartado(estado);
          }}
          nombresBarberos={{ [barberoId]: barbero }}
          ignorarCita={citaId}
        />
      </div>

      {avisos && <PanelAvisos avisos={avisos} textoBoton="Mover de todos modos" pendiente={pendiente} />}

      <BarraAccion>
        {estado.error && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {estado.error}
          </p>
        )}
        <Button type="submit" tamano="lg" bloque disabled={pendiente || elegida === null}>
          {pendiente ? "Moviendo…" : "Mover la cita"}
        </Button>
      </BarraAccion>
    </form>
  );
}
