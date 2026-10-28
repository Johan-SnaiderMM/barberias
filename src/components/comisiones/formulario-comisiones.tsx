"use client";

import { useActionState, useState } from "react";
import { guardarComisionesBarbero } from "@/app/acciones/comisiones";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmentado } from "@/components/ui/segmentado";
import { esPorcentajeValido, formatearPesos, porcentajeDe, type Pesos } from "@/lib/dinero";
import type { EstadoForm } from "@/lib/errores";
import type { ExcepcionComision } from "@/lib/tipos/comisiones";

/** Los porcentajes que más se usan, a un toque. */
const ATAJOS = [40, 50, 60, 70] as const;
/** Con qué monto se ilustra el reparto del porcentaje base. */
const EJEMPLO: Pesos = 10_000;

/** Solo dígitos y nunca más de 100 ("" = vacío). */
function soloPorcentaje(texto: string): string {
  const digitos = texto.replace(/\D/g, "").slice(0, 3);
  return digitos === "" ? "" : String(Math.min(Number(digitos), 100));
}

/**
 * Cuánto gana un barbero: un porcentaje base y, si en algún servicio gana distinto, una excepción. Lo guardado vale
 * para los cobros que vienen; los ya hechos conservan el porcentaje con el que se cobraron.
 * Las excepciones viajan como JSON en el campo `excepciones` (la lista completa: lo que queda vacío se quita).
 */
export function FormularioComisiones({
  barberoId,
  nombre,
  pct,
  servicios,
  excepciones,
}: {
  barberoId: string;
  nombre: string;
  pct: number;
  /** Solo los servicios activos del catálogo. */
  servicios: { id: string; nombre: string; precio: Pesos }[];
  excepciones: ExcepcionComision[];
}) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(guardarComisionesBarbero, { error: null });
  const [base, setBase] = useState(String(pct));
  const [filas, setFilas] = useState<Record<string, string>>(() =>
    Object.fromEntries(excepciones.map((e) => [e.servicio_id, String(e.pct)]))
  );

  const baseNum = base === "" ? null : Number(base);
  const baseValida = baseNum !== null && esPorcentajeValido(baseNum);
  const lista = servicios
    .filter((s) => (filas[s.id] ?? "") !== "")
    .map((s) => ({ servicio_id: s.id, pct: Number(filas[s.id]) }));

  return (
    <form action={accion} className="px-4 pb-40 pt-5">
      <input type="hidden" name="barbero_id" value={barberoId} />
      <input type="hidden" name="pct" value={base} />
      <input type="hidden" name="excepciones" value={JSON.stringify(lista)} />

      <section>
        <Label htmlFor="pct_base">Porcentaje base de {nombre}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="pct_base"
            inputMode="numeric"
            autoComplete="off"
            value={base}
            onChange={(e) => setBase(soloPorcentaje(e.target.value))}
            className="text-2xl font-semibold"
          />
          <span aria-hidden className="text-2xl font-semibold tracking-tight">
            %
          </span>
        </div>
        <div className="mt-3">
          <Segmentado<number>
            etiqueta="Porcentajes frecuentes"
            valor={baseNum ?? -1}
            onCambio={(v) => setBase(String(v))}
            opciones={ATAJOS.map((v) => ({ valor: v, etiqueta: String(v) }))}
          />
        </div>
        {baseValida ? (
          <p className="mt-3 text-base text-tinta-2">
            De cada {formatearPesos(EJEMPLO)} que cobra, {nombre} gana {formatearPesos(porcentajeDe(EJEMPLO, baseNum))} y la barbería{" "}
            {formatearPesos(EJEMPLO - porcentajeDe(EJEMPLO, baseNum))}.
          </p>
        ) : (
          <p role="alert" className="mt-3 text-base font-semibold text-rojo">
            Escribe un porcentaje de 0 a 100.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wider text-tinta-2">Si en un servicio gana distinto</h2>
        <p className="mt-1 text-base text-tinta-2">Escribe su porcentaje. Si lo dejas vacío, usa el base.</p>
        {servicios.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
            Todavía no hay servicios en el catálogo.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {servicios.map((s) => {
              const valor = filas[s.id] ?? "";
              const efectivo = valor === "" ? baseNum : Number(valor);
              return (
                <li key={s.id} className="rounded-xl border border-linea bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold leading-tight">{s.nombre}</span>
                      <span className="block text-base text-tinta-2">{formatearPesos(s.precio)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Input
                        aria-label={`Porcentaje de ${nombre} en ${s.nombre}`}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder={baseValida ? String(baseNum) : "-"}
                        value={valor}
                        onChange={(e) => setFilas((f) => ({ ...f, [s.id]: soloPorcentaje(e.target.value) }))}
                        className="w-20 text-center"
                      />
                      <span aria-hidden className="text-lg font-semibold">
                        %
                      </span>
                    </span>
                  </div>
                  {efectivo !== null && esPorcentajeValido(efectivo) && (
                    <p className="mt-1.5 text-base text-tinta-2">
                      {nombre} gana {formatearPesos(porcentajeDe(s.precio, efectivo))}
                      {valor === "" ? " (el base)" : ""}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <BarraAccion>
        {estado.error && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {estado.error}
          </p>
        )}
        <Button type="submit" tamano="lg" bloque disabled={pendiente || !baseValida}>
          {pendiente ? "Guardando…" : "Guardar"}
        </Button>
      </BarraAccion>
    </form>
  );
}
