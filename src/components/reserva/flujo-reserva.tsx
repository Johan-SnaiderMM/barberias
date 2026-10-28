"use client";

import { useActionState, useState, useTransition } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { huecosPublicos, reservar } from "@/app/acciones/reserva";
import { PieLegal } from "@/components/legal/pie-legal";
import { SelectorDiaHora } from "@/components/reserva/selector-dia-hora";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { textoDuracion } from "@/lib/catalogo";
import { formatearPesos } from "@/lib/dinero";
import { fechaBogota, fechaLarga, horaCorta } from "@/lib/fechas";
import type { BarberiaPublica, BarberoPublico, EstadoReserva, HuecoPublico, ServicioPublico } from "@/lib/tipos/reserva";
import { enlaceWhatsappA } from "@/lib/whatsapp";

type Paso = "servicio" | "barbero" | "hora" | "datos";
const NUMERO: Record<Paso, number> = { servicio: 1, barbero: 2, hora: 3, datos: 4 };
/** "El primero disponible": la base elige al barbero con menos citas ese día. */
const CUALQUIERA = "cualquiera";
/** Cada recarga de "buscar más adelante" salta este número de días. */
const SALTO_DIAS = 31;

/**
 * La reserva sin cuenta, en una sola mano: servicio → barbero → día y hora → nombre y celular. Las horas libres las
 * calcula la base (`publico_huecos`); aquí solo se muestran. Todos los campos son controlados: si la base rechaza
 * (hora tomada, celular mal escrito) la persona no pierde lo que escribió.
 */
export function FlujoReserva({
  barberia,
  servicios,
  barberos,
  hoy,
}: {
  barberia: BarberiaPublica;
  servicios: ServicioPublico[];
  barberos: BarberoPublico[];
  hoy: string;
}) {
  const [paso, setPaso] = useState<Paso>("servicio");
  const [servicioId, setServicioId] = useState<string | null>(null);
  const [barberoId, setBarberoId] = useState<string>(CUALQUIERA);
  const [huecos, setHuecos] = useState<HuecoPublico[]>([]);
  const [desde, setDesde] = useState(0);
  const [errorHuecos, setErrorHuecos] = useState<string | null>(null);
  const [cargando, iniciarCarga] = useTransition();
  const [elegido, setElegido] = useState<HuecoPublico | null>(null);

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [consentimiento, setConsentimiento] = useState(false);
  const [web, setWeb] = useState("");
  const [estado, accion, enviando] = useActionState<EstadoReserva, FormData>(reservar, { error: null });

  const servicio = servicios.find((s) => s.id === servicioId) ?? null;
  const barberosDelServicio = barberos.filter((b) => b.servicios.some((s) => s.servicio_id === servicioId));
  // Quien va a atender: el que se eligió o, con "el primero disponible", el que la base asignó a la hora elegida.
  const atiende = barberos.find((b) => b.id === (barberoId === CUALQUIERA ? elegido?.barbero_id : barberoId)) ?? null;
  const detalleAtiende = atiende?.servicios.find((s) => s.servicio_id === servicioId) ?? null;

  const whatsapp = enlaceWhatsappA(barberia.whatsapp, `Hola, quiero reservar una cita en ${barberia.nombre}.`);

  /** Pide las horas a la base. `acumular` suma las de "buscar más adelante" a las que ya hay. */
  function cargar(servicio: string, quien: string, desdeDias: number, acumular: boolean) {
    setErrorHuecos(null);
    iniciarCarga(async () => {
      const r = await huecosPublicos(barberia.slug, servicio, quien === CUALQUIERA ? null : quien, desdeDias);
      if (!r.ok) {
        setErrorHuecos(r.error);
        return;
      }
      setDesde(desdeDias);
      setHuecos((previas) => (acumular ? [...previas, ...r.huecos] : r.huecos));
    });
  }

  function elegirServicio(id: string) {
    setServicioId(id);
    setElegido(null);
    const quienes = barberos.filter((b) => b.servicios.some((s) => s.servicio_id === id));
    if (quienes.length === 1) {
      // Un solo barbero lo hace: no hay nada que elegir.
      setBarberoId(quienes[0].id);
      setHuecos([]);
      cargar(id, quienes[0].id, 0, false);
      setPaso("hora");
    } else {
      setBarberoId(CUALQUIERA);
      setPaso("barbero");
    }
  }

  function elegirBarbero(id: string) {
    setBarberoId(id);
    setElegido(null);
    setHuecos([]);
    if (servicioId) cargar(servicioId, id, 0, false);
    setPaso("hora");
  }

  function recargarHoras() {
    setElegido(null);
    setHuecos([]);
    if (servicioId) cargar(servicioId, barberoId, 0, false);
    setPaso("hora");
  }

  function atras() {
    if (paso === "datos") setPaso("hora");
    else if (paso === "hora") setPaso(barberosDelServicio.length === 1 ? "servicio" : "barbero");
    else if (paso === "barbero") setPaso("servicio");
  }

  // La hora la tomaron mientras la persona escribía sus datos: se le dice y se recargan las horas con un toque.
  const horaTomada = estado.motivo === "hora_ocupada" || estado.motivo === "cerrado";

  const precioCualquiera = (() => {
    const precios = barberosDelServicio.flatMap((b) => b.servicios.filter((s) => s.servicio_id === servicioId).map((s) => s.precio));
    if (precios.length === 0) return null;
    const min = Math.min(...precios);
    return { precio: min, varia: precios.some((p) => p !== min) };
  })();

  return (
    <div className="px-4 pb-32 pt-[calc(1rem+env(safe-area-inset-top,0px))]">
      <header>
        <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">{barberia.nombre}</p>
        <h1 className="mt-1 text-3xl font-semibold leading-tight tracking-tight">Reserva tu cita</h1>
        <p className="mt-1 text-base text-tinta-2">Paso {NUMERO[paso]} de 4</p>
      </header>

      {paso !== "servicio" && (
        <button
          type="button"
          onClick={atras}
          className="mt-3 -ml-2 flex min-h-12 items-center gap-2 rounded-xl px-2 text-base font-medium text-tinta-2 active:bg-hueso"
        >
          <ArrowLeft className="size-5" aria-hidden />
          Atrás
        </button>
      )}

      {paso === "servicio" && (
        <section className="mt-5">
          <h2 className="mb-2 text-lg font-semibold">¿Qué te hacemos?</h2>
          <ul className="space-y-3">
            {servicios.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => elegirServicio(s.id)}
                  className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-linea bg-white px-4 py-3 text-left active:bg-hueso"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-medium leading-tight">{s.nombre}</span>
                    <span className="mt-0.5 block text-base text-tinta-2">{textoDuracion(s.duracion_min)}</span>
                  </span>
                  <span className="text-base font-medium">{formatearPesos(s.precio)}</span>
                  <ChevronRight className="size-5 shrink-0 text-zinc-400" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {paso === "barbero" && servicio && (
        <section className="mt-3">
          <h2 className="mb-2 text-lg font-semibold">¿Con quién?</h2>
          <ul className="space-y-3">
            <li>
              <button
                type="button"
                onClick={() => elegirBarbero(CUALQUIERA)}
                className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-tinta bg-white px-4 py-3 text-left active:bg-hueso"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium leading-tight">El primero disponible</span>
                  <span className="mt-0.5 block text-base text-tinta-2">Te asignamos a quien tenga la hora</span>
                </span>
                {precioCualquiera && (
                  <span className="text-base font-medium">
                    {precioCualquiera.varia ? "desde " : ""}
                    {formatearPesos(precioCualquiera.precio)}
                  </span>
                )}
                <ChevronRight className="size-5 shrink-0 text-zinc-400" aria-hidden />
              </button>
            </li>
            {barberosDelServicio.map((b) => {
              const d = b.servicios.find((s) => s.servicio_id === servicio.id)!;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => elegirBarbero(b.id)}
                    className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-linea bg-white px-4 py-3 text-left active:bg-hueso"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-medium leading-tight">{b.nombre}</span>
                      <span className="mt-0.5 block text-base text-tinta-2">{textoDuracion(d.duracion_min)}</span>
                    </span>
                    <span className="text-base font-medium">{formatearPesos(d.precio)}</span>
                    <ChevronRight className="size-5 shrink-0 text-zinc-400" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {paso === "hora" && (
        <section className="mt-3">
          <h2 className="mb-3 text-lg font-semibold">¿Cuándo?</h2>
          {cargando && huecos.length === 0 && (
            <p className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
              Buscando horas libres…
            </p>
          )}
          {errorHuecos && (
            <p role="alert" className="text-base font-semibold text-rojo">
              {errorHuecos}
            </p>
          )}
          {!cargando && !errorHuecos && huecos.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-4 text-base text-tinta-2">
              <p>No hay horas libres en estos días.</p>
              {desde + SALTO_DIAS <= barberia.dias_adelante && servicioId && (
                <Button
                  variante="secundario"
                  bloque
                  className="mt-3"
                  onClick={() => cargar(servicioId, barberoId, desde + SALTO_DIAS, true)}
                >
                  Buscar más adelante
                </Button>
              )}
              {whatsapp && (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="mt-3 block font-medium underline">
                  Escríbenos por WhatsApp
                </a>
              )}
            </div>
          )}
          {huecos.length > 0 && (
            <>
              <SelectorDiaHora huecos={huecos} hoy={hoy} elegido={elegido?.inicio ?? null} onElegir={setElegido} />
              {desde + SALTO_DIAS <= barberia.dias_adelante && servicioId && (
                <button
                  type="button"
                  disabled={cargando}
                  onClick={() => cargar(servicioId, barberoId, desde + SALTO_DIAS, true)}
                  className="mt-3 min-h-12 w-full rounded-xl text-base font-medium text-tinta-2 underline underline-offset-4 active:bg-hueso"
                >
                  {cargando ? "Buscando…" : "Buscar más adelante"}
                </button>
              )}
            </>
          )}
          <BarraAccion>
            <Button tamano="lg" bloque disabled={!elegido} onClick={() => elegido && setPaso("datos")}>
              {elegido ? `Continuar · ${horaCorta(elegido.inicio)}` : "Elige una hora"}
            </Button>
          </BarraAccion>
        </section>
      )}

      {paso === "datos" && servicio && elegido && (
        <form action={accion} className="mt-3 space-y-5">
          <input type="hidden" name="slug" value={barberia.slug} />
          <input type="hidden" name="servicio_id" value={servicio.id} />
          <input type="hidden" name="barbero_id" value={barberoId === CUALQUIERA ? "" : barberoId} />
          <input type="hidden" name="inicio" value={elegido.inicio} />
          <input type="hidden" name="nombre" value={nombre} />
          <input type="hidden" name="telefono" value={telefono} />
          <input type="hidden" name="consentimiento" value={consentimiento ? "1" : "0"} />

          <h2 className="text-lg font-semibold">Tus datos</h2>

          <dl className="divide-y divide-hueso rounded-xl border border-linea bg-white">
            <Fila etiqueta="Servicio" valor={servicio.nombre} />
            <Fila etiqueta="Con" valor={atiende?.nombre ?? "El primero disponible"} />
            <Fila etiqueta="Día" valor={fechaLarga(fechaBogota(elegido.inicio))} />
            <Fila etiqueta="Hora" valor={horaCorta(elegido.inicio)} />
            {detalleAtiende && <Fila etiqueta="Precio" valor={formatearPesos(detalleAtiende.precio)} />}
          </dl>

          <div>
            <Label htmlFor="nombre_reserva">Tu nombre</Label>
            <Input
              id="nombre_reserva"
              value={nombre}
              maxLength={60}
              autoComplete="name"
              placeholder="Juan Pérez"
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="celular_reserva">Tu celular</Label>
            <Input
              id="celular_reserva"
              value={telefono}
              maxLength={30}
              inputMode="tel"
              autoComplete="tel"
              placeholder="300 123 4567"
              onChange={(e) => setTelefono(e.target.value)}
            />
            <p className="mt-1 text-base text-tinta-2">Es para avisarte si algo cambia con tu cita.</p>
          </div>

          {/* Campo trampa: las personas no lo ven; los robots lo llenan. */}
          <div aria-hidden className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
            <label>
              No llenar este campo
              <input
                type="text"
                name="web"
                tabIndex={-1}
                autoComplete="off"
                value={web}
                onChange={(e) => setWeb(e.target.value)}
              />
            </label>
          </div>

          <label className="flex min-h-14 items-start gap-3 rounded-xl border border-linea bg-white px-4 py-3">
            <input
              type="checkbox"
              checked={consentimiento}
              onChange={(e) => setConsentimiento(e.target.checked)}
              className="mt-0.5 size-6 shrink-0 accent-tinta"
            />
            <span className="text-base leading-snug">
              Autorizo a {barberia.nombre} a tratar mi nombre y mi celular para gestionar mi cita, según el aviso de privacidad y la
              política de datos.
            </span>
          </label>
          <PieLegal slug={barberia.slug} />

          {estado.error && (
            <div role="alert" className="rounded-xl border border-rojo bg-white p-3 text-base">
              <p className="font-semibold text-rojo">{estado.error}</p>
              {horaTomada && (
                <Button variante="secundario" bloque className="mt-3" onClick={recargarHoras}>
                  Elegir otra hora
                </Button>
              )}
            </div>
          )}

          <BarraAccion>
            <Button
              type="submit"
              tamano="lg"
              bloque
              disabled={enviando || nombre.trim() === "" || telefono.trim() === "" || !consentimiento}
            >
              {enviando ? "Reservando…" : "Confirmar reserva"}
            </Button>
          </BarraAccion>
        </form>
      )}
    </div>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-sm font-medium uppercase tracking-wider text-tinta-2">{etiqueta}</dt>
      <dd className="text-right text-base font-medium">{valor}</dd>
    </div>
  );
}
