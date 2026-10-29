import type { Metadata } from "next";
import Link from "@/components/ui/enlace";
import { BloqueResponsable, DocumentoLegal, SeccionLegal } from "@/components/legal/documento-legal";
import { obtenerResponsable } from "@/lib/datos/publico";
import { enlacesLegales, PLAZOS_LEGALES, slugDeLaDireccion, VERSION_LEGAL } from "@/lib/legal";
import { MARCA } from "@/lib/marca";

export const metadata: Metadata = { title: "Política de datos" };

// Muestra los datos de la barbería que se indica en la dirección (?b=<nombre-corto>): se lee en cada visita.
export const dynamic = "force-dynamic";

/**
 * Política de tratamiento de datos personales (Ley 1581 de 2012, Decreto 1377 de 2013 compilado en el Decreto 1074 de
 * 2015): lo que exige el art. 13 del decreto (responsable, finalidades, derechos, quién atiende, procedimiento y
 * vigencia). Se enlaza desde la reserva y desde la página de la cita. BORRADOR: un abogado la revisa antes de un piloto
 * con clientes reales (tarea 4.3; ver docs/legal).
 */
export default async function Privacidad({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const slug = slugDeLaDireccion((await searchParams).b);
  const responsable = await obtenerResponsable(slug);
  const { aviso } = enlacesLegales(slug);

  return (
    <DocumentoLegal titulo="Política de tratamiento de datos">
      <SeccionLegal titulo="1. Quién es el responsable">
        <p>
          El responsable del tratamiento de tus datos es la barbería donde reservas. Ella decide para qué se usan y quién
          los ve.
        </p>
        <BloqueResponsable responsable={responsable} />
        <p>
          {MARCA.nombre} es el encargado del tratamiento: la herramienta que aloja la agenda y las cuentas de la barbería.
          Solo trata los datos siguiendo las instrucciones de la barbería y para prestarle el servicio.
        </p>
      </SeccionLegal>

      <SeccionLegal titulo="2. Qué datos recogemos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Tu nombre y tu celular, que escribes al reservar (o que le dices al equipo si te agenda en el local).</li>
          <li>Los datos de tu cita: servicio, barbero, día, hora, precio y su estado (confirmada, atendida, cancelada).</li>
          <li>
            Lo que la barbería anote de tus visitas: cuánto pagaste, cómo pagaste y, si quiere, una nota sobre tu corte.
          </li>
          <li>La fecha y la hora en que aceptaste esta política.</li>
        </ul>
        <p>
          No pedimos documento de identidad, correo, dirección, fotos ni datos sensibles (salud, origen, ideas políticas
          o religiosas, datos biométricos). Si reservas para un menor de edad, usa tu nombre y tu celular, que son los de su
          representante: no recogemos datos del menor.
        </p>
      </SeccionLegal>

      <SeccionLegal titulo="3. Para qué los usamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Agendar, mover y cancelar tu cita, y avisarte si algo cambia.</li>
          <li>Recordarte la cita por WhatsApp o por llamada.</li>
          <li>Llevar el historial de tus visitas y tus preferencias en esa barbería.</li>
          <li>Registrar el cobro del servicio en las cuentas de la barbería.</li>
          <li>Atender tus consultas y reclamos.</li>
        </ul>
        <p>
          No los usamos para publicidad ni para otros fines, no los vendemos y no los cedemos a terceros. Si algún día la
          barbería quisiera usarlos para otra cosa, te pediría una nueva autorización.
        </p>
      </SeccionLegal>

      <SeccionLegal titulo="4. Tu autorización">
        <p>
          Al reservar en línea marcas una casilla donde autorizas este tratamiento; queda registrada la fecha y la hora. Si
          te agendan en el local, la barbería debe pedirte la autorización y avisarte de esta política. Autorizar es
          voluntario, pero sin tu nombre y tu celular no podemos agendar. Puedes retirar tu autorización cuando quieras.
        </p>
      </SeccionLegal>

      <SeccionLegal titulo="5. Quién ve tus datos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            El equipo de la barbería, según su rol: un barbero ve las citas que le tocan a él; recepción y el dueño ven la
            agenda completa.
          </li>
          <li>
            Quien administra {MARCA.nombre}, solo para dar soporte o resolver un problema, con el mismo deber de reserva.
          </li>
          <li>Otras personas que reservan nunca ven tu nombre ni tu celular: solo ven que una hora está ocupada.</li>
          <li>Tú, con el enlace secreto de tu cita, que recibes al reservar. Guárdalo: quien lo tenga puede ver tu cita.</li>
        </ul>
      </SeccionLegal>

      <SeccionLegal titulo="6. Dónde se guardan y con quién">
        <p>
          Los datos se guardan en servicios de infraestructura contratados por el encargado: Supabase (base de datos) y
          Vercel (alojamiento de la aplicación). Sus servidores pueden estar fuera de Colombia, así que tus datos pueden
          viajar al exterior para ser guardados y protegidos. Cuando el equipo te escribe por WhatsApp, esa conversación la
          rige además la política de WhatsApp.
        </p>
      </SeccionLegal>

      <SeccionLegal titulo="7. Cómo los protegemos">
        <p>
          Las conexiones van cifradas; cada persona del equipo entra con su propia cuenta y solo ve lo que su rol permite;
          los datos de cada barbería están separados de los de las demás; y la aplicación no usa cookies de seguimiento ni de
          publicidad.
        </p>
      </SeccionLegal>

      <SeccionLegal titulo="8. Cuánto tiempo los guardamos">
        <p>
          Mientras sigas siendo cliente de la barbería o hasta que pidas suprimirlos. Si los pides suprimir, la barbería los
          elimina o los deja sin tu nombre y tu celular, salvo lo que una norma obligue a conservar (por ejemplo, los
          registros de cobros), y te lo confirma.
        </p>
      </SeccionLegal>

      <SeccionLegal titulo="9. Tus derechos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Conocer, actualizar y corregir tus datos.</li>
          <li>Pedir prueba de la autorización que diste.</li>
          <li>Ser informado de cómo se han usado tus datos.</li>
          <li>Pedir que se supriman tus datos o retirar tu autorización.</li>
          <li>Consultar tus datos gratis.</li>
          <li>Presentar una queja ante la Superintendencia de Industria y Comercio, después de haber reclamado a la barbería.</li>
        </ul>
      </SeccionLegal>

      <SeccionLegal titulo="10. Cómo hacer una consulta o un reclamo">
        <p>
          Escríbele a la barbería (arriba están sus datos de contacto) diciendo tu nombre completo, el celular con el que
          reservaste y qué necesitas. La persona que atiende estas solicitudes es el dueño de la barbería o quien él designe.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Consultas (saber qué datos tiene de ti): respuesta en máximo {PLAZOS_LEGALES.consulta} días hábiles. Si necesita
            más tiempo, te avisa antes del vencimiento y responde en máximo {PLAZOS_LEGALES.consultaProrroga} días hábiles más.
          </li>
          <li>
            Reclamos (corregir, suprimir, retirar tu autorización o denunciar un incumplimiento): respuesta en máximo{" "}
            {PLAZOS_LEGALES.reclamo} días hábiles, prorrogables por {PLAZOS_LEGALES.reclamoProrroga} días hábiles más si te
            avisan el motivo. Si tu reclamo está incompleto, te piden lo que falta dentro de los 5 días siguientes.
          </li>
        </ul>
      </SeccionLegal>

      <SeccionLegal titulo="11. Vigencia y cambios">
        <p>
          Esta política es la versión {VERSION_LEGAL.version} del {VERSION_LEGAL.fecha}. Si cambia de forma importante, la
          nueva versión se publica en esta misma dirección. Los datos se tratan mientras dure la relación de la barbería con
          sus clientes y la que ella tenga con {MARCA.nombre}.
        </p>
        <Link href={aviso} className="inline-flex min-h-12 items-center font-medium text-tinta underline underline-offset-4">
          Leer el aviso de privacidad
        </Link>
      </SeccionLegal>
    </DocumentoLegal>
  );
}
