"use client";

import { useEffect, useState } from "react";
import { obtenerHuecos } from "@/app/acciones/citas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { horaCorta, instanteBogota } from "@/lib/fechas";
import { hora24AMinutos } from "@/lib/horarios";
import type { HuecoLibre } from "@/lib/tipos/agenda";
import { cn } from "@/lib/utils";

/** La hora que eligió el personal: un instante y el barbero con quien queda. */
export type HoraElegida = { inicio: string; barberoId: string };

/**
 * Horas libres de un día para un servicio. Con `barberoId` null ofrece "la primera disponible" (y dice con quién).
 * Además deja escribir otra hora (el personal puede encajar a alguien fuera de la rejilla; la base avisa si no
 * entra). Las horas libres las calcula la base (`obtener_huecos`): aquí no hay cuentas de disponibilidad.
 */
export function SelectorHora({
  servicioId,
  barberoId,
  fecha,
  elegida,
  onElegir,
  nombresBarberos,
  ignorarCita = null,
}: {
  servicioId: string;
  /** null = cualquier barbero. */
  barberoId: string | null;
  fecha: string;
  elegida: HoraElegida | null;
  onElegir: (h: HoraElegida | null) => void;
  nombresBarberos: Record<string, string>;
  /** La cita que se está moviendo: no cuenta contra sí misma. */
  ignorarCita?: string | null;
}) {
  const clave = `${servicioId}|${barberoId ?? ""}|${fecha}|${ignorarCita ?? ""}`;
  const [resultado, setResultado] = useState<{ clave: string; huecos: HuecoLibre[] | null; error: string | null } | null>(
    null
  );
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!servicioId || !fecha) return;
    let cancelado = false;
    obtenerHuecos(servicioId, barberoId, fecha, ignorarCita).then((r) => {
      if (cancelado) return;
      setResultado({ clave, huecos: r.ok ? r.huecos : null, error: r.ok ? null : r.error });
    });
    return () => {
      cancelado = true;
    };
  }, [clave, servicioId, barberoId, fecha, ignorarCita]);

  if (!servicioId) {
    return <p className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">Primero elige el servicio.</p>;
  }

  const vigente = resultado?.clave === clave ? resultado : null;
  const cargando = vigente === null;
  const huecos = vigente?.huecos ?? [];

  const ponerManual = (texto: string) => {
    setManual(texto);
    const minutos = hora24AMinutos(texto);
    if (minutos === null || !barberoId) {
      onElegir(null);
      return;
    }
    onElegir({ inicio: instanteBogota(fecha, minutos), barberoId });
  };

  return (
    <div className="space-y-3">
      {cargando ? (
        <p className="text-base text-tinta-2">Buscando horas libres…</p>
      ) : vigente.error ? (
        <p role="alert" className="text-base font-semibold text-rojo">
          {vigente.error}
        </p>
      ) : huecos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
          No hay horas libres ese día. Prueba otro día, otro barbero o escribe una hora.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2" aria-label="Horas libres">
          {huecos.map((h) => {
            const activa = elegida?.inicio === h.inicio && elegida.barberoId === h.barbero_id && manual === "";
            return (
              <li key={`${h.inicio}-${h.barbero_id}`}>
                <button
                  type="button"
                  aria-pressed={activa}
                  onClick={() => {
                    setManual("");
                    onElegir({ inicio: h.inicio, barberoId: h.barbero_id });
                  }}
                  className={cn(
                    "min-h-12 w-full rounded-xl border px-1 text-base font-semibold leading-tight",
                    activa ? "border-tinta bg-tinta text-papel" : "border-linea bg-papel text-tinta active:bg-hueso"
                  )}
                >
                  {horaCorta(h.inicio)}
                  {barberoId === null && (
                    <span className="block text-base font-normal">con {nombresBarberos[h.barbero_id] ?? "el equipo"}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <Label htmlFor="hora_manual">O escribe otra hora</Label>
        <Input
          id="hora_manual"
          type="time"
          step={300}
          value={manual}
          disabled={!barberoId}
          onChange={(e) => ponerManual(e.target.value)}
        />
        {!barberoId && <p className="mt-1 text-base text-tinta-2">Para escribir una hora, elige un barbero.</p>}
      </div>
    </div>
  );
}
