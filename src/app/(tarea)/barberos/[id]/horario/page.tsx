import { notFound } from "next/navigation";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { FormularioHorario } from "@/components/horarios/formulario-horario";
import { listarBarberos } from "@/lib/datos/barberos";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Horario del barbero" };

export default async function HorarioDelBarbero({ params }: { params: Promise<{ id: string }> }) {
  const { permitido } = await revisarPermiso("barberos");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const barbero = (await listarBarberos(true)).find((b) => b.id === id);
  if (!barbero) notFound();

  return (
    <>
      <EncabezadoTarea titulo="Horario semanal" volverA={`/barberos/${barbero.id}`} />
      <FormularioHorario barberoId={barbero.id} nombreBarbero={barbero.nombre} franjas={barbero.horario} />
    </>
  );
}
