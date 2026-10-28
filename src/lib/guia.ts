/**
 * Recorrido guiado de la demo (tarea 4.2 · SPEC F12): dos minutos por lo que más se usa en una barbería (agenda, cobro,
 * gastos, comisiones, cierre y reservas en línea). Sin librerías: una lista de pasos, un estado mínimo (el paso actual,
 * guardado en sessionStorage para que sobreviva a los cambios de pantalla) y un aro que resalta lo que hay que tocar.
 *
 * Cliente y servidor pueden importar este archivo: no usa Zod ni nada del servidor.
 */

export type PasoGuia = {
  titulo: string;
  texto: string;
  /** Dónde ocurre el paso (la hoja ofrece «Llévame ahí» si la persona está en otra pantalla). */
  ruta: RegExp;
  /** A dónde llevar a la persona si no está en `ruta` (una pantalla que existe sin necesitar un registro en particular). */
  ir: string;
  /** Elemento que se resalta: el primero con `data-guia="<objetivo>"`. */
  objetivo?: string;
  /** Si llega a esta ruta tocando lo que se le pidió, la guía avanza sola al paso siguiente. */
  alLlegarA?: RegExp;
  /** La persona tiene que hacer algo y la guía avanza sola cuando lo hace: la hoja se cierra para dejarla actuar. */
  accion?: boolean;
  /** A qué paso se salta si omite este (por defecto, el siguiente). Sirve para no dejar a nadie en un paso que necesita algo que omitió. */
  saltarA?: number;
  /** Si en este paso la persona vuelve a `ruta`, la guía retrocede a `paso` (salió del formulario sin terminar). */
  volverA?: { ruta: RegExp; paso: number };
};

export const PASOS: readonly PasoGuia[] = [
  {
    titulo: "Así va tu día",
    texto: "Lo vendido, lo que ganan tus barberos y lo gastado hoy. Todo se calcula solo, con cada cobro.",
    ruta: /^\/inicio$/,
    ir: "/inicio",
    objetivo: "resumen",
  },
  {
    titulo: "Tu agenda",
    texto: "Aquí están las citas del día, de todos los barberos, con su estado. Toca una para abrirla.",
    ruta: /^\/agenda$/,
    ir: "/agenda",
    objetivo: "cita",
    alLlegarA: /^\/agenda\/cita\/[^/]+$/,
    accion: true,
    saltarA: 3,
  },
  {
    titulo: "Atiende la cita",
    texto:
      "Cada cita muestra quién viene, qué se le hace y cuánto cuesta. Según su estado la empiezas, la cobras, la mueves o la cancelas. Las que reservan los clientes desde su casa también llegan aquí.",
    ruta: /^\/agenda\/cita\/[^/]+$/,
    ir: "/agenda",
  },
  {
    titulo: "Cobra",
    texto: "Toca una cita para cobrarla. Las que quedaron sin cobrar de otros días salen aparte, para que no se pierda plata.",
    ruta: /^\/caja$/,
    ir: "/caja",
    objetivo: "cobrar",
    alLlegarA: /^\/caja\/(cobrar\/[^/]+|venta)$/,
    accion: true,
    saltarA: 5,
  },
  {
    titulo: "Elige cómo paga",
    texto:
      "Efectivo con vuelto, Nequi o mitad y mitad; también puedes sumar un extra o la propina. Toca «Exacto» y luego «Cobrar»: al terminar, la guía sigue sola.",
    ruta: /^\/caja\/(cobrar\/[^/]+|venta)$/,
    ir: "/caja",
    objetivo: "exacto",
    accion: true,
    saltarA: 5,
    volverA: { ruta: /^\/caja$/, paso: 3 },
  },
  {
    titulo: "Anota los gastos",
    texto: "Arriendo, insumos, la luz… se anotan en pocos toques y hasta con foto del recibo. Lo que pagas en efectivo se resta de la caja.",
    ruta: /^\/gastos(\/|$)/,
    ir: "/gastos",
  },
  {
    titulo: "Comisiones al día",
    texto: "Cada barbero gana su porcentaje, calculado en cada cobro. Aquí ves lo que falta por pagarle y se lo liquidas de un toque.",
    ruta: /^\/comisiones(\/|$)/,
    ir: "/comisiones",
  },
  {
    titulo: "Cierra el día",
    texto: "Cuentas el efectivo de la caja y la app te dice si cuadra, si sobra o si falta. Después mandas el resumen por WhatsApp.",
    ruta: /^\/cierre$/,
    ir: "/cierre",
  },
  {
    titulo: "Tus clientes reservan solos",
    texto: "Imprime este cartel con el código QR: tus clientes reservan desde su casa y la cita aparece sola en tu agenda.",
    ruta: /^\/cartel$/,
    ir: "/cartel",
  },
  {
    titulo: "Listo",
    texto: "Eso es todo. En «Más → Reiniciar la demo» vuelven los datos de ejemplo para la próxima visita, y aquí mismo repites el recorrido.",
    ruta: /^\/mas$/,
    ir: "/mas",
  },
];

/** ¿La persona tiene que hacer algo en este paso (y la guía avanza sola)? */
export function esAccion(paso: number): boolean {
  const p = PASOS[paso];
  return Boolean(p && (p.accion ?? p.alLlegarA));
}

/**
 * El paso en el que debe quedar la guía cuando la persona está en `ruta` estando en `paso`: el siguiente si llegó a la
 * pantalla que se le pidió, uno anterior si abandonó lo que estaba haciendo, o el mismo si no corresponde.
 */
export function pasoTrasNavegar(paso: number, ruta: string): number {
  const actual = PASOS[paso];
  if (actual?.alLlegarA?.test(ruta)) return paso + 1;
  if (actual?.volverA?.ruta.test(ruta)) return actual.volverA.paso;
  return paso;
}

export function pasoEnRuta(paso: number, ruta: string): boolean {
  return PASOS[paso]?.ruta.test(ruta) ?? false;
}

/** Paso al que se va si se omite el de `paso`. */
export function pasoTrasSaltar(paso: number): number {
  return PASOS[paso]?.saltarA ?? paso + 1;
}

// Estado compartido (useSyncExternalStore). `abierta` solo vive en memoria; `paso` también en sessionStorage.

export type EstadoGuia = { paso: number; abierta: boolean } | null;

const CLAVE = "guia-paso";
let estado: EstadoGuia = null;
let cargado = false;
const oyentes = new Set<() => void>();

function emitir(nuevo: EstadoGuia) {
  estado = nuevo;
  try {
    if (nuevo) sessionStorage.setItem(CLAVE, String(nuevo.paso));
    else sessionStorage.removeItem(CLAVE);
  } catch {
    // Sin sessionStorage (ventana privada, datos bloqueados): la guía sigue en memoria.
  }
  oyentes.forEach((o) => o());
}

export function suscribirGuia(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

export function leerGuia(): EstadoGuia {
  if (!cargado) {
    cargado = true;
    try {
      const guardado = sessionStorage.getItem(CLAVE);
      const n = guardado === null ? NaN : Number(guardado);
      if (Number.isInteger(n) && n >= 0 && n < PASOS.length) estado = { paso: n, abierta: false };
    } catch {
      // ver arriba
    }
  }
  return estado;
}

export const leerGuiaServidor = (): EstadoGuia => null;

export function iniciarGuia() {
  emitir({ paso: 0, abierta: true });
}
export function irAPaso(paso: number) {
  if (paso >= PASOS.length) emitir(null);
  else emitir({ paso: Math.max(0, paso), abierta: true });
}
/** Si la guía está en `paso`, pasa al siguiente (lo usan las pantallas que saben que la persona ya hizo lo pedido). */
export function avanzarDesde(paso: number) {
  if (leerGuia()?.paso === paso) irAPaso(paso + 1);
}
export function abrirGuia() {
  const actual = leerGuia();
  if (actual) emitir({ ...actual, abierta: true });
}
export function cerrarGuia() {
  const actual = leerGuia();
  if (actual?.abierta) emitir({ ...actual, abierta: false });
}
export function terminarGuia() {
  if (leerGuia()) emitir(null);
}
