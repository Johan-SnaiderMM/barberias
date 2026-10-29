import Link from "@/components/ui/enlace";
import { Plus, Wallet } from "lucide-react";
import { BarraAccion } from "@/components/layout/barra-accion";
import { EnlaceFila } from "@/components/layout/enlace-fila";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { botonVariantes } from "@/components/ui/button";
import { obtenerCaja } from "@/lib/datos/caja";
import { ETIQUETA_MEDIO, formatearPesos } from "@/lib/dinero";
import { fechaBogota, fechaCorta, fechaLarga, horaCorta, hoyBogota } from "@/lib/fechas";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Caja" };

export default async function Caja() {
  const { permitido } = await revisarPermiso("caja");
  if (!permitido) return <SinPermiso />;

  const caja = await obtenerCaja();
  const t = caja.totales;
  const hay = caja.por_cobrar.length + caja.atrasadas.length + caja.cobros.length > 0;
  const hoy = hoyBogota();
  // Después de cerrar el día, lo que se cobra cuenta para el siguiente: la caja muestra ese día, no el cerrado.
  const yaCerrado = caja.fecha > hoy;
  // Lo que resalta el recorrido guiado: la primera cita que se puede cobrar (si no hay, el botón de venta sin cita).
  const citaDeLaGuia = (caja.por_cobrar[0] ?? caja.atrasadas[0])?.id;

  return (
    <main className="px-4 pb-48 pt-[calc(1.25rem+env(safe-area-inset-top,0px))]">
      <p className="text-base font-semibold text-tinta-2">{fechaLarga(hoy)}</p>
      <h1 className="mt-1 text-3xl font-semibold leading-tight tracking-tight">Caja</h1>

      {yaCerrado && (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
          Ya cerraste el día de hoy: lo que cobres ahora cuenta para el {fechaLarga(caja.fecha).toLowerCase()}.
        </p>
      )}

      <section className="mt-4 rounded-xl border border-linea bg-white p-4" aria-label="Lo cobrado hoy">
        <div className="flex items-center gap-2 text-tinta-2">
          <Wallet className="size-5" aria-hidden />
          <p className="text-sm font-medium uppercase tracking-wider">{yaCerrado ? `Cobrado el ${fechaCorta(caja.fecha)}` : "Cobrado hoy"}</p>
        </div>
        <p className="mt-1 text-4xl font-semibold tracking-tight">{formatearPesos(t.servicios + t.propinas)}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-hueso pt-3 text-base">
          <Dato etiqueta={ETIQUETA_MEDIO.efectivo} valor={formatearPesos(t.efectivo)} />
          <Dato etiqueta="Nequi" valor={formatearPesos(t.transferencia)} />
          <Dato etiqueta="Servicios" valor={formatearPesos(t.servicios)} />
          <Dato etiqueta="Propinas" valor={formatearPesos(t.propinas)} />
        </dl>
        <p className="mt-2 text-base text-tinta-2">{t.cobros === 1 ? "1 cobro" : `${t.cobros} cobros`}</p>
      </section>

      {caja.atrasadas.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-rojo">Sin cobrar de días anteriores</h2>
          <ul className="mt-2 space-y-3">
            {caja.atrasadas.map((c) => (
              <li key={c.id}>
                <EnlaceFila
                  href={`/caja/cobrar/${c.id}`}
                  titulo={`${fechaCorta(fechaBogota(c.inicio))} · ${c.cliente}`}
                  detalle={`${c.servicio} · con ${c.barbero} · ${formatearPesos(c.precio)}`}
                  guia={c.id === citaDeLaGuia ? "cobrar" : undefined}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Por cobrar</h2>
        {caja.por_cobrar.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
            {hay ? "No queda nada por cobrar hoy." : "Hoy no hay citas por cobrar."}
          </p>
        ) : (
          <ul className="mt-2 space-y-3">
            {caja.por_cobrar.map((c) => (
              <li key={c.id}>
                <EnlaceFila
                  href={`/caja/cobrar/${c.id}`}
                  titulo={`${horaCorta(c.inicio)} · ${c.cliente}`}
                  detalle={`${c.servicio} · con ${c.barbero} · ${formatearPesos(c.precio)}`}
                  guia={c.id === citaDeLaGuia ? "cobrar" : undefined}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {caja.cobros.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Cobrados hoy</h2>
          <ul className="mt-2 space-y-3">
            {caja.cobros.map((k) => (
              <li key={k.id}>
                <EnlaceFila
                  href={`/caja/cobro/${k.id}`}
                  titulo={`${k.cliente ?? "Sin cita"} · ${formatearPesos(k.total + k.propina)}`}
                  detalle={`${horaCorta(k.created_at)} · ${k.medios.map((m) => (m === "efectivo" ? "Efectivo" : "Nequi")).join(" + ") || "Cortesía"} · ${k.barbero}${k.anulado ? " · ANULADO" : ""}`}
                  tenue={k.anulado}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <BarraAccion conNavegacion>
        <Link
          href="/caja/venta"
          data-guia={citaDeLaGuia ? undefined : "cobrar"}
          className={botonVariantes({ tamano: "lg", bloque: true })}
        >
          <Plus className="size-5" aria-hidden />
          Venta sin cita
        </Link>
      </BarraAccion>
    </main>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-tinta-2">{etiqueta}</dt>
      <dd className="font-semibold">{valor}</dd>
    </div>
  );
}
