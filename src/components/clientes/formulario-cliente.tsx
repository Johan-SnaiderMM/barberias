"use client";

import { useActionState, useState } from "react";
import { guardarCliente } from "@/app/acciones/clientes";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EstadoForm } from "@/lib/errores";
import { formatearTelefono } from "@/lib/telefono";

/** Alta (sin `cliente`) o edición de nombre y celular. Campos controlados: React 19 limpia los demás al terminar. */
export function FormularioCliente({
  cliente,
}: {
  cliente?: { id: string; nombre: string; telefono: string | null };
}) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(guardarCliente, { error: null });
  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [telefono, setTelefono] = useState(cliente?.telefono ? formatearTelefono(cliente.telefono) : "");
  const [nota, setNota] = useState("");

  return (
    <form action={accion} className="space-y-5 px-4 pt-5">
      {cliente && <input type="hidden" name="id" value={cliente.id} />}
      <input type="hidden" name="nombre" value={nombre} />
      <input type="hidden" name="telefono" value={telefono} />
      <input type="hidden" name="nota" value={nota} />

      <div>
        <Label htmlFor="nombre_cliente">Nombre</Label>
        <Input
          id="nombre_cliente"
          value={nombre}
          maxLength={60}
          required
          autoComplete="off"
          placeholder="Juan Pérez"
          onChange={(e) => setNombre(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="telefono_cliente">Celular (opcional)</Label>
        <Input
          id="telefono_cliente"
          value={telefono}
          inputMode="tel"
          maxLength={30}
          autoComplete="off"
          placeholder="300 123 4567"
          onChange={(e) => setTelefono(e.target.value)}
        />
        <p className="mt-1 text-base text-tinta-2">
          Con el celular se reconoce al cliente cada vez que agenda y se le puede recordar la cita.
        </p>
      </div>

      {!cliente && (
        <div>
          <Label htmlFor="nota_cliente">Nota del corte (opcional)</Label>
          <Input
            id="nota_cliente"
            value={nota}
            maxLength={300}
            autoComplete="off"
            placeholder="Degradé 2 a los lados, barba al ras…"
            onChange={(e) => setNota(e.target.value)}
          />
        </div>
      )}

      <BarraAccion>
        {estado.error && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {estado.error}
          </p>
        )}
        <Button type="submit" tamano="lg" bloque disabled={pendiente || nombre.trim() === ""}>
          {pendiente ? "Guardando…" : cliente ? "Guardar cambios" : "Crear cliente"}
        </Button>
      </BarraAccion>
    </form>
  );
}
