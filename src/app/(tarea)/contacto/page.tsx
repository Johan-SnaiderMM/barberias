import { FormularioContacto } from "@/components/contacto/formulario-contacto";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "WhatsApp y dirección" };

export default async function Contacto() {
  const { barberia, permitido } = await revisarPermiso("contacto");
  if (!permitido) return <SinPermiso />;

  return (
    <>
      <EncabezadoTarea titulo="WhatsApp y dirección" volverA="/mas" />
      <FormularioContacto whatsapp={barberia.whatsapp} direccion={barberia.direccion} nombreBarberia={barberia.nombre} />
    </>
  );
}
