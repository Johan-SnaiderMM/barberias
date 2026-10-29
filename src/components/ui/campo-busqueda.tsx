import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/** El buscador de una lista: lupa a la izquierda y 48 px de alto. El texto escrito lo guarda quien lo usa. */
export function CampoBusqueda({
  id,
  etiqueta,
  ejemplo,
  valor,
  onCambio,
}: {
  id: string;
  /** Lo que lee un lector de pantalla (no se ve). */
  etiqueta: string;
  /** El texto de ejemplo dentro del campo. */
  ejemplo: string;
  valor: string;
  onCambio: (texto: string) => void;
}) {
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {etiqueta}
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-tinta-2" aria-hidden />
      <Input
        id={id}
        type="search"
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        placeholder={ejemplo}
        autoComplete="off"
        className="pl-10"
      />
    </div>
  );
}
