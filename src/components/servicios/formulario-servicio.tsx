"use client";

import { useActionState, useState } from "react";
import { guardarServicio } from "@/app/acciones/servicios";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DURACIONES, textoDuracion } from "@/lib/catalogo";
import { formatearMiles, leerPesos } from "@/lib/dinero";
import type { EstadoForm } from "@/lib/errores";
import type { Servicio } from "@/lib/tipos/agenda";

/** Crear o editar un servicio. Con `servicio` es edición (manda su id). El precio se escribe con puntos de miles. */
export function FormularioServicio({ servicio }: { servicio?: Servicio }) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(guardarServicio, { error: null });
  const [precio, setPrecio] = useState(servicio ? formatearMiles(servicio.precio) : "");

  return (
    <form action={accion} className="space-y-5 px-4 pt-5">
      {servicio && <input type="hidden" name="id" value={servicio.id} />}

      <div>
        <Label htmlFor="nombre">Nombre</Label>
        <Input
          id="nombre"
          name="nombre"
          defaultValue={servicio?.nombre ?? ""}
          maxLength={60}
          required
          autoComplete="off"
          placeholder="Corte, barba, corte + barba…"
        />
      </div>

      <div>
        <Label htmlFor="precio">Precio</Label>
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-xl font-semibold tracking-tight">
            $
          </span>
          <Input
            id="precio"
            name="precio"
            inputMode="numeric"
            autoComplete="off"
            required
            placeholder="15.000"
            value={precio}
            onChange={(e) => {
              const digitos = e.target.value.replace(/\D/g, "");
              setPrecio(digitos === "" ? "" : formatearMiles(leerPesos(digitos)));
            }}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="duracion_min">Duración</Label>
        <select
          id="duracion_min"
          name="duracion_min"
          defaultValue={servicio?.duracion_min ?? 30}
          className="min-h-12 w-full rounded-xl border border-borde-campo bg-white px-3 text-base text-tinta"
        >
          {DURACIONES.map((m) => (
            <option key={m} value={m}>
              {textoDuracion(m)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-base text-tinta-2">Es lo que ocupa en la agenda cada vez que se reserva.</p>
      </div>

      <BarraAccion>
        {estado.error && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {estado.error}
          </p>
        )}
        <Button type="submit" tamano="lg" bloque disabled={pendiente}>
          {pendiente ? "Guardando…" : servicio ? "Guardar cambios" : "Crear servicio"}
        </Button>
      </BarraAccion>
    </form>
  );
}
