"use client";

import { useState } from "react";
import { fechaBogota, fechaCorta, horaCorta, sumarDias } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import type { HuecoPublico } from "@/lib/tipos/reserva";

/** Días que se muestran de entrada; "Ver más días" suma otros tantos. */
const POR_PAGINA = 6;

/**
 * Elegir el día y la hora entre las horas libres que dio la base (nunca se calcula aquí). Solo salen los días que
 * tienen alguna hora; sin scroll horizontal: los días van en cuadrícula y se amplían con "Ver más días".
 * `hoy` es el día de hoy en Bogotá ('YYYY-MM-DD'), que manda el servidor.
 */
export function SelectorDiaHora({
  huecos,
  hoy,
  elegido,
  onElegir,
}: {
  huecos: HuecoPublico[];
  hoy: string;
  /** Instante ISO de la hora elegida, o null. */
  elegido: string | null;
  onElegir: (hueco: HuecoPublico) => void;
}) {
  const [diaElegido, setDiaElegido] = useState<string | null>(null);
  const [visibles, setVisibles] = useState(POR_PAGINA);

  const porDia = new Map<string, HuecoPublico[]>();
  for (const h of huecos) {
    const dia = fechaBogota(h.inicio);
    porDia.set(dia, [...(porDia.get(dia) ?? []), h]);
  }
  const dias = [...porDia.keys()].sort();
  if (dias.length === 0) return null;

  // El día de la hora elegida manda; si no, el que tocó la persona; si no, el primero con horas.
  const diaDelElegido = elegido ? fechaBogota(elegido) : null;
  const activo = diaElegido && porDia.has(diaElegido) ? diaElegido : (diaDelElegido ?? dias[0]);
  const manana = sumarDias(hoy, 1);
  const etiqueta = (d: string) => (d === hoy ? "Hoy" : d === manana ? "Mañana" : fechaCorta(d));

  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-tinta-2">Día</h2>
        <div className="grid grid-cols-3 gap-2">
          {dias.slice(0, visibles).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === activo}
              onClick={() => setDiaElegido(d)}
              className={cn(
                "min-h-12 rounded-xl border px-2 text-base font-medium leading-tight",
                d === activo ? "border-tinta bg-tinta text-white" : "border-linea bg-white text-tinta active:bg-hueso"
              )}
            >
              {etiqueta(d)}
            </button>
          ))}
        </div>
        {dias.length > visibles && (
          <button
            type="button"
            onClick={() => setVisibles((v) => v + POR_PAGINA)}
            className="mt-2 min-h-12 w-full rounded-xl text-base font-medium text-tinta-2 underline underline-offset-4 active:bg-hueso"
          >
            Ver más días
          </button>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-tinta-2">Hora</h2>
        <div className="grid grid-cols-3 gap-2">
          {(porDia.get(activo) ?? []).map((h) => (
            <button
              key={`${h.barbero_id}-${h.inicio}`}
              type="button"
              aria-pressed={h.inicio === elegido}
              onClick={() => onElegir(h)}
              className={cn(
                "min-h-12 rounded-xl border px-1 text-base font-medium",
                h.inicio === elegido ? "border-tinta bg-tinta text-white" : "border-linea bg-white text-tinta active:bg-hueso"
              )}
            >
              {horaCorta(h.inicio)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
