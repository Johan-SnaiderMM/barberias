"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hoja } from "@/components/ui/hoja";
import {
  abrirGuia,
  cerrarGuia,
  esAccion,
  irAPaso,
  leerGuia,
  leerGuiaServidor,
  PASOS,
  pasoEnRuta,
  pasoTrasNavegar,
  pasoTrasSaltar,
  suscribirGuia,
  terminarGuia,
} from "@/lib/guia";

/**
 * Recorrido guiado (solo se activa si la persona lo inicia). Vive en el layout raíz para que el paso actual sobreviva a
 * los cambios de pantalla. Cuatro trabajos: mostrar la hoja con la instrucción del paso, resaltar lo que hay que tocar,
 * avanzar solo cuando la persona llega a la pantalla siguiente y dejar una ficha «paso 3/10» para volver a leerla.
 */
export function GuiaRecorrido() {
  const estado = useSyncExternalStore(suscribirGuia, leerGuia, leerGuiaServidor);
  const ruta = usePathname();
  const router = useRouter();
  const paso = estado?.paso;
  const abierta = estado?.abierta ?? false;
  const objetivo = paso === undefined ? undefined : PASOS[paso]?.objetivo;

  // Al salir de la demo no queda un recorrido a medias para la siguiente visita.
  useEffect(() => {
    if (ruta === "/" || ruta === "/entrar") terminarGuia();
  }, [ruta]);

  // La persona tocó lo que se le pedía y llegó a la pantalla siguiente (o abandonó lo que hacía): se acomoda el paso.
  useEffect(() => {
    if (paso === undefined) return;
    const siguiente = pasoTrasNavegar(paso, ruta);
    if (siguiente !== paso) irAPaso(siguiente);
  }, [paso, ruta]);

  // Resalta el elemento del paso. El aro es un elemento aparte pegado al <body> que sigue al objetivo (así no se toca el
  // HTML que React maneja ni lo recorta un contenedor con overflow). Las pantallas cargan en segundo plano: el objetivo
  // se busca en cada cuadro hasta que aparece. Con la hoja abierta, el objetivo se acomoda en el espacio que ella deja
  // libre; si aun así queda tapado, no se dibuja el aro (sobre el texto de la hoja estorbaría).
  useEffect(() => {
    if (!objetivo) return;
    const aro = document.createElement("div");
    aro.setAttribute("data-guia-aro", "");
    aro.setAttribute("aria-hidden", "true");
    document.body.appendChild(aro);
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const comportamiento = quieto ? "auto" : "smooth";
    /** Dónde empieza la hoja (su borde de arriba); sin hoja, el borde de abajo de la ventana. */
    const topeHoja = () => document.querySelector('[role="dialog"]')?.getBoundingClientRect().top ?? window.innerHeight;
    const acomodar = (el: Element) => {
      if (!abierta) {
        el.scrollIntoView({ block: "center", behavior: comportamiento });
        return;
      }
      const r = el.getBoundingClientRect();
      const libre = topeHoja() - 16;
      const arriba = r.height < libre - 16 ? 16 + (libre - 16 - r.height) / 2 : 16;
      window.scrollBy({ top: r.top - arriba, behavior: comportamiento });
    };
    let objetivoEl: Element | null = null;
    let cuadro = 0;
    let ultimo = "";
    const seguir = () => {
      if (!objetivoEl?.isConnected) {
        objetivoEl = document.querySelector(`[data-guia="${objetivo}"]`);
        if (objetivoEl) acomodar(objetivoEl);
      }
      if (objetivoEl) {
        const r = objetivoEl.getBoundingClientRect();
        const tapado = abierta && r.bottom > topeHoja() + 4;
        const firma = `${r.left}|${r.top}|${r.width}|${r.height}|${tapado}`;
        if (firma !== ultimo) {
          ultimo = firma;
          aro.style.cssText = tapado
            ? "display:none"
            : `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border-radius:${getComputedStyle(objetivoEl).borderRadius}`;
        }
      } else {
        aro.style.display = "none";
      }
      cuadro = requestAnimationFrame(seguir);
    };
    cuadro = requestAnimationFrame(seguir);
    return () => {
      cancelAnimationFrame(cuadro);
      aro.remove();
    };
  }, [objetivo, abierta, ruta]);

  if (!estado) return null;
  const actual = PASOS[estado.paso];
  if (!actual) return null;

  /** Pasa al paso `a` y, si la persona no está en su pantalla, la lleva (la hoja se queda abierta con la nueva instrucción). */
  function irA(a: number) {
    if (a >= PASOS.length) {
      terminarGuia();
      return;
    }
    irAPaso(a);
    if (!pasoEnRuta(a, ruta)) router.push(PASOS[a].ir);
  }

  const ficha = (
    <button
      type="button"
      onClick={abrirGuia}
      aria-label={`Recorrido guiado, paso ${estado.paso + 1} de ${PASOS.length}. Toca para ver la instrucción`}
      className="fixed right-3 top-[calc(0.25rem+env(safe-area-inset-top,0px))] z-30 flex min-h-12 items-center gap-2 rounded-full border border-linea bg-superficie px-4 text-base font-medium active:bg-hueso"
    >
      <Lightbulb className="size-5" aria-hidden />
      {estado.paso + 1}/{PASOS.length}
    </button>
  );
  if (!estado.abierta) return ficha;

  const aqui = pasoEnRuta(estado.paso, ruta);
  const accion = esAccion(estado.paso);
  const ultimo = estado.paso === PASOS.length - 1;

  return (
    <>
      {/* Mientras la hoja está abierta la página gana espacio al final: así lo resaltado se puede subir hasta quedar sobre la hoja. */}
      <div aria-hidden className="h-[45dvh] print:hidden" />
      <Hoja titulo={actual.titulo} onCerrar={cerrarGuia} velo={false}>
        <p className="text-sm font-medium uppercase tracking-wider text-tinta-2">
          Paso {estado.paso + 1} de {PASOS.length}
        </p>
        <p className="mt-1 text-lg leading-snug">{actual.texto}</p>

        <div className="mt-4 space-y-2">
          {!aqui ? (
            <Button
              tamano="lg"
              bloque
              onClick={() => {
                // Un paso de acción necesita ver la pantalla (y el aro): se cierra la hoja. Los demás se leen aquí mismo.
                if (accion) cerrarGuia();
                router.push(actual.ir);
              }}
            >
              Llévame ahí
            </Button>
          ) : accion ? (
            <>
              <Button tamano="lg" bloque onClick={cerrarGuia}>
                Entendido
              </Button>
              <Button variante="fantasma" bloque onClick={() => irA(pasoTrasSaltar(estado.paso))}>
                Saltar este paso
              </Button>
            </>
          ) : (
            <Button tamano="lg" bloque onClick={() => irA(estado.paso + 1)}>
              {ultimo ? "Terminar" : "Siguiente"}
            </Button>
          )}
          {!ultimo && (
            <Button variante="fantasma" bloque onClick={terminarGuia}>
              Salir del recorrido
            </Button>
          )}
        </div>
      </Hoja>
    </>
  );
}
