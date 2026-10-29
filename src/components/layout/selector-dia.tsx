"use client";

import Link from "@/components/ui/enlace";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fechaLarga, sumarDias } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Navegación entre días: ayer / mañana, volver a hoy y saltar a una fecha. Es solo la URL (`<ruta>?fecha=…&barbero=…`):
 * la página del servidor trae lo que toca. La usan la agenda, los gastos y el cierre del día.
 */
export function SelectorDia({
  fecha,
  hoy,
  ruta = "/agenda",
  barbero,
}: {
  fecha: string;
  hoy: string;
  /** La pantalla a la que lleva (por defecto la agenda). */
  ruta?: string;
  barbero?: string | null;
}) {
  const router = useRouter();
  const url = (f: string) => `${ruta}?fecha=${f}${barbero ? `&barbero=${barbero}` : ""}`;
  const boton = "flex size-12 shrink-0 items-center justify-center rounded-xl border border-linea bg-papel active:bg-hueso";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Link href={url(sumarDias(fecha, -1))} aria-label="Día anterior" className={boton}>
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <p className="min-w-0 flex-1 text-center text-lg font-semibold tracking-tight leading-tight">{fechaLarga(fecha)}</p>
        <Link href={url(sumarDias(fecha, 1))} aria-label="Día siguiente" className={boton}>
          <ChevronRight className="size-6" aria-hidden />
        </Link>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={url(hoy)}
          aria-current={fecha === hoy ? "date" : undefined}
          className={cn(
            "flex min-h-12 items-center rounded-xl border px-4 text-base font-semibold",
            fecha === hoy ? "border-tinta bg-tinta text-papel" : "border-linea bg-papel text-tinta active:bg-hueso"
          )}
        >
          Hoy
        </Link>
        <input
          type="date"
          value={fecha}
          aria-label="Ir a otro día"
          onChange={(e) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) router.push(url(e.target.value));
          }}
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-borde-campo bg-superficie px-3 text-base"
        />
      </div>
    </div>
  );
}
