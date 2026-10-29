import Link from "@/components/ui/enlace";
import { notFound } from "next/navigation";
import { BotonLiquidar } from "@/components/comisiones/boton-liquidar";
import { BarraAccion } from "@/components/layout/barra-accion";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { EnlaceFila } from "@/components/layout/enlace-fila";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { ListaPlegable } from "@/components/ui/lista-plegable";
import { abre, puedeVer } from "@/lib/areas";
import { obtenerComisionesDeBarbero } from "@/lib/datos/liquidaciones";
import { formatearPesos } from "@/lib/dinero";
import { ErrorApp } from "@/lib/errores";
import { fechaCorta, horaCorta, hoyBogota } from "@/lib/fechas";
import { esFecha, esPeriodo } from "@/lib/periodos";
import { revisarPermiso } from "@/lib/permisos";
import { nuevaClave } from "@/lib/reloj";
import type { ComisionesDeBarbero } from "@/lib/tipos/liquidaciones";

export const metadata = { title: "Comisiones del barbero" };

/**
 * Lo que se le debe a un barbero hasta un día, con los cobros que lo componen, el botón para liquidar y sus pagos
 * anteriores. «comisiones» liquida; el barbero (mi_agenda) solo mira lo suyo.
 */
export default async function ComisionesDeUnBarbero({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ hasta?: string; periodo?: string; ref?: string }>;
}) {
  const { quien, permitido } = await revisarPermiso("comisiones");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const parametros = await searchParams;
  const hoy = hoyBogota();
  const hasta = esFecha(parametros.hasta) && parametros.hasta <= hoy ? parametros.hasta : hoy;

  let datos: ComisionesDeBarbero;
  try {
    datos = await obtenerComisionesDeBarbero(id, hasta);
  } catch (e) {
    if (e instanceof ErrorApp && e.codigo === "P0002") notFound();
    throw e;
  }

  const puedeLiquidar = abre(quien.areas, "comisiones");
  const puedeVerCobro = puedeVer(quien, "caja");
  const { barbero, pendiente } = datos;
  const volverA = `/comisiones?periodo=${esPeriodo(parametros.periodo) ? parametros.periodo : "semana"}&ref=${
    esFecha(parametros.ref) ? parametros.ref : hoy
  }`;
  const hayAcciones = puedeLiquidar && pendiente.cobros > 0;

  return (
    <>
      <EncabezadoTarea titulo={barbero.activo ? barbero.nombre : `${barbero.nombre} (archivado)`} volverA={volverA} />
      <main className={`space-y-6 px-4 pt-5 ${hayAcciones ? "pb-40" : "pb-10"}`}>
        <section className="rounded-xl border border-linea bg-white p-4">
          <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">
            {puedeLiquidar ? "Por pagarle" : "Por pagarte"} hasta {fechaCorta(hasta)}
          </p>
          <p className="mt-1 text-4xl font-semibold tracking-tight">{formatearPesos(pendiente.total)}</p>
          {pendiente.cobros > 0 ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-hueso pt-3 text-base">
              <Dato etiqueta="Comisión" valor={formatearPesos(pendiente.comision)} />
              <Dato etiqueta="Propina" valor={formatearPesos(pendiente.propina)} />
              <Dato etiqueta="Cobros" valor={String(pendiente.cobros)} />
              {pendiente.desde && <Dato etiqueta="Desde" valor={fechaCorta(pendiente.desde)} />}
            </dl>
          ) : (
            <p className="mt-2 text-base text-tinta-2">No hay nada pendiente hasta esa fecha.</p>
          )}
        </section>

        {datos.cobros.length > 0 && (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Lo que lo compone</h2>
            <ListaPlegable
              className="mt-2 divide-y divide-hueso rounded-xl border border-linea bg-white"
              resumen={(n) => `Ver ${n} cobros anteriores`}
              filas={datos.cobros.map((c) => {
                const contenido = (
                  <>
                    <span className="min-w-0">
                      <span className="block truncate text-base font-medium">
                        {c.cliente ?? "Sin cita"} · {c.servicios}
                      </span>
                      <span className="block text-base text-tinta-2">
                        {fechaCorta(c.fecha)} · {horaCorta(c.created_at)}
                      </span>
                    </span>
                    <span className="text-base font-semibold">{formatearPesos(c.comision + c.propina_barbero)}</span>
                  </>
                );
                return (
                  <li key={c.id}>
                    {puedeVerCobro ? (
                      <Link href={`/caja/cobro/${c.id}`} className="flex items-baseline justify-between gap-3 px-4 py-3 active:bg-hueso">
                        {contenido}
                      </Link>
                    ) : (
                      <div className="flex items-baseline justify-between gap-3 px-4 py-3">{contenido}</div>
                    )}
                  </li>
                );
              })}
            />
            {datos.cobros.length < pendiente.cobros && (
              <p className="mt-2 text-base text-tinta-2">Se muestran los {datos.cobros.length} más recientes; la liquidación incluye los {pendiente.cobros}.</p>
            )}
          </section>
        )}

        {datos.liquidaciones.length > 0 && (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Pagos anteriores</h2>
            <ul className="mt-2 space-y-3">
              {datos.liquidaciones.map((l) => (
                <li key={l.id}>
                  <EnlaceFila
                    href={`/comisiones/liquidacion/${l.id}`}
                    titulo={`${formatearPesos(l.total)} · ${fechaCorta(l.fecha)}`}
                    detalle={`${l.cobros === 1 ? "1 cobro" : `${l.cobros} cobros`} · ${l.medio === "efectivo" ? "Efectivo" : "Transferencia"}${l.anulada ? " · ANULADA" : ""}`}
                    tenue={l.anulada}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {hayAcciones && (
        <BarraAccion>
          <BotonLiquidar
            clave={nuevaClave()}
            barberoId={barbero.id}
            nombre={barbero.nombre}
            hasta={hasta}
            cobros={pendiente.cobros}
            comision={pendiente.comision}
            propina={pendiente.propina}
          />
        </BarraAccion>
      )}
    </>
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
