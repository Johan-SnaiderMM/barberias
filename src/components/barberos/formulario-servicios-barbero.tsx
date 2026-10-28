"use client";

import { useActionState, useState } from "react";
import { guardarServiciosBarbero } from "@/app/acciones/barberos";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DURACIONES, textoDuracion } from "@/lib/catalogo";
import { formatearMiles, formatearPesos, leerPesos } from "@/lib/dinero";
import type { EstadoForm } from "@/lib/errores";
import type { Servicio, ServicioDeBarbero } from "@/lib/tipos/agenda";

type Fila = {
  hace: boolean;
  /** Texto del precio propio con puntos de miles ("" = el del catálogo). */
  precio: string;
  /** "" = la del catálogo. */
  duracion: string;
};

/**
 * Qué servicios hace este barbero. Cada uno puede tener precio y/o duración propios; vacío = los del catálogo.
 * Viaja como JSON en el campo `servicios` (la lista completa: lo que no está marcado se quita).
 */
export function FormularioServiciosBarbero({
  barberoId,
  nombreBarbero,
  servicios,
  asignados,
}: {
  barberoId: string;
  nombreBarbero: string;
  /** Solo los servicios activos del catálogo. */
  servicios: Servicio[];
  asignados: ServicioDeBarbero[];
}) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(guardarServiciosBarbero, { error: null });
  const [filas, setFilas] = useState<Record<string, Fila>>(() =>
    Object.fromEntries(
      servicios.map((s) => {
        const a = asignados.find((x) => x.servicio_id === s.id);
        return [
          s.id,
          {
            hace: Boolean(a),
            precio: a?.precio_propio != null ? formatearMiles(a.precio_propio) : "",
            duracion: a?.duracion_propia != null ? String(a.duracion_propia) : "",
          } satisfies Fila,
        ];
      })
    )
  );

  const cambiar = (id: string, parche: Partial<Fila>) =>
    setFilas((f) => ({ ...f, [id]: { ...f[id], ...parche } }));

  const json = JSON.stringify(
    servicios
      .filter((s) => filas[s.id]?.hace)
      .map((s) => ({
        servicio_id: s.id,
        precio_propio: filas[s.id].precio === "" ? null : leerPesos(filas[s.id].precio),
        duracion_propia: filas[s.id].duracion === "" ? null : Number(filas[s.id].duracion),
      }))
  );

  return (
    <form action={accion} className="px-4 pt-5">
      <input type="hidden" name="barbero_id" value={barberoId} />
      <input type="hidden" name="servicios" value={json} />

      <p className="text-base text-tinta-2">
        Marca lo que hace <strong className="text-tinta">{nombreBarbero}</strong>. Solo eso podrán reservarle.
      </p>

      <ul className="mt-4 space-y-3">
        {servicios.map((s) => {
          const f = filas[s.id];
          return (
            <li key={s.id} className="rounded-xl border border-linea bg-white">
              <label className="flex min-h-16 items-center gap-3 px-4 py-2">
                <input
                  type="checkbox"
                  checked={f.hace}
                  onChange={(e) => cambiar(s.id, { hace: e.target.checked })}
                  className="size-6 shrink-0 accent-tinta"
                />
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold leading-tight">{s.nombre}</span>
                  <span className="block text-base text-tinta-2">
                    {formatearPesos(s.precio)} · {textoDuracion(s.duracion_min)}
                  </span>
                </span>
              </label>

              {f.hace && (
                <div className="space-y-3 border-t border-hueso px-4 py-3">
                  <div>
                    <label htmlFor={`precio-${s.id}`} className="mb-1 block text-sm font-medium uppercase tracking-wider text-tinta-2">
                      Precio para {nombreBarbero}
                    </label>
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="text-xl font-semibold tracking-tight">
                        $
                      </span>
                      <Input
                        id={`precio-${s.id}`}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder={`${formatearMiles(s.precio)} (el de siempre)`}
                        value={f.precio}
                        onChange={(e) => {
                          const digitos = e.target.value.replace(/\D/g, "");
                          cambiar(s.id, { precio: digitos === "" ? "" : formatearMiles(leerPesos(digitos)) });
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor={`duracion-${s.id}`} className="mb-1 block text-sm font-medium uppercase tracking-wider text-tinta-2">
                      Duración para {nombreBarbero}
                    </label>
                    <select
                      id={`duracion-${s.id}`}
                      value={f.duracion}
                      onChange={(e) => cambiar(s.id, { duracion: e.target.value })}
                      className="min-h-12 w-full rounded-xl border border-borde-campo bg-white px-3 text-base text-tinta"
                    >
                      <option value="">Igual que siempre ({textoDuracion(s.duracion_min)})</option>
                      {DURACIONES.map((m) => (
                        <option key={m} value={m}>
                          {textoDuracion(m)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <BarraAccion>
        {estado.error && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {estado.error}
          </p>
        )}
        <Button type="submit" tamano="lg" bloque disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar servicios"}
        </Button>
      </BarraAccion>
    </form>
  );
}
