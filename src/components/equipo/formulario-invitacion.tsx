"use client";

import { useActionState, useState } from "react";
import { crearInvitacion } from "@/app/acciones/equipo";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ETIQUETA_AREA } from "@/lib/areas";
import type { EstadoForm } from "@/lib/errores";
import type { RolEquipo } from "@/lib/tipos/equipo";

/**
 * Invitar a alguien al equipo: su nombre, sus roles y, si es barbero, cuál. Los roles que dan permisos que quien
 * invita no tiene salen apagados (la base igual lo rechaza). Campos controlados.
 */
export function FormularioInvitacion({
  roles,
  asignables,
  barberos,
}: {
  roles: RolEquipo[];
  /** Ids de los roles que quien invita puede dar. */
  asignables: string[];
  /** Barberos activos que todavía no tienen cuenta. */
  barberos: { id: string; nombre: string }[];
}) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(crearInvitacion, { error: null });
  const [nombre, setNombre] = useState("");
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [barbero, setBarbero] = useState("");

  const alternar = (id: string) =>
    setElegidos((actual) => (actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id]));

  return (
    <form action={accion} className="space-y-5 px-4 pt-5">
      <input type="hidden" name="nombre" value={nombre} />
      <input type="hidden" name="roles" value={JSON.stringify(elegidos)} />
      <input type="hidden" name="barbero_id" value={barbero} />

      <div>
        <Label htmlFor="nombre_invitado">Nombre de la persona</Label>
        <Input
          id="nombre_invitado"
          value={nombre}
          maxLength={40}
          autoComplete="off"
          placeholder="Mateo, Ruth…"
          onChange={(e) => setNombre(e.target.value)}
        />
        <p className="mt-1 text-base text-tinta-2">Así aparecerá en la app.</p>
      </div>

      <fieldset>
        <legend className="mb-1 block text-sm font-medium uppercase tracking-wider text-tinta-2">Qué puede hacer</legend>
        <ul className="space-y-2">
          {roles.map((r) => {
            const permitido = asignables.includes(r.id);
            return (
              <li key={r.id}>
                <label
                  className={`flex min-h-14 items-start gap-3 rounded-xl border px-4 py-3 ${
                    permitido ? "border-linea bg-superficie" : "border-dashed border-zinc-300 bg-hueso"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={elegidos.includes(r.id)}
                    disabled={!permitido}
                    onChange={() => alternar(r.id)}
                    className="mt-0.5 size-6 shrink-0 accent-tinta"
                  />
                  <span className="min-w-0">
                    <span className="block text-lg font-semibold leading-tight">{r.nombre}</span>
                    <span className="block text-base text-tinta-2">
                      {r.areas.map((a) => ETIQUETA_AREA[a]).join(" · ") || "Sin permisos"}
                      {!permitido && " · no puedes dar estos permisos"}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div>
        <Label htmlFor="barbero_invitado">¿Es uno de tus barberos?</Label>
        <select
          id="barbero_invitado"
          value={barbero}
          onChange={(e) => setBarbero(e.target.value)}
          className="min-h-12 w-full rounded-xl border border-borde-campo bg-superficie px-3 text-base text-tinta"
        >
          <option value="">No es barbero</option>
          {barberos.map((b) => (
            <option key={b.id} value={b.id}>
              Sí, es {b.nombre}
            </option>
          ))}
        </select>
        <p className="mt-1 text-base text-tinta-2">
          {barberos.length === 0
            ? "No hay barberos sin cuenta. Si es barbero, créalo primero en Más → Barberos y horarios."
            : "Así verá en la agenda solo sus propias citas."}
        </p>
      </div>

      <BarraAccion>
        {estado.error && (
          <p role="alert" className="text-center text-base font-semibold text-rojo">
            {estado.error}
          </p>
        )}
        <Button type="submit" tamano="lg" bloque disabled={pendiente || nombre.trim() === "" || elegidos.length === 0}>
          {pendiente ? "Creando…" : "Crear invitación"}
        </Button>
      </BarraAccion>
    </form>
  );
}
