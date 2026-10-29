"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { comprimirImagen } from "@/lib/imagen";

/**
 * La foto del recibo: se toma o se elige, y se achica en el celular antes de mandarla (el servidor acepta 1 MB y a un
 * recibo le basta con verse nítido). Es opcional. Muestra una vista previa y deja quitarla.
 */
export function CampoFoto({ foto, onCambio }: { foto: File | null; onCambio: (foto: File | null) => void }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [preparando, setPreparando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // La vista previa es una URL temporal del archivo: se crea al elegir la foto y se libera al quitarla o al salir.
  const [vista, setVista] = useState<string | null>(null);
  const vistaActual = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (vistaActual.current) URL.revokeObjectURL(vistaActual.current);
    },
    []
  );

  function fijarVista(archivo: File | null) {
    if (vistaActual.current) URL.revokeObjectURL(vistaActual.current);
    vistaActual.current = archivo ? URL.createObjectURL(archivo) : null;
    setVista(vistaActual.current);
  }

  async function alElegir(archivo: File | undefined) {
    if (!archivo) return;
    setError(null);
    setPreparando(true);
    try {
      const comprimida = await comprimirImagen(archivo);
      fijarVista(comprimida);
      onCambio(comprimida);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo preparar la foto.");
    } finally {
      setPreparando(false);
      // Permite elegir la misma foto otra vez después de quitarla.
      if (entrada.current) entrada.current.value = "";
    }
  }

  function quitar() {
    fijarVista(null);
    onCambio(null);
  }

  return (
    <div>
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Foto del recibo"
        onChange={(e) => void alElegir(e.target.files?.[0])}
      />

      {vista && foto ? (
        <div className="flex items-center gap-3 rounded-xl border border-linea bg-superficie p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:), no hay nada que optimizar */}
          <img src={vista} alt="Foto del recibo" className="size-20 shrink-0 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium">Foto lista</p>
            <p className="text-base text-tinta-2">{Math.max(1, Math.round(foto.size / 1024))} KB</p>
          </div>
          <Button variante="secundario" aria-label="Quitar la foto" onClick={quitar}>
            <X className="size-5" aria-hidden />
            Quitar
          </Button>
        </div>
      ) : (
        <Button variante="secundario" tamano="lg" bloque disabled={preparando} onClick={() => entrada.current?.click()}>
          <Camera className="size-5" aria-hidden />
          {preparando ? "Preparando la foto…" : "Agregar foto del recibo"}
        </Button>
      )}

      {error && (
        <p role="alert" className="mt-2 text-base font-semibold text-rojo">
          {error}
        </p>
      )}
    </div>
  );
}
