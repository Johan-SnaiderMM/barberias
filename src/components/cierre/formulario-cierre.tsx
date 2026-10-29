"use client";

import { useState, useTransition } from "react";
import { cerrarDia } from "@/app/acciones/cierre";
import { HojaMonto } from "@/components/caja/hoja-monto";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { compararCaja, formatearPesos, textoDiferencia, type Pesos } from "@/lib/dinero";
import { cn } from "@/lib/utils";

/** El tope del efectivo que se puede escribir al contar (el mismo que acepta la base). */
const MAX_CONTADO: Pesos = 99_999_999;

/**
 * Cerrar el día: se cuenta el efectivo de la caja y se ve al instante si cuadra, sobra o falta contra lo esperado.
 * "Cerrar" guarda las cifras del día; lo que se registre después va al día siguiente. La `clave` se fija al abrir la
 * pantalla: tocar dos veces, o reintentar con mala señal, no cierra dos veces.
 */
export function FormularioCierre({
  clave: claveInicial,
  fecha,
  esperado,
}: {
  clave: string;
  /** El día que se cierra ('YYYY-MM-DD'). */
  fecha: string;
  /** El efectivo que debe haber (puede ser negativo). */
  esperado: Pesos;
}) {
  const [clave] = useState(claveInicial);
  const [contado, setContado] = useState<Pesos | null>(null);
  const [nota, setNota] = useState("");
  const [hoja, setHoja] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, empezar] = useTransition();

  const comparacion = contado === null ? null : compararCaja(contado, esperado);

  function cerrar() {
    if (contado === null || enviando) return;
    setError(null);
    empezar(async () => {
      const r = await cerrarDia({ fecha, efectivo_contado: contado, clave, nota });
      // Si sale bien, el servidor refresca la pantalla y muestra el día cerrado.
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <div>
      <section className="rounded-xl border border-linea bg-superficie p-4">
        <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">Cuenta el efectivo</p>
        <button
          type="button"
          onClick={() => setHoja(true)}
          className="mt-2 flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-linea bg-superficie px-4 text-left active:bg-hueso"
        >
          <span className={cn("text-4xl font-semibold tracking-tight", contado === null && "text-tinta-2")}>
            {formatearPesos(contado ?? 0)}
          </span>
          <span className="text-base font-medium text-tinta-2">{contado === null ? "Escribir" : "Cambiar"}</span>
        </button>

        {comparacion && (
          <p
            role="status"
            className={cn(
              "mt-3 rounded-xl border px-4 py-3 text-lg font-semibold",
              comparacion.estado === "cuadra" ? "border-linea bg-hueso" : "border-dashed border-zinc-300 bg-hueso"
            )}
          >
            {textoDiferencia(comparacion.diferencia)}
            <span className="block text-base font-normal text-tinta-2">
              {comparacion.estado === "cuadra" ? "Lo contado es justo lo esperado." : `Esperado ${formatearPesos(esperado)}, contado ${formatearPesos(contado ?? 0)}.`}
            </span>
          </p>
        )}

        <div className="mt-4">
          <Label htmlFor="nota_cierre">Nota (opcional)</Label>
          <Input
            id="nota_cierre"
            value={nota}
            maxLength={200}
            autoComplete="off"
            placeholder="Ej. de dónde sale la diferencia"
            onChange={(e) => setNota(e.target.value)}
          />
        </div>
      </section>

      <BarraAccion conNavegacion>
        {error && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {error}
          </p>
        )}
        <Button tamano="lg" bloque disabled={contado === null || enviando} onClick={cerrar}>
          {enviando ? "Cerrando…" : contado === null ? "Cuenta el efectivo para cerrar" : "Cerrar el día"}
        </Button>
      </BarraAccion>

      {hoja && (
        <HojaMonto
          titulo="Efectivo en la caja"
          inicial={contado ?? 0}
          max={MAX_CONTADO}
          atajos={esperado > 0 ? [{ etiqueta: "Justo lo esperado", valor: esperado }] : []}
          alAceptar={(v) => {
            setContado(v);
            setHoja(false);
          }}
          onCerrar={() => setHoja(false)}
        />
      )}
    </div>
  );
}
