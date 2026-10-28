# Textos legales (borradores para revisar con un abogado)

> **Nada de esto es asesoría jurídica.** Son borradores de partida, escritos con la Ley 1581 de 2012 (habeas data), el
> Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015) y los plazos del Código General como referencia. Un
> abogado debe revisarlos **antes del piloto con clientes reales** (tarea 4.6 del plan). Con la demo no hace falta: todos
> los datos son inventados.

Versión de los tres textos: **Versión 1 · 17 de octubre de 2026** (`src/lib/legal.ts`; si cambias uno, sube la versión).

> **Para llevarle todo al abogado en un solo documento:** [`PAQUETE-PARA-EL-ABOGADO.md`](PAQUETE-PARA-EL-ABOGADO.md) reúne el
> contexto del producto, 18 preguntas, los tres textos de datos, el borrador del contrato y el inventario de datos. Si cambias un texto, vuelve a
> armarlo (una prueba avisa si quedó desactualizado).

## Los tres textos de datos (y el contrato)

| Texto | Dónde está | Para quién |
|---|---|---|
| **Aviso de privacidad** (corto) | `/aviso-de-privacidad?b=<nombre-corto-de-la-barbería>` · `src/app/aviso-de-privacidad/page.tsx` | El cliente que va a reservar. Lo ve enlazado junto a la casilla de autorización y al pie de la página de su cita. |
| **Política de tratamiento de datos** (completa) | `/privacidad?b=<nombre-corto>` · `src/app/privacidad/page.tsx` | El cliente que quiere el detalle. Lleva lo que pide el art. 13 del Decreto 1377: responsable, finalidades, derechos, quién atiende, procedimiento, vigencia. |
| **Cláusula de encargo** | `docs/legal/encargo-de-datos.md` | El contrato entre quien administra la plataforma (encargado) y cada barbería (responsable). Va en el contrato, no en la app. |
| **Contrato de servicio y condiciones de uso** (borrador sin versión) | `docs/legal/contrato-de-servicio.md` | Cada barbería (objeto, precio, soporte, suspensión, terminación, responsabilidad) y, en su anexo 1, las reglas sencillas para su equipo. Sin precios: esos van solo en el contrato firmado. |

Con `?b=` las páginas muestran el nombre, la dirección y el WhatsApp de la barbería (los lee de su catálogo público). Sin él,
dicen «la barbería donde reservas».

## Qué cambia entre una barbería y otra

Nada en el texto: se personaliza solo con lo que la barbería tiene en la app. **Antes de entregar una barbería, hay que
dejarle cargados su WhatsApp y su dirección**: el dueño los escribe en *Más → WhatsApp y dirección* (o quien la da de alta,
con el comando del `README.md` de la raíz), porque ahí es donde el cliente hace sus consultas y reclamos.

## Para llevarle al abogado

1. **Menores de edad.** Una barbería atiende niños. Los textos dicen que quien reserva usa sus propios datos (los de su
   representante) y que no se recogen datos del menor. ¿Es suficiente, o hace falta una autorización específica?
2. **Supresión.** La política promete que la barbería elimina o deja sin nombre y celular los datos de quien lo pida. Hoy la
   app **no tiene** una función para anonimizar un cliente (se archivan, no se borran): el administrador lo haría a mano.
   Decidir si se construye antes del piloto (propuesta: `anonimizar_cliente`, solo el dueño, con motivo).
3. **Autorización en el local.** Si el equipo agenda a un cliente que no pasó por la reserva en línea, no hay casilla. ¿Basta
   con avisarle de palabra y mostrarle el cartel con el aviso, o debe quedar constancia? Hoy no se guarda.
4. **Transmisión internacional.** Supabase y Vercel pueden guardar datos fuera de Colombia. ¿Alcanza la autorización de
   la política y la cláusula (numeral 9), o hay que revisar las condiciones del proveedor / declaración de conformidad?
5. **Conservación de cobros.** Los cobros se anulan, no se borran. ¿Cuánto se deben conservar según las normas
   contables y tributarias, y cómo se concilia con la supresión del nombre del cliente?
6. **Registro Nacional de Bases de Datos (RNBD).** ¿Aplica a cada barbería (depende del tamaño del negocio)? ¿Y al
   proveedor como encargado?
7. **Plazos de la cláusula** (entre corchetes): aviso de incidentes, devolución y supresión, vigencia de la
   confidencialidad. Ajustarlos a lo que de verdad se pueda cumplir.
8. **WhatsApp.** La app solo arma el enlace `wa.me`; el equipo manda el mensaje desde su celular. ¿Qué debe decir el aviso
   sobre ese canal?
9. **Quién firma.** Si la barbería es persona natural o empresa, y si el proveedor factura como persona natural o como
   empresa (decisión pendiente del negocio, ver la ficha de venta).

## Lo que NO cubren estos borradores

Términos y condiciones públicos dentro de la app, la política interna de datos del proveedor, el plan de respuesta a
incidentes y la facturación. El contrato real (precio, fechas, firmas) se arma aparte para cada barbería a partir de
[`contrato-de-servicio.md`](contrato-de-servicio.md); la cláusula de encargo se pega dentro de él.
