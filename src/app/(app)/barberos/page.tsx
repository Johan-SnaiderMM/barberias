import Link from "next/link";
import { Plus } from "lucide-react";
import { BotonActivoBarbero } from "@/components/barberos/boton-activo-barbero";
import { BarraAccion } from "@/components/layout/barra-accion";
import { EnlaceFila } from "@/components/layout/enlace-fila";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { botonVariantes } from "@/components/ui/button";
import { listarBarberos } from "@/lib/datos/barberos";
import { revisarPermiso } from "@/lib/permisos";
import type { Barbero } from "@/lib/tipos/agenda";

export const metadata = { title: "Barberos y horarios" };

function resumen(b: Barbero): string {
  const n = b.servicios.length;
  const servicios = n === 0 ? "Sin servicios asignados" : n === 1 ? "1 servicio" : `${n} servicios`;
  return b.acepta_reservas ? servicios : `${servicios} · No recibe reservas en línea`;
}

export default async function Barberos() {
  const { permitido } = await revisarPermiso("barberos");
  if (!permitido) return <SinPermiso />;

  const todos = await listarBarberos(true);
  const activos = todos.filter((b) => b.activo);
  const archivados = todos.filter((b) => !b.activo);

  return (
    <main className="px-4 pb-40 pt-[calc(1.25rem+env(safe-area-inset-top,0px))]">
      <h1 className="text-3xl font-semibold tracking-tight leading-tight">Barberos y horarios</h1>
      <p className="mt-1 text-base text-tinta-2">Quién atiende, qué servicios hace y cuándo trabaja.</p>

      {activos.length === 0 ? (
        <section className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-hueso p-4">
          <h2 className="text-xl font-semibold tracking-tight">Todavía no tienes barberos</h2>
          <p className="mt-2 text-base text-tinta-2">
            Agrega a quienes atienden (tú también, si cortas). Cada uno tendrá su propia agenda.
          </p>
        </section>
      ) : (
        <ul className="mt-5 space-y-3">
          {activos.map((b) => (
            <li key={b.id}>
              <EnlaceFila href={`/barberos/${b.id}`} titulo={b.nombre} detalle={resumen(b)} tenue={b.servicios.length === 0} />
            </li>
          ))}
        </ul>
      )}

      {archivados.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold tracking-tight">Archivados</h2>
          <p className="mt-1 text-base text-tinta-2">Ya no reciben citas, pero su historial se conserva.</p>
          <ul className="mt-3 space-y-3">
            {archivados.map((b) => (
              <li key={b.id} className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-4">
                <p className="mb-3 text-lg font-semibold leading-tight">{b.nombre}</p>
                <BotonActivoBarbero id={b.id} activar etiqueta="Restaurar" bloque />
              </li>
            ))}
          </ul>
        </section>
      )}

      <BarraAccion conNavegacion>
        <Link href="/barberos/nuevo" className={botonVariantes({ tamano: "lg", bloque: true })}>
          <Plus className="size-5" aria-hidden />
          Nuevo barbero
        </Link>
      </BarraAccion>
    </main>
  );
}
