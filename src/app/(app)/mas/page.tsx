import {
  CalendarCog,
  HandCoins,
  LockKeyhole,
  LogOut,
  MapPin,
  Percent,
  QrCode,
  Receipt,
  Scissors,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { salir } from "@/app/acciones/sesion";
import { AvisosPush } from "@/components/avisos/avisos-push";
import { AvisoDemo } from "@/components/demo/aviso-demo";
import { BotonReiniciarDemo } from "@/components/demo/boton-reiniciar-demo";
import { EnlaceFila } from "@/components/layout/enlace-fila";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { Button } from "@/components/ui/button";
import { abre, puedeVer, type Pantalla } from "@/lib/areas";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Más" };

type Seccion = "cuentas" | "configuracion";
type Enlace = {
  seccion: Seccion;
  href: string;
  etiqueta: string;
  detalle: string;
  Icono: LucideIcon;
  pantalla: Pantalla;
  /** Cómo se llama para quien solo ve lo suyo (el barbero). */
  etiquetaPropia?: { etiqueta: string; detalle: string };
};

/** Cuentas y configuración de la barbería: cada enlace aparece solo si el rol abre esa pantalla. */
const ENLACES: Enlace[] = [
  {
    seccion: "cuentas",
    href: "/cierre",
    etiqueta: "Cierre del día",
    detalle: "Cuenta el efectivo, cierra y manda el resumen por WhatsApp",
    Icono: LockKeyhole,
    pantalla: "cierre",
  },
  {
    seccion: "cuentas",
    href: "/gastos",
    etiqueta: "Gastos",
    detalle: "Lo que se paga en la barbería, con foto del recibo",
    Icono: Receipt,
    pantalla: "gastos",
  },
  {
    seccion: "cuentas",
    href: "/comisiones",
    etiqueta: "Comisiones",
    detalle: "Lo que ganó cada barbero y lo que falta por pagarle",
    Icono: HandCoins,
    pantalla: "comisiones",
    etiquetaPropia: { etiqueta: "Mis comisiones", detalle: "Lo que has ganado y lo que te deben" },
  },
  {
    seccion: "configuracion",
    href: "/servicios",
    etiqueta: "Servicios y precios",
    detalle: "Qué ofreces, cuánto cuesta y cuánto dura",
    Icono: Scissors,
    pantalla: "servicios",
  },
  {
    seccion: "configuracion",
    href: "/barberos",
    etiqueta: "Barberos y horarios",
    detalle: "Quién atiende, qué hace y cuándo trabaja",
    Icono: Users,
    pantalla: "barberos",
  },
  {
    seccion: "configuracion",
    href: "/comisiones/porcentajes",
    etiqueta: "Porcentajes de comisión",
    detalle: "Cuánto gana cada barbero y de quién es la propina",
    Icono: Percent,
    pantalla: "porcentajes",
  },
  {
    seccion: "configuracion",
    href: "/equipo",
    etiqueta: "Equipo",
    detalle: "Invita a tu gente y decide qué puede hacer cada quien",
    Icono: UserPlus,
    pantalla: "equipo",
  },
  {
    seccion: "configuracion",
    href: "/cartel",
    etiqueta: "Cartel y enlace de reservas",
    detalle: "El QR para imprimir y el enlace para tus clientes",
    Icono: QrCode,
    pantalla: "cartel",
  },
  {
    seccion: "configuracion",
    href: "/contacto",
    etiqueta: "WhatsApp y dirección",
    detalle: "Cómo te escriben y a dónde llegan tus clientes",
    Icono: MapPin,
    pantalla: "contacto",
  },
  {
    seccion: "configuracion",
    href: "/ajustes-agenda",
    etiqueta: "Ajustes de la agenda",
    detalle: "Reservas en línea, horas, anticipación y descanso",
    Icono: CalendarCog,
    pantalla: "ajustes",
  },
];

export default async function Mas() {
  const { barberia, quien, permitido } = await revisarPermiso("mas");
  if (!permitido) return <SinPermiso />;

  const rol = quien.esDueno ? "Dueño" : quien.roles.length > 0 ? quien.roles.join(" · ") : "Sin rol asignado";
  const enlaces = ENLACES.filter((e) => puedeVer(quien, e.pantalla));
  const secciones: { clave: Seccion; titulo: string }[] = [
    { clave: "cuentas", titulo: "Cuentas" },
    { clave: "configuracion", titulo: "Configuración" },
  ];

  return (
    <main className="px-4 pb-6 pt-[calc(1.25rem+env(safe-area-inset-top,0px))]">
      <h1 className="text-3xl font-semibold tracking-tight leading-tight">Más</h1>

      <dl className="mt-5 divide-y divide-hueso rounded-xl border border-linea bg-white">
        <div className="px-4 py-3">
          <dt className="text-sm font-medium uppercase tracking-wider text-tinta-2">Barbería</dt>
          <dd className="mt-0.5 text-lg font-semibold">{barberia.nombre}</dd>
        </div>
        <div className="px-4 py-3">
          <dt className="text-sm font-medium uppercase tracking-wider text-tinta-2">Tú</dt>
          <dd className="mt-0.5 text-lg font-semibold">{quien.nombre}</dd>
          <dd className="text-base text-tinta-2">{rol}</dd>
        </div>
      </dl>

      {secciones.map(({ clave, titulo }) => {
        const deLaSeccion = enlaces.filter((e) => e.seccion === clave);
        if (deLaSeccion.length === 0) return null;
        return (
          <section key={clave} className="mt-6">
            <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">{titulo}</h2>
            <ul className="mt-2 space-y-3">
              {deLaSeccion.map(({ href, etiqueta, detalle, Icono, etiquetaPropia }) => {
                // Quien solo ve lo suyo (el barbero) lo ve con otro nombre.
                const propia = etiquetaPropia && !abre(quien.areas, "comisiones") ? etiquetaPropia : null;
                return (
                  <li key={href}>
                    <EnlaceFila href={href} titulo={propia?.etiqueta ?? etiqueta} detalle={propia?.detalle ?? detalle} Icono={Icono} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {/* La demo: se avisa que es de ejemplo y el dueño la puede reiniciar (borra lo que se hizo y recarga los datos). */}
      {barberia.es_demo && (
        <section className="mt-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Demostración</h2>
          <AvisoDemo className="mt-2" conRecorrido />
          {quien.esDueno && (
            <div className="mt-3">
              <BotonReiniciarDemo conPin={barberia.reinicio_con_pin} />
            </div>
          )}
        </section>
      )}

      {/* Quien ve citas (todas o las suyas) puede recibir avisos de reservas en este celular. */}
      {puedeVer(quien, "agenda") && (
        <div className="mt-6">
          <AvisosPush llavePublica={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null} />
        </div>
      )}

      <form action={salir} className="mt-8">
        <Button type="submit" variante="secundario" tamano="lg" bloque>
          <LogOut className="size-5" aria-hidden />
          {barberia.es_demo ? "Salir de la demo" : "Salir"}
        </Button>
      </form>
    </main>
  );
}
