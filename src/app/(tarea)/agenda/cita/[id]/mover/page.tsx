import { notFound, redirect } from "next/navigation";
import { FormularioMover } from "@/components/agenda/formulario-mover";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { obtenerCita } from "@/lib/datos/citas";
import { fechaBogota, fechaLarga, hoyBogota, horaCorta } from "@/lib/fechas";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Mover cita" };

export default async function MoverCita({ params }: { params: Promise<{ id: string }> }) {
  const { permitido } = await revisarPermiso("agenda");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const cita = await obtenerCita(id);
  if (!cita) notFound();
  // Solo se mueven las confirmadas: cualquier otra vuelve a su detalle (ahí se ve qué se puede hacer).
  if (cita.estado !== "confirmada") redirect(`/agenda/cita/${id}`);

  const hoy = hoyBogota();
  const dia = fechaBogota(cita.inicio);

  return (
    <>
      <EncabezadoTarea titulo="Mover cita" volverA={`/agenda/cita/${cita.id}`} />
      <p className="mx-4 mt-4 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base">
        <strong>{cita.cliente}</strong> · {cita.servicio}
        <br />
        Ahora: {fechaLarga(dia).toLowerCase()}, {horaCorta(cita.inicio)}
      </p>
      <FormularioMover
        citaId={cita.id}
        servicioId={cita.servicio_id}
        barberoId={cita.barbero_id}
        barbero={cita.barbero}
        fechaInicial={dia < hoy ? hoy : dia}
        hoy={hoy}
      />
    </>
  );
}
