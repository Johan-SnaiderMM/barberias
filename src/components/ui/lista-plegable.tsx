import type { ReactNode } from "react";
import { partirLista } from "@/lib/listas";
import { cn } from "@/lib/utils";

/**
 * Una historia que puede crecer sin alargar la pantalla: a la vista las primeras filas y el resto plegado detrás de un
 * «Ver N más» (un `<details>` nativo, no necesita JavaScript). Las filas llegan ya armadas y con su `key`.
 */
export function ListaPlegable({
  filas,
  resumen,
  className,
}: {
  filas: ReactNode[];
  /** El texto del botón que despliega el resto, según cuántas filas quedaron plegadas («Ver 12 cobros anteriores»). */
  resumen: (plegadas: number) => string;
  /** Las clases de la `<ul>`; la parte plegada lleva las mismas. */
  className: string;
}) {
  const { visibles, plegadas } = partirLista(filas);
  return (
    <>
      <ul className={className}>{visibles}</ul>
      {plegadas.length > 0 && (
        <details className="mt-2">
          <summary className="flex min-h-12 cursor-pointer items-center text-base font-medium text-tinta-2">
            {resumen(plegadas.length)}
          </summary>
          <ul className={cn("mt-2", className)}>{plegadas}</ul>
        </details>
      )}
    </>
  );
}
