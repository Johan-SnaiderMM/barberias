import Link from "@/components/ui/enlace";
import { ChevronRight } from "lucide-react";
import { SelectorPeriodo } from "@/components/comisiones/selector-periodo";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { abre } from "@/lib/areas";
import { obtenerResumenComisiones } from "@/lib/datos/liquidaciones";
import { formatearPesos, sumar } from "@/lib/dinero";
import { fechaCorta, hoyBogota } from "@/lib/fechas";
import { esFecha, esPeriodo, hastaEfectivo, rangoDelPeriodo, type Periodo } from "@/lib/periodos";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Comisiones" };

/**
 * Lo que ganó cada barbero en un periodo y lo que falta por pagarle. «comisiones» ve a todos y liquida; el barbero
 * (mi_agenda) ve solo lo suyo.
 */
export default async function Comisiones({ searchParams }: { searchParams: Promise<{ periodo?: string; ref?: string }> }) {
  const { quien, permitido } = await revisarPermiso("comisiones");
  if (!permitido) return <SinPermiso />;

  const parametros = await searchParams;
  const hoy = hoyBogota();
  const periodo: Periodo = esPeriodo(parametros.periodo) ? parametros.periodo : "semana";
  const referencia = esFecha(parametros.ref) && parametros.ref <= hoy ? parametros.ref : hoy;
  const rango = rangoDelPeriodo(periodo, referencia);
  const hasta = hastaEfectivo(rango, hoy);

  const resumen = await obtenerResumenComisiones(rango.desde, hasta);
  const todos = abre(quien.areas, "comisiones");
  const pendiente = sumar(resumen.barberos.map((b) => b.pendiente));
  const generado = sumar(resumen.barberos.map((b) => b.comision + b.propina));
  const cobros = sumar(resumen.barberos.map((b) => b.cobros));

  return (
    <main className="px-4 pb-8 pt-[calc(1.25rem+env(safe-area-inset-top,0px))]">
      <h1 className="text-3xl font-semibold leading-tight tracking-tight">{todos ? "Comisiones" : "Mis comisiones"}</h1>

      <div className="mt-4">
        <SelectorPeriodo periodo={periodo} referencia={referencia} hoy={hoy} />
      </div>

      <section className="mt-5 rounded-xl border border-linea bg-white p-4" aria-label="Lo que falta por pagar">
        <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">
          {todos ? "Por pagar a los barberos" : "Por pagarte"} hasta {fechaCorta(hasta)}
        </p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">{formatearPesos(pendiente)}</p>
        <p className="mt-2 border-t border-hueso pt-2 text-base text-tinta-2">
          Generado en el periodo: <span className="font-semibold text-tinta">{formatearPesos(generado)}</span> · {cobros === 1 ? "1 cobro" : `${cobros} cobros`}
        </p>
      </section>

      {resumen.barberos.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
          Todavía no hay barberos.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {resumen.barberos.map((b) => (
            <li key={b.id}>
              <Link
                href={`/comisiones/barbero/${b.id}?hasta=${hasta}&periodo=${periodo}&ref=${referencia}`}
                className="block rounded-xl border border-linea bg-white p-4 active:bg-hueso"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold leading-tight">
                      {b.nombre}
                      {!b.activo && " (archivado)"}
                    </p>
                    <p className="text-base text-tinta-2">
                      {b.cobros === 1 ? "1 cobro" : `${b.cobros} cobros`} · servicios {formatearPesos(b.servicios)}
                    </p>
                  </div>
                  <ChevronRight className="mt-0.5 size-5 shrink-0 text-zinc-400" aria-hidden />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-hueso pt-3 text-base">
                  <Dato etiqueta="Comisión" valor={formatearPesos(b.comision)} />
                  <Dato etiqueta="Propina" valor={formatearPesos(b.propina)} />
                  <Dato etiqueta="Ya pagado" valor={formatearPesos(b.liquidado)} />
                  <Dato etiqueta="Por pagar" valor={formatearPesos(b.pendiente)} fuerte />
                </dl>
                {b.pendiente_desde && b.pendiente_desde < rango.desde && (
                  <p className="mt-2 text-base text-tinta-2">Incluye lo pendiente desde el {fechaCorta(b.pendiente_desde)}.</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Dato({ etiqueta, valor, fuerte = false }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-tinta-2">{etiqueta}</dt>
      <dd className={fuerte ? "font-semibold" : "font-medium"}>{valor}</dd>
    </div>
  );
}
