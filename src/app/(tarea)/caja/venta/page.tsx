import { FormularioCobro } from "@/components/caja/formulario-cobro";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { datosCobro } from "@/lib/datos/caja";
import { revisarPermiso } from "@/lib/permisos";
import { nuevaClave } from "@/lib/reloj";

export const metadata = { title: "Venta sin cita" };

/** Cobrar algo que no tuvo cita: se elige qué barbero atendió y se arma el cobro. */
export default async function VentaSinCita() {
  const { permitido } = await revisarPermiso("caja");
  if (!permitido) return <SinPermiso />;

  const datos = await datosCobro();
  if (datos.barberos.length === 0) {
    return (
      <>
        <EncabezadoTarea titulo="Venta sin cita" volverA="/caja" />
        <main className="px-4 pt-6">
          <p className="rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
            Primero crea un barbero en Más → Barberos y horarios: a él se le asigna lo que se cobre.
          </p>
        </main>
      </>
    );
  }

  return <FormularioCobro clave={nuevaClave()} cita={null} barberos={datos.barberos} servicios={datos.servicios} />;
}
