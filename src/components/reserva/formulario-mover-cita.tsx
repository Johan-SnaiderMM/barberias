"use client";

import { useActionState, useState, useTransition } from "react";
import { huecosDeMiCita, moverMiCita } from "@/app/acciones/reserva";
import { SelectorDiaHora } from "@/components/reserva/selector-dia-hora";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { horaCorta } from "@/lib/fechas";
import type { EstadoReserva, HuecoPublico } from "@/lib/tipos/reserva";

const SALTO_DIAS = 31;

/**
 * Mover la cita a otra hora libre del MISMO barbero. Las horas vienen de la base; si la que se elige la tomaron
 * justo antes, se avisa y se recargan.
 */
export function FormularioMoverCita({
  token,
  huecosIniciales,
  hoy,
  diasAdelante,
}: {
  token: string;
  huecosIniciales: HuecoPublico[];
  hoy: string;
  diasAdelante: number;
}) {
  const [huecos, setHuecos] = useState(huecosIniciales);
  const [desde, setDesde] = useState(0);
  const [elegido, setElegido] = useState<HuecoPublico | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [cargando, iniciarCarga] = useTransition();
  const [estado, accion, enviando] = useActionState<EstadoReserva, FormData>(moverMiCita, { error: null });

  function cargar(desdeDias: number, acumular: boolean) {
    setErrorCarga(null);
    iniciarCarga(async () => {
      const r = await huecosDeMiCita(token, desdeDias);
      if (!r.ok) {
        setErrorCarga(r.error);
        return;
      }
      setDesde(desdeDias);
      setHuecos((previas) => (acumular ? [...previas, ...r.huecos] : r.huecos));
    });
  }

  const hayMas = desde + SALTO_DIAS <= diasAdelante;

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="inicio" value={elegido?.inicio ?? ""} />

      {huecos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-4 text-base text-tinta-2">
          No hay otras horas libres en estos días con el mismo barbero.
        </p>
      ) : (
        <SelectorDiaHora huecos={huecos} hoy={hoy} elegido={elegido?.inicio ?? null} onElegir={setElegido} />
      )}

      {hayMas && (
        <button
          type="button"
          disabled={cargando}
          onClick={() => cargar(desde + SALTO_DIAS, true)}
          className="min-h-12 w-full rounded-xl text-base font-medium text-tinta-2 underline underline-offset-4 active:bg-hueso"
        >
          {cargando ? "Buscando…" : "Buscar más adelante"}
        </button>
      )}

      {(estado.error || errorCarga) && (
        <div role="alert" className="rounded-xl border border-rojo bg-superficie p-3 text-base">
          <p className="font-semibold text-rojo">{estado.error ?? errorCarga}</p>
          {estado.motivo === "hora_ocupada" && (
            <Button
              variante="secundario"
              bloque
              className="mt-3"
              onClick={() => {
                setElegido(null);
                cargar(0, false);
              }}
            >
              Ver las horas libres otra vez
            </Button>
          )}
        </div>
      )}

      <BarraAccion>
        <Button type="submit" tamano="lg" bloque disabled={!elegido || enviando}>
          {enviando ? "Cambiando…" : elegido ? `Cambiar a las ${horaCorta(elegido.inicio)}` : "Elige una hora"}
        </Button>
      </BarraAccion>
    </form>
  );
}
