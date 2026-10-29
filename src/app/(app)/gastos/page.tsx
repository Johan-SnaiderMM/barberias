import Link from "@/components/ui/enlace";
import { Camera, Plus, Receipt } from "lucide-react";
import { BarraAccion } from "@/components/layout/barra-accion";
import { EnlaceFila } from "@/components/layout/enlace-fila";
import { SelectorDia } from "@/components/layout/selector-dia";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { botonVariantes } from "@/components/ui/button";
import { abre } from "@/lib/areas";
import { obtenerGastos } from "@/lib/datos/gastos";
import { ETIQUETA_MEDIO, formatearPesos } from "@/lib/dinero";
import { horaCorta, hoyBogota } from "@/lib/fechas";
import { ETIQUETA_CATEGORIA } from "@/lib/gastos";
import { esFecha } from "@/lib/periodos";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Gastos" };

export default async function Gastos({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const { quien, permitido } = await revisarPermiso("gastos");
  if (!permitido) return <SinPermiso />;

  const parametros = await searchParams;
  const hoy = hoyBogota();
  const fecha = esFecha(parametros.fecha) ? parametros.fecha : hoy;
  const dia = await obtenerGastos(fecha);
  const puedeRegistrar = abre(quien.areas, "gastos");
  const t = dia.totales;

  return (
    <main className="px-4 pb-48 pt-[calc(1.25rem+env(safe-area-inset-top,0px))]">
      <h1 className="text-3xl font-semibold leading-tight tracking-tight">Gastos</h1>

      <div className="mt-4">
        <SelectorDia fecha={fecha} hoy={hoy} ruta="/gastos" />
      </div>

      <section className="mt-5 rounded-xl border border-linea bg-white p-4" aria-label="Lo gastado en el día">
        <div className="flex items-center gap-2 text-tinta-2">
          <Receipt className="size-5" aria-hidden />
          <p className="text-sm font-medium uppercase tracking-wider">Gastado</p>
        </div>
        <p className="mt-1 text-4xl font-semibold tracking-tight">{formatearPesos(t.total)}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-hueso pt-3 text-base">
          <Dato etiqueta={ETIQUETA_MEDIO.efectivo} valor={formatearPesos(t.efectivo)} />
          <Dato etiqueta="Nequi" valor={formatearPesos(t.transferencia)} />
          {dia.por_categoria.map((c) => (
            <Dato key={c.categoria} etiqueta={ETIQUETA_CATEGORIA[c.categoria]} valor={formatearPesos(c.total)} />
          ))}
        </dl>
        <p className="mt-2 text-base text-tinta-2">{t.gastos === 1 ? "1 gasto" : `${t.gastos} gastos`}</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Registrados</h2>
        {dia.gastos.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
            No hay gastos este día.
          </p>
        ) : (
          <ul className="mt-2 space-y-3">
            {dia.gastos.map((g) => (
              <li key={g.id}>
                <EnlaceFila
                  href={`/gastos/${g.id}`}
                  titulo={`${ETIQUETA_CATEGORIA[g.categoria]} · ${formatearPesos(g.monto)}`}
                  detalle={`${horaCorta(g.created_at)} · ${ETIQUETA_MEDIO[g.medio]}${g.nota ? ` · ${g.nota}` : ""}${g.anulado ? " · ANULADO" : ""}`}
                  Icono={g.con_foto ? Camera : undefined}
                  tenue={g.anulado}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {puedeRegistrar && (
        <BarraAccion conNavegacion>
          <Link href="/gastos/nuevo" className={botonVariantes({ tamano: "lg", bloque: true })}>
            <Plus className="size-5" aria-hidden />
            Registrar gasto
          </Link>
        </BarraAccion>
      )}
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
