import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { BarraAccion } from "@/components/layout/barra-accion";
import { EnlaceFila } from "@/components/layout/enlace-fila";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { Button, botonVariantes } from "@/components/ui/button";
import { abre } from "@/lib/areas";
import { listarClientes } from "@/lib/datos/clientes";
import { fechaCorta, fechaBogota } from "@/lib/fechas";
import { revisarPermiso } from "@/lib/permisos";
import { formatearTelefono } from "@/lib/telefono";

export const metadata = { title: "Clientes" };

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { quien, permitido } = await revisarPermiso("clientes");
  if (!permitido) return <SinPermiso />;

  const { q } = await searchParams;
  const texto = (q ?? "").trim().slice(0, 60);
  const clientes = await listarClientes(texto);
  const puedeCrear = abre(quien.areas, "agenda");

  return (
    <main className="px-4 pb-40 pt-[calc(1.25rem+env(safe-area-inset-top,0px))]">
      <h1 className="text-3xl font-semibold tracking-tight leading-tight">Clientes</h1>

      {/* Búsqueda sin JavaScript: es un formulario GET a esta misma página. */}
      <form action="/clientes" className="mt-4 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={texto}
          maxLength={60}
          autoComplete="off"
          placeholder="Nombre o celular"
          aria-label="Buscar cliente por nombre o celular"
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-borde-campo bg-white px-3 text-base text-tinta placeholder:text-tinta-2"
        />
        <Button type="submit" aria-label="Buscar">
          <Search className="size-5" aria-hidden />
        </Button>
      </form>

      <p className="mt-4 text-base text-tinta-2">
        {texto === ""
          ? "Los más recientes primero."
          : clientes.length === 0
            ? `Nadie coincide con «${texto}».`
            : clientes.length === 1
              ? "1 cliente."
              : `${clientes.length} clientes.`}
      </p>

      {clientes.length === 0 && texto === "" ? (
        <section className="mt-3 rounded-xl border border-dashed border-zinc-300 bg-hueso p-4">
          <h2 className="text-xl font-semibold tracking-tight">Todavía no hay clientes</h2>
          <p className="mt-2 text-base text-tinta-2">
            Se crean solos cuando agendas una cita con su celular, o puedes agregarlos tú.
          </p>
        </section>
      ) : (
        <ul className="mt-3 space-y-3">
          {clientes.map((c) => {
            const partes = [
              c.telefono ? formatearTelefono(c.telefono) : "Sin celular",
              c.visitas === 1 ? "1 visita" : `${c.visitas} visitas`,
            ];
            if (c.ultima_visita) partes.push(`última ${fechaCorta(fechaBogota(c.ultima_visita))}`);
            if (c.no_asistio > 0) partes.push(c.no_asistio === 1 ? "no llegó 1 vez" : `no llegó ${c.no_asistio} veces`);
            return (
              <li key={c.id}>
                <EnlaceFila href={`/clientes/${c.id}`} titulo={c.nombre} detalle={partes.join(" · ")} />
              </li>
            );
          })}
        </ul>
      )}

      {puedeCrear && (
        <BarraAccion conNavegacion>
          <Link href="/clientes/nuevo" className={botonVariantes({ tamano: "lg", bloque: true })}>
            <Plus className="size-5" aria-hidden />
            Nuevo cliente
          </Link>
        </BarraAccion>
      )}
    </main>
  );
}
