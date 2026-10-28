import { notFound } from "next/navigation";
import { FormularioCobro } from "@/components/caja/formulario-cobro";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { datosCobro } from "@/lib/datos/caja";
import { revisarPermiso } from "@/lib/permisos";
import { nuevaClave } from "@/lib/reloj";

export const metadata = { title: "Cobrar" };

/**
 * Cobrar una cita. Si ya está cobrada o es de una cita cancelada, el propio formulario lo dice (ver `bloqueo`): la
 * página no cambia de pantalla porque, al cobrar, el servidor la refresca y la confirmación se perdería.
 */
export default async function CobrarCita({ params }: { params: Promise<{ id: string }> }) {
  const { permitido } = await revisarPermiso("caja");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const datos = await datosCobro(id);
  const cita = datos.cita;
  if (!cita) notFound();

  const bloqueo = datos.cobro_id
    ? ({ tipo: "cobrada", cobroId: datos.cobro_id } as const)
    : cita.estado === "cancelada" || cita.estado === "no_asistio"
      ? ({ tipo: "no_cobrable", estado: cita.estado } as const)
      : null;

  return <FormularioCobro clave={nuevaClave()} cita={cita} barberos={datos.barberos} servicios={datos.servicios} bloqueo={bloqueo} />;
}
