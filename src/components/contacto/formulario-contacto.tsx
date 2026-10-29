"use client";

import { MessageCircle } from "lucide-react";
import { useActionState, useState } from "react";
import { guardarContacto } from "@/app/acciones/contacto";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button, botonVariantes } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EstadoForm } from "@/lib/errores";
import { formatearTelefono, normalizarTelefono } from "@/lib/telefono";
import { enlaceWhatsappA } from "@/lib/whatsapp";

/**
 * El WhatsApp y la dirección de la barbería: lo que el cliente ve para escribirle y para llegar. Campos controlados
 * (React 19 limpia los demás al terminar la acción, y si la base rechaza el WhatsApp hay que conservar lo escrito).
 */
export function FormularioContacto({
  whatsapp,
  direccion,
  nombreBarberia,
}: {
  whatsapp: string | null;
  direccion: string | null;
  nombreBarberia: string;
}) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(guardarContacto, { error: null });
  const [tel, setTel] = useState(whatsapp ? formatearTelefono(whatsapp) : "");
  const [dir, setDir] = useState(direccion ?? "");

  // Con lo escrito ya se sabe si se entiende; la base igual lo vuelve a comprobar al guardar.
  const entendido = normalizarTelefono(tel);
  const numero = entendido.ok ? entendido.valor : null;
  const probar = enlaceWhatsappA(numero, `Hola, estoy probando el WhatsApp de ${nombreBarberia}.`);

  return (
    <form action={accion} className="space-y-5 px-4 pb-8 pt-5">
      <div>
        <Label htmlFor="whatsapp_barberia">WhatsApp de la barbería</Label>
        <Input
          id="whatsapp_barberia"
          name="whatsapp"
          value={tel}
          inputMode="tel"
          maxLength={30}
          autoComplete="off"
          placeholder="300 123 4567"
          onChange={(e) => setTel(e.target.value)}
        />
        <p className="mt-1 text-base text-tinta-2">
          Tus clientes te escriben a este número desde la reserva y desde su cita. Con 10 dígitos; si es de otro país,
          empieza con +.
        </p>
        {probar && (
          <a
            href={probar}
            target="_blank"
            rel="noopener noreferrer"
            className={`${botonVariantes({ variante: "secundario", bloque: true })} mt-3`}
          >
            <MessageCircle className="size-5" aria-hidden />
            Probar en WhatsApp
          </a>
        )}
      </div>

      <div>
        <Label htmlFor="direccion_barberia">Dirección</Label>
        <Input
          id="direccion_barberia"
          name="direccion"
          value={dir}
          maxLength={120}
          autoComplete="off"
          placeholder="Carrera 9 #12-34, Centro"
          onChange={(e) => setDir(e.target.value)}
        />
        <p className="mt-1 text-base text-tinta-2">Para que tus clientes sepan a dónde llegar.</p>
      </div>

      <p className="rounded-xl border border-linea bg-superficie px-4 py-3 text-base text-tinta-2">
        También sale en el aviso y la política de privacidad, como el contacto para consultas y reclamos sobre los datos de
        tus clientes. Déjalo vacío para quitarlo.
      </p>

      <BarraAccion>
        {estado.error && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {estado.error}
          </p>
        )}
        <Button type="submit" tamano="lg" bloque disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar contacto"}
        </Button>
      </BarraAccion>
    </form>
  );
}
