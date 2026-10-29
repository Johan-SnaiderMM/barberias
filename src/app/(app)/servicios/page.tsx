import Link from "@/components/ui/enlace";
import { ChevronRight, Plus } from "lucide-react";
import { BarraAccion } from "@/components/layout/barra-accion";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { BotonActivoServicio } from "@/components/servicios/boton-activo";
import { botonVariantes } from "@/components/ui/button";
import { textoDuracion } from "@/lib/catalogo";
import { listarServicios } from "@/lib/datos/servicios";
import { formatearPesos } from "@/lib/dinero";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Servicios y precios" };

export default async function Servicios() {
  const { permitido } = await revisarPermiso("servicios");
  if (!permitido) return <SinPermiso />;

  const todos = await listarServicios(true);
  const activos = todos.filter((s) => s.activo);
  const archivados = todos.filter((s) => !s.activo);

  return (
    <main className="px-4 pb-40 pt-[calc(1.25rem+env(safe-area-inset-top,0px))]">
      <h1 className="text-3xl font-semibold tracking-tight leading-tight">Servicios y precios</h1>
      <p className="mt-1 text-base text-tinta-2">Lo que ofreces, cuánto cuesta y cuánto dura cada uno.</p>

      {activos.length === 0 ? (
        <section className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-hueso p-4">
          <h2 className="text-xl font-semibold tracking-tight">Todavía no tienes servicios</h2>
          <p className="mt-2 text-base text-tinta-2">
            Crea el primero (por ejemplo, «Corte»). Es lo que tus clientes van a poder reservar.
          </p>
        </section>
      ) : (
        <ul className="mt-5 space-y-3">
          {activos.map((s) => (
            <li key={s.id}>
              <Link
                href={`/servicios/${s.id}`}
                className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-linea bg-white px-4 py-3 active:bg-hueso"
              >
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold leading-tight">{s.nombre}</span>
                  <span className="block text-base text-tinta-2">
                    {formatearPesos(s.precio)} · {textoDuracion(s.duracion_min)}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {archivados.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold tracking-tight">Archivados</h2>
          <p className="mt-1 text-base text-tinta-2">
            Ya no se ofrecen, pero siguen en las citas y los cobros que ya se hicieron.
          </p>
          <ul className="mt-3 space-y-3">
            {archivados.map((s) => (
              <li key={s.id} className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-4">
                <p className="text-lg font-semibold leading-tight">{s.nombre}</p>
                <p className="mb-3 text-base text-tinta-2">
                  {formatearPesos(s.precio)} · {textoDuracion(s.duracion_min)}
                </p>
                <BotonActivoServicio id={s.id} activar etiqueta="Restaurar" bloque />
              </li>
            ))}
          </ul>
        </section>
      )}

      <BarraAccion conNavegacion>
        <Link href="/servicios/nuevo" className={botonVariantes({ tamano: "lg", bloque: true })}>
          <Plus className="size-5" aria-hidden />
          Nuevo servicio
        </Link>
      </BarraAccion>
    </main>
  );
}
