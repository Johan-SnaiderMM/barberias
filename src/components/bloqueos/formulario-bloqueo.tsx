"use client";

import { useActionState, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { crearBloqueo } from "@/app/acciones/horarios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmentado } from "@/components/ui/segmentado";
import { fechaBogota, fechaCorta, horaCorta } from "@/lib/fechas";
import { hora24AMinutos } from "@/lib/horarios";
import type { EstadoBloqueo } from "@/lib/tipos/agenda";

type Tipo = "dia" | "horas";

/**
 * Bloquear tiempo de un barbero: uno o varios días completos, o unas horas de un día. `hoy` (día de Bogotá, lo
 * calcula el servidor) es la fecha más temprana que se puede elegir.
 *
 * Todos los campos son controlados: React 19 limpia los campos sin control cuando termina una acción, y aquí el
 * formulario debe conservar lo escrito para poder confirmar un bloqueo que cae sobre citas.
 */
export function FormularioBloqueo({ barberoId, hoy }: { barberoId: string; hoy: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoBloqueo, FormData>(crearBloqueo, { error: null });
  const [tipo, setTipo] = useState<Tipo>("dia");
  const [fecha, setFecha] = useState(hoy);
  const [fechaFin, setFechaFin] = useState("");
  const [desde, setDesde] = useState("14:00");
  const [hasta, setHasta] = useState("16:00");
  const [motivo, setMotivo] = useState("");
  // El aviso de citas se oculta en cuanto se cambia algo; una respuesta nueva (otro objeto) vuelve a mostrarlo.
  const [aviso, setAviso] = useState<EstadoBloqueo | null>(null);

  const minutosDesde = hora24AMinutos(desde);
  const minutosHasta = hora24AMinutos(hasta, true);
  const citas = estado.citas && estado.citas.length > 0 && aviso !== estado ? estado.citas : null;

  const editar = <T,>(poner: (v: T) => void) => (v: T) => {
    poner(v);
    setAviso(estado);
  };

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="barbero_id" value={barberoId} />
      <input type="hidden" name="desde" value={tipo === "horas" && minutosDesde !== null ? minutosDesde : ""} />
      <input type="hidden" name="hasta" value={tipo === "horas" && minutosHasta !== null ? minutosHasta : ""} />

      <Segmentado
        etiqueta="Qué se bloquea"
        nombre="tipo"
        valor={tipo}
        onCambio={editar(setTipo)}
        opciones={[
          { valor: "dia", etiqueta: "Todo el día" },
          { valor: "horas", etiqueta: "Unas horas" },
        ]}
      />

      <div>
        <Label htmlFor="fecha">{tipo === "dia" ? "Primer día" : "Día"}</Label>
        <Input
          id="fecha"
          name="fecha"
          type="date"
          min={hoy}
          value={fecha}
          onChange={(e) => editar(setFecha)(e.target.value)}
          required
        />
      </div>

      {tipo === "dia" ? (
        <div>
          <Label htmlFor="fecha_fin">Último día (si son varios)</Label>
          <Input
            id="fecha_fin"
            name="fecha_fin"
            type="date"
            min={fecha || hoy}
            value={fechaFin}
            onChange={(e) => editar(setFechaFin)(e.target.value)}
          />
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="hora_desde">Desde</Label>
            <Input
              id="hora_desde"
              type="time"
              step={300}
              value={desde}
              onChange={(e) => editar(setDesde)(e.target.value)}
              required
            />
          </div>
          <div className="min-w-0 flex-1">
            <Label htmlFor="hora_hasta">Hasta</Label>
            <Input
              id="hora_hasta"
              type="time"
              step={300}
              value={hasta}
              onChange={(e) => editar(setHasta)(e.target.value)}
              required
            />
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="motivo">Motivo (opcional)</Label>
        <Input
          id="motivo"
          name="motivo"
          maxLength={100}
          autoComplete="off"
          placeholder="Cita médica, vacaciones…"
          value={motivo}
          onChange={(e) => editar(setMotivo)(e.target.value)}
        />
      </div>

      {citas && (
        <section role="alert" className="rounded-xl border border-rojo bg-superficie p-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-rojo">
            <TriangleAlert className="size-5 shrink-0" aria-hidden />
            {citas.length === 1 ? "Ese rato ya tiene 1 cita" : `Ese rato ya tiene ${citas.length} citas`}
          </h3>
          <ul className="mt-2 space-y-1">
            {citas.map((c) => (
              <li key={c.id} className="text-base">
                <strong>
                  {fechaCorta(fechaBogota(c.inicio))} · {horaCorta(c.inicio)}
                </strong>{" "}
                · {c.cliente} · {c.servicio}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-base text-tinta-2">
            Si bloqueas, esas citas no se cancelan solas: tendrás que moverlas o avisarles a los clientes.
          </p>
          <Button type="submit" name="confirmar" value="1" variante="peligro" bloque className="mt-3" disabled={pendiente}>
            {pendiente ? "Bloqueando…" : "Bloquear de todos modos"}
          </Button>
        </section>
      )}

      {estado.error && (
        <p role="alert" className="text-base font-semibold text-rojo">
          {estado.error}
        </p>
      )}
      <Button type="submit" tamano="lg" bloque disabled={pendiente}>
        {pendiente ? "Bloqueando…" : "Bloquear"}
      </Button>
    </form>
  );
}
