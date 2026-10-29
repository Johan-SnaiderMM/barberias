import Link from "@/components/ui/enlace";
import { CalendarDays, TriangleAlert, Wallet } from "lucide-react";
import { AvisoDemo } from "@/components/demo/aviso-demo";
import { IniciarGuia } from "@/components/guia/iniciar-guia";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { botonVariantes } from "@/components/ui/button";
import { puedeVer } from "@/lib/areas";
import { porCerrar } from "@/lib/citas";
import { obtenerCierre } from "@/lib/datos/cierre";
import { listarCitas } from "@/lib/datos/citas";
import { obtenerInicio } from "@/lib/datos/inicio";
import { avisoDiasSinCerrar } from "@/lib/dias-sin-cerrar";
import { formatearPesos, textoDiferencia } from "@/lib/dinero";
import { fechaCorta, fechaLarga, horaCorta, hoyBogota } from "@/lib/fechas";
import { revisarPermiso } from "@/lib/permisos";
import { ahoraMs as leerAhora } from "@/lib/reloj";

export const metadata = { title: "Inicio" };

export default async function Inicio({ searchParams }: { searchParams: Promise<{ recorrido?: string }> }) {
  const { barberia, quien, permitido } = await revisarPermiso("inicio");
  if (!permitido) return <SinPermiso />;
  // Al entrar a la demo (acción «Probar la demo») arranca el recorrido guiado.
  const empezarRecorrido = barberia.es_demo && (await searchParams).recorrido === "1";

  const verAgenda = puedeVer(quien, "agenda");
  const verCierre = puedeVer(quien, "cierre");
  const [citas, dia, cierre] = await Promise.all([
    verAgenda ? listarCitas() : Promise.resolve([]),
    obtenerInicio(),
    verCierre ? obtenerCierre() : Promise.resolve(null),
  ]);
  const sinCerrar = cierre ? avisoDiasSinCerrar(cierre.sin_cerrar) : null;
  const ahoraMs = leerAhora();
  const vigentes = citas.filter((c) => c.estado !== "cancelada");
  const porCerrarHoy = vigentes.filter((c) => porCerrar(c, ahoraMs)).length;
  const siguiente = vigentes.find(
    (c) => (c.estado === "confirmada" || c.estado === "en_atencion") && new Date(c.fin).getTime() > ahoraMs
  );

  return (
    <main className="px-4 pb-6 pt-[calc(1.25rem+env(safe-area-inset-top,0px))]">
      <p className="text-base font-semibold text-tinta-2">{fechaLarga(hoyBogota())}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight leading-tight">Hola, {quien.nombre}</h1>
      <p className="mt-1 text-lg text-tinta-2">{barberia.nombre}</p>
      {barberia.es_demo && <AvisoDemo className="mt-4" conRecorrido />}
      {empezarRecorrido && <IniciarGuia volverA="/inicio" />}

      {sinCerrar && (
        <Link
          href={`/cierre?fecha=${sinCerrar.fecha}`}
          className="mt-4 flex min-h-14 items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-hueso px-4 py-3 active:bg-zinc-200"
        >
          <TriangleAlert className="size-6 shrink-0" aria-hidden />
          <span className="text-base font-medium">{sinCerrar.texto}</span>
        </Link>
      )}

      <section className="mt-6 rounded-xl border border-linea bg-superficie p-4" data-guia={dia.ventas || dia.comisiones || dia.gastos ? undefined : "resumen"}>
        <div className="flex items-center gap-2">
          <CalendarDays className="size-6" aria-hidden />
          <h2 className="text-xl font-semibold tracking-tight">Hoy</h2>
        </div>

        {!verAgenda ? (
          <p className="mt-2 text-base text-tinta-2">Tu rol no incluye la agenda.</p>
        ) : vigentes.length === 0 ? (
          <p className="mt-2 text-base text-tinta-2">No hay citas para hoy.</p>
        ) : (
          <>
            <p className="mt-2 text-2xl font-semibold tracking-tight leading-tight">
              {vigentes.length === 1 ? "1 cita" : `${vigentes.length} citas`}
            </p>
            {siguiente ? (
              <p className="mt-1 text-base">
                {siguiente.estado === "en_atencion" ? "En atención" : "Sigue"}:{" "}
                <strong>
                  {horaCorta(siguiente.inicio)} · {siguiente.cliente}
                </strong>{" "}
                <span className="text-tinta-2">({siguiente.servicio})</span>
              </p>
            ) : (
              <p className="mt-1 text-base text-tinta-2">Ya no quedan citas por atender hoy.</p>
            )}
            {porCerrarHoy > 0 && (
              <p className="mt-1 text-base font-semibold text-rojo">
                {porCerrarHoy === 1 ? "1 cita por cerrar." : `${porCerrarHoy} citas por cerrar.`}
              </p>
            )}
          </>
        )}

        {dia.citas && (dia.citas.atendidas > 0 || dia.citas.no_asistio > 0) && (
          <p className="mt-1 text-base text-tinta-2">
            {dia.citas.atendidas === 1 ? "1 atendida" : `${dia.citas.atendidas} atendidas`}
            {dia.citas.no_asistio > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-tinta">{dia.citas.no_asistio === 1 ? "1 no llegó" : `${dia.citas.no_asistio} no llegaron`}</span>
              </>
            )}
          </p>
        )}

        {verAgenda && (
          <Link href="/agenda" className={`${botonVariantes({ variante: "secundario", bloque: true })} mt-4`}>
            Abrir la agenda
          </Link>
        )}
      </section>

      {(dia.ventas || dia.comisiones || dia.gastos) && (
        <section className="mt-4 rounded-xl border border-linea bg-superficie p-4" aria-label="Las cifras del día" data-guia="resumen">
          <div className="flex items-center gap-2">
            <Wallet className="size-6" aria-hidden />
            <h2 className="text-xl font-semibold tracking-tight">
              {dia.ventas?.propias || (!dia.ventas && dia.comisiones?.propias) ? "Lo tuyo" : "Las cifras"} {dia.fecha === dia.hoy ? "de hoy" : `del ${fechaCorta(dia.fecha)}`}
            </h2>
          </div>

          {dia.fecha > dia.hoy && (
            <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
              Hoy ya está cerrado: lo que se registre ahora cuenta para mañana.
            </p>
          )}
          {dia.cierre_hoy && (
            <Link href={`/cierre?fecha=${dia.hoy}`} className="mt-2 block text-base font-semibold underline underline-offset-4">
              Cierre de hoy: {textoDiferencia(dia.cierre_hoy.diferencia)}
            </Link>
          )}

          {dia.ventas && (
            <>
              <p className="mt-3 text-sm font-medium uppercase tracking-wider text-tinta-2">{dia.ventas.propias ? "Has cobrado" : "Vendido"}</p>
              <p className="text-4xl font-semibold tracking-tight">{formatearPesos(dia.ventas.servicios + dia.ventas.propinas)}</p>
              <p className="mt-1 text-base text-tinta-2">
                {dia.ventas.cobros === 1 ? "1 cobro" : `${dia.ventas.cobros} cobros`}
                {dia.ventas.propinas > 0 ? ` · incluye ${formatearPesos(dia.ventas.propinas)} de propina` : ""}
              </p>
            </>
          )}

          {(dia.comisiones || dia.gastos) && (
            <dl className="mt-3 divide-y divide-hueso border-t border-hueso">
              {dia.comisiones && (
                <Fila
                  etiqueta={dia.comisiones.propias ? "Has ganado" : "Comisiones del día"}
                  valor={formatearPesos(dia.comisiones.comisiones + dia.comisiones.propinas_barbero)}
                />
              )}
              {dia.gastos && <Fila etiqueta="Gastos del día" valor={formatearPesos(dia.gastos.total)} />}
            </dl>
          )}

          {(puedeVer(quien, "caja") || puedeVer(quien, "cierre")) && (
            <div className="mt-4 flex flex-col gap-2">
              {puedeVer(quien, "caja") && (
                <Link href="/caja" className={botonVariantes({ variante: "secundario", bloque: true })}>
                  Abrir la caja
                </Link>
              )}
              {puedeVer(quien, "cierre") && (
                <Link href="/cierre" className={botonVariantes({ variante: "secundario", bloque: true })}>
                  Cierre del día
                </Link>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-base text-tinta-2">{etiqueta}</dt>
      <dd className="text-right text-base font-semibold">{valor}</dd>
    </div>
  );
}
