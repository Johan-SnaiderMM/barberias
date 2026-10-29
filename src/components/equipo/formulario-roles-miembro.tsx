"use client";

import { useActionState, useState } from "react";
import { cambiarRolesMiembro, quitarDelEquipo } from "@/app/acciones/equipo";
import { BarraAccion } from "@/components/layout/barra-accion";
import { Button } from "@/components/ui/button";
import { ETIQUETA_AREA } from "@/lib/areas";
import type { EstadoForm } from "@/lib/errores";
import type { RolEquipo } from "@/lib/tipos/equipo";

/**
 * Cambiar los roles de alguien del equipo o sacarlo. Los roles con permisos que quien administra no tiene salen
 * apagados; lo que no corresponde lo rechaza la base de todos modos.
 */
export function FormularioRolesMiembro({
  userId,
  nombre,
  roles,
  asignables,
  actuales,
}: {
  userId: string;
  nombre: string;
  roles: RolEquipo[];
  asignables: string[];
  actuales: string[];
}) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(cambiarRolesMiembro, { error: null });
  const [elegidos, setElegidos] = useState<string[]>(actuales);
  const alternar = (id: string) =>
    setElegidos((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  return (
    <>
      <form action={accion} className="space-y-5 px-4 pt-5">
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="roles" value={JSON.stringify(elegidos)} />

        <fieldset>
          <legend className="mb-1 block text-sm font-medium uppercase tracking-wider text-tinta-2">
            Qué puede hacer {nombre}
          </legend>
          <ul className="space-y-2">
            {roles.map((r) => {
              const permitido = asignables.includes(r.id) || actuales.includes(r.id);
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
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <BarraAccion>
          {estado.error && (
            <p role="alert" className="text-center text-base font-semibold text-rojo">
              {estado.error}
            </p>
          )}
          <Button type="submit" tamano="lg" bloque disabled={pendiente || elegidos.length === 0}>
            {pendiente ? "Guardando…" : "Guardar roles"}
          </Button>
        </BarraAccion>
      </form>

      <QuitarDelEquipo userId={userId} nombre={nombre} />
    </>
  );
}

/** Sacar a alguien del equipo: pide confirmar (pierde el acceso al instante). */
function QuitarDelEquipo({ userId, nombre }: { userId: string; nombre: string }) {
  const [abierto, setAbierto] = useState(false);
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(quitarDelEquipo, { error: null });

  return (
    <section className="px-4 pb-40 pt-8">
      {!abierto ? (
        <Button variante="fantasma" bloque onClick={() => setAbierto(true)}>
          Quitar a {nombre} del equipo
        </Button>
      ) : (
        <form action={accion} className="space-y-3 rounded-xl border border-rojo bg-superficie p-4">
          <input type="hidden" name="user_id" value={userId} />
          <p className="text-base">
            <strong>{nombre}</strong> perderá el acceso a la app en este mismo momento. Su historial y su barbero se
            conservan.
          </p>
          {estado.error && (
            <p role="alert" className="text-base font-semibold text-rojo">
              {estado.error}
            </p>
          )}
          <Button type="submit" variante="peligro" bloque disabled={pendiente}>
            {pendiente ? "Quitando…" : "Sí, quitarlo del equipo"}
          </Button>
          <Button variante="secundario" bloque onClick={() => setAbierto(false)}>
            No, dejarlo
          </Button>
        </form>
      )}
    </section>
  );
}
