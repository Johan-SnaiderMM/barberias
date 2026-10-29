import { describe, expect, it } from "vitest";
import { filtrarCitas, HISTORIA_VISIBLE, MIN_PARA_BUSCAR, partirLista } from "./listas";
import { textoPlano } from "./texto";

describe("textoPlano", () => {
  it("quita tildes y mayúsculas", () => {
    expect(textoPlano("José Ñandú")).toBe("jose nandu");
    expect(textoPlano("Corte y BARBA")).toBe("corte y barba");
  });
});

describe("partirLista", () => {
  const filas = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it("deja a la vista las primeras filas y pliega el resto", () => {
    const { visibles, plegadas } = partirLista(filas(12));
    expect(visibles).toEqual(filas(HISTORIA_VISIBLE));
    expect(plegadas).toEqual([6, 7, 8, 9, 10, 11, 12]);
  });

  it("no pliega una lista corta ni una sola fila", () => {
    expect(partirLista(filas(0))).toEqual({ visibles: [], plegadas: [] });
    expect(partirLista(filas(HISTORIA_VISIBLE)).plegadas).toEqual([]);
    expect(partirLista(filas(HISTORIA_VISIBLE + 1)).plegadas).toEqual([]);
    expect(partirLista(filas(HISTORIA_VISIBLE + 2)).plegadas).toEqual([HISTORIA_VISIBLE + 1, HISTORIA_VISIBLE + 2]);
  });

  it("acepta otro número de filas a la vista", () => {
    const { visibles, plegadas } = partirLista(filas(10), 3);
    expect(visibles).toEqual([1, 2, 3]);
    expect(plegadas).toHaveLength(7);
  });
});

describe("filtrarCitas", () => {
  const citas = [
    { id: "a", cliente: "José Pérez", servicio: "Corte y barba", barbero: "Santiago Vargas", telefono: "3000001008" },
    { id: "b", cliente: "Ana Gómez", servicio: "Cejas", barbero: "Hernán Quintero", telefono: "3115550000" },
    { id: "c", cliente: null, servicio: "Corte clásico", barbero: "Santiago Vargas", telefono: null },
  ];

  it("sin nada escrito devuelve todas, y la misma lista", () => {
    expect(filtrarCitas(citas, "")).toBe(citas);
    expect(filtrarCitas(citas, "   ")).toBe(citas);
  });

  it("busca por cliente, servicio o barbero, sin tildes ni mayúsculas", () => {
    expect(filtrarCitas(citas, "jose").map((c) => c.id)).toEqual(["a"]);
    expect(filtrarCitas(citas, "CEJAS").map((c) => c.id)).toEqual(["b"]);
    expect(filtrarCitas(citas, "hernan").map((c) => c.id)).toEqual(["b"]);
    expect(filtrarCitas(citas, "santiago").map((c) => c.id)).toEqual(["a", "c"]);
    expect(filtrarCitas(citas, "corte").map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("busca por celular con 3 dígitos o más, sin importar espacios ni guiones", () => {
    expect(filtrarCitas(citas, "300 000 1008").map((c) => c.id)).toEqual(["a"]);
    expect(filtrarCitas(citas, "1008").map((c) => c.id)).toEqual(["a"]);
    expect(filtrarCitas(citas, "311-555").map((c) => c.id)).toEqual(["b"]);
    // Con menos de 3 dígitos no se mira el celular (casi todos empiezan por «3»).
    expect(filtrarCitas(citas, "30")).toEqual([]);
  });

  it("una cita sin cliente ni celular no rompe la búsqueda", () => {
    expect(filtrarCitas(citas, "clasico").map((c) => c.id)).toEqual(["c"]);
    expect(filtrarCitas(citas, "nadie")).toEqual([]);
  });

  it("el buscador aparece desde 6 filas", () => {
    expect(MIN_PARA_BUSCAR).toBe(6);
  });
});
