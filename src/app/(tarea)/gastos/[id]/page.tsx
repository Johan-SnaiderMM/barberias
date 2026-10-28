import { notFound } from "next/navigation";
import { AnularGasto } from "@/components/gastos/anular-gasto";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { abre } from "@/lib/areas";
import { obtenerGasto } from "@/lib/datos/gastos";
import { ETIQUETA_MEDIO, formatearPesos } from "@/lib/dinero";
import { fechaBogota, fechaCorta, fechaLarga, horaCorta } from "@/lib/fechas";
import { ETIQUETA_CATEGORIA } from "@/lib/gastos";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Gasto" };

/** Un gasto: cuánto, en qué, cómo se pagó, quién lo registró y su recibo. Se puede anular con motivo. */
export default async function DetalleGasto({ params }: { params: Promise<{ id: string }> }) {
  const { quien, permitido } = await revisarPermiso("gastos");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const gasto = await obtenerGasto(id);
  if (!gasto) notFound();

  const puedeAnular = abre(quien.areas, "gastos") && !gasto.anulado;

  return (
    <>
      <EncabezadoTarea titulo="Gasto" volverA={`/gastos?fecha=${gasto.fecha}`} />
      <main className="space-y-4 px-4 pb-10 pt-5">
        {gasto.anulado && (
          <section className="rounded-xl border border-rojo bg-white p-4">
            <p className="text-base font-semibold text-rojo">Gasto anulado</p>
            <p className="mt-1 text-base">{gasto.anulado_motivo}</p>
            {gasto.anulado_at && (
              <p className="mt-1 text-base text-tinta-2">
                {fechaCorta(fechaBogota(gasto.anulado_at))} · {horaCorta(gasto.anulado_at)}
              </p>
            )}
          </section>
        )}

        <section className="rounded-xl border border-linea bg-white p-4">
          <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">
            {fechaLarga(gasto.fecha)} · {horaCorta(gasto.created_at)}
          </p>
          <p className={`mt-1 text-4xl font-semibold tracking-tight ${gasto.anulado ? "line-through" : ""}`}>{formatearPesos(gasto.monto)}</p>
          <dl className="mt-3 divide-y divide-hueso border-t border-hueso">
            <Fila etiqueta="En qué" valor={ETIQUETA_CATEGORIA[gasto.categoria]} />
            <Fila etiqueta="Cómo se pagó" valor={ETIQUETA_MEDIO[gasto.medio]} />
            {gasto.nota && <Fila etiqueta="Nota" valor={gasto.nota} />}
            {gasto.registrado_por && <Fila etiqueta="Lo registró" valor={gasto.registrado_por} />}
          </dl>
        </section>

        {gasto.foto_ruta && (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Recibo</h2>
            <a href={`/api/foto/gasto/${gasto.id}`} target="_blank" rel="noreferrer" className="mt-2 block rounded-xl border border-linea bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- foto privada servida por /api/foto (necesita la sesión); next/image no la puede pedir */}
              <img src={`/api/foto/gasto/${gasto.id}`} alt="Foto del recibo" className="max-h-96 w-full rounded-lg object-contain" />
            </a>
            <p className="mt-2 text-base text-tinta-2">Toca la foto para verla completa.</p>
          </section>
        )}

        {puedeAnular && <AnularGasto id={gasto.id} monto={gasto.monto} />}
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
