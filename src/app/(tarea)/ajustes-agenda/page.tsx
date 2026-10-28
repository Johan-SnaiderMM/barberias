import { FormularioAjustes } from "@/components/ajustes/formulario-ajustes";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Ajustes de la agenda" };

export default async function AjustesAgenda() {
  const { barberia, permitido } = await revisarPermiso("ajustes");
  if (!permitido) return <SinPermiso />;

  return (
    <>
      <EncabezadoTarea titulo="Ajustes de la agenda" volverA="/mas" />
      <FormularioAjustes ajustes={barberia.agenda} slug={barberia.slug} />
    </>
  );
}
