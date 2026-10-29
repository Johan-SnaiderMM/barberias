import Link from "@/components/ui/enlace";
import { Scissors } from "lucide-react";
import { salir } from "@/app/acciones/sesion";
import { Button, botonVariantes } from "@/components/ui/button";
import { obtenerContexto } from "@/lib/datos/contexto";
import { demoDisponible } from "@/lib/demo";
import { MARCA } from "@/lib/marca";
import { obtenerUsuario } from "@/lib/sesion";
import { usarDemoPublica } from "@/lib/supabase/servidor";
import { BotonDemo } from "./boton-demo";
import { FormularioClave } from "./formulario-clave";

export const metadata = { title: "Entrar a mi barbería" };

// Depende de la sesión (cookies): nunca se prerenderiza. Sin esto, un build sin Supabase la congelaría con el formulario.
export const dynamic = "force-dynamic";

/**
 * Entrada del dueño con su correo y su contraseña (el equipo entra con un código en /unirme). La cuenta la crea
 * quien instala la app. Esta página NO pide permiso de pantalla: es justo a donde se manda a quien no tiene sesión
 * o barbería.
 */
export default async function Entrar() {
  const usuario = await obtenerUsuario().catch(() => null);
  const contexto = usuario ? await obtenerContexto().catch(() => null) : null;
  const dentro = contexto?.perfil && contexto.barberia ? { perfil: contexto.perfil, barberia: contexto.barberia } : null;

  // Demo pública: no hay entrada por contraseña (no existe esa cuenta), solo el botón de la demo y el código del equipo.
  if (usarDemoPublica() && !usuario) {
    return (
      <div className="columna-app flex flex-col px-4 pb-8 pt-[calc(1rem+env(safe-area-inset-top,0px))]">
        <div className="flex items-center gap-2">
          <span className="flex size-10 items-center justify-center rounded-lg border border-linea bg-oro">
            <Scissors className="size-6" aria-hidden />
          </span>
          <span className="text-2xl font-semibold tracking-tight leading-none">{MARCA.nombre}</span>
        </div>
        <h1 className="mt-7 text-3xl font-semibold tracking-tight leading-tight">Demo de {MARCA.nombre}</h1>
        <p className="mt-3 text-base leading-snug text-tinta-2">
          Entra a una barbería de demostración con datos inventados. No pide correo ni contraseña, y lo que hagas aquí se
          borra solo.
        </p>
        <div className="mt-6">
          <BotonDemo />
        </div>
        <div className="mt-8 border-t border-hueso pt-6">
          <p className="text-center text-base text-tinta-2">¿Eres del equipo? El dueño te manda un código.</p>
          <Link
            href="/unirme"
            className={`${botonVariantes({ variante: "secundario", tamano: "lg", bloque: true })} mt-3`}
          >
            Tengo un código de invitación
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="columna-app flex flex-col px-4 pb-8 pt-[calc(1rem+env(safe-area-inset-top,0px))]">
      <div className="flex items-center gap-2">
        <span className="flex size-10 items-center justify-center rounded-lg border border-linea bg-oro">
          <Scissors className="size-6" aria-hidden />
        </span>
        <span className="text-2xl font-semibold tracking-tight leading-none">{MARCA.nombre}</span>
      </div>

      {dentro ? (
        <>
          <h1 className="mt-7 text-3xl font-semibold tracking-tight leading-tight">Ya estás dentro</h1>
          <p className="mt-3 text-base leading-snug text-tinta-2">
            Este celular es de <strong className="text-tinta">{dentro.perfil.nombre}</strong> en {dentro.barberia.nombre}.
            Para entrar con otra cuenta, primero sal.
          </p>
          <Link href="/inicio" className={`${botonVariantes({ tamano: "lg", bloque: true })} mt-6`}>
            Abrir la app
          </Link>
          <form action={salir} className="mt-3">
            <Button type="submit" variante="secundario" bloque>
              Salir
            </Button>
          </form>
        </>
      ) : usuario ? (
        <>
          <h1 className="mt-7 text-3xl font-semibold tracking-tight leading-tight">Falta tu barbería</h1>
          <p className="mt-3 text-base leading-snug text-tinta-2">
            Tu cuenta existe, pero todavía no tiene una barbería asignada. Pídele a quien te instaló la app que la dé de
            alta, o usa el código de invitación que te mandó el dueño.
          </p>
          <Link href="/unirme" className={`${botonVariantes({ tamano: "lg", bloque: true })} mt-6`}>
            Tengo un código de invitación
          </Link>
          <form action={salir} className="mt-3">
            <Button type="submit" variante="secundario" bloque>
              Salir
            </Button>
          </form>
        </>
      ) : (
        <>
          <h1 className="mt-7 text-3xl font-semibold tracking-tight leading-tight">Entrar a mi barbería</h1>
          <p className="mt-3 text-base leading-snug text-tinta-2">
            Con el correo y la contraseña que te dieron al instalar la app.
          </p>
          <div className="mt-6">
            <FormularioClave />
          </div>
          <p className="mt-6 text-center text-base text-tinta-2">
            ¿Olvidaste la contraseña? Pídele una nueva a quien te instaló la app.
          </p>
          <div className="mt-8 border-t border-hueso pt-6">
            <p className="text-center text-base text-tinta-2">¿Eres del equipo? El dueño te manda un código.</p>
            <Link
              href="/unirme"
              className={`${botonVariantes({ variante: "secundario", tamano: "lg", bloque: true })} mt-3`}
            >
              Tengo un código de invitación
            </Link>
          </div>
          {demoDisponible() && (
            <div className="mt-8 border-t border-hueso pt-6">
              <p className="text-center text-base text-tinta-2">¿Quieres conocer la app? Entra a una barbería de ejemplo.</p>
              <div className="mt-3">
                <BotonDemo />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
