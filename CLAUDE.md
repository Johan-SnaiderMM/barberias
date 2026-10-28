# Barberías

PWA **mobile-first** para barberías pequeñas de Colombia: cuentas, agenda y reserva de citas desde casa.
Especificación en `SPEC.md`, fases en `PLAN.md`. Datos de demo SIEMPRE ficticios.
Patrones de referencia (NO copiar módulos ni su auto-deploy): `C:\Users\johan\OneDrive\Desktop\proyectos\Restaurantes` y `C:\Users\johan\OneDrive\Desktop\proyectos\Polo Air Cool`.

## Convenciones

- Todo en español: interfaz, comentarios, commits, nombres de tablas y funciones SQL.
- Dinero: pesos enteros (`integer`). Cálculos solo en `src/lib/dinero.ts` (espejo en SQL, comparados por prueba).
- Anular con motivo en vez de borrar. `created_at` y `registrado_por` en todo lo que se registra.
- Toda tabla de negocio lleva `barberia_id NOT NULL` + RLS (una prueba falla si no). Llaves foráneas compuestas `(barberia_id, id)`.
- Las escrituras van por funciones RPC `security definer`; el cliente nunca escribe tablas. Los visitantes sin cuenta
  solo ejecutan funciones `publico_*` (la lista exacta la fija una prueba).
- Permisos por área (`fn_areas` en SQL y `src/lib/areas.ts`, una prueba las compara). Toda función de escritura nueva
  pide su área con `requerir_area('…')` (o `requerir_dueno`, o `fn_requerir_agenda_de` para bloquear tiempo), nunca solo
  `requerir_barberia()`: una prueba (`permisos-por-area.test.ts`) falla si una función volátil de la API queda sin
  guardia. El barbero abre `mi_agenda` (solo lo suyo, vía `mi_barbero()`); la recepción `agenda` (todos).
- Migraciones (`supabase/migrations/`, nombre `AAAAMMDDNNNNNN_tema.sql`): toda migración que agregue funciones termina con
  `select public.fn_aplicar_permisos();` y se corre `npm run esquema` para regenerar `supabase/esquema-completo.sql`
  (una prueba lo verifica). Al redefinir una función, copiar la ÚLTIMA versión; si cambia su firma, `drop function`
  de la anterior (si no, queda una sobrecarga).
- SQL: cuidado con los NULL en las validaciones (`jsonb_typeof(x -> 'clave')` es NULL si falta la clave y un `or` con
  NULL no dispara el `raise`): usa `coalesce`. Una función plpgsql que devuelve `table (...)` lleva
  `#variable_conflict use_column` si sus consultas usan los mismos nombres de columna.
- Pruebas de SQL/RLS: Postgres real en memoria con PGlite (`src/test/base-datos.ts`), sin Docker. La extensión
  `btree_gist` ya viene cargada. Una prueba que escribe tablas directo (como dueño de la base) ejercita restricciones
  y triggers; las funciones de la API se llaman con `rpc(db, actor, "nombre", {...})`. PGlite atiende una consulta a
  la vez: las pruebas "concurrentes" verifican el RESULTADO que garantiza la restricción, no carreras reales.
- Citas (migración `0008`): `fin` es columna generada; mover = cambiar solo `inicio`. El precio y la duración se COPIAN
  del catálogo en un trigger al insertar (lo que pida el insert se ignora) y no cambian después. La hora libre la
  calcula solo `fn_huecos` / `fn_huecos_cualquiera` (migración `0009`); NO hay una versión en TypeScript.
- Agendar y mover (migración `0010`): lo confirmable (hora pasada, fuera del horario, sobre un bloqueo) NO es un
  error: la función devuelve `{ok:false, avisos}` y la pantalla reenvía con `p_confirmar`. Una hora ocupada es
  siempre un error duro (nadie la puede forzar).
- Equipo (migración `0013`): se entra con un código en `/unirme` (sesión anónima de Supabase + `canjear_invitacion`
  con la MISMA conexión; hay que activar "Allow anonymous sign-ins" en Supabase). `canjear_invitacion` es la única
  función de escritura sin área (lista `SIN_AREA_PERMITIDAS`); quien invita solo da roles cuyas áreas ya tiene.
- Reserva pública (migraciones `0015` a `0017`): lo único que `anon` ejecuta son las 7 funciones `publico_*` (lista
  fijada en `reserva-publica.test.ts`). Cada una envuelve una `fn_publico_*` con `p_ahora` (las pruebas llaman a la
  interna con un instante fijo). Una hora no libre es siempre `{ok:false, motivo:"hora_ocupada"}` sin decir quién la
  tiene; nada de otros clientes sale en ninguna respuesta. Las páginas públicas (`/reservar/<slug>`, `/cita/<token>`,
  `/privacidad`, `/aviso-de-privacidad`) están exentas de `revisarPermiso`. El token de la cita es el único permiso del cliente. La consulta pública (`0029`) NO devuelve el nombre del cliente: el celular
  identifica la ficha. La cita guarda el nombre que
  escribió quien reservó (`nombre_reserva`, `0030`) y la agenda y el aviso push lo muestran como `reservo_como` solo si es distinto del de la
  ficha.
- Avisos push (migración `0018`): sin `service_role`, el servidor lee las suscripciones con `publico_tomar_aviso(token)`
  (una vez por cita, últimos 10 min) y manda con `web-push` desde `after()`; `src/lib/push.ts` nunca lanza. Sin las
  tres variables VAPID no se manda nada. El service worker (`public/sw.js`) solo muestra el aviso y abre la cita (y solo direcciones de la propia app).
  Las suscripciones solo aceptan los servicios push de los navegadores (`ENDPOINT_PUSH`, mismo patrón en la restricción de `0031`), con tope de 5
  celulares por persona, y el envío tiene `timeout` de 5 s. Las cookies de sesión de Supabase salen `HttpOnly` (y `Secure` en producción)
  con `cookieDeSesion` (`src/lib/supabase/cookies.ts`): la app no usa el cliente de Supabase del navegador ni lee cookies con JavaScript.
  Antes de desplegar: `npm audit` (Next va fijado en 16.4.3 desde la revisión de seguridad 02).
- WhatsApp: la app nunca envía mensajes. `src/lib/whatsapp.ts` arma el enlace `wa.me` y la persona lo manda;
  `recordatorio_enviado_at` (migración `0014`) dice "se abrió", no "se envió".
- Cobros (migraciones `0019` a `0021`): un cobro (líneas, descuento repartido, propina, pagos) no se edita ni se borra, solo se
  anula con motivo; lleva `clave` de idempotencia (repetirla devuelve el mismo; si ya se anuló, avisa). Una cita con cobro
  vigente se queda `atendida` (trigger); anular el cobro la reabre. Los pagos suman EXACTO total + propina; el efectivo
  guarda lo aplicado, lo recibido y el vuelto. La pantalla calcula con `dinero.ts`, la base manda.
- Comisiones (`0022` y `0023`): el % vive en `comisiones_barbero` y `comisiones_servicio` (50 % si no hay fila), legibles solo
  con el área `comisiones`; se calcula al cobrar y se guarda en cada línea (instantánea). Liquidar paga TODO lo pendiente hasta
  un día; un cobro está en una sola liquidación vigente (índice único parcial); un cobro liquidado no se anula.
- Gastos (`0024`): foto del recibo en el bucket PRIVADO `gastos-fotos` (`<barberia_id>/<clave>.jpg`). El celular la achica
  (`src/lib/imagen.ts`: una acción acepta 1 MB), el servidor reconoce el tipo por el contenido y la sube con
  `BaseDatos.subirArchivo`; se sirve por `/api/foto/gasto/<id>` (nunca por la ruta). Sin `service_role`.
- Cierre del día (`0025`): `fn_jornada` es «hoy» para registrar (el día de Bogotá, o el siguiente si ese está cerrado);
  lo registrado después de cerrar entra al día siguiente y de un día cerrado no se anula nada. Solo se anula el cierre más
  reciente. Cobros, gastos y liquidaciones toman un candado compartido sobre la barbería (`fn_jornada_de_registro`) y el
  cierre uno exclusivo. Las cifras del día salen de `fn_resumen_dia` (las usan el cierre y Inicio); `obtener_inicio` (`0026`)
  devuelve a cada rol solo lo suyo.
- SQL, lo aprendido en la Fase 3: en un `raise exception` un `%` literal va como `%%`; una lectura `stable` con permisos de
  quien llama NO puede llamar a `fn_*` ni a `requerir_*` (usa `jornada_actual()` / `tiene_area()`), y una lectura protegida por
  área es `security definer` con `requerir_area` y filtra por la barbería a mano. Un trigger que revisa otra tabla es
  `security definer` para ver todo. En el modo local, `rpc` entrega JSON como PostgREST.
- Demo (`0027`): `fn_cargar_datos_demo(barbería, ahora)` borra y recrea TODO lo de una barbería con `es_demo` (activa
  `app.reiniciando_demo` en su transacción) y lo arma relativo a hoy con `fn_demo_hash` (sin `random()`): dos cargas con el mismo
  `ahora` dan el mismo contenido. Inserta cobros/pagos/cierres directo (con `created_at` en el pasado) copiando la aritmética de
  `fn_cobrar` y `registrar_cierre`, y `demo.test.ts` lo contrasta: si cambias una regla de dinero, cambia también `fn_demo_cobro`.
  Los porcentajes se guardan ANTES de cobrar; los cierres, al final. `reiniciar_demo(pin)` (solo dueño, solo demo) y el PIN
  (`fn_definir_pin_reinicio`, solo desde el SQL Editor) viven aquí; `fn_provisionar_demo(correo)` da de alta la demo. «Probar la
  demo» solo aparece con `DEMO_EMAIL`/`DEMO_PASSWORD` o en modo local (`demoDisponible`); en local hay una segunda barbería, la
  demo (`demo@local.test`).
- Recorrido guiado (`src/lib/guia.ts`, `components/guia`): pasos con `ruta`, `ir`, `objetivo` (`data-guia="…"` en la pantalla) y
  `alLlegarA`; vive en el layout raíz. Si cambias una ruta o quitas un `data-guia`, `guia.test.ts` falla. Un paso que necesita un
  registro (una cita, un cobro) usa como `ir` la lista y se puede saltar (`saltarA`).
- Textos legales (`docs/legal`, `/privacidad`, `/aviso-de-privacidad`): BORRADORES. Comparten `src/lib/legal.ts` (versión y plazos
  de la Ley 1581) y se personalizan con `?b=<slug>`; si cambias uno, sube la versión y mira `legal.test.ts`. El `README.md` lo
  contrasta `readme.test.ts` (variables, comandos, funciones SQL, nombres de pantalla): si cambias algo de eso, actualízalo.
  `docs/venta/` es solo local (`.gitignore`): precios y márgenes, nunca a GitHub.
- Contacto de la barbería (`0028`): `actualizar_contacto_barberia(p_whatsapp, p_direccion)` (área `servicios`) reemplaza LOS DOS
  datos; vacío quita el dato. El WhatsApp se normaliza con `fn_normalizar_telefono` (el mensaje dice «WhatsApp») y la dirección se
  limpia (1 a 120). `obtener_contexto` ya los trae; la pantalla es `/contacto` (**Más → WhatsApp y dirección**). El `update` del
  README (D.3) solo queda como alternativa al dar de alta.
- Textos: una hora como "5:00 p. m." ya termina en punto; no le pongas otro detrás (pasó dos veces).
- `src/lib/reloj.ts` (`ahoraMs`) en vez de `Date.now()` dentro de páginas: la regla `react-hooks/purity` lo prohíbe.
- Formularios: React 19 limpia los campos SIN control al terminar una acción. Si el formulario debe conservar lo
  escrito (p. ej. para confirmar), todos sus campos van controlados (`useState`).
- Fechas: instantes en `timestamptz`; "hoy" en Bogotá (`hoyBogota`, `fecha_bogota`). Las pruebas usan instantes fijos, nunca el reloj.
- Diseño: objetivos táctiles ≥ 48 px, texto ≥ 16 px, acciones principales abajo, sin `hover`, sin scroll horizontal;
  lo apagado se ve con borde punteado y fondo gris, nunca con `opacity`. Verificar a 360×640 y 390×844.
  Estilo "ultra clean": bordes de 1 px `border-linea` (nunca `border-2` ni negro), títulos `font-semibold`, etiquetas
  `font-medium` en mayúsculas (14 px), texto secundario `text-tinta-2`, íconos de línea fina, barras fijas
  translúcidas. Los colores salen de los tokens de `globals.css`; no usar hex sueltos.
  Contraste (`contraste.test.ts`): el texto llega a 4,5:1 sobre blanco, papel y hueso; el borde de un CAMPO es `borde-campo` (3:1; `linea` es solo
  para tarjetas y separadores), el anillo de foco es `tinta` y el texto de ejemplo, `tinta-2`. Solo las etiquetas en mayúsculas bajan a 14 px (y las
  de la barra de navegación). Perillas de diseño: ENERGÍA 1 / RITMO 1 / MOVIMIENTO 1 (calmo, pantallas parecidas entre sí, movimiento solo con
  propósito: el aro del recorrido late cuatro veces y se queda quieto). Las pantallas de carga y de error están en `loading.tsx`, `error.tsx` y
  `global-error.tsx`; `loading.tsx` va SOLO en `(app)` y `(tarea)`: en una página pública el servidor mandaría 200 antes de saber si la cita o la
  barbería existe y se perdería el 404 (`pantallas-de-estado.test.ts` y la e2e lo vigilan).
- Los componentes `"use client"` no importan Zod ni `server-only`.
- Next: esta versión tiene cambios de API. Leer `node_modules/next/dist/docs/` antes de escribir código de Next
  (aquí `middleware` es `src/proxy.ts`). No usar los tipos globales `LayoutProps`/`PageProps` (necesitan generar tipos
  antes de `tsc`): tipar `children` con `ReactNode`.
- Todo lo que dependa de la sesión (cookies) declara `export const dynamic = "force-dynamic"` (el layout `(app)`,
  `/entrar` y `/unirme` lo hacen): sin eso, un `next build` sin Supabase configurado intenta prerenderizarlo y falla.
- `.next/dev/types` (lo genera `next dev`) a veces queda con basura al final y rompe `tsc` y `next build`: por eso
  `npm run typecheck` y `npm run build` lo borran antes (`scripts/limpiar-tipos-dev.mjs`); `next dev` lo recrea solo.
- Modo local sin Supabase: `.env.local` con `DEMO_BD=local` crea en `.local/` una barbería de prueba; se entra en
  `/entrar` con `dueno@local.test` y cualquier contraseña (solo desarrollo; en producción está apagado). La base
  local se recrea sola cuando cambian las migraciones (huella en `.local/huella.txt`): los datos de prueba se pierden.
- Pantallas del personal: `src/app/(app)/<pantalla>/page.tsx` empieza con `revisarPermiso("<pantalla>")`, maneja
  `permitido` con `<SinPermiso>` y la pantalla se agrega a `PANTALLAS` (`src/lib/areas.ts`) y, si lleva botón en la
  barra, a `ITEMS` de `barra-navegacion.tsx`. `/`, `/entrar` y `/unirme` son las únicas páginas exentas (una prueba
  lo exige).

## Comandos

`npm run dev` · `npm run verificar` (lint + typecheck + test, obligatorio antes de dar algo por terminado) ·
`npm run esquema` · `npm test` · `npm run e2e:reservas` (Chrome real, dos celulares; NO va en verificar; cierra
cualquier `npm run dev` antes) · `npm run vapid` (llaves de los avisos push, una vez).

## No hacer sin avisar

Push, despliegues, tocar Supabase / Vercel / GitHub / DNS, agregar dependencias o servicios externos, pasar algo de
"Después del MVP" al MVP. Nunca `service_role` en la app, nunca claves en commits ni en el chat.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
