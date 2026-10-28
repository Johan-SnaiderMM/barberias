import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { FormularioServicio } from "@/components/servicios/formulario-servicio";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Nuevo servicio" };

export default async function NuevoServicio() {
  const { permitido } = await revisarPermiso("servicios");
  if (!permitido) return <SinPermiso />;

  return (
    <>
      <EncabezadoTarea titulo="Nuevo servicio" volverA="/servicios" />
      <FormularioServicio />
    </>
  );
}
