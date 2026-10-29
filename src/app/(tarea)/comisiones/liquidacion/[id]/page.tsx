import { notFound } from "next/navigation";
import { AnularLiquidacion } from "@/components/comisiones/anular-liquidacion";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { ListaPlegable } from "@/components/ui/lista-plegable";
import { abre } from "@/lib/areas";
import { obtenerLiquidacion } from "@/lib/datos/liquidaciones";
import { ETIQUETA_MEDIO, formatearPesos } from "@/lib/dinero";
import { fechaBogota, fechaCorta, fechaLarga, horaCorta } from "@/lib/fechas";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Liquidación" };

/** Un pago de comisión: a quién, cuánto, cómo y qué cobros cubre. Se puede anular con motivo. */
export default async function DetalleLiquidacion({ params }: { params: Promise<{ id: string }> }) {
  const { quien, permitido } = await revisarPermiso("comisiones");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const liquidacion = await obtenerLiquidacion(id);
  if (!liquidacion) notFound();

  const puedeAnular = abre(quien.areas, "comisiones") && !liquidacion.anulada;

  return (
    <>
      <EncabezadoTarea titulo="Liquidación" volverA={`/comisiones/barbero/${liquidacion.barbero_id}`} />
      <main className="space-y-4 px-4 pb-10 pt-5">
        {liquidacion.anulada && (
          <section className="rounded-xl border border-rojo bg-superficie p-4">
            <p className="text-base font-semibold text-rojo">Liquidación anulada</p>
            <p className="mt-1 text-base">{liquidacion.anulada_motivo}</p>
            {liquidacion.anulada_at && (
              <p className="mt-1 text-base text-tinta-2">
                {fechaCorta(fechaBogota(liquidacion.anulada_at))} · {horaCorta(liquidacion.anulada_at)}
              </p>
            )}
          </section>
        )}

        <section className="rounded-xl border border-linea bg-superficie p-4">
          <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">
            {fechaLarga(liquidacion.fecha)} · {horaCorta(liquidacion.created_at)}
          </p>
          <p className={`mt-1 text-4xl font-semibold tracking-tight ${liquidacion.anulada ? "line-through" : ""}`}>
            {formatearPesos(liquidacion.total)}
          </p>
          <p className="mt-1 text-base text-tinta-2">Para {liquidacion.barbero}</p>
          <dl className="mt-3 divide-y divide-hueso border-t border-hueso">
            <Fila etiqueta="Cómo se pagó" valor={ETIQUETA_MEDIO[liquidacion.medio]} />
            <Fila etiqueta="Comisión" valor={formatearPesos(liquidacion.comision)} />
            {liquidacion.propina > 0 && <Fila etiqueta="Propina" valor={formatearPesos(liquidacion.propina)} />}
            <Fila etiqueta="Cobros" valor={`${liquidacion.cobros} hasta el ${fechaCorta(liquidacion.hasta)}`} />
            {liquidacion.nota && <Fila etiqueta="Nota" valor={liquidacion.nota} />}
          </dl>
        </section>

        <section>
          <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Cobros que cubre</h2>
          <ListaPlegable
            className="mt-2 divide-y divide-hueso rounded-xl border border-linea bg-superficie"
            resumen={(n) => `Ver ${n} cobros más`}
            filas={liquidacion.items.map((c) => (
              <li key={c.cobro_id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-base font-medium">
                    {c.cliente ?? "Sin cita"} · {c.servicios}
                  </span>
                  <span className="block text-base text-tinta-2">
                    {fechaCorta(c.fecha)} · {horaCorta(c.created_at)}
                  </span>
                </span>
                <span className="text-base font-semibold">{formatearPesos(c.comision + c.propina_barbero)}</span>
              </li>
            ))}
          />
        </section>

        {puedeAnular && <AnularLiquidacion id={liquidacion.id} total={liquidacion.total} cobros={liquidacion.cobros} />}
      </main>
    </>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm font-medium uppercase tracking-wider text-tinta-2">{etiqueta}</dt>
      <dd className="text-right text-base font-semibold">{valor}</dd>
    </div>
  );
}
