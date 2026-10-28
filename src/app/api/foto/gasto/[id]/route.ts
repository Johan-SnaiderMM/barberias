import { bd } from "@/lib/datos/bd";
import { obtenerGasto } from "@/lib/datos/gastos";
import { BUCKET_FOTOS_GASTOS, esRutaFotoGasto, tipoDeRutaFoto } from "@/lib/gastos";
import { obtenerUsuario } from "@/lib/sesion";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const sinCuerpo = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

/**
 * La foto de un gasto. El bucket es privado: no hay enlaces públicos, la foto se sirve SOLO a quien tiene permiso sobre
 * el gasto (la base decide: la función `obtener_gasto` no devuelve gastos de otra barbería ni a quien no ve los gastos).
 * Se pide por el id del gasto, nunca por la ruta del archivo.
 */
export async function GET(_peticion: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return sinCuerpo(404);
  if (!(await obtenerUsuario())) return sinCuerpo(401);

  let ruta: string | null = null;
  try {
    ruta = (await obtenerGasto(id))?.foto_ruta ?? null;
  } catch {
    return sinCuerpo(403);
  }
  if (!esRutaFotoGasto(ruta)) return sinCuerpo(404);

  const archivo = await (await bd()).leerArchivo(BUCKET_FOTOS_GASTOS, ruta);
  const tipo = tipoDeRutaFoto(ruta);
  if (!archivo || !tipo) return sinCuerpo(404);

  return new Response(new Blob([archivo.datos.slice().buffer], { type: tipo }), {
    headers: {
      "Content-Type": tipo,
      // Privada: solo el navegador de quien la pidió la guarda (y un rato), nunca una caché compartida.
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
