"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { HojaMonto } from "@/components/caja/hoja-monto";
import { Button } from "@/components/ui/button";
import { Hoja } from "@/components/ui/hoja";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearPesos, PRECIO_MAXIMO, type Pesos } from "@/lib/dinero";

/** Una línea del cobro tal como se edita en pantalla. `servicio_id` null = extra. */
export type LineaEditable = { id: string; servicio_id: string | null; nombre: string; precio: Pesos };

/** Las líneas del cobro: cambiar el precio de una, quitarla o agregar un servicio o un extra. */
export function HojaLineas({
  lineas,
  alEditarPrecio,
  alQuitar,
  alAgregarServicio,
  alAgregarExtra,
  onCerrar,
}: {
  lineas: LineaEditable[];
  alEditarPrecio: (id: string) => void;
  alQuitar: (id: string) => void;
  alAgregarServicio: () => void;
  alAgregarExtra: () => void;
  onCerrar: () => void;
}) {
  return (
    <Hoja titulo="Qué se cobra" onCerrar={onCerrar}>
      <ul className="space-y-2">
        {lineas.map((l) => (
          <li key={l.id} className="flex items-center gap-2 rounded-xl border border-linea bg-white pl-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-medium leading-tight">{l.nombre}</span>
              <span className="block text-base text-tinta-2">{l.servicio_id ? "Servicio" : "Extra"}</span>
            </span>
            <button
              type="button"
              onClick={() => alEditarPrecio(l.id)}
              aria-label={`Cambiar el precio de ${l.nombre}`}
              className="min-h-12 rounded-xl px-3 text-base font-semibold underline decoration-zinc-300 underline-offset-4 active:bg-hueso"
            >
              {formatearPesos(l.precio)}
            </button>
            <button
              type="button"
              onClick={() => alQuitar(l.id)}
              aria-label={`Quitar ${l.nombre}`}
              className="flex size-12 items-center justify-center rounded-xl text-tinta-2 active:bg-hueso"
            >
              <Trash2 className="size-5" aria-hidden />
            </button>
          </li>
        ))}
        {lineas.length === 0 && (
          <li className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
            Todavía no hay nada que cobrar. Agrega un servicio o un extra.
          </li>
        )}
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variante="secundario" onClick={alAgregarServicio}>
          <Plus className="size-5" aria-hidden />
          Servicio
        </Button>
        <Button variante="secundario" onClick={alAgregarExtra}>
          <Plus className="size-5" aria-hidden />
          Extra
        </Button>
      </div>
      <Button tamano="lg" bloque className="mt-3" onClick={onCerrar}>
        Listo
      </Button>
    </Hoja>
  );
}

/** Elegir un servicio del catálogo para agregarlo (con el precio que cobra este barbero). */
export function HojaServicio({
  servicios,
  alElegir,
  onCerrar,
}: {
  servicios: { id: string; nombre: string; precio: Pesos }[];
  alElegir: (servicio: { id: string; nombre: string; precio: Pesos }) => void;
  onCerrar: () => void;
}) {
  return (
    <Hoja titulo="Agregar un servicio" onCerrar={onCerrar}>
      <ul className="space-y-2">
        {servicios.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => alElegir(s)}
              className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-linea bg-white px-4 text-left active:bg-hueso"
            >
              <span className="text-base font-medium">{s.nombre}</span>
              <span className="text-base font-semibold">{formatearPesos(s.precio)}</span>
            </button>
          </li>
        ))}
        {servicios.length === 0 && (
          <li className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
            No hay servicios en el catálogo. Créalos en Más → Servicios y precios.
          </li>
        )}
      </ul>
    </Hoja>
  );
}

/** Un extra con nombre y precio ("Cera", "Cejas", "Producto"). */
export function HojaExtra({ alAgregar, onCerrar }: { alAgregar: (nombre: string, precio: Pesos) => void; onCerrar: () => void }) {
  const [nombre, setNombre] = useState("");

  return (
    <HojaMonto
      titulo="Agregar un extra"
      inicial={0}
      max={PRECIO_MAXIMO}
      aceptar="Agregar"
      puedeAceptar={(v) => v > 0 && nombre.trim() !== ""}
      alAceptar={(v) => alAgregar(nombre.trim(), v)}
      onCerrar={onCerrar}
    >
      <div>
        <Label htmlFor="nombre_extra">Qué es</Label>
        <Input
          id="nombre_extra"
          value={nombre}
          maxLength={60}
          autoComplete="off"
          placeholder="Cera, cejas, producto…"
          onChange={(e) => setNombre(e.target.value)}
        />
      </div>
    </HojaMonto>
  );
}
