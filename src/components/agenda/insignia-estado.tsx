import { ETIQUETA_ESTADO, type EstadoCita } from "@/lib/citas";
import { cn } from "@/lib/utils";

const CLASES: Record<EstadoCita, string> = {
  confirmada: "border-linea bg-superficie text-tinta",
  en_atencion: "border-linea bg-oro text-tinta",
  atendida: "border-zinc-300 bg-hueso text-tinta-2",
  no_asistio: "border-rojo bg-superficie text-rojo",
  cancelada: "border-dashed border-zinc-300 bg-hueso text-tinta-2",
};

/**
 * Estado de una cita como texto (nunca solo color). `porCerrar` = confirmada cuya hora ya terminó: nadie dijo si se
 * atendió o no llegó; sale en rojo para que el personal la resuelva.
 */
export function InsigniaEstado({ estado, porCerrar = false }: { estado: EstadoCita; porCerrar?: boolean }) {
  const clase = porCerrar ? "border-rojo bg-rojo-solido text-white" : CLASES[estado];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-sm font-semibold uppercase leading-tight tracking-wide",
        clase
      )}
    >
      {porCerrar ? "Por cerrar" : estado === "atendida" ? `✓ ${ETIQUETA_ESTADO[estado]}` : ETIQUETA_ESTADO[estado]}
    </span>
  );
}
