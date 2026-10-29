import Link from "@/components/ui/enlace";
import { redirect } from "next/navigation";
import { CircleCheck, MessageCircle, TriangleAlert } from "lucide-react";
import { AnularCierre } from "@/components/cierre/anular-cierre";
import { FormularioCierre } from "@/components/cierre/formulario-cierre";
import { BarraAccion } from "@/components/layout/barra-accion";
import { SelectorDia } from "@/components/layout/selector-dia";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { botonVariantes } from "@/components/ui/button";
import { abre } from "@/lib/areas";
import { obtenerCierre, obtenerJornada } from "@/lib/datos/cierre";
import { ETIQUETA_MEDIO, formatearPesos, textoDiferencia } from "@/lib/dinero";
import { fechaBogota, fechaCorta, fechaLarga, horaCorta, hoyBogota } from "@/lib/fechas";
import { esFecha } from "@/lib/periodos";
import { revisarPermiso } from "@/lib/permisos";
import { nuevaClave } from "@/lib/reloj";
import { enlaceWhatsappSinNumero, mensajeResumenCierre } from "@/lib/whatsapp";

export const metadata = { title: "Cierre del día" };

/**
 * Cerrar el día: las cifras (cobrado, gastos, pagos a barberos), el efectivo que debe haber en la caja y lo que se
 * contó. Cerrado el día, las cifras no se mueven; el resumen sale por WhatsApp.
 */
export default async function Cierre({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const { barberia, quien, permitido } = await revisarPermiso("cierre");
  if (!permitido) return <SinPermiso />;

  // Siempre con el día en la dirección: así, al cerrar, la pantalla se queda en ese día y no salta al siguiente.
  const parametros = await searchParams;
  if (!esFecha(parametros.fecha)) {
    const jornada = await obtenerJornada();
    // Si por algo la base no devolviera una fecha, se usa la de hoy: nunca se redirige a una dirección que vuelva a redirigir.
    redirect(`/cierre?fecha=${esFecha(jornada) ? jornada : hoyBogota()}`);
  }

  const dia = await obtenerCierre(parametros.fecha);
  const { resumen: r, cierre } = dia;
  const cobrado = r.servicios + r.propinas;
  const gastos = r.gastos_efectivo + r.gastos_transferencia;
  const pagos = r.liquidaciones_efectivo + r.liquidaciones_transferencia;
  const puedeCerrar = abre(quien.areas, "cierre");

  return (
    <main className="px-4 pb-52 pt-[calc(1.25rem+env(safe-area-inset-top,0px))]">
      <h1 className="text-3xl font-semibold leading-tight tracking-tight">Cierre del día</h1>

      <div className="mt-4">
        <SelectorDia fecha={dia.fecha} hoy={dia.jornada} ruta="/cierre" />
      </div>

      {dia.sin_cerrar.length > 0 && (
        <section className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-hueso p-4" aria-label="Días sin cerrar">
          <p className="text-base font-semibold">Hay días sin cerrar</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {dia.sin_cerrar.map((f) => (
              <li key={f}>
                <Link href={`/cierre?fecha=${f}`} className="flex min-h-12 items-center rounded-xl border border-linea bg-white px-4 text-base font-medium active:bg-hueso">
                  {fechaCorta(f)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cierre ? (
        <section className="mt-4 rounded-xl border border-linea bg-white p-4" aria-label="Día cerrado">
          <div className="flex items-center gap-2 text-tinta-2">
            <CircleCheck className="size-5" aria-hidden />
            <p className="text-sm font-medium uppercase tracking-wider">Día cerrado</p>
          </div>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{textoDiferencia(cierre.diferencia)}</p>
          <p className="mt-1 text-base text-tinta-2">
            Cerrado el {fechaCorta(fechaBogota(cierre.created_at))} a las {horaCorta(cierre.created_at)}
            {cierre.registrado_por ? ` por ${cierre.registrado_por}` : ""}.
          </p>
          {cierre.nota && <p className="mt-2 border-t border-hueso pt-2 text-base">{cierre.nota}</p>}
        </section>
      ) : (
        dia.sin_cobrar > 0 && (
          <Link
            href="/caja"
            className="mt-4 flex min-h-14 items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-hueso px-4 py-3 active:bg-zinc-200"
          >
            <TriangleAlert className="size-6 shrink-0" aria-hidden />
            <span className="text-base font-medium">
              {dia.sin_cobrar === 1 ? "Hay 1 cita atendida sin cobrar." : `Hay ${dia.sin_cobrar} citas atendidas sin cobrar.`} Cóbrala{dia.sin_cobrar === 1 ? "" : "s"} antes de
              cerrar.
            </span>
          </Link>
        )
      )}

      <section className="mt-4 rounded-xl border border-linea bg-white p-4" aria-label="Lo cobrado">
        <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">Cobrado</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">{formatearPesos(cobrado)}</p>
        <dl className="mt-3 divide-y divide-hueso border-t border-hueso">
          <Fila etiqueta={ETIQUETA_MEDIO.efectivo} valor={formatearPesos(r.efectivo_cobros)} />
          <Fila etiqueta="Nequi" valor={formatearPesos(r.transferencia_cobros)} />
          <Fila etiqueta="Servicios" valor={formatearPesos(r.servicios)} />
          <Fila etiqueta="Propinas" valor={formatearPesos(r.propinas)} />
          <Fila etiqueta="Cobros" valor={String(r.cobros)} />
        </dl>
      </section>

      <section className="mt-4 rounded-xl border border-linea bg-white p-4" aria-label="Lo que salió">
        <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">Lo que salió</p>
        <dl className="mt-2 divide-y divide-hueso">
          <Fila etiqueta={`Gastos${r.gastos > 0 ? ` (${r.gastos})` : ""}`} valor={formatearPesos(gastos)} />
          <Fila etiqueta="Pagos a barberos" valor={formatearPesos(pagos)} />
        </dl>
      </section>

      <section className="mt-4 rounded-xl border border-linea bg-white p-4" aria-label="Efectivo en la caja">
        <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">Efectivo en la caja</p>
        <dl className="mt-2 divide-y divide-hueso">
          <Fila etiqueta="Cobrado en efectivo" valor={formatearPesos(r.efectivo_cobros)} />
          <Fila etiqueta="− Gastos en efectivo" valor={formatearPesos(r.gastos_efectivo)} />
          <Fila etiqueta="− Pagos a barberos en efectivo" valor={formatearPesos(r.liquidaciones_efectivo)} />
          <Fila etiqueta="Debe haber" valor={formatearPesos(r.efectivo_esperado)} fuerte />
          {cierre && <Fila etiqueta="Contado" valor={formatearPesos(cierre.efectivo_contado)} fuerte />}
        </dl>
      </section>

      {cierre ? (
        <>
          {puedeCerrar && (
            <div className="mt-6">
              <AnularCierre id={cierre.id} dia={fechaLarga(dia.fecha)} />
            </div>
          )}
          <BarraAccion conNavegacion>
            <a
              href={enlaceWhatsappSinNumero(mensajeResumenCierre({ barberia: barberia.nombre, dia: fechaLarga(dia.fecha), cierre }))}
              target="_blank"
              rel="noreferrer"
              className={botonVariantes({ tamano: "lg", bloque: true })}
            >
              <MessageCircle className="size-5" aria-hidden />
              Enviar resumen por WhatsApp
            </a>
          </BarraAccion>
        </>
      ) : (
        puedeCerrar && (
          <div className="mt-6">
            <FormularioCierre clave={nuevaClave()} fecha={dia.fecha} esperado={r.efectivo_esperado} />
          </div>
        )
      )}
    </main>
  );
}

function Fila({ etiqueta, valor, fuerte = false }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className={fuerte ? "text-base font-semibold" : "text-base text-tinta-2"}>{etiqueta}</dt>
      <dd className={fuerte ? "text-right text-lg font-semibold" : "text-right text-base font-semibold"}>{valor}</dd>
    </div>
  );
}
