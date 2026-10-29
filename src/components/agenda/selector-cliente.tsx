"use client";

import { useEffect, useState } from "react";
import { UserRound, X } from "lucide-react";
import { buscarClientes } from "@/app/acciones/citas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearTelefono } from "@/lib/telefono";
import type { ClienteBuscado } from "@/lib/tipos/agenda";

export type ValorCliente = { id: string | null; nombre: string; telefono: string };

/**
 * El cliente de la cita: se escribe su nombre y (opcional) su celular. Mientras se escribe, aparecen los clientes
 * que ya existen para tocar uno. Un celular que ya existe se reconoce solo al guardar (la base lo une).
 */
export function SelectorCliente({
  valor,
  onCambio,
  elegidoInicial = null,
}: {
  valor: ValorCliente;
  onCambio: (v: ValorCliente) => void;
  /** Un cliente ya elegido al abrir (p. ej. al agendar desde su ficha). */
  elegidoInicial?: ClienteBuscado | null;
}) {
  const digitos = valor.telefono.replace(/\D/g, "");
  const consulta = valor.id
    ? ""
    : valor.nombre.trim().length >= 2
      ? valor.nombre.trim()
      : digitos.length >= 3
        ? valor.telefono.trim()
        : "";

  const [resultado, setResultado] = useState<{ consulta: string; clientes: ClienteBuscado[] } | null>(null);
  const [elegido, setElegido] = useState<ClienteBuscado | null>(elegidoInicial);

  useEffect(() => {
    if (consulta === "") return;
    let cancelado = false;
    const espera = setTimeout(() => {
      buscarClientes(consulta).then((r) => {
        if (!cancelado) setResultado({ consulta, clientes: r.ok ? r.clientes : [] });
      });
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(espera);
    };
  }, [consulta]);

  const sugerencias = consulta !== "" && resultado?.consulta === consulta ? resultado.clientes : [];

  if (valor.id && elegido) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-linea bg-superficie p-3">
        <UserRound className="size-6 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold leading-tight">{elegido.nombre}</p>
          <p className="text-base text-tinta-2">
            {elegido.telefono ? formatearTelefono(elegido.telefono) : "Sin celular"} ·{" "}
            {elegido.visitas === 1 ? "1 visita" : `${elegido.visitas} visitas`}
          </p>
          {elegido.nota && <p className="text-base">Nota: {elegido.nota}</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            setElegido(null);
            onCambio({ id: null, nombre: "", telefono: "" });
          }}
          aria-label="Cambiar de cliente"
          className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-linea bg-papel active:bg-hueso"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="cliente_nombre">Nombre del cliente</Label>
        <Input
          id="cliente_nombre"
          value={valor.nombre}
          maxLength={60}
          autoComplete="off"
          placeholder="Juan Pérez"
          onChange={(e) => onCambio({ ...valor, nombre: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="cliente_telefono">Celular (opcional)</Label>
        <Input
          id="cliente_telefono"
          value={valor.telefono}
          inputMode="tel"
          maxLength={30}
          autoComplete="off"
          placeholder="300 123 4567"
          onChange={(e) => onCambio({ ...valor, telefono: e.target.value })}
        />
        <p className="mt-1 text-base text-tinta-2">Con el celular lo reconocemos la próxima vez y le podemos recordar la cita.</p>
      </div>

      {sugerencias.length > 0 && (
        <div>
          <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">¿Es alguno de estos?</p>
          <ul className="mt-2 space-y-2">
            {sugerencias.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setElegido(c);
                    onCambio({ id: c.id, nombre: c.nombre, telefono: c.telefono ?? "" });
                  }}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-linea bg-superficie px-3 py-2 text-left active:bg-hueso"
                >
                  <UserRound className="size-5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-semibold leading-tight">{c.nombre}</span>
                    <span className="block text-base text-tinta-2">
                      {c.telefono ? formatearTelefono(c.telefono) : "Sin celular"} ·{" "}
                      {c.visitas === 1 ? "1 visita" : `${c.visitas} visitas`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
