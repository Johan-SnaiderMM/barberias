"use client";

import { useActionState } from "react";
import { guardarAjustes } from "@/app/acciones/horarios";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ANTICIPACION_OPCIONES,
  CANCELAR_HASTA_OPCIONES,
  COLCHON_OPCIONES,
  DIAS_ADELANTE_OPCIONES,
  PASOS,
  textoAnticipacion,
  textoCancelarHasta,
  textoColchon,
  type AjustesAgenda,
} from "@/lib/ajustes-agenda";
import type { EstadoForm } from "@/lib/errores";

const SELECT = "min-h-12 w-full rounded-xl border border-borde-campo bg-superficie px-3 text-base text-tinta";

/**
 * Ajustes de la agenda: el interruptor de reservas en línea, el límite para que el cliente cancele o mueva y los
 * que usa la disponibilidad (paso, días adelante, anticipación y descanso entre citas).
 */
export function FormularioAjustes({ ajustes, slug }: { ajustes: AjustesAgenda; slug: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(guardarAjustes, { error: null });

  return (
    <form action={accion} className="space-y-5 px-4 pt-5 pb-32">
      <label className="flex min-h-14 items-start gap-3 rounded-xl border border-linea bg-superficie px-4 py-3">
        <input
          type="checkbox"
          name="reservas_en_linea"
          value="1"
          defaultChecked={ajustes.reservas_en_linea}
          className="mt-0.5 size-6 shrink-0 accent-tinta"
        />
        <span>
          <span className="block text-base font-medium leading-tight">Recibir reservas en línea</span>
          <span className="mt-0.5 block text-base text-tinta-2">
            Apagado, tus clientes ven los servicios pero no pueden reservar.
          </span>
        </span>
      </label>
      <a
        href={`/reservar/${slug}`}
        target="_blank"
        rel="noopener noreferrer"
        className="-mt-2 flex min-h-12 items-center break-all rounded-xl px-1 text-base font-medium text-tinta underline underline-offset-4 active:bg-hueso"
      >
        Tu enlace: /reservar/{slug}
      </a>

      <div>
        <Label htmlFor="cancelar_hasta_horas">El cliente puede cancelar o mover</Label>
        <select
          id="cancelar_hasta_horas"
          name="cancelar_hasta_horas"
          defaultValue={ajustes.cancelar_hasta_horas}
          className={SELECT}
        >
          {CANCELAR_HASTA_OPCIONES.map((h) => (
            <option key={h} value={h}>
              {textoCancelarHasta(h)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-base text-tinta-2">Después de ese plazo, tiene que escribirte por WhatsApp.</p>
      </div>

      <div>
        <Label htmlFor="paso_min">Las horas de reserva arrancan cada</Label>
        <select id="paso_min" name="paso_min" defaultValue={ajustes.paso_min} className={SELECT}>
          {PASOS.map((m) => (
            <option key={m} value={m}>
              {m} minutos
            </option>
          ))}
        </select>
        <p className="mt-1 text-base text-tinta-2">Con 30 minutos: 9:00, 9:30, 10:00… Con 15: 9:00, 9:15, 9:30…</p>
      </div>

      <div>
        <Label htmlFor="dias_adelante">Se puede reservar hasta</Label>
        <select id="dias_adelante" name="dias_adelante" defaultValue={ajustes.dias_adelante} className={SELECT}>
          {DIAS_ADELANTE_OPCIONES.map((d) => (
            <option key={d} value={d}>
              {d} días adelante
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="anticipacion_min">Anticipación mínima</Label>
        <select id="anticipacion_min" name="anticipacion_min" defaultValue={ajustes.anticipacion_min} className={SELECT}>
          {ANTICIPACION_OPCIONES.map((m) => (
            <option key={m} value={m}>
              {textoAnticipacion(m)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-base text-tinta-2">Cuánto antes de la cita deben reservar (nadie aparta «para ya»).</p>
      </div>

      <div>
        <Label htmlFor="colchon_min">Descanso entre citas</Label>
        <select id="colchon_min" name="colchon_min" defaultValue={ajustes.colchon_min} className={SELECT}>
          {COLCHON_OPCIONES.map((m) => (
            <option key={m} value={m}>
              {textoColchon(m)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-base text-tinta-2">Tiempo para limpiar y preparar el puesto entre un cliente y otro.</p>
      </div>

      <BarraAccion>
        {estado.error && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {estado.error}
          </p>
        )}
        <Button type="submit" tamano="lg" bloque disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar ajustes"}
        </Button>
      </BarraAccion>
    </form>
  );
}
