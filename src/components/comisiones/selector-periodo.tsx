import Link from "@/components/ui/enlace";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  ETIQUETA_PERIODO,
  PERIODOS,
  periodoAnterior,
  periodoSiguiente,
  rangoDelPeriodo,
  textoPeriodo,
  type Periodo,
} from "@/lib/periodos";
import { cn } from "@/lib/utils";

/**
 * Elegir el periodo (hoy, semana, quincena, mes) y moverse al anterior o al siguiente. Son enlaces: la pantalla se
 * arma en el servidor con `?periodo=…&ref=…` y no hay estado en el navegador. No se puede ir a un periodo que todavía
 * no empieza.
 */
export function SelectorPeriodo({
  periodo,
  referencia,
  hoy,
  base = "/comisiones",
}: {
  periodo: Periodo;
  /** Un día cualquiera dentro del periodo que se está mirando ('YYYY-MM-DD'). */
  referencia: string;
  hoy: string;
  base?: string;
}) {
  const { titulo, detalle } = textoPeriodo(periodo, referencia, hoy);
  const anterior = periodoAnterior(periodo, referencia);
  const siguiente = periodoSiguiente(periodo, referencia);
  const haySiguiente = rangoDelPeriodo(periodo, siguiente).desde <= hoy;
  const enlace = (p: Periodo, ref: string) => `${base}?periodo=${p}&ref=${ref}`;
  const flecha = "flex size-12 shrink-0 items-center justify-center rounded-xl border";

  return (
    <div className="space-y-3">
      <nav aria-label="Periodo" className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-4">
        {PERIODOS.map((p) => (
          <Link
            key={p}
            href={enlace(p, referencia)}
            aria-current={p === periodo ? "true" : undefined}
            className={cn(
              "flex min-h-12 items-center justify-center rounded-xl border px-1 text-base font-semibold leading-tight",
              p === periodo ? "border-tinta bg-tinta text-papel" : "border-linea bg-papel text-tinta active:bg-hueso"
            )}
          >
            {ETIQUETA_PERIODO[p]}
          </Link>
        ))}
      </nav>

      <div className="flex items-center justify-between gap-2">
        <Link href={enlace(periodo, anterior)} aria-label="Periodo anterior" className={cn(flecha, "border-linea bg-superficie active:bg-hueso")}>
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <div className="min-w-0 text-center">
          <p className="text-lg font-semibold leading-tight">{titulo}</p>
          <p className="text-base text-tinta-2">{detalle}</p>
        </div>
        {haySiguiente ? (
          <Link href={enlace(periodo, siguiente)} aria-label="Periodo siguiente" className={cn(flecha, "border-linea bg-superficie active:bg-hueso")}>
            <ChevronRight className="size-6" aria-hidden />
          </Link>
        ) : (
          <span aria-hidden className={cn(flecha, "border-dashed border-zinc-300 bg-hueso text-zinc-400")}>
            <ChevronRight className="size-6" />
          </span>
        )}
      </div>
    </div>
  );
}
