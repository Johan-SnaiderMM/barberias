import Link from "@/components/ui/enlace";
import { notFound } from "next/navigation";
import { CircleCheck, Wallet } from "lucide-react";
import { AccionesCita } from "@/components/agenda/acciones-cita";
import { BotonRecordatorio } from "@/components/agenda/boton-recordatorio";
import { InsigniaEstado } from "@/components/agenda/insignia-estado";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { botonVariantes } from "@/components/ui/button";
import { puedeVer } from "@/lib/areas";
import { textoDuracion } from "@/lib/catalogo";
import { porCerrar } from "@/lib/citas";
import { datosCobro } from "@/lib/datos/caja";
import { obtenerCita } from "@/lib/datos/citas";
import { formatearPesos } from "@/lib/dinero";
import { fechaBogota, fechaCorta, fechaLarga, horaCorta, hoyBogota } from "@/lib/fechas";
import { revisarPermiso } from "@/lib/permisos";
import { ahoraMs as leerAhora } from "@/lib/reloj";
import { formatearTelefono } from "@/lib/telefono";
import { enlaceWhatsappA, mensajeRecordatorio } from "@/lib/whatsapp";

export const metadata = { title: "Cita" };

/** "hoy a las 3:15 p. m." o "mar 13 oct a las 3:15 p. m.": cuándo se mandó el último recordatorio. */
function cuandoSeRecordo(iso: string): string {
  const dia = fechaBogota(iso);
  return `${dia === hoyBogota() ? "hoy" : fechaCorta(dia)} a las ${horaCorta(iso)}`;
}

export default async function DetalleCita({ params }: { params: Promise<{ id: string }> }) {
  const { barberia, quien, permitido } = await revisarPermiso("agenda");
  if (!permitido) return <SinPermiso />;

  const { id } = await params;
  const cita = await obtenerCita(id);
  if (!cita) notFound();

  // Quien cobra (área caja) ve si la cita ya se cobró o puede cobrarla.
  const cobro = puedeVer(quien, "caja") ? await datosCobro(id) : null;
  const cobrable = cita.estado === "confirmada" || cita.estado === "en_atencion" || cita.estado === "atendida";

  const ahoraMs = leerAhora();
  const fecha = fechaBogota(cita.inicio);
  const yaEmpezo = new Date(cita.inicio).getTime() <= ahoraMs;

  const filas: [string, string][] = [
    ["Servicio", `${cita.servicio} · ${textoDuracion(cita.duracion_min)}`],
    ["Barbero", cita.barbero],
    ["Precio", formatearPesos(cita.precio)],
    ["Reservó", cita.origen === "cliente" ? "El cliente, en línea" : "El equipo"],
  ];
  if (cita.notas) filas.push(["Nota", cita.notas]);
  if (cita.estado === "cancelada" && cita.cancelada_motivo) filas.push(["Motivo", cita.cancelada_motivo]);

  // El recordatorio solo tiene sentido para una cita confirmada; sin celular, `enlace` es null.
  const enlaceRecordatorio = enlaceWhatsappA(
    cita.telefono,
    mensajeRecordatorio({
      cliente: cita.cliente,
      barberia: barberia.nombre,
      servicio: cita.servicio,
      barbero: cita.barbero,
      dia: fechaLarga(fecha).toLowerCase(),
      hora: horaCorta(cita.inicio),
    })
  );

  return (
    <>
      <EncabezadoTarea titulo="Cita" volverA={`/agenda?fecha=${fecha}`} />
      <main className="space-y-5 px-4 pt-5">
        <section className="rounded-xl border border-linea bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">{fechaLarga(fecha)}</p>
            <InsigniaEstado estado={cita.estado} porCerrar={porCerrar(cita, ahoraMs)} />
          </div>
          <p className="mt-1 whitespace-nowrap text-2xl font-semibold tracking-tight leading-tight">
            {horaCorta(cita.inicio)} – {horaCorta(cita.fin)}
          </p>
          <p className="mt-3 text-xl font-semibold leading-tight">{cita.cliente}</p>
          {cita.reservo_como && (
            <p className="text-base text-tinta-2">
              Reservó en línea con otro nombre: «{cita.reservo_como}». Revisa que sea la persona de la ficha.
            </p>
          )}
          <p className="text-base text-tinta-2">
            {cita.telefono ? formatearTelefono(cita.telefono) : "Sin celular"}
          </p>
          {cita.estado === "confirmada" && (
            <div className="mt-3">
              <BotonRecordatorio
                id={cita.id}
                clienteId={cita.cliente_id}
                enlace={enlaceRecordatorio}
                enviado={cita.recordatorio_enviado_at ? cuandoSeRecordo(cita.recordatorio_enviado_at) : null}
              />
            </div>
          )}

          <dl className="mt-4 divide-y divide-hueso border-t border-hueso">
            {filas.map(([etiqueta, valor]) => (
              <div key={etiqueta} className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-sm font-medium uppercase tracking-wider text-tinta-2">{etiqueta}</dt>
                <dd className="text-right text-base font-semibold">{valor}</dd>
              </div>
            ))}
          </dl>
        </section>

        {cobro?.cobro_id ? (
          <Link
            href={`/caja/cobro/${cobro.cobro_id}`}
            className="flex min-h-14 items-center gap-3 rounded-xl border border-linea bg-white px-4 active:bg-hueso"
          >
            <CircleCheck className="size-6 shrink-0" aria-hidden />
            <span className="text-base font-medium">Cobrada · ver el cobro</span>
          </Link>
        ) : (
          cobro &&
          cobrable && (
            <Link
              href={`/caja/cobrar/${cita.id}`}
              className={botonVariantes({
                variante: cita.estado === "confirmada" ? "secundario" : "primario",
                tamano: "lg",
                bloque: true,
              })}
            >
              <Wallet className="size-5" aria-hidden />
              Cobrar · {formatearPesos(cita.precio)}
            </Link>
          )
        )}

        <AccionesCita id={cita.id} estado={cita.estado} yaEmpezo={yaEmpezo} volver={fecha} cobrada={Boolean(cobro?.cobro_id)} />
      </main>
    </>
  );
}
