"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { liquidar } from "@/app/acciones/liquidaciones";
import { Button } from "@/components/ui/button";
import { Hoja } from "@/components/ui/hoja";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmentado } from "@/components/ui/segmentado";
import { formatearPesos, type MedioPago, type Pesos } from "@/lib/dinero";
import { fechaCorta } from "@/lib/fechas";

/**
 * «Liquidar»: le paga al barbero todo lo pendiente hasta un día. Primero se elige cómo se le paga y se confirma. La
 * `clave` se fija al abrir la pantalla: tocar dos veces, o reintentar con mala señal, no paga dos veces.
 */
export function BotonLiquidar({
  clave: claveInicial,
  barberoId,
  nombre,
  hasta,
  cobros,
  comision,
  propina,
}: {
  clave: string;
  barberoId: string;
  nombre: string;
  /** Se paga todo lo pendiente hasta este día ('YYYY-MM-DD'). */
  hasta: string;
  cobros: number;
  comision: Pesos;
  propina: Pesos;
}) {
  const router = useRouter();
  const [clave] = useState(claveInicial);
  const [abierta, setAbierta] = useState(false);
  const [medio, setMedio] = useState<MedioPago>("efectivo");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, empezar] = useTransition();
  const total = comision + propina;

  function confirmar() {
    setError(null);
    empezar(async () => {
      const r = await liquidar({ barbero_id: barberoId, hasta, medio, clave, nota });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/comisiones/liquidacion/${r.datos.id}`);
    });
  }

  return (
    <>
      <Button tamano="lg" bloque onClick={() => setAbierta(true)}>
        Liquidar · {formatearPesos(total)}
      </Button>

      {abierta && (
        <Hoja titulo={`Pagarle a ${nombre}`} onCerrar={() => (enviando ? undefined : setAbierta(false))}>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">Se le paga</p>
              <p className="text-4xl font-semibold tracking-tight">{formatearPesos(total)}</p>
              <p className="mt-1 text-base text-tinta-2">
                {cobros === 1 ? "1 cobro" : `${cobros} cobros`} hasta el {fechaCorta(hasta)}: comisión {formatearPesos(comision)}
                {propina > 0 ? ` y propina ${formatearPesos(propina)}` : ""}.
              </p>
            </div>

            <div>
              <p className="mb-1.5 block text-sm font-medium uppercase tracking-wider text-tinta-2">Cómo se le paga</p>
              <Segmentado<MedioPago>
                etiqueta="Cómo se le paga"
                valor={medio}
                onCambio={setMedio}
                opciones={[
                  { valor: "efectivo", etiqueta: "Efectivo" },
                  { valor: "transferencia", etiqueta: "Transferencia" },
                ]}
              />
            </div>

            <div>
              <Label htmlFor="nota_liquidacion">Nota (opcional)</Label>
              <Input
                id="nota_liquidacion"
                value={nota}
                maxLength={200}
                autoComplete="off"
                placeholder="Quincena del 1 al 15"
                onChange={(e) => setNota(e.target.value)}
              />
            </div>

            {error && (
              <p role="alert" className="text-base font-semibold text-rojo">
                {error}
              </p>
            )}

            <Button tamano="lg" bloque disabled={enviando} onClick={confirmar}>
              {enviando ? "Guardando…" : `Confirmar pago · ${formatearPesos(total)}`}
            </Button>
          </div>
        </Hoja>
      )}
    </>
  );
}
