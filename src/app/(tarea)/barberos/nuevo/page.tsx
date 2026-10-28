import { FormularioBarbero } from "@/components/barberos/formulario-barbero";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Nuevo barbero" };

export default async function NuevoBarbero() {
  const { permitido } = await revisarPermiso("barberos");
  if (!permitido) return <SinPermiso />;

  return (
    <>
      <EncabezadoTarea titulo="Nuevo barbero" volverA="/barberos" />
      <FormularioBarbero />
    </>
  );
}
