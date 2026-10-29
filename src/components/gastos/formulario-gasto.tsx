"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registrarGasto } from "@/app/acciones/gastos";
import { HojaMonto } from "@/components/caja/hoja-monto";
import { CampoFoto } from "@/components/gastos/campo-foto";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmentado } from "@/components/ui/segmentado";
import { formatearPesos, type MedioPago } from "@/lib/dinero";
import { CATEGORIAS_GASTO, ETIQUETA_CATEGORIA, GASTO_MAXIMO, NOTA_GASTO_MAXIMA, type CategoriaGasto } from "@/lib/gastos";
import { cn } from "@/lib/utils";

/** Montos de un toque para escribir un gasto. */
const ATAJOS = [
  { etiqueta: "$ 10.000", valor: 10_000 },
  { etiqueta: "$ 20.000", valor: 20_000 },
  { etiqueta: "$ 50.000", valor: 50_000 },
  { etiqueta: "$ 100.000", valor: 100_000 },
];

/** El título de un grupo de campos (no es una etiqueta de un solo campo, por eso no es un <label>). */
function Titulo({ children }: { children: string }) {
  return <p className="mb-1.5 block text-sm font-medium uppercase tracking-wider text-tinta-2">{children}</p>;
}

/**
 * Registrar un gasto rápido: cuánto → en qué → cómo se pagó → (foto del recibo) → guardar. Todo queda controlado en
 * estado para que, si falla, no se pierda lo escrito. La `clave` se fija al abrir la pantalla: tocar dos veces, o
 * reintentar con mala señal, no registra dos veces (y es el nombre de la foto).
 */
export function FormularioGasto({ clave: claveInicial }: { clave: string }) {
  const router = useRouter();
  const [clave] = useState(claveInicial);
  const [monto, setMonto] = useState(0);
  const [categoria, setCategoria] = useState<CategoriaGasto | null>(null);
  const [medio, setMedio] = useState<MedioPago>("efectivo");
  const [nota, setNota] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [hojaMonto, setHojaMonto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, empezar] = useTransition();

  const listo = monto > 0 && categoria !== null;

  function guardar() {
    if (!listo || enviando) return;
    setError(null);
    empezar(async () => {
      const datos = new FormData();
      datos.set("clave", clave);
      datos.set("monto", String(monto));
      datos.set("categoria", categoria);
      datos.set("medio", medio);
      datos.set("nota", nota);
      if (foto) datos.set("foto", foto);
      const r = await registrarGasto(datos);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/gastos");
    });
  }

  return (
    <div className="px-4 pb-40 pt-5">
      <section>
        <Titulo>Cuánto fue</Titulo>
        <button
          type="button"
          onClick={() => setHojaMonto(true)}
          className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-linea bg-superficie px-4 text-left active:bg-hueso"
        >
          <span className={cn("text-4xl font-semibold tracking-tight", monto === 0 && "text-tinta-2")}>{formatearPesos(monto)}</span>
          <span className="text-base font-medium text-tinta-2">{monto === 0 ? "Escribir" : "Cambiar"}</span>
        </button>
      </section>

      <section className="mt-6">
        <Titulo>En qué</Titulo>
        <div role="radiogroup" aria-label="Categoría del gasto" className="grid grid-cols-2 gap-2">
          {CATEGORIAS_GASTO.map((c) => {
            const elegida = c === categoria;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={elegida}
                onClick={() => setCategoria(c)}
                className={cn(
                  "min-h-12 rounded-xl border px-3 text-base font-semibold leading-tight",
                  elegida ? "border-tinta bg-tinta text-papel" : "border-linea bg-papel text-tinta active:bg-hueso"
                )}
              >
                {elegida ? "✓ " : ""}
                {ETIQUETA_CATEGORIA[c]}
              </button>
            );
          })}
        </div>
        {categoria === "comisiones" && (
          <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-hueso p-3 text-base text-tinta-2">
            Para pagarle a un barbero usa «Comisiones» y toca Liquidar: así queda registrado y el cierre del día lo descuenta.
          </p>
        )}
      </section>

      <section className="mt-6">
        <Titulo>Cómo se pagó</Titulo>
        <Segmentado<MedioPago>
          etiqueta="Cómo se pagó"
          valor={medio}
          onCambio={setMedio}
          opciones={[
            { valor: "efectivo", etiqueta: "Efectivo" },
            { valor: "transferencia", etiqueta: "Nequi" },
          ]}
        />
        {medio === "efectivo" && <p className="mt-2 text-base text-tinta-2">Sale del efectivo de la caja en el cierre del día.</p>}
      </section>

      <section className="mt-6">
        <Label htmlFor="nota_gasto">Nota (opcional)</Label>
        <Input
          id="nota_gasto"
          value={nota}
          maxLength={NOTA_GASTO_MAXIMA}
          autoComplete="off"
          placeholder="Cuchillas y toallas"
          onChange={(e) => setNota(e.target.value)}
        />
      </section>

      <section className="mt-6">
        <Titulo>Recibo (opcional)</Titulo>
        <CampoFoto foto={foto} onCambio={setFoto} />
      </section>

      <BarraAccion>
        {error && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {error}
          </p>
        )}
        <Button tamano="lg" bloque disabled={!listo || enviando} onClick={guardar}>
          {enviando ? "Guardando…" : listo ? `Guardar gasto · ${formatearPesos(monto)}` : "Escribe cuánto y en qué"}
        </Button>
      </BarraAccion>

      {hojaMonto && (
        <HojaMonto
          titulo="Cuánto fue el gasto"
          inicial={monto}
          max={GASTO_MAXIMO}
          atajos={ATAJOS}
          puedeAceptar={(v) => v > 0}
          alAceptar={(v) => {
            setMonto(v);
            setHojaMonto(false);
          }}
          onCerrar={() => setHojaMonto(false)}
        />
      )}
    </div>
  );
}
