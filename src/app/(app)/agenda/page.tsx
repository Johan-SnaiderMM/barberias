import Link from "next/link";
import { CalendarOff, Plus, UserPlus } from "lucide-react";
import { SelectorDia } from "@/components/layout/selector-dia";
import { TarjetaCita } from "@/components/agenda/tarjeta-cita";
import { BarraAccion } from "@/components/layout/barra-accion";
import { EnlaceFila } from "@/components/layout/enlace-fila";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { botonVariantes } from "@/components/ui/button";
import { alcanceAgenda } from "@/lib/areas";
import { porCerrar } from "@/lib/citas";
import { listarBarberos } from "@/lib/datos/barberos";
import { listarCitas } from "@/lib/datos/citas";
import { barberoPropio } from "@/lib/datos/mi-barbero";
import { hoyBogota } from "@/lib/fechas";
import { revisarPermiso } from "@/lib/permisos";
import { ahoraMs as leerAhora } from "@/lib/reloj";
import { cn } from "@/lib/utils";

export const metadata = { title: "Agenda" };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export default async function Agenda({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; barbero?: string }>;
}) {
  const { quien, permitido } = await revisarPermiso("agenda");
  if (!permitido) return <SinPermiso />;

  const alcance = alcanceAgenda(quien.areas);
  const parametros = await searchParams;
  const hoy = hoyBogota();
  const fecha = parametros.fecha && FECHA.test(parametros.fecha) ? parametros.fecha : hoy;

  const barberos = await listarBarberos(false);
  const propio = alcance === "propia" ? await barberoPropio(barberos) : null;
  // Quien ve la agenda de todos puede filtrar por barbero; el barbero ve solo la suya (lo decide la base).
  const filtro =
    alcance === "todos" && parametros.barbero && barberos.some((b) => b.id === parametros.barbero)
      ? parametros.barbero
      : null;

  const citas = await listarCitas({ desde: fecha, barbero: filtro ?? undefined, conCanceladas: true });
  const ahoraMs = leerAhora();
  const vigentes = citas.filter((c) => c.estado !== "cancelada");
  // La que resalta el recorrido guiado: la primera que no está cancelada ni quedó sin asistir.
  const citaDeLaGuia = citas.find((c) => c.estado !== "cancelada" && c.estado !== "no_asistio")?.id;
  const pendientes = vigentes.filter((c) => porCerrar(c, ahoraMs));
  const sinCuenta = alcance === "propia" && !propio;
  const titulo = alcance === "propia" ? "Mi día" : "Agenda";
  const nueva = `/agenda/nueva?fecha=${fecha}${filtro ? `&barbero=${filtro}` : ""}`;

  return (
    <main className="px-4 pb-44 pt-[calc(1.25rem+env(safe-area-inset-top,0px))]">
      <h1 className="text-3xl font-semibold tracking-tight leading-tight">{titulo}</h1>

      <div className="mt-4">
        <SelectorDia fecha={fecha} hoy={hoy} barbero={filtro} />
      </div>

      {alcance === "todos" && barberos.length > 1 && (
        <nav aria-label="Barbero" className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {[{ id: null as string | null, nombre: "Todos" }, ...barberos].map((b) => {
            const activo = (b.id ?? null) === filtro;
            return (
              <Link
                key={b.id ?? "todos"}
                href={`/agenda?fecha=${fecha}${b.id ? `&barbero=${b.id}` : ""}`}
                aria-current={activo ? "true" : undefined}
                className={cn(
                  "flex min-h-12 shrink-0 items-center rounded-xl border px-4 text-base font-semibold",
                  activo ? "border-tinta bg-tinta text-papel" : "border-linea bg-papel text-tinta active:bg-hueso"
                )}
              >
                {b.nombre}
              </Link>
            );
          })}
        </nav>
      )}

      {sinCuenta ? (
        <section className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-hueso p-4">
          <h2 className="text-xl font-semibold tracking-tight">Tu cuenta todavía no es de un barbero</h2>
          <p className="mt-2 text-base text-tinta-2">
            Para ver «Mi día», el dueño debe vincular tu cuenta con tu nombre de barbero (Más → Barberos).
          </p>
        </section>
      ) : (
        <>
          {pendientes.length > 0 && (
            <p role="status" className="mt-4 rounded-xl border border-rojo bg-white px-4 py-3 text-base font-semibold text-rojo">
              {pendientes.length === 1
                ? "Hay 1 cita por cerrar: di si se atendió o no llegó."
                : `Hay ${pendientes.length} citas por cerrar: di si se atendieron o no llegaron.`}
            </p>
          )}

          <p className="mt-4 text-base text-tinta-2">
            {vigentes.length === 0
              ? "Sin citas este día."
              : vigentes.length === 1
                ? "1 cita este día."
                : `${vigentes.length} citas este día.`}
          </p>

          {citas.length === 0 ? (
            <section className="mt-3 rounded-xl border border-dashed border-zinc-300 bg-hueso p-4">
              <p className="text-base text-tinta-2">
                Nada agendado. Toca «Nueva cita» para apartar una hora, o «Llegó sin cita» si el cliente ya está aquí.
              </p>
            </section>
          ) : (
            <ul className="mt-3 space-y-3">
              {citas.map((c) => (
                <li key={c.id}>
                  <TarjetaCita
                    cita={c}
                    ahoraMs={ahoraMs}
                    mostrarBarbero={alcance === "todos" && filtro === null}
                    guia={c.id === citaDeLaGuia ? "cita" : undefined}
                  />
                </li>
              ))}
            </ul>
          )}

          {propio && (
            <div className="mt-6">
              <EnlaceFila
                href={`/barberos/${propio.id}/bloqueos`}
                titulo="Bloquear mi horario"
                detalle="Un día libre, una cita médica, vacaciones"
                Icono={CalendarOff}
              />
            </div>
          )}
        </>
      )}

      {!sinCuenta && (
        <BarraAccion conNavegacion fila>
          <Link href={nueva} className={botonVariantes({ tamano: "lg" })}>
            <Plus className="size-5" aria-hidden />
            Nueva cita
          </Link>
          <Link href="/agenda/sin-reserva" className={botonVariantes({ variante: "secundario", tamano: "lg" })}>
            <UserPlus className="size-5" aria-hidden />
            Sin cita
          </Link>
        </BarraAccion>
      )}
    </main>
  );
}
