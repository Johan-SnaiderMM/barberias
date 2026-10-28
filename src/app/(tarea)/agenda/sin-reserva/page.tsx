import { FormularioCita } from "@/components/agenda/formulario-cita";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { alcanceAgenda } from "@/lib/areas";
import { listarBarberos } from "@/lib/datos/barberos";
import { barberoPropio } from "@/lib/datos/mi-barbero";
import { listarServicios } from "@/lib/datos/servicios";
import { hoyBogota } from "@/lib/fechas";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Llegó sin cita" };

export default async function LlegoSinCita() {
  const { quien, permitido } = await revisarPermiso("agenda");
  if (!permitido) return <SinPermiso />;

  const hoy = hoyBogota();
  const [servicios, barberos] = await Promise.all([listarServicios(false), listarBarberos(false)]);
  const propio = alcanceAgenda(quien.areas) === "propia" ? await barberoPropio(barberos) : null;
  if (alcanceAgenda(quien.areas) === "propia" && !propio) {
    return <SinPermiso texto="Tu cuenta todavía no está vinculada con un barbero. Pídeselo al dueño." />;
  }

  const barberosConServicios = barberos.filter((b) => b.servicios.length > 0);

  return (
    <>
      <EncabezadoTarea titulo="Llegó sin cita" volverA={`/agenda?fecha=${hoy}`} />
      {servicios.length === 0 || barberosConServicios.length === 0 ? (
        <section className="mx-4 mt-5 rounded-xl border border-dashed border-zinc-300 bg-hueso p-4">
          <h2 className="text-xl font-semibold tracking-tight">Falta configurar la agenda</h2>
          <p className="mt-2 text-base text-tinta-2">
            Hace falta al menos un servicio y un barbero que lo haga (Más → Servicios y precios, y Barberos y horarios).
          </p>
        </section>
      ) : (
        <FormularioCita
          modo="ahora"
          servicios={servicios}
          barberos={barberosConServicios}
          barberoFijo={propio?.id ?? null}
          fechaInicial={hoy}
          barberoInicial={null}
          hoy={hoy}
        />
      )}
    </>
  );
}
