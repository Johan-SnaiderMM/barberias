"use client";

import { useActionState, useState } from "react";
import { crearCita, crearCitaSinReserva } from "@/app/acciones/citas";
import { PanelAvisos } from "@/components/agenda/panel-avisos";
import { SelectorCliente, type ValorCliente } from "@/components/agenda/selector-cliente";
import { SelectorHora, type HoraElegida } from "@/components/agenda/selector-hora";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { textoDuracion } from "@/lib/catalogo";
import { formatearPesos } from "@/lib/dinero";
import type { Barbero, ClienteBuscado, EstadoFormCita, Servicio } from "@/lib/tipos/agenda";

const SELECT = "min-h-12 w-full rounded-xl border border-borde-campo bg-white px-3 text-base text-tinta";

/**
 * Agendar una cita (`modo = "cita"`: día y hora) o registrar a quien llegó sin cita (`modo = "ahora"`: empieza ya).
 *
 * Todos los campos son controlados: React 19 limpia los campos sin control al terminar una acción, y si la base
 * devuelve avisos para confirmar, el formulario debe conservar lo escrito para volver a enviarlo con `confirmar = 1`.
 * Las horas libres las calcula la base; aquí solo se muestran.
 */
export function FormularioCita({
  modo,
  servicios,
  barberos,
  barberoFijo,
  fechaInicial,
  barberoInicial,
  hoy,
  clienteInicial = null,
}: {
  modo: "cita" | "ahora";
  /** Solo servicios activos. */
  servicios: Servicio[];
  /** Solo barberos activos. */
  barberos: Barbero[];
  /** Si viene, la cita es de ese barbero y no se puede cambiar (el barbero con su propia cuenta). */
  barberoFijo: string | null;
  fechaInicial: string;
  barberoInicial: string | null;
  hoy: string;
  /** Un cliente ya elegido al abrir (al agendar desde su ficha). */
  clienteInicial?: ClienteBuscado | null;
}) {
  const [estado, accion, pendiente] = useActionState<EstadoFormCita, FormData>(
    modo === "ahora" ? crearCitaSinReserva : crearCita,
    { error: null }
  );

  const [servicioId, setServicioId] = useState(servicios.length === 1 ? servicios[0].id : "");
  const [barberoId, setBarberoId] = useState(barberoFijo ?? barberoInicial ?? "");
  const [fecha, setFecha] = useState(fechaInicial);
  const [elegida, setElegida] = useState<HoraElegida | null>(null);
  const [cliente, setCliente] = useState<ValorCliente>(
    clienteInicial
      ? { id: clienteInicial.id, nombre: clienteInicial.nombre, telefono: clienteInicial.telefono ?? "" }
      : { id: null, nombre: "", telefono: "" }
  );
  const [notas, setNotas] = useState("");
  // Los avisos ya vistos y descartados (al cambiar algo); una respuesta nueva del servidor vuelve a mostrarlos.
  const [descartado, setDescartado] = useState<EstadoFormCita | null>(null);

  const servicio = servicios.find((s) => s.id === servicioId) ?? null;
  const disponibles = barberos
    .filter((b) => (barberoFijo ? b.id === barberoFijo : true))
    .filter((b) => (servicioId ? b.servicios.some((x) => x.servicio_id === servicioId) : true));
  const nombres = Object.fromEntries(barberos.map((b) => [b.id, b.nombre]));

  const barberoEfectivo = (modo === "ahora" ? barberoId : (elegida?.barberoId ?? barberoId)) || null;
  const asignado = barberos
    .find((b) => b.id === barberoEfectivo)
    ?.servicios.find((x) => x.servicio_id === servicioId);
  const precio = servicio ? (asignado?.precio_propio ?? servicio.precio) : null;
  const duracion = servicio ? (asignado?.duracion_propia ?? servicio.duracion_min) : null;

  const listo =
    Boolean(servicioId && barberoEfectivo) &&
    (modo === "ahora" || elegida !== null) &&
    (cliente.id !== null || cliente.nombre.trim().length > 0);

  const avisos = estado.avisos && estado.avisos.length > 0 && descartado !== estado ? estado.avisos : null;
  const cambio = () => setDescartado(estado);

  return (
    <form action={accion} className="space-y-5 px-4 pt-5">
      <input type="hidden" name="servicio_id" value={servicioId} />
      <input type="hidden" name="barbero_id" value={barberoEfectivo ?? ""} />
      {modo === "cita" && <input type="hidden" name="inicio" value={elegida?.inicio ?? ""} />}
      <input type="hidden" name="cliente_id" value={cliente.id ?? ""} />
      <input type="hidden" name="cliente_nombre" value={cliente.nombre} />
      <input type="hidden" name="cliente_telefono" value={cliente.telefono} />
      <input type="hidden" name="notas" value={notas} />

      <div>
        <Label htmlFor="servicio">Servicio</Label>
        <select
          id="servicio"
          value={servicioId}
          onChange={(e) => {
            const nuevo = e.target.value;
            setServicioId(nuevo);
            setElegida(null);
            cambio();
            // Si el barbero elegido no hace el servicio nuevo, se vuelve a "cualquiera".
            const sigue = barberos.find((b) => b.id === barberoId)?.servicios.some((x) => x.servicio_id === nuevo);
            if (!barberoFijo && !sigue) setBarberoId("");
          }}
          className={SELECT}
        >
          <option value="">Elige el servicio…</option>
          {servicios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre} · {formatearPesos(s.precio)} · {textoDuracion(s.duracion_min)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="barbero">Barbero</Label>
        <select
          id="barbero"
          value={barberoId}
          disabled={barberoFijo !== null}
          onChange={(e) => {
            setBarberoId(e.target.value);
            setElegida(null);
            cambio();
          }}
          className={`${SELECT} disabled:border-dashed disabled:bg-hueso`}
        >
          {modo === "cita" && !barberoFijo && <option value="">Cualquiera disponible</option>}
          {modo === "ahora" && !barberoFijo && <option value="">Elige el barbero…</option>}
          {disponibles.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nombre}
            </option>
          ))}
        </select>
        {servicioId && disponibles.length === 0 && (
          <p className="mt-1 text-base font-semibold text-rojo">Nadie hace este servicio todavía. Asígnalo a un barbero.</p>
        )}
      </div>

      {precio !== null && duracion !== null && (
        <p className="rounded-xl border border-dashed border-zinc-300 bg-hueso px-3 py-2 text-base">
          <strong>{formatearPesos(precio)}</strong> · {textoDuracion(duracion)}
        </p>
      )}

      {modo === "cita" ? (
        <>
          <div>
            <Label htmlFor="fecha">Día</Label>
            <Input
              id="fecha"
              type="date"
              min={hoy}
              value={fecha}
              required
              onChange={(e) => {
                setFecha(e.target.value);
                setElegida(null);
                cambio();
              }}
            />
          </div>
          <div>
            <Label>Hora</Label>
            <SelectorHora
              servicioId={servicioId}
              barberoId={barberoId || null}
              fecha={fecha}
              elegida={elegida}
              onElegir={(h) => {
                setElegida(h);
                cambio();
              }}
              nombresBarberos={nombres}
            />
          </div>
        </>
      ) : (
        <p className="rounded-xl border border-linea bg-oro px-3 py-2 text-base font-semibold">
          Empieza ahora: queda «en atención» desde este momento.
        </p>
      )}

      <section>
        <h2 className="text-xl font-semibold tracking-tight">Cliente</h2>
        <div className="mt-2">
          <SelectorCliente
            valor={cliente}
            elegidoInicial={clienteInicial}
            onCambio={(v) => {
              setCliente(v);
              cambio();
            }}
          />
        </div>
      </section>

      <div>
        <Label htmlFor="notas">Nota (opcional)</Label>
        <Input
          id="notas"
          value={notas}
          maxLength={300}
          autoComplete="off"
          placeholder="Degradé 2 a los lados, barba al ras…"
          onChange={(e) => {
            setNotas(e.target.value);
            cambio();
          }}
        />
      </div>

      {avisos && <PanelAvisos avisos={avisos} textoBoton="Agendar de todos modos" pendiente={pendiente} />}

      <BarraAccion>
        {estado.error && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {estado.error}
          </p>
        )}
        <Button type="submit" tamano="lg" bloque disabled={pendiente || !listo}>
          {pendiente ? "Guardando…" : modo === "ahora" ? "Empezar ahora" : "Agendar cita"}
        </Button>
      </BarraAccion>
    </form>
  );
}
