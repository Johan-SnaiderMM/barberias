import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ListaPlegable } from "@/components/ui/lista-plegable";

const filas = (cuantas: number) => Array.from({ length: cuantas }, (_, i) => createElement("li", { key: i }, `fila ${i + 1}`));
const pintar = (cuantas: number) =>
  renderToStaticMarkup(createElement(ListaPlegable, { filas: filas(cuantas), resumen: (n: number) => `Ver ${n} más`, className: "lista" }));

describe("ListaPlegable", () => {
  it("con 6 filas o menos no pliega nada", () => {
    for (const n of [0, 3, 5, 6]) expect(pintar(n)).not.toContain("<details");
    expect(pintar(6)).toContain("fila 6");
  });

  it("con 7 o más deja 5 a la vista y pliega el resto con su resumen", () => {
    const [visibles, plegadas] = pintar(12).split("<details");
    expect(visibles.match(/<li>/g)).toHaveLength(5);
    expect(visibles).toContain("fila 5");
    expect(visibles).not.toContain("fila 6");
    expect(plegadas.match(/<li>/g)).toHaveLength(7);
    expect(plegadas).toContain("Ver 7 más");
    expect(plegadas).toContain("fila 6");
    expect(plegadas).toContain("fila 12");
  });
});
