import Link from "next/link";
import { BellRing, Globe } from "lucide-react";
import { InsigniaEstado } from "@/components/agenda/insignia-estado";
import { deberiaEstarEnAtencion, porCerrar as estaPorCerrar } from "@/lib/citas";
import { formatearPesos } from "@/lib/dinero";
import { horaCorta } from "@/lib/fechas";
import type { CitaDia } from "@/lib/tipos/agenda";
import { cn } from "@/lib/utils";

/**
 * Una cita en la lista del día. Es un enlace a su detalle. `ahoraMs` lo pone el servidor (la tarjeta no usa reloj),
 * `mostrarBarbero` solo cuando la lista mezcla a varios barberos.
 */
export function TarjetaCita({
  cita,
  ahoraMs,
  mostrarBarbero,
  guia,
}: {
  cita: CitaDia;
  ahoraMs: number;
  mostrarBarbero: boolean;
  /** Lo que el recorrido guiado resalta (data-guia): ver src/lib/guia.ts. */
  guia?: string;
}) {
  const porCerrar = estaPorCerrar(cita, ahoraMs);
  const ahora = deberiaEstarEnAtencion(cita, ahoraMs);
  const apagada = cita.estado === "cancelada" || cita.estado === "no_asistio";

  return (
    <Link
      href={`/agenda/cita/${cita.id}`}
      data-guia={guia}
      className={cn(
        "block rounded-xl border p-4 active:bg-hueso",
        apagada ? "border-dashed border-zinc-300 bg-hueso" : "border-linea bg-white",
        cita.estado === "en_atencion" && "border-l-8 border-l-oro"
      )}
    >
      {/* La hora nunca se parte; si no cabe junto a la insignia, la insignia baja a la línea de abajo. */}
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <p className="whitespace-nowrap text-lg font-semibold tracking-tight leading-tight">
          {horaCorta(cita.inicio)} – {horaCorta(cita.fin)}
        </p>
        <InsigniaEstado estado={cita.estado} porCerrar={porCerrar} />
      </div>
      <p className={cn("mt-1 text-lg font-semibold leading-tight", apagada && "line-through")}>{cita.cliente}</p>
      {cita.reservo_como && <p className="text-base text-tinta-2">Reservó como «{cita.reservo_como}»</p>}
      <p className="text-base text-tinta-2">
        {cita.servicio}
        {mostrarBarbero && ` · con ${cita.barbero}`} · {formatearPesos(cita.precio)}
      </p>
      {ahora && <p className="mt-1 text-base font-semibold text-rojo">Ya es la hora: debería estar en atención</p>}
      {cita.origen === "cliente" && (
        <p className="mt-1 flex items-center gap-1 text-base text-tinta-2">
          <Globe className="size-4" aria-hidden />
          Reservó en línea
        </p>
      )}
      {cita.recordatorio_enviado_at && (
        <p className="mt-1 flex items-center gap-1 text-base text-tinta-2">
          <BellRing className="size-4" aria-hidden />
          Recordatorio enviado
        </p>
      )}
      {cita.estado === "cancelada" && cita.cancelada_motivo && (
        <p className="mt-1 text-base text-tinta-2">Motivo: {cita.cancelada_motivo}</p>
      )}
    </Link>
  );
}
