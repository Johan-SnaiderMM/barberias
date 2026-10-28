/**
 * ÚNICO lugar donde se calcula dinero en la interfaz: formato, lectura del teclado, efectivo y vuelto, el
 * porcentaje (comisiones), el cobro completo (descuento repartido, propina, pagos) y, más adelante, el cierre.
 *
 * Reglas:
 *  - COP no usa decimales: todo es un número ENTERO de pesos. Nada de floats ni de "centavos".
 *  - Estos cálculos son para MOSTRAR y dar respuesta inmediata al tocar. El servidor (funciones SQL)
 *    vuelve a calcular todo desde la base y es la verdad; una prueba compara ambos para que no se contradigan.
 *  - Redondeos siempre al peso con Math.round / Math.floor sobre enteros.
 */

export type Pesos = number;

export type MedioPago = "efectivo" | "transferencia";

export const ETIQUETA_MEDIO: Record<MedioPago, string> = {
  efectivo: "Efectivo",
  transferencia: "Nequi / transferencia",
};

// Formato y lectura

/** Convierte cualquier número a pesos enteros (redondea; descarta NaN/Infinity). */
export function aPesos(n: number): Pesos {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** 12500 -> "$ 12.500"; negativos: "− $ 12.500" (signo menos tipográfico, se lee bien al sol). */
export function formatearPesos(n: Pesos): string {
  const v = aPesos(n);
  const miles = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${v < 0 ? "− " : ""}$ ${miles}`;
}

/** Igual que formatearPesos pero sin el símbolo (para el teclado numérico y campos). */
export function formatearMiles(n: Pesos): string {
  return formatearPesos(Math.abs(n)).replace("$ ", "");
}

/** "12.500", "$ 12 500", "12,500" -> 12500. Solo cuenta los dígitos; vacío -> 0. Tope: 99.999.999. */
export function leerPesos(texto: string): Pesos {
  const digitos = texto.replace(/\D/g, "").slice(0, 8);
  return digitos ? Number(digitos) : 0;
}

export function sumar(valores: Pesos[]): Pesos {
  return valores.reduce((a, b) => a + b, 0);
}

// Porcentajes (comisiones)

/**
 * `porcentaje` % de `valor`, redondeado HACIA ABAJO al peso. Lo que sobra por el redondeo se queda en la
 * barbería: nunca se le paga de más a un barbero. Mismo cálculo que `floor(valor * pct / 100)` en SQL.
 * El porcentaje es un entero de 0 a 100 y el valor, pesos enteros no negativos.
 */
export function porcentajeDe(valor: Pesos, porcentaje: number): Pesos {
  if (!Number.isInteger(valor) || valor < 0) throw new RangeError(`Valor no válido: ${valor}`);
  if (!Number.isInteger(porcentaje) || porcentaje < 0 || porcentaje > 100) {
    throw new RangeError(`El porcentaje debe ser un entero entre 0 y 100: ${porcentaje}`);
  }
  return Math.floor((valor * porcentaje) / 100);
}

/** Lo que gana un barbero que no tiene porcentaje guardado. Igual a `fn_comision_defecto()` en SQL (una prueba lo compara). */
export const COMISION_POR_DEFECTO = 50;

/** ¿Es un porcentaje de comisión válido (entero de 0 a 100)? */
export function esPorcentajeValido(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 100;
}

// Efectivo

export type ResultadoEfectivo = {
  /** Lo que se devuelve al cliente (0 si no alcanza). */
  vuelto: Pesos;
  /** Lo que falta si el efectivo recibido no alcanza (0 si alcanza). */
  falta: Pesos;
  alcanza: boolean;
};

/** Efectivo recibido vs. lo que se cobra: vuelto o lo que falta. */
export function calcularEfectivo(recibido: Pesos, aCobrar: Pesos): ResultadoEfectivo {
  const dif = recibido - aCobrar;
  return { vuelto: Math.max(dif, 0), falta: Math.max(-dif, 0), alcanza: dif >= 0 };
}

/**
 * Atajos de efectivo para el teclado: el valor exacto y los billetes/múltiplos que lo cubren
 * (siguiente múltiplo de 5.000, 10.000, 20.000 y 50.000), sin repetir y en orden creciente.
 */
export function atajosEfectivo(aCobrar: Pesos): Pesos[] {
  if (aCobrar <= 0) return [];
  const paso = [5000, 10000, 20000, 50000].map((p) => Math.ceil(aCobrar / p) * p);
  return [...new Set([aCobrar, ...paso])].sort((a, b) => a - b).slice(0, 4);
}

// Cobro (espejo de cobrar_cita / cobrar_venta en SQL; una prueba los compara)

/** Tope de un precio o de un monto, igual que los `check` de la base. */
export const PRECIO_MAXIMO: Pesos = 10_000_000;
export const PROPINA_MAXIMA: Pesos = 1_000_000;
export const LINEAS_MAXIMAS = 20;

/**
 * Reparte `descuento` entre las líneas en proporción a su precio, al peso: cada una recibe la parte entera de
 * `descuento × precio ÷ subtotal` y el sobrante se reparte de a un peso a las líneas con MAYOR fracción (a igual
 * fracción, la primera). Las partes suman exactamente el descuento y ninguna pasa del precio de su línea.
 * Es la misma regla de `fn_cobrar` en SQL.
 */
export function repartirDescuento(precios: Pesos[], descuento: Pesos): Pesos[] {
  const subtotal = sumar(precios);
  if (!Number.isInteger(descuento) || descuento < 0 || descuento > subtotal) {
    throw new RangeError(`El descuento debe ser un entero entre 0 y ${subtotal}: ${descuento}`);
  }
  if (descuento === 0) return precios.map(() => 0);

  const d = BigInt(descuento);
  const s = BigInt(subtotal);
  const partes = precios.map((p) => Number((d * BigInt(p)) / s));
  const resto = descuento - sumar(partes);
  const porFraccion = precios
    .map((p, indice) => ({ indice, fraccion: (d * BigInt(p)) % s }))
    .sort((a, b) => (a.fraccion === b.fraccion ? a.indice - b.indice : a.fraccion > b.fraccion ? -1 : 1));
  for (const { indice } of porFraccion.slice(0, resto)) partes[indice] += 1;
  return partes;
}

export type LineaCobro = {
  precio: Pesos;
  /** Comisión del barbero por esta línea, en % (0 si no se conoce). */
  comisionPct?: number;
};

export type ResultadoCobro = {
  subtotal: Pesos;
  descuento: Pesos;
  /** subtotal − descuento: lo que se cobra por los servicios y extras. */
  total: Pesos;
  propina: Pesos;
  /** total + propina: lo que tienen que sumar los pagos. */
  aCobrar: Pesos;
  /** Por línea: su parte del descuento, lo que realmente se cobró de ella y su comisión. */
  lineas: { precio: Pesos; descuento: Pesos; neto: Pesos; comision: Pesos }[];
  /** Suma de las comisiones de las líneas. */
  comision: Pesos;
  /** total − comisión: lo que queda para la barbería. */
  parteBarberia: Pesos;
  /** La parte de la propina que es del barbero (toda, o nada si la propina se queda en la barbería). */
  propinaBarbero: Pesos;
};

/**
 * El cobro completo a partir de las líneas, el descuento y la propina. Lanza RangeError si algo no es válido.
 * `propinaDelBarbero` (por defecto sí) dice de quién es la propina; es el ajuste de la barbería en ese momento.
 */
export function calcularCobro(e: {
  lineas: LineaCobro[];
  descuento: Pesos;
  propina: Pesos;
  propinaDelBarbero?: boolean;
}): ResultadoCobro {
  const precios = e.lineas.map((l) => l.precio);
  const partes = repartirDescuento(precios, e.descuento);
  const lineas = e.lineas.map((l, i) => {
    const neto = l.precio - partes[i];
    return { precio: l.precio, descuento: partes[i], neto, comision: porcentajeDe(neto, l.comisionPct ?? 0) };
  });
  const subtotal = sumar(precios);
  const total = subtotal - e.descuento;
  const comision = sumar(lineas.map((l) => l.comision));
  return {
    subtotal,
    descuento: e.descuento,
    total,
    propina: e.propina,
    aCobrar: total + e.propina,
    lineas,
    comision,
    parteBarberia: total - comision,
    propinaBarbero: (e.propinaDelBarbero ?? true) ? e.propina : 0,
  };
}

/**
 * Cómo se reparte lo que entró en un cobro: del barbero (su comisión y la parte de la propina que es suya) y de la
 * barbería (el resto de los servicios y de la propina). Las dos partes suman EXACTAMENTE total + propina.
 */
export function repartoDeCobro(c: { total: Pesos; comision: Pesos; propina: Pesos; propinaBarbero: Pesos }): {
  barbero: Pesos;
  barberia: Pesos;
} {
  return { barbero: c.comision + c.propinaBarbero, barberia: c.total - c.comision + (c.propina - c.propinaBarbero) };
}

// Cierre del día (espejo de fn_resumen_dia y registrar_cierre en SQL; una prueba los compara)

/**
 * El efectivo que debe haber en la caja al cerrar: lo cobrado en efectivo (sin el vuelto), menos los gastos pagados en
 * efectivo y menos lo que se le pagó en efectivo a los barberos. Puede dar negativo si salió más efectivo del que entró.
 */
export function efectivoEsperado(d: { efectivoCobros: Pesos; gastosEfectivo: Pesos; liquidacionesEfectivo: Pesos }): Pesos {
  return d.efectivoCobros - d.gastosEfectivo - d.liquidacionesEfectivo;
}

export type EstadoCaja = "cuadra" | "sobra" | "falta";

/** Lo contado contra lo esperado: la diferencia (contado − esperado: más es que sobra, menos que falta) y su estado. */
export function compararCaja(contado: Pesos, esperado: Pesos): { diferencia: Pesos; estado: EstadoCaja } {
  const diferencia = contado - esperado;
  return { diferencia, estado: diferencia === 0 ? "cuadra" : diferencia > 0 ? "sobra" : "falta" };
}

/** 0 -> "Cuadra"; 500 -> "Sobran $ 500"; −500 -> "Faltan $ 500". */
export function textoDiferencia(diferencia: Pesos): string {
  if (diferencia === 0) return "Cuadra";
  return diferencia > 0 ? `Sobran ${formatearPesos(diferencia)}` : `Faltan ${formatearPesos(-diferencia)}`;
}

export type PagoPlan = {
  medio: MedioPago;
  monto: Pesos;
  /** Solo efectivo: lo que entregó el cliente (el vuelto sale de ahí). */
  recibido?: Pesos;
  /** Solo transferencia: referencia opcional. */
  referencia?: string;
};

/**
 * Arma los pagos según lo elegido en pantalla:
 *  - efectivo: un pago por todo lo que se cobra, con lo recibido (el vuelto sale de ahí).
 *  - transferencia (Nequi, Daviplata o banco): un pago, con referencia opcional; o, si paga una parte en efectivo
 *    (`pagaAhora`), esa parte en efectivo (exacta, sin vuelto) y el resto por transferencia.
 * Sin nada que cobrar no hay pagos.
 */
export function planDePagos(e: {
  medio: MedioPago;
  aCobrar: Pesos;
  recibido: Pesos;
  referencia: string;
  pagaAhora: Pesos;
}): PagoPlan[] {
  if (e.aCobrar <= 0) return [];
  if (e.medio === "efectivo") return [{ medio: "efectivo", monto: e.aCobrar, recibido: e.recibido }];

  const ahora = Math.max(0, e.pagaAhora);
  const enEfectivo: PagoPlan[] = ahora > 0 ? [{ medio: "efectivo", monto: ahora, recibido: ahora }] : [];
  const referencia = e.referencia.trim();
  return [...enEfectivo, { medio: "transferencia", monto: e.aCobrar - ahora, ...(referencia ? { referencia } : {}) }];
}

export type ValidacionCobro = { ok: true; vuelto: Pesos } | { ok: false; error: string };

/** Valida un cobro igual que la base: los pagos deben sumar total + propina y el efectivo recibido debe alcanzar. */
export function validarCobro(total: Pesos, propina: Pesos, pagos: PagoPlan[]): ValidacionCobro {
  if (propina < 0 || propina > PROPINA_MAXIMA) return { ok: false, error: "La propina no es válida." };
  const debido = total + propina;
  if (debido === 0) return pagos.length === 0 ? { ok: true, vuelto: 0 } : { ok: false, error: "No hay nada que cobrar." };
  if (pagos.length === 0) return { ok: false, error: "Elige cómo se paga." };

  let vuelto = 0;
  for (const p of pagos) {
    if (p.monto <= 0) return { ok: false, error: "El valor de cada pago debe ser mayor que cero." };
    if (p.medio === "efectivo") {
      const recibido = p.recibido ?? p.monto;
      if (recibido < p.monto) {
        return { ok: false, error: `El efectivo recibido (${formatearPesos(recibido)}) no alcanza.` };
      }
      vuelto += recibido - p.monto;
    }
  }
  const suma = sumar(pagos.map((p) => p.monto));
  if (suma !== debido) {
    return { ok: false, error: `Los pagos suman ${formatearPesos(suma)} y el total a cobrar es ${formatearPesos(debido)}.` };
  }
  return { ok: true, vuelto };
}
