"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { iniciarGuia } from "@/lib/guia";

/**
 * Arranca el recorrido al entrar a la demo (la dirección trae `?recorrido=1`) y limpia la dirección: al recargar, o al
 * volver a Inicio, no vuelve a empezar solo.
 */
export function IniciarGuia({ volverA }: { volverA: string }) {
  const router = useRouter();
  useEffect(() => {
    iniciarGuia();
    router.replace(volverA);
  }, [router, volverA]);
  return null;
}
