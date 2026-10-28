import Link from "next/link";
import { enlacesLegales } from "@/lib/legal";

const ENLACE = "flex min-h-12 items-center rounded-xl px-1 text-base font-medium text-tinta-2 underline underline-offset-4 active:bg-hueso";

/** Los dos textos de datos personales, enlazados desde donde se piden o se ven datos del cliente (reserva y su cita). */
export function PieLegal({ slug, className = "" }: { slug: string | null; className?: string }) {
  const { aviso, politica } = enlacesLegales(slug);
  return (
    <nav aria-label="Datos personales" className={`flex flex-wrap gap-x-5 ${className}`}>
      <Link href={aviso} target="_blank" className={ENLACE}>
        Aviso de privacidad
      </Link>
      <Link href={politica} target="_blank" className={ENLACE}>
        Política de datos
      </Link>
    </nav>
  );
}
