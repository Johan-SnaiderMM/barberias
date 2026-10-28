# Barberías · Plan por fases

> Depende de `SPEC.md` (aprobar primero). Tamaños: **S** ≈ medio día · **M** ≈ 1–2 días · **L** ≈ 3–5 días,
> trabajando de a una cosa. Cada fase termina en algo que se puede **abrir en el celular y enseñar**.
> Regla de oro: no empieza la fase N+1 hasta que `npm run verificar` pasa en la fase N.

## Cómo se ve el conjunto

```
Fase 0  Cimientos ─▶ Fase 1  Agenda del personal ─▶ Fase 2  Reserva pública ─▶ Fase 3  Cuentas ─▶ Fase 4  Demo + piloto
 (tenant, auth,        (servicios, barberos,          (el cliente aparta        (cobro, comisión,      (datos ficticios,
  permisos, PGlite)     horarios, citas)               desde su casa)            gastos, cierre)         legal, salida)
```

**Camino crítico:** disponibilidad sin dobles reservas (Fase 0 spike → Fase 1 → Fase 2). Lo demás se apoya en eso.
**Por qué la reserva va antes que las cuentas:** es lo que el cliente de la barbería *ve* y lo que más diferencia el
producto; además la agenda ya da valor sola. Si el piloto pide primero la caja, se intercambian las fases 2 y 3.

---

## Fase 0 · Cimientos

**Meta:** repo vacío que arranca, con inquilino, login, permisos por área y pruebas de SQL funcionando.

| # | Tarea | Tam. | Verificación |
|---|---|---|---|
| 0.1 | Proyecto Next + TS + Tailwind en `Barberias`, `CLAUDE.md`/`AGENTS.md` con las convenciones del SPEC §7, scripts de §5 | S | `npm run dev` abre; `npm run verificar` pasa en vacío |
| 0.2 | Leer la guía de Next en `node_modules/next/dist/docs/`; anotar en `CLAUDE.md` los cambios que afecten (middleware/proxy, etc.) | S | Nota escrita |
| 0.3 | Harness de pruebas: PGlite + `src/test/base-datos.ts` que aplica las migraciones | M | Una prueba trivial corre en < 30 s |
| 0.4 | **Spike `btree_gist`:** probar la restricción de exclusión de citas en PGlite; si falla, plan B con `pg_advisory_xact_lock` | S | Prueba de dos reservas simultáneas, una falla |
| 0.5 | Migración 0001: `barberias`, `perfiles`, fechas Bogotá, slug único y reservados | M | Aislamiento entre dos barberías |
| 0.6 | Migración 0002: RLS, `registrado_por`, bloqueo de borrado, `fn_aplicar_permisos()` | M | `anon` no ejecuta nada salvo `publico_*` (lista fijada) |
| 0.7 | Roles y **áreas** desde el inicio (`roles_equipo`, `perfil_roles`, `requerir_area`, `lib/areas.ts`) | M | Prueba que compara áreas SQL vs TS |
| 0.8 | Auth: `/entrar` (dueño) y alta de barbería por quien administra (`fn_crear_barberia`) | M | Dueño entra y ve su barbería vacía |
| 0.9 | `lib/dinero.ts` y `lib/fechas.ts` con pruebas | S | Pruebas de redondeo y de día Bogotá |
| 0.10 | PWA mínima: manifest, íconos, columna de celular, barra de navegación | S | Instalable; sin scroll horizontal a 360×640 |

**Salida de fase:** dueño de una barbería de prueba entra, ve un inicio vacío y las pruebas de aislamiento y permisos pasan.

---

## Fase 1 · Agenda del personal

**Meta:** el dueño configura su barbería y maneja la agenda a mano, sin dobles citas.

| # | Tarea | Tam. | Verificación |
|---|---|---|---|
| 1.1 | Servicios y precios (CRUD, archivar) · F2 | M | Pruebas de archivado y de copia de precio a la cita |
| 1.2 | Barberos + `barbero_servicios` · F2 | M | Un barbero solo ofrece lo asignado |
| 1.3 | Horarios semanales y bloqueos · F3 | M | Sin traslapes; bloqueo avisa citas afectadas |
| 1.4 | Migración de `citas` con la restricción de exclusión y estados · F4 | M | Prueba concurrente verde |
| 1.5 | **`fn_huecos`** en SQL: franjas − bloqueos − citas + colchón + paso + anticipación · corazón de F5 | L | Tabla de casos de borde con instantes fijos |
| 1.6 | Crear / mover / cancelar cita a mano; cita sin reserva · F4 | M | Mover a hora ocupada falla y no cambia nada |
| 1.7 | Pantalla de agenda: día por barbero, "mi día", estados y pendientes por cerrar | L | Revisado a 360×640 y 390×844 |
| 1.8 | Clientes: alta automática por celular, ficha con nota · F10 | M | Dedupe por celular dentro de la barbería |
| 1.9 | Equipo por invitación (`crear_invitacion` → `/unirme` → `canjear_invitacion`) con barbero vinculado · F1 | M | Barbero ve solo su agenda |
| 1.10 | Recordatorio por WhatsApp de un toque (`wa.me`) | S | Marca `recordatorio_enviado_at` |

**Salida de fase:** una barbería real podría usar la agenda ya (aunque sin reserva pública ni caja).
**Punto de decisión:** enseñar esto al posible piloto y recoger reacciones antes de seguir.

### Estado (1.1 a 1.10 hechas: la Fase 1 está completa)

| # | Hecho | Dónde |
|---|---|---|
| 1.1 | Servicios: crear, editar, archivar y restaurar, con pantallas (`/servicios`) | migración `0005`, `servicios.test.ts` |
| 1.2 | Barberos, servicios por barbero con precio/duración propios, vincular con una cuenta; pantallas (`/barberos`) | `0006`, `barberos.test.ts` |
| 1.3 | Horario semanal por franjas (turnos partidos), bloqueos y ajustes de la agenda; pantallas | `0007`, `horarios.test.ts` |
| 1.4 | Citas con la restricción de exclusión, precio/duración copiados, bloqueo que avisa las citas afectadas | `0008`, `citas.test.ts` |
| 1.5 | `fn_huecos` y `fn_huecos_cualquiera`, con la tabla de casos de borde escrita antes que la función | `0009`, `disponibilidad.test.ts` |
| 1.6 | Crear, mover y cancelar cita a mano; "llegó sin cita"; cambios de estado; avisos que se pueden confirmar | `0010`, `citas-funciones.test.ts`, `telefono.test.ts` |
| 1.7 | Pantalla de agenda: día con selector de barbero, "Mi día" del barbero, detalle, nueva cita, sin cita, mover, "por cerrar" | `0011`, `agenda-lecturas.test.ts` |
| 1.8 | Clientes: lista con búsqueda, ficha con nota e historial, alta y edición; el mismo celular es el mismo cliente | `0012`, `clientes.test.ts` |
| 1.9 | Equipo: invitar con código (8 caracteres, 72 h, un solo uso), `/unirme` con sesión anónima, roles por persona, quitar del equipo | `0013`, `equipo.test.ts`, `invitaciones.test.ts` |
| 1.10 | Recordatorio por WhatsApp de un toque (`wa.me`) que deja `recordatorio_enviado_at` | `0014`, `recordatorio-cita.test.ts`, `whatsapp.test.ts` |

**Diferencias respecto del plan original (decididas al construir):**
- La tabla `clientes` se creó en 1.4 (la cita la necesita para su llave foránea); sus pantallas y la alta
  automática por celular siguen siendo la tarea 1.8.
- Las pantallas de configuración (servicios, barberos, horario, bloqueos, ajustes) se hicieron dentro de 1.1 a 1.3:
  sin ellas la agenda no se podía usar con datos reales.
- Se agregó el área `mi_agenda` (el barbero ve solo lo suyo) y `fn_requerir_agenda_de` para bloquear tiempo propio.
- `comision_pct` NO se adelantó: llega con las comisiones (Fase 3), después de resolver renta de silla vs. comisión.
- Ocupan la hora las citas `atendida` además de `confirmada` y `en_atencion`.
- `cancelar_hasta_horas` y `reservas_en_linea` quedan para la Fase 2 (2.4 y 2.6), donde se usan.
- Agendar y mover (1.6): una hora pasada, fuera del horario o sobre un bloqueo no es un error: se avisa y el personal
  confirma. Una hora ocupada nunca se puede forzar.
- `buscar_clientes` se hizo en 1.7 (el formulario de cita busca al cliente); el resto de clientes, en 1.8.
- La agenda NO tiene columnas por barbero en pantalla ancha (SPEC F4): en celular y en escritorio es la misma lista
  del día con selector de barbero. Se hace si el piloto la pide.
- No hay editor de roles: a cada persona se le asignan los roles que ya existen (Barbero, Recepción). Crear roles
  nuevos desde la app queda para después de ver el piloto.
- Quien invita solo puede dar roles cuyas áreas ya tiene, y al dueño no se le cambian los roles ni se le saca del equipo.
- El recordatorio no envía nada: abre WhatsApp con el mensaje armado. La marca dice "se abrió", no "se envió"
  (`wa.me` no confirma si la persona lo mandó).

**Pendientes que deja la Fase 1:**
- Para que el equipo entre con código en producción hay que activar "Allow anonymous sign-ins" en Supabase
  (anotado en `.env.example`; no se tocó Supabase).
- `canjear_invitacion` no limita los intentos por sesión. Con 32^8 combinaciones y pocas invitaciones vivas adivinar
  un código es impráctico, pero conviene meterla en el anti-abuso de la tarea 2.2.
- Ley 1581: un cliente se puede corregir pero no suprimir. Falta decidir con el abogado (4.3) cómo se atiende una
  solicitud de supresión (lo natural: anonimizar nombre y celular y conservar las cifras).
- Preguntas abiertas del SPEC (§11): la 1 (comisión vs. renta de silla) decide el diseño de la Fase 3, y la 2
  (aprobación de reservas) el de la Fase 2.

---

## Fase 2 · Reserva pública desde casa

**Meta:** el cliente aparta su cita con un enlace, sin cuenta.

| # | Tarea | Tam. | Verificación |
|---|---|---|---|
| 2.1 | Funciones `publico_*`: `catalogo`, `huecos`, `reservar`, `consultar_cita`, `cancelar`, `reprogramar` · F5 | L | Lista exacta de funciones abiertas a `anon` fijada en prueba |
| 2.2 | Anti-abuso en la base: tope por celular, por minuto, campo trampa | M | Pruebas de cada tope |
| 2.3 | Página `/reservar/<slug>`: servicio → barbero → día → hora → datos → confirmar | L | A 360×640 sin scroll horizontal; táctiles ≥ 48 px |
| 2.4 | Página `/cita/<token>`: ver, cancelar, mover, enlace a WhatsApp de la barbería | M | Token ajeno devuelve "no existe" sin filtrar datos |
| 2.5 | Consentimiento de datos y política enlazada · F5 | S | No se puede enviar sin marcar |
| 2.6 | Interruptor "reservas en línea" y límites (días adelante, anticipación, cancelar hasta) | S | Cerrado: el cliente ve el catálogo y el aviso |
| 2.7 | Aviso push al personal por reserva nueva / cancelación · F11 | M | Sin llaves VAPID no rompe nada |
| 2.8 | Cartel con el QR para imprimir y enlace para compartir por WhatsApp | S | Se imprime solo el cartel |
| 2.9 | `npm run e2e:reservas`: dos celulares simulados (cliente y personal) | M | Reservar → aparece en la agenda → cancelar |

**Salida de fase:** una persona ajena a la barbería reserva desde su casa y el personal lo ve en su celular.

### Estado (2.1 a 2.9 hechas: la Fase 2 está completa)

| # | Hecho | Dónde |
|---|---|---|
| 2.1 | API pública: `publico_catalogo`, `publico_huecos`, `publico_reservar`, `publico_consultar_cita`, `publico_cancelar_cita`, `publico_huecos_cita`, `publico_reprogramar_cita`; la lista exacta que abre a `anon` está fijada en una prueba | `0015`, `reserva-publica.test.ts` |
| 2.2 | Topes en la base: 3 citas por venir por celular, 10 reservas por minuto por barbería y campo trampa | `0016`, `reserva-topes.test.ts` |
| 2.3 | `/reservar/<slug>`: servicio → barbero (o "el primero disponible") → día → hora → datos → confirmar | `src/app/reservar`, `src/components/reserva` |
| 2.4 | `/cita/<token>` y `/cita/<token>/mover`: ver, cambiar la hora, cancelar y escribir a la barbería; un token ajeno da 404 | `src/app/cita` |
| 2.5 | Casilla de consentimiento obligatoria (también en la base: queda `consentimiento_at` en la cita) y `/privacidad` | `0015`, `src/app/privacidad` |
| 2.6 | Interruptor "recibir reservas en línea" y "el cliente puede cancelar o mover hasta…" en los ajustes de la agenda | `0017`, `ajustes-reservas.test.ts` |
| 2.7 | Avisos push al personal por reserva nueva y cancelación del cliente (`web-push`); sin llaves VAPID no pasa nada | `0018`, `avisos-push.test.ts`, `push.test.ts`, `public/sw.js` |
| 2.8 | Cartel con el QR (`qrcode`), enlace para copiar y para mandar por WhatsApp; al imprimir sale solo el cartel | `src/app/(tarea)/cartel`, `qr.test.ts` |
| 2.9 | `npm run e2e:reservas`: Chrome real y dos celulares (cliente 360×640, personal 390×844) sobre la app con una base local aparte | `e2e/`, `vitest.e2e.config.mts` |

**Diferencias respecto del plan (decididas al construir):**
- Los topes de 2.2 se calculan sobre las mismas citas (no hay tabla de intentos): frenan reservas, no intentos fallidos.
  Un robot puede ocupar hasta 10 horas por minuto como mucho; el personal las cancela con motivo.
- Las funciones `fn_publico_*` reciben `p_ahora` y los `publico_*` son envoltorios con `now()`: así las pruebas usan
  instantes fijos.
- Mover una cita desde el enlace conserva barbero y servicio; solo cambia la hora.
- `/privacidad` es un BORRADOR; el texto definitivo lo revisa un abogado (tarea 4.3).
- Las pantallas públicas muestran "No encontramos esa página" (`src/app/not-found.tsx`) para slugs y enlaces que no existen.
- Push (2.7): como la app no usa `service_role`, el servidor lee las suscripciones con `publico_tomar_aviso(token)`: solo con
  el token de la cita, una vez por cita y si la reserva o cancelación es de los últimos 10 minutos. Quien tenga ese token
  puede obtener esas suscripciones, pero sin la llave privada VAPID (solo del servidor) no puede mandar avisos con ellas.
- Push (2.7): el aviso sale con `after()` después de responderle al cliente; nunca lo hace esperar ni fallar. Solo avisa de
  reservas y cancelaciones del cliente (no de cambios de hora) y llega al dueño, a quien abre "agenda" y al barbero de
  esa cita.
- La prueba de punta a punta usa el Chrome instalado (`channel: "chrome"`): no se descarga ningún navegador. Levanta
  `next dev` con `DEMO_BD_DIR=.local-e2e`; no corre con `npm run verificar`.

**Para activar los avisos push** (una vez, por quien instala): `npm run vapid`, y poner las tres variables
(`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) en Vercel. Cada persona los enciende en Más →
Avisos de reservas. En iPhone la app tiene que estar instalada en la pantalla de inicio.

---

## Fase 3 · Cuentas

**Meta:** saber cuánto entró, cuánto se debe a cada barbero y cuánto quedó al cerrar.

| # | Tarea | Tam. | Verificación |
|---|---|---|---|
| 3.1 | `cobros` y `cobro_pagos`: servicios + extras + descuento con motivo, medios, propina, idempotencia · F6 | L | No hay doble cobro; pago mixto suma exacto |
| 3.2 | Pantalla "Cobrar" con teclado propio y vuelto | M | Una mano, 360×640 |
| 3.3 | Anulación de cobro con motivo que reabre la cita | S | Cierra el ciclo sin dejar huérfanos |
| 3.4 | Comisiones: cálculo al cobrar, instantánea, excepciones por servicio · F7 | M | Suma de partes = total al peso |
| 3.5 | Resumen por barbero y periodo; **Liquidar** idempotente | M | No se liquida dos veces |
| 3.6 | Gastos con foto privada y categorías · F8 | M | Anulable con motivo |
| 3.7 | Cierre del día: contar, diferencia, cerrar, anular, resumen por WhatsApp · F9 | M | Tras cerrar, las cifras no se mueven |
| 3.8 | Inicio: citas de hoy, vendido hoy, comisiones del día, no-shows | M | Cifras de Inicio = cifras del cierre |
| 3.9 | Prueba de consistencia: TS (`dinero.ts`) vs SQL con datos variados | S | Verde |

**Salida de fase:** un día completo simulado de punta a punta (reservar → atender → cobrar → liquidar → cerrar) cuadra al peso.

### Estado (3.1 a 3.9 hechas: la Fase 3 está completa)

| # | Hecho | Dónde |
|---|---|---|
| 3.1 | `cobrar_cita` y `cobrar_venta`: servicios (con precio editable) + extras + descuento con motivo repartido entre las líneas + propina + pagos en efectivo (con vuelto), Nequi o mixtos que suman exacto; idempotentes por clave; un cobro vigente por cita | `0019`, `cobros.test.ts` |
| 3.2 | `/caja` (por cobrar, atrasadas, cobrados y totales), `/caja/cobrar/[id]`, `/caja/venta` y `/caja/cobro/[id]` con teclado propio, hojas para precio, descuento y propina, y confirmación con el vuelto | `0020`, `src/components/caja`, `caja-lecturas.test.ts` |
| 3.3 | `anular_cobro` con motivo: la cita se reabre (en atención) y se puede cobrar de nuevo; una cita cobrada no sale de «atendida» (trigger); repetir la clave de un cobro anulado avisa | `0021`, `anular-cobro.test.ts` |
| 3.4 | Porcentaje por barbero (50 % por defecto) con excepción por servicio, calculado al cobrar y guardado en cada línea; propina del barbero o de la barbería según el ajuste; pantalla de porcentajes | `0022`, `comisiones.test.ts`, `/comisiones/porcentajes` |
| 3.5 | Resumen por barbero y periodo (hoy, semana, quincena, mes) y **Liquidar** idempotente; anular la liquidación; un cobro liquidado no se anula | `0023`, `liquidaciones.test.ts`, `periodos.test.ts`, `/comisiones` |
| 3.6 | Gastos con categoría y medio, foto del recibo en un bucket privado (se achica en el celular y se sirve solo a quien tiene permiso), anulables con motivo | `0024`, `gastos.test.ts`, `/gastos`, `/api/foto/gasto/[id]` |
| 3.7 | Cierre del día: efectivo esperado, contar, diferencia, cerrar, anular y resumen por WhatsApp; el día cerrado no se mueve | `0025`, `cierre.test.ts`, `/cierre` |
| 3.8 | Inicio con citas de hoy (atendidas y no llegaron), vendido, comisiones y gastos del día; cada rol ve lo suyo; las cifras salen de la misma función que el cierre | `0026`, `inicio.test.ts` |
| 3.9 | TypeScript y SQL dan lo mismo, al peso: constantes, formato, porcentajes, 60 cobros variados, 120 combinaciones de pagos, el efectivo del cierre y un día completo simulado | `consistencia-dinero.test.ts` |

**Diferencias respecto del plan (decididas al construir):**
- **Solo comisión.** La renta de silla queda para después del piloto (tú lo decidiste). Los porcentajes viven en tablas
  aparte (`comisiones_barbero`, `comisiones_servicio`) que solo lee el área «comisiones»: un barbero no ve lo que gana otro.
- **Liquidar paga todo lo pendiente hasta un día**, no solo el periodo que se mira: así nada viejo se olvida y el monto de
  la pantalla es el que se paga. El periodo sirve para ver lo generado.
- **«Hoy» sigue al cierre.** Después de cerrar el día, lo que se registre entra al día siguiente (la caja, los gastos y
  Inicio muestran ese día; las citas siguen el calendario). De un día cerrado no se anula nada, y solo se anula el cierre
  más reciente. Para corregir algo viejo hay que anular los cierres desde el último hacia atrás.
- **Efectivo esperado** = cobrado en efectivo (sin el vuelto) − gastos en efectivo − pagos en efectivo a barberos. No hay
  «base de caja»: si la barbería deja un fondo, la diferencia lo mostrará.
- Mientras se cierra, nadie registra: cobros, gastos y liquidaciones toman un candado compartido sobre la barbería y el
  cierre uno exclusivo (en PGlite no se puede probar una carrera real; la lógica está y es la de Postgres).
- La foto del recibo se sirve por el id del gasto (`/api/foto/gasto/<id>`), nunca por la ruta del archivo, y se reconoce por
  su contenido (jpg, png o webp), no por el nombre.
- En el modo local, `rpc` ahora entrega el resultado como JSON igual que Supabase (antes una función que devolvía una `date`
  llegaba como objeto `Date` y provocaba un bucle de redirecciones en `/cierre`; se encontró probando en el navegador).

**Pendientes que deja la Fase 3:**
- Las migraciones `0019` a `0026` **no se han aplicado a un Supabase real** (no se tocó). El bucket `gastos-fotos` y sus políticas
  están probados en PGlite, pero subir y leer una foto con Storage de verdad no se ha probado: hacerlo con el proyecto de piloto.
- Fondo de caja (base) y adelantos a los barberos: no están; decidirlos con el piloto.
- El aviso de «días sin cerrar» está en `/cierre`, no en Inicio.
- La demo (4.1) tiene que sembrar cobros, gastos, liquidaciones y cierres con fechas relativas a hoy; las tablas nuevas ya aceptan el
  reinicio de la demo (`app.reiniciando_demo`).

---

## Fase 4 · Demo y salida a piloto

**Meta:** algo que se pueda enseñar en una visita y poner a prueba en una barbería real.

| # | Tarea | Tam. | Verificación |
|---|---|---|---|
| 4.1 | Barbería de demo con datos ficticios relativos a hoy; reinicio desde la app (solo demo, con PIN opcional) · F12 | M | Dos reinicios dan lo mismo |
| 4.2 | Recorrido guiado de 2 minutos | M | Completa sin ayuda |
| 4.3 | Textos legales: aviso, privacidad y cláusula de encargo de datos (borrador para revisar con abogado) | S | Enlazados desde la reserva |
| 4.4 | `README` de puesta en marcha en Supabase + Vercel, hecho **a mano por ti** | S | Un tercero lo sigue sin preguntar |
| 4.5 | Ficha de venta y precios (partir de `CONTEXTO.md` de Polo Air Cool) | S | Lista para cotizar |
| 4.6 | Piloto en una barbería: 2 semanas de uso, lista de fricciones | · | Decidir qué entra de "Después del MVP" |

**Salida de fase:** primera barbería usándolo con datos reales y una lista priorizada de lo que sigue.

### Estado (4.1 a 4.5 hechas; 4.6 es el piloto, no es código)

| # | Hecho | Dónde |
|---|---|---|
| 4.1 | Barbería de demo (3 barberos, 7 servicios y 1 archivado, 20 clientes, ~350 citas, cobros con extras, descuentos, propinas y pagos mixtos, gastos, pagos a barberos y cierres) armada **relativa a hoy** y sin azar: dos cargas en el mismo instante dejan lo mismo, y una semana después queda igual medida desde hoy. «Probar la demo» en `/entrar`, **Más → Reiniciar la demo** (solo dueño, solo demo, PIN opcional que pone quien administra, 5 intentos y 5 minutos de bloqueo) y aviso de demostración | `0027`, `demo.test.ts` (30), `src/app/acciones/demo.ts`, `src/components/demo`, `/entrar` |
| 4.2 | Recorrido guiado de 10 pasos (inicio → agenda → cita → cobrar → gastos → comisiones → cierre → cartel → listo): arranca al entrar a la demo, avanza solo al llegar a cada pantalla, resalta lo que hay que tocar con un aro, se puede saltar y se reabre con la ficha «n/10» | `src/lib/guia.ts`, `src/components/guia`, `guia.test.ts` |
| 4.3 | Aviso de privacidad (`/aviso-de-privacidad`) y política de datos (`/privacidad`) con lo del art. 13 del Decreto 1377, personalizados con `?b=<slug>`, enlazados desde la casilla de la reserva y la página de la cita; cláusula de encargo y lista para el abogado en `docs/legal/` | `src/app/privacidad`, `src/app/aviso-de-privacidad`, `src/components/legal`, `docs/legal`, `legal.test.ts` |
| 4.4 | `README.md` de la raíz: modo local, Supabase + Vercel paso a paso (A–F con lista de 10 minutos), alta de una barbería de verdad y de la demo, actualizar, variables, problemas frecuentes. Una prueba lo contrasta con el código (variables, comandos, funciones, pantallas) y otra comprueba que el esquema completo se puede volver a pegar | `README.md`, `readme.test.ts`, `reglas-esquema.test.ts` |
| 4.5 | Ficha de venta y precios (solo local, en `.gitignore`): qué incluye y qué no, guion de demo de 10 minutos, costos con un solo despliegue, punto de equilibrio, planes, plantilla de cotización, objeciones, piloto y lo que falta antes de cotizar | `docs/venta/FICHA-DE-VENTA.md`, `ficha-venta.test.ts` |
| extra | **WhatsApp y dirección de la barbería, desde la app** (era un pendiente de la fase: solo se cargaban con un `update`, README D.3). `actualizar_contacto_barberia(p_whatsapp, p_direccion)` los reemplaza a los dos, normaliza el WhatsApp a E.164 con `fn_normalizar_telefono` y limpia la dirección (1 a 120); vacío quita el dato. Pantalla `/contacto` en **Más → WhatsApp y dirección**, con un botón para probar el número. Los usan la reserva, la cita y los textos legales | `0028`, `contacto-barberia.test.ts` (21), `src/app/(tarea)/contacto`, `src/components/contacto`, `src/app/acciones/contacto.ts` |

**Diferencias respecto del plan (decididas al construir):**
- **La demo se arma en SQL** (`fn_cargar_datos_demo`), no con un seed aparte: el mismo código sirve al alta, al reinicio y a las pruebas,
  y las cifras de cobros y cierres salen con la misma aritmética que `fn_cobrar` y `registrar_cierre`. Lo que sobrevive al reinicio: la
  barbería, la cuenta del dueño, los roles y el PIN. Las personas que entraron con un código y sus avisos se van.
- **Ayer queda sin cerrar a propósito** (y con una cita atendida sin cobrar) para que el cierre y la caja enseñen sus avisos; hay otra
  sin cobrar de hace tres días. Un cobro y un gasto anulados enseñan la anulación.
- **«Probar la demo» solo aparece si hay demo**: con `DEMO_EMAIL` y `DEMO_PASSWORD` o en modo local. La instalación de un cliente no la ofrece.
- **El contacto lo edita quien maneja los servicios**, no solo el dueño: `actualizar_contacto_barberia` pide el área «servicios» (como los
  ajustes de la agenda y el cartel; el dueño la tiene siempre) y la pantalla `contacto` usa la misma. `obtener_contexto` ya traía
  `whatsapp` y `direccion`, así que no hubo que tocarlo. El `update` del README (D.3) queda solo como alternativa al dar de alta.
- **El «aviso» de 4.3 es el aviso de privacidad** del Decreto 1377 (corto, antes de reservar); la política es el texto completo.
- **El `README` anterior no existía**: el de la raíz se escribió de cero, tomando el de comandacomi solo como patrón de contenido.

**Pendientes que deja la Fase 4:**
- Nada se ha ejecutado contra un **Supabase o un Vercel reales**: el `README` está probado contra el código, no siguiéndolo en un proyecto
  de verdad. Las migraciones `0019` a `0027` y el bucket de fotos siguen sin probarse fuera de PGlite. Es lo primero del piloto.
- **Supresión de datos de un cliente** (Ley 1581): la política la promete y no hay función para anonimizar un cliente (se archivan). Hoy lo haría
  quien administra a mano. Decidir con el abogado si se construye antes del piloto.
- **Los textos legales son borradores**: los revisa un abogado antes de usar datos reales (`docs/legal/LEEME.md` trae la lista de preguntas).
- El PIN de reinicio y la cuenta de la demo se ponen a mano (`fn_definir_pin_reinicio`, `fn_provisionar_demo`); no hay pantalla.
- Reiniciar la demo apaga los avisos push de todos los celulares, también el de quien la reinicia (en comandacomi se conserva ese).

---

## Después del MVP (se decide con lo que diga el piloto)

1. Fiado / cartera · 2. Trabajo sin conexión · 3. Resumen diario por push (cron) · 4. Productos con inventario simple ·
5. Aprobación manual de reservas y bloqueo por no-shows · 6. Subdominio por barbería (ver `docs/PLATAFORMA.md` de comandacomi).

## Riesgos por fase

| Fase | Riesgo | Plan |
|---|---|---|
| 0 | `btree_gist` no disponible en PGlite | Spike 0.4 antes que nada; plan B con bloqueo consultivo |
| 1 | `fn_huecos` con casos raros (citas que cruzan el cierre, paso vs duración) | Tabla de casos de borde escrita **antes** de la función |
| 2 | Spam por el enlace público | Topes en la base (2.2), campo trampa, límites por celular |
| 3 | Redondeos de comisión que no cuadran | Instantánea al cobrar + prueba de suma exacta |
| 4 | Un solo piloto sesga las decisiones | Mostrar la demo a 2 o 3 dueños más antes de fijar precio |

## Qué necesito de ti (no avanzo sin esto)

- **Aprobar `SPEC.md`** y responder las preguntas abiertas de su §11 (al menos 1 y 2: comisión/renta de silla y aprobación).
- Antes de la Fase 4: crear tú el proyecto de Supabase y el de Vercel (no pegues claves en el chat).
