import Link from "next/link";
import { notFound } from "next/navigation";
import { FormularioServiciosBarbero } from "@/components/barberos/formulario-servicios-barbero";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { botonVariantes } from "@/components/ui/button";
import { listarBarberos } from "@/lib/datos/barberos";
import { listarServicios } from "@/lib/datos/servicios";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Servicios del barbero" };

export default async function ServiciosDelBarbero({ params }: { params: Promise<{ id: string }> }) {
  const { permitido } = await revisarPermiso("barberos");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const [barberos, servicios] = await Promise.all([listarBarberos(true), listarServicios(false)]);
  const barbero = barberos.find((b) => b.id === id);
  if (!barbero) notFound();

  return (
    <>
      <EncabezadoTarea titulo="Servicios que hace" volverA={`/barberos/${barbero.id}`} />
      {servicios.length === 0 ? (
        <section className="mx-4 mt-5 rounded-xl border border-dashed border-zinc-300 bg-hueso p-4">
          <h2 className="text-xl font-semibold tracking-tight">Primero crea servicios</h2>
          <p className="mt-2 text-base text-tinta-2">
            Todavía no hay servicios en el catálogo, así que no hay nada que asignarle a {barbero.nombre}.
          </p>
          <Link href="/servicios/nuevo" className={`${botonVariantes({ tamano: "lg", bloque: true })} mt-4`}>
            Crear un servicio
          </Link>
        </section>
      ) : (
        <FormularioServiciosBarbero
          barberoId={barbero.id}
          nombreBarbero={barbero.nombre}
          servicios={servicios}
          asignados={barbero.servicios}
        />
      )}
    </>
  );
}
