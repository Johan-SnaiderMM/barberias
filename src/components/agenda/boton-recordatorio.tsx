"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/enlace";
import { MessageCircle } from "lucide-react";
import { registrarRecordatorio } from "@/app/acciones/citas";
import { botonVariantes } from "@/components/ui/button";

/**
 * Recordar la cita por WhatsApp con un toque. El enlace (`wa.me`, con el mensaje ya armado) se abre en otra
 * pestaña y, al mismo tiempo, se deja constancia en la cita. La app no envía nada: la persona lo manda desde su
 * WhatsApp. Si el cliente no tiene celular, en vez del botón sale el camino para agregarlo.
 */
export function BotonRecordatorio({
  id,
  clienteId,
  enlace,
  enviado,
}: {
  id: string;
  clienteId: string;
  /** `null` cuando el cliente no tiene celular. */
  enlace: string | null;
  /** Cuándo se recordó la última vez, ya escrito ("hoy a las 3:15 p. m."), o null si nunca. */
  enviado: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [, iniciar] = useTransition();

  if (enlace === null) {
    return (
      <Link
        href={`/clientes/${clienteId}#datos-del-cliente`}
        className="flex min-h-12 items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-hueso px-4 py-2 text-center text-base font-semibold"
      >
        Sin celular: agrégalo en su ficha para recordarle
      </Link>
    );
  }

  return (
    <div className="space-y-2">
      <a
        href={enlace}
        target="_blank"
        rel="noopener noreferrer"
        className={botonVariantes({ variante: "secundario", tamano: "md", bloque: true })}
        onClick={() => {
          // No se frena el enlace: WhatsApp se abre ya, y la constancia se guarda en paralelo.
          setError(null);
          iniciar(async () => {
            const r = await registrarRecordatorio(id);
            if (r.error) setError(r.error);
          });
        }}
      >
        <MessageCircle className="size-5" aria-hidden />
        {enviado ? "Recordar otra vez por WhatsApp" : "Recordar por WhatsApp"}
      </a>
      {/* `enviado` ya termina en punto ("p. m."): no se le agrega otro. */}
      {enviado && <p className="text-center text-base text-tinta-2">Recordatorio enviado {enviado}</p>}
      {error && (
        <p role="alert" className="text-center text-base font-semibold text-rojo">
          {error}
        </p>
      )}
    </div>
  );
}
