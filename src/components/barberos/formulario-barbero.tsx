"use client";

import { useActionState } from "react";
import { guardarBarbero } from "@/app/acciones/barberos";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EstadoForm } from "@/lib/errores";
import type { Barbero } from "@/lib/tipos/agenda";

/** Crear o editar un barbero. Con `barbero` es edición (manda su id y deja decidir si recibe reservas en línea). */
export function FormularioBarbero({ barbero }: { barbero?: Barbero }) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(guardarBarbero, { error: null });

  return (
    <form action={accion} className="space-y-5 px-4 pt-5">
      {barbero && <input type="hidden" name="id" value={barbero.id} />}

      <div>
        <Label htmlFor="nombre">Nombre</Label>
        <Input
          id="nombre"
          name="nombre"
          defaultValue={barbero?.nombre ?? ""}
          maxLength={40}
          required
          autoComplete="off"
          placeholder="Camilo, Dani R.…"
        />
        <p className="mt-1 text-base text-tinta-2">Así lo ven tus clientes al reservar.</p>
      </div>

      {barbero && (
        <label className="flex min-h-14 items-center gap-3 rounded-xl border border-linea bg-superficie px-4 py-2">
          <input
            type="checkbox"
            name="acepta_reservas"
            defaultChecked={barbero.acepta_reservas}
            className="size-6 shrink-0 accent-tinta"
          />
          <span>
            <span className="block text-lg font-semibold leading-tight">Recibe reservas en línea</span>
            <span className="block text-base text-tinta-2">Si lo apagas, sigue en la agenda pero no sale a los clientes.</span>
          </span>
        </label>
      )}

      <BarraAccion>
        {estado.error && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {estado.error}
          </p>
        )}
        <Button type="submit" tamano="lg" bloque disabled={pendiente}>
          {pendiente ? "Guardando…" : barbero ? "Guardar cambios" : "Crear barbero"}
        </Button>
      </BarraAccion>
    </form>
  );
}
