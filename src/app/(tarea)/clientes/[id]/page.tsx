import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { InsigniaEstado } from "@/components/agenda/insignia-estado";
import { FormularioNota } from "@/components/clientes/formulario-nota";
import { FormularioCliente } from "@/components/clientes/formulario-cliente";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { botonVariantes } from "@/components/ui/button";
import { abre } from "@/lib/areas";
import { obtenerFichaCliente } from "@/lib/datos/clientes";
import { formatearPesos } from "@/lib/dinero";
import { fechaBogota, fechaCorta, fechaLarga, horaCorta } from "@/lib/fechas";
import { revisarPermiso } from "@/lib/permisos";
import { formatearTelefono } from "@/lib/telefono";

export const metadata = { title: "Cliente" };

export default async function FichaDelCliente({ params }: { params: Promise<{ id: string }> }) {
  const { quien, permitido } = await revisarPermiso("clientes");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const cliente = await obtenerFichaCliente(id);
  if (!cliente) notFound();

  const puedeEditar = abre(quien.areas, "agenda");
  const puedeNota = abre(quien.areas, "agenda", "mi_agenda");
  const puedeAgendar = abre(quien.areas, "agenda", "mi_agenda");

  return (
    <>
      <EncabezadoTarea titulo={cliente.nombre} volverA="/clientes" />

      <main className="space-y-6 px-4 pt-5">
        <section className="rounded-xl border border-linea bg-white p-4">
          <p className="text-xl font-semibold tracking-tight leading-tight">{cliente.nombre}</p>
          <p className="text-base text-tinta-2">
            {cliente.telefono ? formatearTelefono(cliente.telefono) : "Sin celular"}
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-hueso pt-3 text-center">
            <div>
              <dt className="text-sm font-medium uppercase tracking-wider text-tinta-2">Visitas</dt>
              <dd className="text-2xl font-semibold tracking-tight">{cliente.visitas}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium uppercase tracking-wider text-tinta-2">Última</dt>
              <dd className="text-lg font-semibold tracking-tight leading-tight">
                {cliente.ultima_visita ? fechaCorta(fechaBogota(cliente.ultima_visita)) : "Sin visitas"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium uppercase tracking-wider text-tinta-2">No llegó</dt>
              <dd className={`text-2xl font-semibold tracking-tight ${cliente.no_asistio > 0 ? "text-rojo" : ""}`}>
                {cliente.no_asistio}
              </dd>
            </div>
          </dl>
        </section>

        {puedeAgendar && (
          <Link href={`/agenda/nueva?cliente=${cliente.id}`} className={botonVariantes({ tamano: "lg", bloque: true })}>
            <CalendarPlus className="size-5" aria-hidden />
            Agendar una cita
          </Link>
        )}

        {puedeNota && <FormularioNota clienteId={cliente.id} nota={cliente.nota} />}

        <section>
          <h2 className="text-xl font-semibold tracking-tight">Historial</h2>
          {cliente.citas.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
              Todavía no tiene citas.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {cliente.citas.map((c) => (
                <li key={c.id} className="rounded-xl border border-linea bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                    <p className="text-base font-semibold leading-tight">
                      {fechaLarga(fechaBogota(c.inicio))} · {horaCorta(c.inicio)}
                    </p>
                    <InsigniaEstado estado={c.estado} />
                  </div>
                  <p className="text-base text-tinta-2">
                    {c.servicio} · con {c.barbero} · {formatearPesos(c.precio)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {puedeEditar && (
        <section id="datos-del-cliente" className="mt-8 border-t border-hueso pt-2">
          <h2 className="px-4 pt-3 text-xl font-semibold tracking-tight">Datos del cliente</h2>
          <FormularioCliente cliente={{ id: cliente.id, nombre: cliente.nombre, telefono: cliente.telefono }} />
        </section>
      )}
    </>
  );
}
