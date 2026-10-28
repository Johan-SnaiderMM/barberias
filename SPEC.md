# Barberías · Especificación del MVP

> Nombre de marca provisional: **Barberías** (cámbialo antes de salir a vender).
> Estado: borrador para aprobar. Nada de esto está construido todavía.
> Referencias de patrones (NO copiar módulos ni su auto-deploy):
> `C:\Users\johan\OneDrive\Desktop\proyectos\Restaurantes` (repo `comandacomi`) y `C:\Users\johan\OneDrive\Desktop\proyectos\Polo Air Cool`.

---

## 1. Objetivo

PWA **mobile-first** para barberías pequeñas de Colombia (1 a 8 barberos) que resuelve tres cosas en una sola app:

1. **Cuentas:** cobros (efectivo / Nequi / mixto), propinas, comisiones por barbero, gastos y cierre del día.
2. **Agenda:** citas por barbero, con duración por servicio, sin dobles reservas.
3. **Reserva desde casa:** el cliente aparta su cita desde el celular, **sin cuenta ni app**, con un enlace que la barbería comparte por WhatsApp o un QR.

**Problema:** hoy la barbería agenda por chat y cuaderno: se cruzan horas, hay clientes que no llegan sin aviso, nadie sabe cuánto se ganó de verdad ni cuánto se le debe a cada barbero.

### Usuarios

| Quién | Cómo entra | Qué necesita |
|---|---|---|
| **Dueño** | Correo y contraseña | Ver todo: agenda, caja, comisiones, gastos, cierre, servicios, equipo. |
| **Barbero** | Código de invitación (sin correo) | Su propia agenda y lo que ha ganado. |
| **Recepción** (opcional) | Código de invitación | Agenda de todos y cobrar; sin ver comisiones ni cierre. |
| **Cliente final** | Nadie: abre un enlace | Reservar, ver su cita, cancelarla o moverla. |

### Qué es un "sí" para el MVP

- Un cliente reserva desde su celular en **menos de 1 minuto** y nunca queda una hora doble.
- El dueño cierra el día sabiendo **cuánto entró, cuánto se debe a cada barbero y cuánto quedó**.
- Funciona en un Android de gama media/baja, con una mano.

---

## 2. Alcance

### Dentro del MVP
Servicios y precios · barberos y horarios · agenda del personal · reserva pública · cobro con propina ·
comisiones por barbero · gastos · cierre del día · clientes · recordatorio por WhatsApp (un toque) ·
aviso push al personal de reservas nuevas · equipo por invitación con permisos por área · modo demo.

### Después del MVP (en este orden aproximado)
1. Fiado / cartera (se porta de comandacomi).
2. Trabajo sin conexión (cola idempotente de comandacomi).
3. Resumen diario por push (cron, como Polo Air Cool).
4. Venta de productos (gel, cera) con inventario simple.
5. Reserva con aprobación manual y bloqueo por no-shows repetidos.

### Fuera de alcance (no agregar sin decisión explícita)
Facturación electrónica · pagos en línea / anticipos · WhatsApp automático · multi-sede · app en tiendas ·
reseñas y marketplace de barberías · nómina formal · impresión térmica.

---

## 3. Funcionalidades y criterios de aceptación

### F1. Barbería, equipo y permisos
- Una barbería = un inquilino (`barberia_id` en toda tabla de negocio, con RLS). Tiene `slug` único
  (`/reservar/<slug>`), nombre, WhatsApp, dirección y zona horaria fija `America/Bogota`.
  El WhatsApp y la dirección los edita el dueño (o quien maneja los servicios) en **Más → WhatsApp y dirección**; los ven la
  reserva, la cita y los textos legales.
- La cuenta del dueño la crea quien administra en Supabase (como `fn_crear_restaurante`); no hay registro abierto.
- El dueño invita con un código; la persona entra con una sesión anónima de Supabase (sin `service_role`).
- Permisos por **área** fija: `agenda` (la de todos), `mi_agenda` (solo lo propio, para el barbero), `caja`, `gastos`,
  `cierre`, `comisiones`, `servicios`, `equipo`. Cada rol de la barbería es un conjunto de áreas; el dueño las tiene todas.
  (`mi_agenda` se agregó en la Fase 0 para cumplir el criterio de abajo: "un barbero solo ve su agenda y sus comisiones".)

**Aceptación**
- [ ] Un usuario de la barbería A no puede leer ni escribir nada de la barbería B (prueba de aislamiento).
- [ ] Toda función de escritura pide su área (`requerir_area`); una prueba fija la lista de las que no la piden.
- [ ] Un barbero solo ve **su** agenda y **sus** comisiones.

### F2. Servicios y precios
- Servicio: nombre, precio (COP entero), duración en minutos, activo, orden. "Corte + barba" es un servicio más.
- Qué barbero hace qué servicio (tabla `barbero_servicios`), con precio y duración propios opcionales.

**Aceptación**
- [ ] Un servicio archivado no sale en la reserva pública pero se conserva en citas y cobros viejos.
- [ ] El precio y la duración de una cita quedan **copiados** a la cita al crearla (cambiar el catálogo no reescribe el pasado).

### F3. Horarios y bloqueos
- Horario semanal por barbero en franjas (ej. lunes 9:00–13:00 y 14:30–19:00).
- Bloqueos puntuales (día libre, cita médica, almuerzo largo) con motivo.
- Parámetros de la barbería: paso de reserva (15 o 30 min), días hacia adelante (por defecto 30),
  anticipación mínima (por defecto 60 min), límite para cancelar sin llamar (por defecto 2 h), colchón entre citas (por defecto 0).

**Aceptación**
- [ ] Una franja no puede traslaparse con otra del mismo barbero y día.
- [ ] Un bloqueo que cae sobre citas ya agendadas **avisa cuáles** antes de guardarse (no las cancela solo).

### F4. Agenda del personal
- Vista del día por barbero (columnas en pantalla ancha, lista con selector de barbero en celular) y vista de "mi día" para el barbero.
  (Hoy existe la lista con selector en cualquier pantalla; las columnas quedan para después del piloto.)
- Crear cita a mano (cliente existente o nuevo), cita **sin reserva** (llegó sin cita), mover, cancelar con motivo.
- Estados: `confirmada` → `en_atencion` → `atendida`; o `cancelada` / `no_asistio`. Se anula con motivo, no se borra.
- Botón **Recordar por WhatsApp** (abre `wa.me` con el mensaje armado) y queda marcado `recordatorio_enviado_at`.

**Aceptación**
- [ ] Dos personas no pueden dejar dos citas traslapadas para el mismo barbero, ni siquiera a la vez
  (restricción en la base, no solo validación en pantalla; prueba con dos transacciones concurrentes).
- [ ] Mover una cita a una hora ocupada falla con un mensaje claro y deja la cita donde estaba.
- [ ] Una cita cuya hora ya pasó y sigue `confirmada` aparece destacada como "por cerrar" en la agenda del día.

### F5. Reserva pública (`/reservar/<slug>`)
Flujo en una sola mano: **servicio → barbero (o "el primero disponible") → día → hora → nombre y celular → confirmar.**

- El cliente no necesita cuenta. Termina en `/cita/<token>` (uuid no adivinable): ve su cita, la **cancela** o la **mueve** hasta el límite configurado; después, el botón lo lleva al WhatsApp de la barbería.
- La página pública solo muestra **horas libres u ocupadas**, jamás nombres ni teléfonos de otros clientes.
- Casilla de consentimiento de datos (Ley 1581) con enlace a la política; el celular se guarda en E.164 (+57 por defecto).
- Si el dueño apaga "reservas en línea", el cliente ve el catálogo y "hoy no recibimos reservas".

**Aceptación**
- [ ] `anon` no lee ninguna tabla: solo ejecuta funciones `publico_*`; una prueba fija la lista exacta.
- [ ] Las horas libres las calcula **una sola función SQL** (`publico_huecos`); no hay una segunda versión en TypeScript.
- [ ] Reservar una hora que otro tomó un segundo antes devuelve `{ok:false, motivo:"hora_ocupada"}` y la pantalla recarga las horas.
- [ ] Anti-abuso en la base: máximo de citas futuras activas por celular (3), máximo de reservas por barbería por minuto y campo trampa.
- [ ] A 360×640 y 390×844 la reserva completa se hace sin scroll horizontal y con objetivos táctiles ≥ 48 px.

### F6. Cobro
- Se cobra desde la cita (o una venta sin cita): servicios (editables) + extras con nombre y precio + descuento con motivo.
- Medios: efectivo (con vuelto), Nequi / transferencia, o parte y parte. Propina como valor aparte.
- Cobro **anulable con motivo**; reabre la cita para corregirla.

**Aceptación**
- [ ] Todo en pesos enteros; los cálculos viven en un módulo central (`src/lib/dinero.ts`) y una prueba lo compara con el SQL.
- [ ] Cobrar dos veces la misma cita no duplica el cobro (clave de idempotencia).
- [ ] Una cita `cancelada` o `no_asistio` no se puede cobrar.

### F7. Comisiones
- Porcentaje por barbero, con excepción opcional por servicio. Se **calcula al cobrar y se guarda** (instantánea), no se recalcula después.
- Redondeo: `floor(precio * pct / 100)` al peso; el resto queda para la barbería. La propina es del barbero (configurable).
- Resumen por barbero y periodo (hoy, semana, quincena, mes) y acción **Liquidar** que registra el pago y marca esos cobros como liquidados.

**Aceptación**
- [ ] La suma de comisiones + parte de la barbería = lo cobrado por servicios, al peso, en cualquier combinación de pagos mixtos.
- [ ] Cambiar el porcentaje de un barbero no altera cobros ya hechos.
- [ ] Una liquidación no se puede aplicar dos veces al mismo cobro.

### F8. Gastos
- Registro rápido: monto → categoría (arriendo, insumos, servicios públicos, comisiones, otros) → guardar; foto opcional (privada).
- Se anulan con motivo.

### F9. Cierre del día
- Efectivo esperado (cobros en efectivo − gastos en efectivo) vs efectivo contado → diferencia; cerrar; **Enviar resumen por WhatsApp**.
- Anular el cierre reabre el día.
- Simplificación del MVP: el día es el **día calendario de Bogotá** (una barbería no trabaja de madrugada). Si aparece un cliente nocturno, se porta la "hora de corte" de comandacomi.

**Aceptación**
- [ ] Una vez cerrado, lo que se registre entra al día siguiente y las cifras del cierre no se mueven.

### F10. Clientes
- Se crean solos desde una reserva o una cita manual; se unen por celular dentro de la barbería.
- Ficha: nombre, celular, **nota del corte** ("degradé 2 a los lados"), visitas, última visita, no-shows.

### F11. Avisos
- Push al personal cuando entra una reserva nueva o se cancela una (filtrado por área, igual que comandacomi).
- Sin llaves VAPID la app funciona igual, con el aviso en pantalla.

### F12. Modo demo
- Barbería ficticia con datos relativos a hoy y reinicio desde la app (solo dueño, solo demo). **Datos siempre ficticios.**
- Hecho (Fase 4): la demo se carga en SQL (`fn_cargar_datos_demo`, migración 0027) sin azar (dos reinicios en el mismo instante dejan lo
  mismo y una semana después queda igual medida desde hoy); «Probar la demo» entra sin pedir datos (solo si el servidor tiene la cuenta de
  la demo); **Más → Reiniciar la demo** con PIN opcional; aviso «barbería de demostración»; recorrido guiado de 10 pasos (2 minutos).
- Textos legales (borradores): aviso de privacidad y política de datos enlazados desde la reserva y la cita, y cláusula de encargo en
  `docs/legal/`. Ver `PLAN.md` (Fase 4) para lo que falta.

---

## 4. Modelo de datos

Todas las tablas de negocio: `barberia_id NOT NULL`, RLS, `created_at`, `registrado_por`, llaves foráneas
**compuestas** `(barberia_id, id)`. Dinero `integer`. Fechas `timestamptz`.

Estado: lo de las Fases 0, 1, 2 y 3 **ya existe** (migraciones `0001` a `0026`): agenda, reserva pública, avisos push, cartel,
cobros, comisiones, liquidaciones, gastos con foto privada, cierre del día y las cifras de Inicio. Lo demás es diseño
(la demo y el piloto, Fase 4).

| Tabla | Campos clave |
|---|---|
| `barberias` | id, nombre, slug, whatsapp, direccion, es_demo, **paso_min, dias_adelante, anticipacion_min, colchon_min, reservas_en_linea, cancelar_hasta_horas** (hechos) |
| `perfiles` | user_id, barberia_id, nombre (un usuario = una barbería en el MVP) |
| `roles_equipo`, `perfil_roles`, `invitaciones` | permisos por área (patrón de comandacomi). Invitación: código de 8 caracteres (sin 0/O/1/I), vence a las 72 h, un solo uso; se canjea desde una sesión anónima en `/unirme` y puede dejar vinculado un barbero sin cuenta |
| `barberos` | id, **user_id** (opcional: la cuenta del barbero), nombre, acepta_reservas, activo, orden. La comisión NO está aquí: vive en `comisiones_barbero` (así un barbero no ve lo que gana otro) |
| `servicios` | id, nombre, precio, duracion_min (de 5 en 5), activo, orden |
| `barbero_servicios` | barbero_id, servicio_id, precio_propio?, duracion_propia? |
| `horarios_barbero` | barbero_id, dia_semana (0 = domingo … 6), **desde_min, hasta_min** (minutos desde medianoche, hora de Bogotá; sin traslapes por restricción de exclusión) |
| `bloqueos` | barbero_id, inicio, fin, motivo, activo (se quitan, no se borran) |
| `clientes` | id, nombre, telefono (E.164, único por barbería), nota, activo |
| `citas` | id, barbero_id, cliente_id, servicio_id, inicio, **duracion_min y precio copiados del catálogo al crearla**, **fin = inicio + duración (columna generada)**, estado, origen (`personal`/`cliente`), token, notas, recordatorio_enviado_at (la app no envía el mensaje: marca que se abrió WhatsApp), consentimiento_at (reserva en línea), cancelada_motivo/por/at |
| `cobros` | id, cita_id? (null = venta sin cita), barbero_id, cliente_id?, **clave** (idempotencia), subtotal, descuento + motivo, total, propina, **comision y propina_barbero guardadas al cobrar**, **fecha** (el día al que pertenece), anulación con motivo. Un solo cobro vigente por cita (índice único parcial). No se edita: solo se anula |
| `cobro_items` | cobro_id, tipo (`servicio`/`extra`), nombre y precio (y `precio_lista` si se cambió), **su parte del descuento**, **comision_pct y comision de la línea** (instantánea) |
| `cobro_pagos` | cobro_id, medio (`efectivo`/`transferencia`), monto aplicado, recibido y vuelto (efectivo), referencia |
| `comisiones_barbero`, `comisiones_servicio` | el % de cada barbero (sin fila: 50 %) y su excepción por servicio; solo las lee el área «comisiones». `barberias.propina_del_barbero` dice de quién es la propina |
| `liquidaciones`, `liquidacion_cobros` | pago a un barbero: **todo lo pendiente hasta un día**, medio, comisión + propina, `fecha` del pago. Cada cobro está en UNA liquidación vigente (índice único parcial); se anula con motivo |
| `gastos` | monto, categoría (`arriendo`/`insumos`/`servicios_publicos`/`comisiones`/`otros`), medio, nota, **foto_ruta** (bucket privado `gastos-fotos`), clave, `fecha`, anulación con motivo |
| `cierres` | día cerrado, **las cifras al cerrar**, efectivo contado, esperado y diferencia; un solo cierre vigente por día; se anula con motivo (solo el más reciente) |

**Dinero y días** (Fase 3): el cobro, las comisiones y el cierre se calculan en `src/lib/dinero.ts` y en SQL, y la prueba
`consistencia-dinero.test.ts` los compara con datos variados. «Hoy» para registrar es `fn_jornada`: el día de Bogotá, o el
siguiente si ese ya se cerró (lo que se registre después de cerrar entra al día siguiente y nada del día cerrado se anula).

**Regla central anti-doble-reserva** (verificada con PGlite en el spike 0.4 y puesta en la migración `0008`):

```sql
exclude using gist (barbero_id extensions.gist_uuid_ops with =, tstzrange(inicio, fin, '[)') with &&)
  where (estado in ('confirmada', 'en_atencion', 'atendida'))
```

Ocupan la hora las citas **confirmadas, en atención y atendidas**; las canceladas y las "no asistió" la liberan.
(El borrador solo incluía confirmada y en_atencion: se agregó `atendida` para que una cita ya atendida tampoco pueda
duplicarse por error.) Requiere `btree_gist`, que se instala en el esquema `extensions` como en Supabase.

**Disponibilidad** (`fn_huecos` y `fn_huecos_cualquiera`, migración `0009`): UNA función SQL, sin copia en
TypeScript. Las horas arrancan en el inicio de cada franja y avanzan de `paso_min` en `paso_min`; las franjas pegadas
se unen; el servicio debe entrar completo; se descartan las que se cruzan con citas vigentes o bloqueos; entre dos
citas queda el `colchon_min` (no se pide contra un bloqueo ni contra el cierre de la franja). La tabla de casos de borde
vive en `src/test/disponibilidad.test.ts`.

---

## 5. Comandos

Mismos nombres que comandacomi, para no reaprender:

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor en `http://localhost:3000` |
| `npm run build` | Compilación de producción |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (incluye SQL real con PGlite) |
| `npm run verificar` | lint + typecheck + test (obligatorio antes de dar algo por terminado) |
| `npm run esquema` | Regenera `supabase/esquema-completo.sql` uniendo las migraciones |
| `npm run e2e:reservas` | Chrome real con celulares simulados: cliente reserva → personal lo ve |
| `npm run iconos` | Genera los íconos de la PWA |

Modo local sin cuenta de Supabase: `.env.local` con `DEMO_BD=local` (base PGlite en `.local/`, solo fuera de producción).

---

## 6. Estructura del proyecto

```
Barberias/
├─ SPEC.md · PLAN.md · CLAUDE.md · AGENTS.md · README.md
├─ supabase/
│  ├─ migrations/        # 0001_tablas … una por tema; termina con fn_aplicar_permisos()
│  ├─ esquema-completo.sql  # generado, no se edita a mano
│  └─ seed.sql
├─ scripts/              # unir-migraciones.mjs, e2e-*.mjs, generar-iconos.mjs
├─ src/
│  ├─ app/
│  │  ├─ (app)/          # personal con barra: inicio, agenda, caja, clientes, mas
│  │  ├─ (tarea)/        # una sola tarea: cobrar, nueva cita, gasto, cierre
│  │  ├─ (publico)/      # sin sesión: reservar/[slug], cita/[token]
│  │  ├─ api/            # foto, pulso, cron
│  │  ├─ entrar/ · unirme/
│  ├─ components/        # ui, agenda, caja, reserva, equipo, layout
│  ├─ lib/
│  │  ├─ dinero.ts · fechas.ts · comisiones.ts · areas.ts · permisos.ts
│  │  ├─ esquemas/       # Zod (solo servidor)
│  │  ├─ datos/ · publico/ · supabase/ · push/
│  └─ test/              # base-datos.ts (PGlite) + pruebas de SQL, RLS y permisos
```

Antes de escribir cualquier código de Next: leer la guía en `node_modules/next/dist/docs/` (la versión
instalada tiene cambios de API respecto a lo que se conoce; ver el `AGENTS.md` de los proyectos de referencia).

---

## 7. Estilo de código

- **Todo en español**: interfaz, comentarios, commits, README, nombres de tablas y funciones SQL.
- **Dinero**: pesos enteros; cálculos solo en `src/lib/dinero.ts` (y su espejo en SQL, comparados por prueba).
- **Anular con motivo**, nunca borrar. `created_at` y `registrado_por` en todo.
- **Escrituras solo por funciones RPC** `security definer`; el cliente nunca escribe tablas.
  Visitantes anónimos: solo funciones `publico_*`, llamadas desde el servidor.
- **Una pantalla nueva del personal** empieza con `revisarPermiso("<pantalla>")` y se agrega a `PANTALLAS`.
- **Los componentes `"use client"` no importan Zod ni `server-only`**; las constantes del cliente viven fuera de `lib/esquemas/`.
- **Migraciones**: una por tema, toda tabla nueva con `barberia_id` + RLS, toda migración con funciones termina en
  `select public.fn_aplicar_permisos();` y se corre `npm run esquema`. Al redefinir una función, copiar la **última** versión.
- **Diseño**: objetivos táctiles ≥ 48 px, texto ≥ 16 px, acciones principales abajo, sin `hover`, sin scroll horizontal;
  lo apagado se ve con borde punteado y fondo gris, nunca con `opacity`. Verificar a 360×640 y 390×844.
- **Fechas**: instantes en `timestamptz`; "hoy" en Bogotá; las pruebas usan instantes fijos, nunca el reloj.

---

## 8. Estrategia de pruebas

| Capa | Qué se prueba | Cómo |
|---|---|---|
| SQL / RLS | Aislamiento entre barberías, `anon` solo ejecuta `publico_*`, permisos por área, cada función de escritura | Vitest + **PGlite** (Postgres real en memoria, sin Docker) |
| Concurrencia | Dos reservas simultáneas a la misma hora: una gana, la otra recibe `hora_ocupada` | Dos transacciones sobre PGlite |
| Disponibilidad | Franjas, bloqueos, colchón, paso, anticipación, "primero disponible", citas que cruzan el límite del horario | Instantes fijos; casos de borde (última hora del día, cita de 45 min en paso de 30) |
| Dinero | Totales, vuelto, pagos mixtos, comisiones (suma exacta), liquidación idempotente | Unitarias + comparación TS vs SQL |
| Cliente | Que `"use client"` no arrastre Zod ni `server-only` | Prueba de peso como en comandacomi |
| E2E | Cliente reserva en un celular simulado → el personal lo ve y lo cobra | `playwright-core` + Chrome real (`npm run e2e:reservas`) |
| Manual | 360×640 y 390×844, luz de sol (contraste), una mano | Lista de verificación por pantalla |

Regla: **no se da por terminada una migración sin su prueba**, y `npm run verificar` pasa antes de cada commit.

---

## 9. Límites

### Siempre
- Pesos enteros, anular con motivo, `barberia_id` + RLS en toda tabla nueva, prueba por cada migración.
- Que la base decida (precios, disponibilidad, permisos); la pantalla solo explica.
- Correr `npm run verificar` antes de decir "listo".
- Datos de demo ficticios.
- Leer la guía de Next en `node_modules/next/dist/docs/` antes de escribir código de Next.

### Preguntar antes
- Cualquier **push, despliegue** o cambio en Supabase, Vercel, GitHub o DNS; comprar dominio.
- Agregar una **dependencia** nueva o un servicio externo (WhatsApp API, pasarela de pagos, correo).
- Cambiar el esquema de una base que ya tenga datos reales.
- Mover algo de "Después del MVP" al MVP.
- Cambiar una regla de comisiones o de cancelación (afectan dinero y reputación del cliente).

### Nunca
- Usar `service_role` en la app, ni escribir tablas desde el navegador.
- Mostrar en una página pública nombres, celulares o notas de otros clientes.
- Commitear `.env*`, claves ni contraseñas; pegar claves en el chat.
- Copiar módulos completos de los proyectos de referencia (se portan **patrones**) ni su auto-deploy.
- Borrar datos de negocio o reiniciar una barbería real (el reinicio es solo de la demo).
- Agregar lo "fuera de alcance" por iniciativa propia.

---

## 10. Riesgos principales

| Riesgo | Mitigación |
|---|---|
| Dobles reservas bajo concurrencia | Restricción de exclusión en la base + prueba concurrente desde la Fase 0 |
| `btree_gist` no disponible en PGlite | Spike el primer día; plan B con `pg_advisory_xact_lock` |
| Spam o reservas falsas por el enlace público | Límites por celular y por minuto, campo trampa, tope de citas futuras |
| Clientes que no llegan | Recordatorio por WhatsApp, contador de no-shows, cancelación fácil con enlace |
| Permisos retro-ajustados (en comandacomi costaron una migración grande) | Áreas y roles desde la Fase 0, no al final |
| Datos personales de clientes (Ley 1581) | Consentimiento en la reserva, política enlazada, el negocio es responsable y tú el encargado |
| Costo fijo con pocos clientes | Un solo despliegue para todas las barberías (multi-inquilino desde el día uno) |

---

## 11. Preguntas abiertas (necesitan tu decisión)

1. ~~**Comisión vs. renta de silla**~~ **Resuelta:** en el MVP solo comisión (porcentaje por barbero, con excepción por
   servicio). La renta de silla queda para después del piloto.
2. **Aprobación de reservas:** el supuesto es que se confirman solas. ¿Algún dueño querrá aprobarlas antes?
3. **Fiado:** ¿se usa en las barberías que conoces? (Hoy está en "Después").
4. **Sin conexión:** ¿la señal en las barberías piloto es estable? Si no, el trabajo sin conexión sube de prioridad.
5. **Piloto:** ¿tienes ya una barbería donde probarlo? Define qué tan rápido se valida la Fase 2.
6. **Marca y dominio:** nombre definitivo y si cada barbería tendrá subdominio propio (ver `docs/PLATAFORMA.md` de comandacomi).
7. **No-shows:** ¿bloquear automáticamente a quien falle varias veces, o solo mostrar la advertencia?
