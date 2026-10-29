"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/enlace";
import { Banknote, ChevronRight, Smartphone } from "lucide-react";
import { cobrar } from "@/app/acciones/caja";
import { ConfirmacionCobro } from "@/components/caja/confirmacion-cobro";
import { HojaExtra, HojaLineas, HojaServicio, type LineaEditable } from "@/components/caja/hoja-lineas";
import { HojaMonto } from "@/components/caja/hoja-monto";
import { BarraAccion } from "@/components/layout/barra-accion";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { Button, botonVariantes } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmentado } from "@/components/ui/segmentado";
import { TecladoNumerico } from "@/components/ui/teclado-numerico";
import {
  atajosEfectivo,
  calcularCobro,
  calcularEfectivo,
  formatearPesos,
  planDePagos,
  porcentajeDe,
  PRECIO_MAXIMO,
  PROPINA_MAXIMA,
  sumar,
  validarCobro,
  type MedioPago,
} from "@/lib/dinero";
import { horaCorta } from "@/lib/fechas";
import { aplicarTecla } from "@/lib/teclado";
import type { BarberoDeCobro, Cobrado, DatosCobro } from "@/lib/tipos/caja";
import { cn } from "@/lib/utils";

type Hoja = null | "lineas" | "servicio" | "extra" | "descuento" | "propina" | { precioDe: string };

const SELECT = "min-h-12 w-full rounded-xl border border-borde-campo bg-superficie px-3 text-base text-tinta";

/**
 * Cobrar una cita (o una venta sin cita): qué se cobra, descuento y propina, cómo paga y cuánto devolver. Todo se ve
 * en una pantalla de celular, con teclado propio. Los números que se muestran salen de `dinero.ts`; la base vuelve a
 * calcular y es la que manda. `clave` identifica este cobro: tocar dos veces no cobra dos veces.
 */
export function FormularioCobro({
  clave: claveInicial,
  cita,
  barberos,
  servicios,
  bloqueo = null,
}: {
  clave: string;
  cita: DatosCobro["cita"];
  barberos: BarberoDeCobro[];
  servicios: DatosCobro["servicios"];
  /**
   * Por qué esta cita ya no se puede cobrar (ya tiene cobro, o está cancelada). Se decide AQUÍ y no en la página: al
   * cobrar, el servidor refresca la página y la cita pasa a "ya cobrada"; si la página cambiara de pantalla, se
   * perdería la confirmación con el vuelto.
   */
  bloqueo?: { tipo: "cobrada"; cobroId: string } | { tipo: "no_cobrable"; estado: string } | null;
}) {
  // La clave se fija al abrir la pantalla: aunque el servidor la refresque, este cobro sigue siendo el mismo.
  const [clave] = useState(claveInicial);
  const [barberoId, setBarberoId] = useState(cita?.barbero_id ?? barberos[0]?.id ?? "");
  const [lineas, setLineas] = useState<LineaEditable[]>(
    cita ? [{ id: "cita", servicio_id: cita.servicio_id, nombre: cita.servicio, precio: cita.precio }] : []
  );
  const [descuento, setDescuento] = useState(0);
  const [motivo, setMotivo] = useState("");
  const [propina, setPropina] = useState(0);
  const [medio, setMedio] = useState<MedioPago>("efectivo");
  const [recibido, setRecibido] = useState(0);
  const [referencia, setReferencia] = useState("");
  const [conParteEfectivo, setConParteEfectivo] = useState(false);
  const [pagaAhora, setPagaAhora] = useState(0);
  const [hoja, setHoja] = useState<Hoja>(null);
  const [error, setError] = useState<string | null>(null);
  const [cobrado, setCobrado] = useState<Cobrado | null>(null);
  const [enviando, empezar] = useTransition();

  const barbero = barberos.find((b) => b.id === barberoId) ?? null;
  const precioDe = (id: string, base: number) => barbero?.precios[id] ?? base;

  // Cuentas (las mismas de la base). El descuento nunca pasa de lo que se cobra: si bajan los precios, se ajusta solo.
  const subtotal = sumar(lineas.map((l) => l.precio));
  const descuentoReal = Math.min(descuento, subtotal);
  const cuenta = calcularCobro({ lineas: lineas.map((l) => ({ precio: l.precio })), descuento: descuentoReal, propina });
  const aCobrar = cuenta.aCobrar;
  const efectivo = calcularEfectivo(recibido, aCobrar);
  const pagos = planDePagos({ medio, aCobrar, recibido, referencia, pagaAhora: conParteEfectivo ? pagaAhora : 0 });
  const validacion = validarCobro(cuenta.total, propina, pagos);

  function cambiarMedio(m: MedioPago) {
    setMedio(m);
    setError(null);
    setConParteEfectivo(false);
    setPagaAhora(0);
  }

  function elegirBarbero(id: string) {
    setBarberoId(id);
    const nuevo = barberos.find((b) => b.id === id);
    // Los servicios ya agregados pasan al precio de ese barbero (los extras no cambian).
    setLineas((ls) => ls.map((l) => (l.servicio_id && nuevo?.precios[l.servicio_id] !== undefined ? { ...l, precio: nuevo.precios[l.servicio_id] } : l)));
  }

  function enviar() {
    if (!validacion.ok) {
      setError(validacion.error);
      return;
    }
    setError(null);
    empezar(async () => {
      const r = await cobrar({
        cita_id: cita?.id ?? null,
        barbero_id: cita ? null : barberoId || null,
        cliente_id: null,
        clave,
        items: lineas.map((l) => (l.servicio_id ? { servicio_id: l.servicio_id, precio: l.precio } : { nombre: l.nombre, precio: l.precio })),
        descuento: descuentoReal,
        descuento_motivo: descuentoReal > 0 ? motivo : "",
        propina,
        pagos: pagos.map((p) => ({ medio: p.medio, monto: p.monto, recibido: p.recibido, referencia: p.referencia })),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCobrado(r.datos);
    });
  }

  const volverA = cita ? `/agenda/cita/${cita.id}` : "/caja";
  if (cobrado) {
    return <ConfirmacionCobro cobrado={cobrado} volverA="/caja" volverTexto="Listo" />;
  }
  if (bloqueo && cita) {
    const cobrada = bloqueo.tipo === "cobrada";
    return (
      <>
        <EncabezadoTarea titulo="Cobrar" volverA={volverA} />
        <main className="space-y-4 px-4 pt-6">
          <h1 className="text-2xl font-semibold tracking-tight">{cobrada ? "Esta cita ya está cobrada" : "Esta cita no se cobra"}</h1>
          <p className="text-base text-tinta-2">
            {cobrada
              ? `La cita de ${cita.cliente} ya tiene su cobro.`
              : `La cita de ${cita.cliente} está ${bloqueo.tipo === "no_cobrable" && bloqueo.estado === "cancelada" ? "cancelada" : "marcada como que no asistió"}. Si sí se atendió, reactívala primero en la agenda.`}
          </p>
          <Link
            href={bloqueo.tipo === "cobrada" ? `/caja/cobro/${bloqueo.cobroId}` : `/agenda/cita/${cita.id}`}
            className={botonVariantes({ tamano: "lg", bloque: true })}
          >
            {cobrada ? "Ver el cobro" : "Volver a la cita"}
          </Link>
        </main>
      </>
    );
  }

  // El botón principal dice exactamente qué va a pasar.
  let etiqueta: string;
  let puedeCobrar = validacion.ok && !enviando && lineas.length > 0 && (cita !== null || barberoId !== "");
  if (lineas.length === 0) etiqueta = "Agrega qué se cobra";
  else if (aCobrar === 0) etiqueta = "Registrar cortesía";
  else if (medio === "efectivo") {
    etiqueta =
      recibido === 0 ? "Escribe lo que recibes" : efectivo.alcanza ? `Cobrar · vuelto ${formatearPesos(efectivo.vuelto)}` : `Faltan ${formatearPesos(efectivo.falta)}`;
  } else {
    etiqueta = conParteEfectivo && pagaAhora === 0 ? "Escribe cuánto paga en efectivo" : `Cobrar ${formatearPesos(aCobrar)}`;
    puedeCobrar = puedeCobrar && !(conParteEfectivo && pagaAhora === 0);
  }
  if (enviando) etiqueta = "Cobrando…";

  const lineaEnPrecio = typeof hoja === "object" && hoja !== null ? lineas.find((l) => l.id === hoja.precioDe) : undefined;

  return (
    <div>
      <EncabezadoTarea titulo="Cobrar" volverA={volverA} />

      <main className="space-y-3 px-4 pb-40 pt-3">
        {/* Quién y a qué hora */}
        {cita ? (
          <p className="text-base text-tinta-2">
            <strong className="font-semibold text-tinta">{cita.cliente}</strong> · {horaCorta(cita.inicio)} · con {cita.barbero}
          </p>
        ) : (
          <div>
            <Label htmlFor="barbero_venta">Quién atendió</Label>
            <select id="barbero_venta" value={barberoId} onChange={(e) => elegirBarbero(e.target.value)} className={SELECT}>
              {barberos.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Total a cobrar, qué incluye y los dos ajustes */}
        <section aria-label="Total a cobrar" className="rounded-xl border border-linea bg-superficie p-4">
          <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">A cobrar</p>
          <p className="text-5xl font-semibold tracking-tight">{formatearPesos(aCobrar)}</p>

          <button
            type="button"
            onClick={() => setHoja("lineas")}
            className="mt-3 flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border border-linea px-3 text-left active:bg-hueso"
          >
            <span className="min-w-0 text-base">
              {lineas.length === 0 ? (
                <span className="text-tinta-2">Nada todavía</span>
              ) : (
                <>
                  <span className="block truncate font-medium">{lineas[0].nombre}</span>
                  {lineas.length > 1 && <span className="block text-base text-tinta-2">y {lineas.length - 1} más</span>}
                </>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-base font-medium text-tinta-2">
              {lineas.length === 0 ? "Agregar" : "Cambiar"}
              <ChevronRight className="size-5" aria-hidden />
            </span>
          </button>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setHoja("descuento")}
              disabled={subtotal === 0}
              className="min-h-12 rounded-xl border border-linea px-3 py-1.5 text-left text-base leading-tight active:bg-hueso disabled:border-dashed disabled:border-zinc-300 disabled:bg-hueso disabled:text-tinta-2"
            >
              <span className="block text-base text-tinta-2">Descuento</span>
              <span className="block font-medium">{descuentoReal > 0 ? `− ${formatearPesos(descuentoReal)}` : "Sin"}</span>
            </button>
            <button
              type="button"
              onClick={() => setHoja("propina")}
              className="min-h-12 rounded-xl border border-linea px-3 py-1.5 text-left text-base leading-tight active:bg-hueso"
            >
              <span className="block text-base text-tinta-2">Propina</span>
              <span className="block font-medium">{propina > 0 ? formatearPesos(propina) : "Sin"}</span>
            </button>
          </div>
        </section>

        {aCobrar > 0 && (
          <>
            <Segmentado<MedioPago>
              etiqueta="Cómo paga"
              valor={medio}
              onCambio={cambiarMedio}
              opciones={[
                { valor: "efectivo", etiqueta: "Efectivo" },
                { valor: "transferencia", etiqueta: "Nequi" },
              ]}
            />

            {medio === "efectivo" && (
              <>
                <div className="flex items-center justify-between gap-2 rounded-xl border border-linea bg-superficie px-4 py-2">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">Recibido</p>
                    <p className="text-3xl font-semibold tracking-tight">{formatearPesos(recibido)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">
                      {recibido === 0 || efectivo.alcanza ? "Vuelto" : "Faltan"}
                    </p>
                    <p className={cn("text-3xl font-semibold tracking-tight", recibido > 0 && !efectivo.alcanza && "text-rojo")}>
                      {formatearPesos(recibido === 0 ? 0 : efectivo.alcanza ? efectivo.vuelto : efectivo.falta)}
                    </p>
                  </div>
                </div>
                <div className="grid auto-cols-fr grid-flow-col gap-1.5">
                  {atajosEfectivo(aCobrar).map((valor, i) => (
                    <button
                      key={valor}
                      type="button"
                      data-guia={i === 0 ? "exacto" : undefined}
                      onClick={() => setRecibido(valor)}
                      className={cn(
                        "min-h-12 rounded-xl border px-1 text-base font-medium leading-tight",
                        recibido === valor ? "border-tinta bg-tinta text-papel" : "border-linea bg-superficie active:bg-hueso"
                      )}
                    >
                      {i === 0 && valor === aCobrar ? "Exacto" : formatearPesos(valor).replace("$ ", "")}
                    </button>
                  ))}
                </div>
                <TecladoNumerico onTecla={(t) => setRecibido((v) => aplicarTecla(v, t))} />
              </>
            )}

            {medio === "transferencia" && (
              <>
                <div className="rounded-xl border border-linea bg-superficie p-4">
                  <p className="text-base font-medium leading-tight">Nequi, Daviplata o transferencia del banco</p>
                  {!conParteEfectivo && <p className="mt-1 text-base text-tinta-2">Confirma que el dinero llegó antes de cobrar.</p>}
                  <Label htmlFor="referencia" className="mt-3">
                    Referencia (opcional)
                  </Label>
                  <Input
                    id="referencia"
                    value={referencia}
                    onChange={(e) => setReferencia(e.target.value)}
                    maxLength={60}
                    placeholder="Ej. M1234567"
                    autoCapitalize="characters"
                    autoComplete="off"
                  />
                </div>
                {conParteEfectivo ? (
                  <>
                    <div className="rounded-xl border border-linea bg-superficie px-4 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">Paga en efectivo</p>
                          <p className="text-3xl font-semibold tracking-tight">{formatearPesos(pagaAhora)}</p>
                        </div>
                        <Button
                          variante="fantasma"
                          onClick={() => {
                            setConParteEfectivo(false);
                            setPagaAhora(0);
                          }}
                        >
                          Quitar
                        </Button>
                      </div>
                      <p className="mt-1 flex items-baseline justify-between border-t border-dashed border-zinc-300 pt-2 text-base">
                        <span>El resto, por Nequi</span>
                        <span className="text-xl font-semibold">{formatearPesos(aCobrar - pagaAhora)}</span>
                      </p>
                    </div>
                    <TecladoNumerico onTecla={(t) => setPagaAhora((v) => Math.min(aplicarTecla(v, t), aCobrar - 1))} />
                  </>
                ) : (
                  <Button variante="secundario" bloque onClick={() => setConParteEfectivo(true)}>
                    <Banknote className="size-5" aria-hidden />
                    Paga una parte en efectivo
                  </Button>
                )}
              </>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-rojo bg-superficie p-3 text-base font-semibold text-rojo">
            {error}
          </p>
        )}
      </main>

      <BarraAccion>
        <Button tamano="lg" bloque disabled={!puedeCobrar} onClick={enviar}>
          {medio === "transferencia" && aCobrar > 0 && <Smartphone className="size-5" aria-hidden />}
          {etiqueta}
        </Button>
      </BarraAccion>

      {hoja === "lineas" && (
        <HojaLineas
          lineas={lineas}
          alEditarPrecio={(id) => setHoja({ precioDe: id })}
          alQuitar={(id) => setLineas((ls) => ls.filter((l) => l.id !== id))}
          alAgregarServicio={() => setHoja("servicio")}
          alAgregarExtra={() => setHoja("extra")}
          onCerrar={() => setHoja(null)}
        />
      )}
      {hoja === "servicio" && (
        <HojaServicio
          servicios={servicios.map((s) => ({ ...s, precio: precioDe(s.id, s.precio) }))}
          alElegir={(s) => {
            setLineas((ls) => [...ls, { id: crypto.randomUUID(), servicio_id: s.id, nombre: s.nombre, precio: s.precio }]);
            setHoja("lineas");
          }}
          onCerrar={() => setHoja("lineas")}
        />
      )}
      {hoja === "extra" && (
        <HojaExtra
          alAgregar={(nombre, precio) => {
            setLineas((ls) => [...ls, { id: crypto.randomUUID(), servicio_id: null, nombre, precio }]);
            setHoja("lineas");
          }}
          onCerrar={() => setHoja("lineas")}
        />
      )}
      {lineaEnPrecio && (
        <HojaMonto
          titulo={`Precio de ${lineaEnPrecio.nombre}`}
          inicial={lineaEnPrecio.precio}
          max={PRECIO_MAXIMO}
          atajos={lineaEnPrecio.servicio_id ? [{ etiqueta: "Gratis", valor: 0 }] : []}
          puedeAceptar={(v) => v > 0 || lineaEnPrecio.servicio_id !== null}
          alAceptar={(v) => {
            setLineas((ls) => ls.map((l) => (l.id === lineaEnPrecio.id ? { ...l, precio: v } : l)));
            setHoja("lineas");
          }}
          onCerrar={() => setHoja("lineas")}
        />
      )}
      {hoja === "descuento" && (
        <HojaMonto
          titulo="Descuento"
          inicial={descuentoReal}
          max={subtotal}
          atajos={[
            { etiqueta: "Sin", valor: 0 },
            { etiqueta: "10 %", valor: porcentajeDe(subtotal, 10) },
            { etiqueta: "20 %", valor: porcentajeDe(subtotal, 20) },
            { etiqueta: "Todo", valor: subtotal },
          ]}
          puedeAceptar={(v) => v === 0 || motivo.trim() !== ""}
          alAceptar={(v) => {
            setDescuento(v);
            if (v === 0) setMotivo("");
            setHoja(null);
          }}
          onCerrar={() => setHoja(null)}
        >
          <div>
            <Label htmlFor="motivo_descuento">Motivo (obligatorio con descuento)</Label>
            <Input
              id="motivo_descuento"
              value={motivo}
              maxLength={120}
              autoComplete="off"
              placeholder="Cliente frecuente, promoción…"
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        </HojaMonto>
      )}
      {hoja === "propina" && (
        <HojaMonto
          titulo="Propina"
          inicial={propina}
          max={PROPINA_MAXIMA}
          atajos={[
            { etiqueta: "Sin", valor: 0 },
            { etiqueta: "1.000", valor: 1000 },
            { etiqueta: "2.000", valor: 2000 },
            { etiqueta: "5.000", valor: 5000 },
          ]}
          alAceptar={(v) => {
            setPropina(v);
            setPagaAhora((p) => Math.min(p, Math.max(0, cuenta.total + v - 1)));
            setHoja(null);
          }}
          onCerrar={() => setHoja(null)}
        />
      )}
    </div>
  );
}
