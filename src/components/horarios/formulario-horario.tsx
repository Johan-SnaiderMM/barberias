"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { guardarHorario } from "@/app/acciones/horarios";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import type { EstadoForm } from "@/lib/errores";
import {
  DIAS_SEMANA,
  franjasDelDia,
  hora24AMinutos,
  MAX_FRANJAS_POR_DIA,
  minutosAHora24,
  validarFranjas,
  type FranjaHorario,
} from "@/lib/horarios";

type FranjaEd = { desde: string; hasta: string };
type DiaEd = { activo: boolean; franjas: FranjaEd[] };
type Semana = Record<number, DiaEd>;

const FRANJA_NUEVA: FranjaEd = { desde: "09:00", hasta: "19:00" };

/** Estado inicial: el horario guardado; si no hay ninguno, lunes a sábado de 9:00 a 19:00 como punto de partida. */
function inicial(franjas: readonly FranjaHorario[]): Semana {
  const hayAlgo = franjas.length > 0;
  const semana: Semana = {};
  for (const { dia } of DIAS_SEMANA) {
    const delDia = franjasDelDia(franjas, dia);
    semana[dia] = {
      activo: hayAlgo ? delDia.length > 0 : dia !== 0,
      franjas:
        delDia.length > 0
          ? delDia.map((f) => ({ desde: minutosAHora24(f.desde), hasta: minutosAHora24(f.hasta) }))
          : [{ ...FRANJA_NUEVA }],
    };
  }
  return semana;
}

/** De lo que hay en pantalla a franjas en minutos; null en `franjas` si alguna hora está vacía. */
function aFranjas(semana: Semana): { franjas: FranjaHorario[] | null } {
  const franjas: FranjaHorario[] = [];
  for (const { dia } of DIAS_SEMANA) {
    const d = semana[dia];
    if (!d.activo) continue;
    for (const f of d.franjas) {
      const desde = hora24AMinutos(f.desde);
      const hasta = hora24AMinutos(f.hasta, true);
      if (desde === null || hasta === null) return { franjas: null };
      franjas.push({ dia, desde, hasta });
    }
  }
  return { franjas };
}

/**
 * Horario semanal de un barbero: por cada día, si trabaja y sus franjas (hasta 4, para turnos partidos).
 * Se valida aquí con las mismas reglas que la base para dar respuesta inmediata; la base decide.
 */
export function FormularioHorario({
  barberoId,
  nombreBarbero,
  franjas,
}: {
  barberoId: string;
  nombreBarbero: string;
  franjas: readonly FranjaHorario[];
}) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(guardarHorario, { error: null });
  const [semana, setSemana] = useState<Semana>(() => inicial(franjas));

  const { franjas: finales } = useMemo(() => aFranjas(semana), [semana]);
  const errorLocal = finales === null ? "Hay una hora sin llenar." : validarFranjas(finales);

  const cambiarDia = (dia: number, parche: Partial<DiaEd>) =>
    setSemana((s) => ({ ...s, [dia]: { ...s[dia], ...parche } }));

  const cambiarFranja = (dia: number, i: number, parche: Partial<FranjaEd>) =>
    setSemana((s) => ({
      ...s,
      [dia]: { ...s[dia], franjas: s[dia].franjas.map((f, j) => (j === i ? { ...f, ...parche } : f)) },
    }));

  const copiarALosDemas = (dia: number) =>
    setSemana((s) => {
      const origen = s[dia].franjas;
      const nueva: Semana = { ...s };
      for (const { dia: otro } of DIAS_SEMANA) {
        if (otro !== dia && s[otro].activo) nueva[otro] = { ...s[otro], franjas: origen.map((f) => ({ ...f })) };
      }
      return nueva;
    });

  return (
    <form action={accion} className="px-4 pt-5">
      <input type="hidden" name="barbero_id" value={barberoId} />
      <input type="hidden" name="franjas" value={JSON.stringify(finales ?? [])} />

      <p className="text-base text-tinta-2">
        Los días y las horas en que <strong className="text-tinta">{nombreBarbero}</strong> atiende. Si descansa a
        mediodía, agrega otra franja.
      </p>

      <ul className="mt-4 space-y-3">
        {DIAS_SEMANA.map(({ dia, nombre }) => {
          const d = semana[dia];
          return (
            <li key={dia} className="rounded-xl border border-linea bg-superficie">
              <label className="flex min-h-14 items-center gap-3 px-4 py-2">
                <input
                  type="checkbox"
                  checked={d.activo}
                  onChange={(e) => cambiarDia(dia, { activo: e.target.checked })}
                  className="size-6 shrink-0 accent-tinta"
                />
                <span className="text-lg font-semibold leading-tight">{nombre}</span>
                {!d.activo && <span className="text-base text-tinta-2">· No trabaja</span>}
              </label>

              {d.activo && (
                <div className="space-y-3 border-t border-hueso px-4 py-3">
                  {d.franjas.map((f, i) => (
                    <div key={i}>
                      {/* Con más de una franja, cada una trae su título y su botón de quitar (así las horas
                          tienen todo el ancho y no se cortan en pantallas de 360 px). */}
                      {d.franjas.length > 1 && (
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-sm font-medium uppercase tracking-wider text-tinta-2">Franja {i + 1}</span>
                          <button
                            type="button"
                            onClick={() => cambiarDia(dia, { franjas: d.franjas.filter((_, j) => j !== i) })}
                            aria-label={`Quitar la franja ${i + 1} del ${nombre.toLowerCase()}`}
                            className="flex min-h-12 items-center gap-1 rounded-xl px-3 text-base font-semibold underline active:bg-hueso"
                          >
                            <X className="size-5" aria-hidden />
                            Quitar
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          step={300}
                          value={f.desde}
                          onChange={(e) => cambiarFranja(dia, i, { desde: e.target.value })}
                          aria-label={`${nombre}, franja ${i + 1}, desde`}
                          className="min-h-12 min-w-0 flex-1 rounded-xl border border-borde-campo bg-superficie px-3 text-base"
                        />
                        <span className="text-base text-tinta-2">a</span>
                        <input
                          type="time"
                          step={300}
                          value={f.hasta}
                          onChange={(e) => cambiarFranja(dia, i, { hasta: e.target.value })}
                          aria-label={`${nombre}, franja ${i + 1}, hasta`}
                          className="min-h-12 min-w-0 flex-1 rounded-xl border border-borde-campo bg-superficie px-3 text-base"
                        />
                      </div>
                    </div>
                  ))}

                  <div className="flex flex-wrap gap-2">
                    {d.franjas.length < MAX_FRANJAS_POR_DIA && (
                      <Button
                        variante="secundario"
                        onClick={() => {
                          const ultima = d.franjas[d.franjas.length - 1];
                          cambiarDia(dia, {
                            franjas: [...d.franjas, { desde: ultima?.hasta ?? "14:00", hasta: "19:00" }],
                          });
                        }}
                      >
                        <Plus className="size-5" aria-hidden />
                        Otra franja
                      </Button>
                    )}
                    <Button variante="fantasma" onClick={() => copiarALosDemas(dia)}>
                      Copiar a los demás días
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <BarraAccion>
        {(errorLocal || estado.error) && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {errorLocal ?? estado.error}
          </p>
        )}
        <Button type="submit" tamano="lg" bloque disabled={pendiente || errorLocal !== null}>
          {pendiente ? "Guardando…" : "Guardar horario"}
        </Button>
      </BarraAccion>
    </form>
  );
}
