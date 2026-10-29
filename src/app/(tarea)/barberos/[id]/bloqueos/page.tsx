import { notFound } from "next/navigation";
import { BotonQuitarBloqueo } from "@/components/bloqueos/boton-quitar-bloqueo";
import { FormularioBloqueo } from "@/components/bloqueos/formulario-bloqueo";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { alcanceAgenda } from "@/lib/areas";
import { describirBloqueo } from "@/lib/bloqueos";
import { listarBarberos } from "@/lib/datos/barberos";
import { listarBloqueos } from "@/lib/datos/agenda";
import { hoyBogota } from "@/lib/fechas";
import { revisarPermiso } from "@/lib/permisos";
import { obtenerUsuario } from "@/lib/sesion";

export const metadata = { title: "Bloquear horario" };

export default async function BloqueosDelBarbero({ params }: { params: Promise<{ id: string }> }) {
  const { quien, permitido } = await revisarPermiso("bloqueos");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const barbero = (await listarBarberos(true)).find((b) => b.id === id);
  if (!barbero) notFound();

  // Quien solo abre "mi agenda" (el barbero) bloquea únicamente su propio tiempo. La base lo exige igual.
  if (alcanceAgenda(quien.areas) !== "todos") {
    const usuario = await obtenerUsuario();
    if (!usuario || barbero.user_id !== usuario.id) {
      return <SinPermiso texto="Solo puedes bloquear tu propio horario." />;
    }
  }

  const bloqueos = await listarBloqueos(barbero.id);

  return (
    <>
      <EncabezadoTarea titulo={`Bloquear a ${barbero.nombre}`} volverA={`/barberos/${barbero.id}`} />

      <section className="px-4 pt-5">
        <h2 className="text-xl font-semibold tracking-tight">Nuevo bloqueo</h2>
        <p className="mb-4 mt-1 text-base text-tinta-2">
          Un día libre, una cita médica, vacaciones… En ese rato no se podrá reservar.
        </p>
        {/* La llave cambia al agregar o quitar uno: así el formulario queda limpio después de guardar. */}
        <FormularioBloqueo key={bloqueos.map((b) => b.id).join(",")} barberoId={barbero.id} hoy={hoyBogota()} />
      </section>

      <section className="px-4 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Próximos bloqueos</h2>
        {bloqueos.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-hueso p-4 text-base text-tinta-2">
            No hay bloqueos por delante.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {bloqueos.map((b) => (
              <li key={b.id} className="rounded-xl border border-linea bg-superficie p-4">
                <p className="text-lg font-semibold leading-tight">{describirBloqueo(b.inicio, b.fin)}</p>
                {b.motivo && <p className="text-base text-tinta-2">{b.motivo}</p>}
                <div className="mt-3">
                  <BotonQuitarBloqueo id={b.id} barberoId={barbero.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
