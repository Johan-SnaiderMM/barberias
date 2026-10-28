import { notFound } from "next/navigation";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { BotonActivoServicio } from "@/components/servicios/boton-activo";
import { FormularioServicio } from "@/components/servicios/formulario-servicio";
import { listarServicios } from "@/lib/datos/servicios";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Editar servicio" };

export default async function EditarServicio({ params }: { params: Promise<{ id: string }> }) {
  const { permitido } = await revisarPermiso("servicios");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const servicio = (await listarServicios(true)).find((s) => s.id === id);
  if (!servicio) notFound();

  return (
    <>
      <EncabezadoTarea titulo={servicio.activo ? "Editar servicio" : "Servicio archivado"} volverA="/servicios" />
      {!servicio.activo && (
        <p className="mx-4 mt-4 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
          Este servicio está archivado: no se ofrece a los clientes. Puedes corregirlo y restaurarlo.
        </p>
      )}
      <FormularioServicio servicio={servicio} />
      <div className="px-4 pt-6">
        <BotonActivoServicio
          id={servicio.id}
          activar={!servicio.activo}
          etiqueta={servicio.activo ? "Archivar este servicio" : "Restaurar este servicio"}
          bloque
        />
        {servicio.activo && (
          <p className="mt-2 text-base text-tinta-2">
            Al archivarlo deja de ofrecerse, pero las citas y los cobros que ya hiciste lo conservan.
          </p>
        )}
      </div>
    </>
  );
}
