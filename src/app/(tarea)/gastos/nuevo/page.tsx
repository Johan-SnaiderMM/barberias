import { FormularioGasto } from "@/components/gastos/formulario-gasto";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { abre } from "@/lib/areas";
import { revisarPermiso } from "@/lib/permisos";
import { nuevaClave } from "@/lib/reloj";

export const metadata = { title: "Registrar gasto" };

/** Un gasto rápido: cuánto, en qué, cómo se pagó y, si hay, la foto del recibo. */
export default async function NuevoGasto() {
  const { quien, permitido } = await revisarPermiso("gastos");
  if (!permitido) return <SinPermiso />;
  // Quien solo ve el cierre puede mirar los gastos, pero no registrarlos.
  if (!abre(quien.areas, "gastos")) return <SinPermiso />;

  return (
    <>
      <EncabezadoTarea titulo="Registrar gasto" volverA="/gastos" />
      <FormularioGasto clave={nuevaClave()} />
    </>
  );
}
