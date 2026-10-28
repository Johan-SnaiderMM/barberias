import { FormularioCita } from "@/components/agenda/formulario-cita";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { alcanceAgenda } from "@/lib/areas";
import { listarBarberos } from "@/lib/datos/barberos";
import { obtenerFichaCliente } from "@/lib/datos/clientes";
import { barberoPropio } from "@/lib/datos/mi-barbero";
import { listarServicios } from "@/lib/datos/servicios";
import { hoyBogota } from "@/lib/fechas";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Nueva cita" };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export default async function NuevaCita({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; barbero?: string; cliente?: string }>;
}) {
  const { quien, permitido } = await revisarPermiso("agenda");
  if (!permitido) return <SinPermiso />;

  const parametros = await searchParams;
  const hoy = hoyBogota();
  const fecha = parametros.fecha && FECHA.test(parametros.fecha) && parametros.fecha >= hoy ? parametros.fecha : hoy;

  const [servicios, barberos] = await Promise.all([listarServicios(false), listarBarberos(false)]);
  const propio = alcanceAgenda(quien.areas) === "propia" ? await barberoPropio(barberos) : null;
  if (alcanceAgenda(quien.areas) === "propia" && !propio) {
    return <SinPermiso texto="Tu cuenta todavía no está vinculada con un barbero. Pídeselo al dueño." />;
  }

  const barberosConServicios = barberos.filter((b) => b.servicios.length > 0);
  const barberoInicial = barberos.some((b) => b.id === parametros.barbero) ? (parametros.barbero ?? null) : null;
  // Al agendar desde la ficha de un cliente, llega ya elegido (si el id no es de un cliente, se ignora).
  const clienteInicial =
    parametros.cliente && /^[0-9a-f-]{36}$/i.test(parametros.cliente)
      ? await obtenerFichaCliente(parametros.cliente).catch(() => null)
      : null;

  return (
    <>
      <EncabezadoTarea titulo="Nueva cita" volverA={`/agenda?fecha=${fecha}`} />
      {servicios.length === 0 || barberosConServicios.length === 0 ? (
        <section className="mx-4 mt-5 rounded-xl border border-dashed border-zinc-300 bg-hueso p-4">
          <h2 className="text-xl font-semibold tracking-tight">Falta configurar la agenda</h2>
          <p className="mt-2 text-base text-tinta-2">
            Para agendar hace falta al menos un servicio y un barbero que lo haga. Se crean en Más → Servicios y
            precios, y Más → Barberos y horarios.
          </p>
        </section>
      ) : (
        <FormularioCita
          modo="cita"
          servicios={servicios}
          barberos={barberosConServicios}
          barberoFijo={propio?.id ?? null}
          fechaInicial={fecha}
          barberoInicial={barberoInicial}
          hoy={hoy}
          clienteInicial={clienteInicial}
        />
      )}
    </>
  );
}
