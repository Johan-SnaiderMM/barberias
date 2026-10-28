"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { iniciarGuia, leerGuia, leerGuiaServidor, suscribirGuia } from "@/lib/guia";

/** Inicia el recorrido guiado. Se oculta mientras el recorrido está en marcha (la ficha «paso 3/10» lo reemplaza). */
export function BotonGuia({ className, children }: { className?: string; children: ReactNode }) {
  const activa = useSyncExternalStore(suscribirGuia, leerGuia, leerGuiaServidor) !== null;
  if (activa) return null;
  return (
    <button type="button" className={className} onClick={iniciarGuia}>
      {children}
    </button>
  );
}
