"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const FOCALIZABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Hoja que sube desde abajo (como un cajón) para una tarea corta: elegir un monto, agregar un servicio. Tapa el
 * resto con un velo; se cierra con la X, tocando el velo o con Escape. Queda por encima de las barras fijas y respeta
 * la zona segura de abajo. Mientras está abierta, la página de atrás no se desplaza. Con teclado: al abrirse el foco
 * entra a la hoja, Tab no sale de ella y al cerrarse el foco vuelve al botón que la abrió.
 */
export function Hoja({
  titulo,
  onCerrar,
  children,
  velo = true,
}: {
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
  /** false = sin el velo oscuro: la página de atrás se ve tal cual (el recorrido guiado resalta cosas ahí). */
  velo?: boolean;
}) {
  const hoja = useRef<HTMLElement>(null);

  useEffect(() => {
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = hoja.current;
    const dentro = () => [...(el?.querySelectorAll<HTMLElement>(FOCALIZABLES) ?? [])].filter((x) => x.offsetParent !== null);
    dentro()[0]?.focus({ preventScroll: true });

    const encerrar = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !el) return;
      const lista = dentro();
      if (lista.length === 0) {
        e.preventDefault();
        return;
      }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const activo = document.activeElement;
      if (!el.contains(activo) || (e.shiftKey && activo === primero)) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primero).focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener("keydown", encerrar);
    return () => {
      document.removeEventListener("keydown", encerrar);
      if (antes?.isConnected) antes.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alTeclear);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", alTeclear);
      document.body.style.overflow = anterior;
    };
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button type="button" aria-label="Cerrar" onClick={onCerrar} className={cn("absolute inset-0", velo && "bg-tinta/40")} />
      <section
        ref={hoja}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={cn(
          "relative mx-auto flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl border-t border-linea bg-papel",
          !velo && "shadow-[0_-6px_20px_color-mix(in_srgb,var(--color-tinta)_12%,transparent)]"
        )}
      >
        <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
          <h2 className="text-lg font-semibold tracking-tight">{titulo}</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="flex size-12 items-center justify-center rounded-xl active:bg-hueso"
          >
            <X className="size-6" aria-hidden />
          </button>
        </header>
        <div className="overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-1">{children}</div>
      </section>
    </div>
  );
}
