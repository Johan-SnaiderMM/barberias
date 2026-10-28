import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { AnularCobro } from "@/components/caja/anular-cobro";
import { BarraAccion } from "@/components/layout/barra-accion";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { botonVariantes } from "@/components/ui/button";
import { puedeVer } from "@/lib/areas";
import { datosCobro, obtenerCobro } from "@/lib/datos/caja";
import { formatearPesos, repartoDeCobro } from "@/lib/dinero";
import { fechaBogota, fechaCorta, fechaLarga, horaCorta } from "@/lib/fechas";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Cobro" };

/** Un cobro: qué se cobró, cómo se pagó y de quién es. Se puede anular con motivo (y la cita se reabre). */
export default async function DetalleCobro({ params }: { params: Promise<{ id: string }> }) {
  const { quien, permitido } = await revisarPermiso("caja");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const cobro = await obtenerCobro(id);
  if (!cobro) notFound();

  const entro = cobro.total + cobro.propina;
  // Lo que gana el barbero solo lo ve quien maneja las comisiones (no todo el que cobra).
  const verReparto = puedeVer(quien, "porcentajes");
  const reparto = repartoDeCobro({
    total: cobro.total,
    comision: cobro.comision,
    propina: cobro.propina,
    propinaBarbero: cobro.propina_barbero,
  });
  // Un cobro anulado de una cita: ¿ya se volvió a cobrar? Si no, se ofrece cobrarla de nuevo.
  const nuevoCobro = cobro.anulado && cobro.cita_id ? (await datosCobro(cobro.cita_id)).cobro_id : null;
  const puedeCobrarDeNuevo = cobro.anulado && cobro.cita_id !== null && nuevoCobro === null;

  return (
    <>
      <EncabezadoTarea titulo="Cobro" volverA="/caja" />
      <main className={`space-y-4 px-4 pt-5 ${puedeCobrarDeNuevo ? "pb-40" : "pb-10"}`}>
        {cobro.anulado && (
          <section className="rounded-xl border border-rojo bg-white p-4">
            <p className="text-base font-semibold text-rojo">Cobro anulado</p>
            <p className="mt-1 text-base">{cobro.anulado_motivo}</p>
            {cobro.anulado_at && (
              <p className="mt-1 text-base text-tinta-2">
                {fechaCorta(fechaBogota(cobro.anulado_at))} · {horaCorta(cobro.anulado_at)}
              </p>
            )}
          </section>
        )}
        {nuevoCobro && (
          <Link
            href={`/caja/cobro/${nuevoCobro}`}
            className="flex min-h-14 items-center gap-3 rounded-xl border border-linea bg-white px-4 active:bg-hueso"
          >
            <CircleCheck className="size-6 shrink-0" aria-hidden />
            <span className="text-base font-medium">Se volvió a cobrar · ver el cobro</span>
          </Link>
        )}

        <section className="rounded-xl border border-linea bg-white p-4">
          <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">
            {fechaLarga(fechaBogota(cobro.created_at))} · {horaCorta(cobro.created_at)}
          </p>
          <p className={`mt-1 text-4xl font-semibold tracking-tight ${cobro.anulado ? "line-through" : ""}`}>{formatearPesos(entro)}</p>
          <p className="mt-1 text-base text-tinta-2">
            {cobro.cliente ?? "Sin cita"} · con {cobro.barbero}
          </p>
        </section>

        <section>
          <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Qué se cobró</h2>
          <ul className="mt-2 divide-y divide-hueso rounded-xl border border-linea bg-white">
            {cobro.items.map((i) => (
              <li key={i.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-base font-medium">{i.nombre}</span>
                  {i.precio_lista !== null && i.precio_lista !== i.precio && (
                    <span className="block text-base text-tinta-2">Lista: {formatearPesos(i.precio_lista)}</span>
                  )}
                  {verReparto && !cobro.anulado && (
                    <span className="block text-base text-tinta-2">
                      Comisión {i.comision_pct} % · {formatearPesos(i.comision)}
                    </span>
                  )}
                </span>
                <span className="text-base font-semibold">{formatearPesos(i.precio)}</span>
              </li>
            ))}
            {cobro.descuento > 0 && (
              <li className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-base font-medium">Descuento</span>
                  <span className="block text-base text-tinta-2">{cobro.descuento_motivo}</span>
                </span>
                <span className="text-base font-semibold">− {formatearPesos(cobro.descuento)}</span>
              </li>
            )}
            {cobro.propina > 0 && (
              <li className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="text-base font-medium">Propina</span>
                <span className="text-base font-semibold">{formatearPesos(cobro.propina)}</span>
              </li>
            )}
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Cómo se pagó</h2>
          {cobro.pagos.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">Cortesía: no hubo pago.</p>
          ) : (
            <ul className="mt-2 divide-y divide-hueso rounded-xl border border-linea bg-white">
              {cobro.pagos.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-base font-medium">{p.medio === "efectivo" ? "Efectivo" : "Nequi / transferencia"}</span>
                    {p.medio === "efectivo" && p.vuelto !== null && p.vuelto > 0 && (
                      <span className="block text-base text-tinta-2">
                        Recibido {formatearPesos(p.recibido ?? 0)} · vuelto {formatearPesos(p.vuelto)}
                      </span>
                    )}
                    {p.referencia && <span className="block text-base text-tinta-2">Ref. {p.referencia}</span>}
                  </span>
                  <span className="text-base font-semibold">{formatearPesos(p.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {verReparto && !cobro.anulado && (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Cómo se reparte</h2>
            <dl className="mt-2 divide-y divide-hueso rounded-xl border border-linea bg-white">
              <div className="flex items-baseline justify-between gap-3 px-4 py-3">
                <dt className="text-base font-medium">Comisión de {cobro.barbero}</dt>
                <dd className="text-base font-semibold">{formatearPesos(cobro.comision)}</dd>
              </div>
              {cobro.propina_barbero > 0 && (
                <div className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <dt className="text-base font-medium">Propina de {cobro.barbero}</dt>
                  <dd className="text-base font-semibold">{formatearPesos(cobro.propina_barbero)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 px-4 py-3">
                <dt className="text-base font-medium">Para la barbería</dt>
                <dd className="text-base font-semibold">{formatearPesos(reparto.barberia)}</dd>
              </div>
            </dl>
          </section>
        )}

        {!cobro.anulado &&
          (cobro.liquidacion_id ? (
            <section className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-4">
              <p className="text-base font-semibold">Ya se le pagó la comisión a {cobro.barbero}</p>
              <p className="mt-1 text-base text-tinta-2">Para anular este cobro, primero anula esa liquidación.</p>
              <Link
                href={`/comisiones/liquidacion/${cobro.liquidacion_id}`}
                className={`${botonVariantes({ variante: "secundario", bloque: true })} mt-3`}
              >
                Ver la liquidación
              </Link>
            </section>
          ) : (
            <AnularCobro id={cobro.id} entro={entro} reabreCita={cobro.cita_id !== null} />
          ))}
      </main>

      {puedeCobrarDeNuevo && (
        <BarraAccion>
          <Link href={`/caja/cobrar/${cobro.cita_id}`} className={botonVariantes({ tamano: "lg", bloque: true })}>
            Cobrar de nuevo
          </Link>
        </BarraAccion>
      )}
    </>
  );
}
