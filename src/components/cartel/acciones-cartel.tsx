"use client";

import { useState } from "react";
import { Check, Copy, MessageCircle, Printer } from "lucide-react";
import { Button, botonVariantes } from "@/components/ui/button";

/** Imprimir el cartel, copiar el enlace o mandarlo por WhatsApp. Nada de esto sale en la hoja impresa. */
export function AccionesCartel({ url, enlaceWhatsapp }: { url: string; enlaceWhatsapp: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="space-y-3 print:hidden">
      <Button tamano="lg" bloque onClick={() => window.print()}>
        <Printer className="size-5" aria-hidden />
        Imprimir el cartel
      </Button>
      <a
        href={enlaceWhatsapp}
        target="_blank"
        rel="noopener noreferrer"
        className={botonVariantes({ variante: "secundario", tamano: "lg", bloque: true })}
      >
        <MessageCircle className="size-5" aria-hidden />
        Mandar el enlace por WhatsApp
      </a>
      <Button
        variante="secundario"
        tamano="lg"
        bloque
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopiado(true);
          } catch {
            setCopiado(false);
          }
        }}
      >
        {copiado ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
        {copiado ? "Enlace copiado" : "Copiar el enlace"}
      </Button>
    </div>
  );
}
