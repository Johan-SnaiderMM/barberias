import { notFound } from "next/navigation";
import { CalendarClock, CalendarOff, Scissors } from "lucide-react";
import { BotonActivoBarbero } from "@/components/barberos/boton-activo-barbero";
import { FormularioBarbero } from "@/components/barberos/formulario-barbero";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { EnlaceFila } from "@/components/layout/enlace-fila";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { puedeVer } from "@/lib/areas";
import { listarBarberos } from "@/lib/datos/barberos";
import { listarServicios } from "@/lib/datos/servicios";
import { diasQueTrabaja } from "@/lib/horarios";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Barbero" };

export default async function FichaBarbero({ params }: { params: Promise<{ id: string }> }) {
  const { quien, permitido } = await revisarPermiso("barberos");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const [barberos, servicios] = await Promise.all([listarBarberos(true), listarServicios(false)]);
  const barbero = barberos.find((b) => b.id === id);
  if (!barbero) notFound();

  const activos = new Set(servicios.map((s) => s.id));
  const hace = barbero.servicios.filter((s) => activos.has(s.servicio_id)).length;
  const dias = diasQueTrabaja(barbero.horario);

  return (
    <>
      <EncabezadoTarea titulo={barbero.activo ? barbero.nombre : "Barbero archivado"} volverA="/barberos" />
      {!barbero.activo && (
        <p className="mx-4 mt-4 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
          Este barbero está archivado: ya no recibe citas. Puedes restaurarlo.
        </p>
      )}

      <FormularioBarbero barbero={barbero} />

      <section className="px-4 pt-8">
        <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Qué hace y cuándo</h2>
        <ul className="mt-2 space-y-3">
          <li>
            <EnlaceFila
              href={`/barberos/${barbero.id}/servicios`}
              titulo="Servicios que hace"
              detalle={
                hace === 0
                  ? "Ninguno todavía: sin servicios no se le puede reservar"
                  : hace === 1
                    ? "1 servicio"
                    : `${hace} servicios`
              }
              Icono={Scissors}
              tenue={hace === 0}
            />
          </li>
          <li>
            <EnlaceFila
              href={`/barberos/${barbero.id}/horario`}
              titulo="Horario semanal"
              detalle={
                dias === 0
                  ? "Sin horario: no tendrá horas libres"
                  : dias === 1
                    ? "Trabaja 1 día a la semana"
                    : `Trabaja ${dias} días a la semana`
              }
              Icono={CalendarClock}
              tenue={dias === 0}
            />
          </li>
          {puedeVer(quien, "bloqueos") && (
            <li>
              <EnlaceFila
                href={`/barberos/${barbero.id}/bloqueos`}
                titulo="Bloquear horario"
                detalle="Días libres, citas médicas, vacaciones"
                Icono={CalendarOff}
              />
            </li>
          )}
        </ul>
      </section>

      <div className="px-4 pt-8">
        <BotonActivoBarbero
          id={barbero.id}
          activar={!barbero.activo}
          etiqueta={barbero.activo ? "Archivar este barbero" : "Restaurar este barbero"}
          bloque
        />
        {barbero.activo && (
          <p className="mt-2 text-base text-tinta-2">
            Al archivarlo deja de recibir citas, pero su historial y sus cobros se conservan.
          </p>
        )}
      </div>
    </>
  );
}
