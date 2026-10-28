import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AvisoCita } from "@/lib/tipos/agenda";

/**
 * Avisos que el personal puede confirmar antes de guardar una cita (hora que ya pasó, fuera del horario, sobre un
 * bloqueo). El botón es un envío del MISMO formulario con `confirmar = 1`: por eso los campos del formulario deben
 * ser controlados (React 19 limpia los que no lo son al terminar la acción).
 */
export function PanelAvisos({
  avisos,
  textoBoton,
  pendiente,
}: {
  avisos: AvisoCita[];
  textoBoton: string;
  pendiente: boolean;
}) {
  return (
    <section role="alert" className="rounded-xl border border-rojo bg-white p-4">
      <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-rojo">
        <TriangleAlert className="size-5 shrink-0" aria-hidden />
        Revisa antes de guardar
      </h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-base">
        {avisos.map((a) => (
          <li key={`${a.tipo}-${a.mensaje}`}>{a.mensaje}</li>
        ))}
      </ul>
      <Button type="submit" name="confirmar" value="1" variante="peligro" bloque className="mt-3" disabled={pendiente}>
        {pendiente ? "Guardando…" : textoBoton}
      </Button>
    </section>
  );
}
