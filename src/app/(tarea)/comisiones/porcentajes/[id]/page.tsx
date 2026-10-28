import { notFound } from "next/navigation";
import { FormularioComisiones } from "@/components/comisiones/formulario-comisiones";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { obtenerComisionesConfig } from "@/lib/datos/comisiones";
import { listarServicios } from "@/lib/datos/servicios";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Comisión del barbero" };

export default async function ComisionDeBarbero({ params }: { params: Promise<{ id: string }> }) {
  const { permitido } = await revisarPermiso("porcentajes");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const [config, servicios] = await Promise.all([obtenerComisionesConfig(), listarServicios(false)]);
  const barbero = config.barberos.find((b) => b.id === id);
  if (!barbero) notFound();

  return (
    <>
      <EncabezadoTarea titulo={`Comisión de ${barbero.nombre}`} volverA="/comisiones/porcentajes" />
      <FormularioComisiones
        barberoId={barbero.id}
        nombre={barbero.nombre}
        pct={barbero.pct}
        servicios={servicios.map((s) => ({ id: s.id, nombre: s.nombre, precio: s.precio }))}
        excepciones={barbero.excepciones}
      />
    </>
  );
}
