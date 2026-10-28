import { FormularioInvitacion } from "@/components/equipo/formulario-invitacion";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { listarBarberos } from "@/lib/datos/barberos";
import { listarEquipo } from "@/lib/datos/equipo";
import { revisarPermiso } from "@/lib/permisos";

export const metadata = { title: "Invitar" };

export default async function Invitar() {
  const { quien, permitido } = await revisarPermiso("equipo");
  if (!permitido) return <SinPermiso />;

  const [equipo, barberos] = await Promise.all([listarEquipo(), listarBarberos(false)]);
  // Solo se dan roles cuyas áreas ya se tienen (la base lo exige igual).
  const mias = new Set<string>(quien.areas);
  const asignables = equipo.roles.filter((r) => r.areas.every((a) => mias.has(a))).map((r) => r.id);
  const sinCuenta = barberos.filter((b) => b.activo && b.user_id === null).map((b) => ({ id: b.id, nombre: b.nombre }));

  return (
    <>
      <EncabezadoTarea titulo="Invitar al equipo" volverA="/equipo" />
      <FormularioInvitacion roles={equipo.roles} asignables={asignables} barberos={sinCuenta} />
    </>
  );
}
