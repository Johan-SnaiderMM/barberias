import { FormularioCliente } from "@/components/clientes/formulario-cliente";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { abre } from "@/lib/areas";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Nuevo cliente" };

export default async function NuevoCliente() {
  const { quien, permitido } = await revisarPermiso("clientes");
  // Dar de alta clientes es de recepción (área "agenda"); la base lo exige igual.
  if (!permitido || !abre(quien.areas, "agenda")) return <SinPermiso />;

  return (
    <>
      <EncabezadoTarea titulo="Nuevo cliente" volverA="/clientes" />
      <FormularioCliente />
    </>
  );
}
