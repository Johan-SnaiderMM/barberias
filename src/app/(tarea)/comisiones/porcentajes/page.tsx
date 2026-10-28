import { Percent } from "lucide-react";
import { AjustePropina } from "@/components/comisiones/ajuste-propina";
import { EncabezadoTarea } from "@/components/layout/encabezado-tarea";
import { EnlaceFila } from "@/components/layout/enlace-fila";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { obtenerComisionesConfig } from "@/lib/datos/comisiones";
import { revisarPermiso } from "@/lib/permisos";
import type { ComisionDeBarbero } from "@/lib/tipos/comisiones";

export const metadata = { title: "Porcentajes de comisión" };

function detalle(b: ComisionDeBarbero, defecto: number): string {
  if (!b.definido) return `Sin definir: gana el ${defecto} % por defecto`;
  const n = b.excepciones.length;
  if (n === 0) return "Sin excepciones por servicio";
  return `${n} ${n === 1 ? "excepción" : "excepciones"}: ${b.excepciones.map((e) => e.servicio).join(", ")}`;
}

/** Cuánto gana cada barbero y de quién es la propina. Solo el área «comisiones». */
export default async function PorcentajesDeComision() {
  const { permitido } = await revisarPermiso("porcentajes");
  if (!permitido) return <SinPermiso />;

  const config = await obtenerComisionesConfig();
  const activos = config.barberos.filter((b) => b.activo);
  const archivados = config.barberos.filter((b) => !b.activo);

  const fila = (b: ComisionDeBarbero) => (
    <li key={b.id}>
      <EnlaceFila
        href={`/comisiones/porcentajes/${b.id}`}
        titulo={`${b.nombre} · ${b.pct} %`}
        detalle={detalle(b, config.defecto)}
        Icono={Percent}
        tenue={!b.definido}
      />
    </li>
  );

  return (
    <>
      <EncabezadoTarea titulo="Porcentajes de comisión" volverA="/mas" />
      <main className="space-y-8 px-4 pb-10 pt-5">
        <section>
          <p className="text-base text-tinta-2">
            Cuánto de cada servicio le toca a cada barbero. Cada cobro guarda el porcentaje con el que se hizo: si lo cambias, solo
            vale para los cobros que vienen.
          </p>
          {activos.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
              Todavía no hay barberos. Crea uno en «Barberos y horarios».
            </p>
          ) : (
            <ul className="mt-4 space-y-3">{activos.map(fila)}</ul>
          )}
        </section>

        <section>
          <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Propina</h2>
          <div className="mt-2">
            <AjustePropina delBarbero={config.propina_del_barbero} />
          </div>
        </section>

        {archivados.length > 0 && (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Archivados</h2>
            <ul className="mt-2 space-y-3">{archivados.map(fila)}</ul>
          </section>
        )}
      </main>
    </>
  );
}
