# Barberías

PWA **mobile-first** para barberías pequeñas de Colombia (1 a 8 barberos): **agenda** del personal, **reserva de citas
desde casa** (el cliente aparta con un enlace o un QR, sin cuenta ni app) y las **cuentas** del negocio: cobro en
efectivo y Nequi, comisión de cada barbero, gastos con foto del recibo y cierre del día con resumen por WhatsApp.

Se diseñó primero para **360×640 y 390×844** (celular Android de gama media, una mano): objetivos táctiles de 48 px,
texto de 16 px, acciones abajo, sin `hover` y sin scroll horizontal. En pantallas grandes solo se centra una columna.

La especificación está en [`SPEC.md`](SPEC.md), las fases en [`PLAN.md`](PLAN.md) y las reglas del código en
[`CLAUDE.md`](CLAUDE.md). Los textos legales (borradores) están en [`docs/legal/`](docs/legal/LEEME.md).

---

## 1. Probarla en tu computador (sin cuenta de Supabase)

Requisitos: **Node 22** (sirve 20.9 o más) y npm.

```bash
npm install
```

Crea el archivo `.env.local` (no se sube al repositorio) con una sola línea:

```
DEMO_BD=local
```

```bash
npm run dev      # http://localhost:3000
```

El **modo local** corre las mismas migraciones y funciones de `supabase/` en una base embebida (PGlite) guardada en
`.local/`. Solo funciona fuera de producción. Trae dos barberías de prueba:

| Qué | Cómo entrar |
|---|---|
| Una barbería **vacía** (la de «Barbería de Prueba») | `/entrar` con `dueno@local.test` y **cualquier contraseña** |
| La **demo**, con 14 días de citas, cobros, gastos y cierres inventados | botón **Probar la demo** en `/entrar` |

Para empezar de cero, borra la carpeta `.local/` (también se recrea sola cuando cambian las migraciones).

---

## 2. Ponerla en internet: Supabase + Vercel (lo haces tú, a mano)

> Nada de esto lo hace el código por ti. **No pegues claves en el chat ni las subas al repositorio.** La llave
> `service_role` de Supabase **no se usa en ninguna parte**: solo hacen falta la URL del proyecto y la llave `anon`
> (pública por diseño: la seguridad la da RLS en la base).
>
> Los nombres de los menús de Supabase y Vercel cambian de vez en cuando; si uno no está igual, busca el equivalente.
> Tiempo: unos 30 minutos la primera vez.

Necesitas: una cuenta de [Supabase](https://supabase.com), una de [Vercel](https://vercel.com) y el código en un
repositorio de GitHub (Vercel lo lee de ahí).

### A. Supabase

1. **New project.** Elige la región más cercana a tus clientes (por ejemplo, *South America (São Paulo)*) y guarda la
   contraseña de la base en tu gestor de contraseñas.
2. **SQL Editor → New query:** pega **todo** el contenido de [`supabase/esquema-completo.sql`](supabase/esquema-completo.sql)
   y pulsa **Run**. Debe terminar sin errores (verás *Success*). (Es la unión de las migraciones; se regenera con
   `npm run esquema`. Se puede volver a pegar sin riesgo: no borra datos.)
3. **Comprueba:** en *Table Editor* aparecen tablas como `barberias`, `citas`, `cobros` y `cierres`, y en *Storage* hay un
   bucket **privado** llamado `gastos-fotos` (para los recibos).
4. **Authentication → Sign In / Providers:**
   - Enciende **Allow anonymous sign-ins**. Así entra el equipo con su código de invitación (`/unirme`): cada celular
     recibe una sesión sin correo ni contraseña, y sin un código válido no ve nada de ninguna barbería. Sin esto,
     «Tengo un código de invitación» responde que las invitaciones todavía no están encendidas.
   - Deja activo el proveedor **Email** (el dueño entra con correo y contraseña) y desactiva **Allow new users to sign
     up** para que nadie se registre solo: las cuentas las creas tú. Si al apagarlo `/unirme` deja de funcionar,
     vuélvelo a encender: una cuenta sin barbería no puede hacer nada en la base.
5. **Project Settings → API** (en algunas versiones del panel, **API Keys**): copia la **Project URL** y la llave
   **anon public**. (No copies la `service_role`.)

### B. Avisos al celular (opcional)

Con la app cerrada, el equipo recibe un aviso cuando un cliente reserva o cancela. Se generan **una sola vez**:

```bash
npm run vapid
```

Imprime una llave pública y una privada. Guárdalas: van a Vercel como `NEXT_PUBLIC_VAPID_PUBLIC_KEY` y
`VAPID_PRIVATE_KEY` (la privada **nunca** con `NEXT_PUBLIC_`), junto con `VAPID_SUBJECT` (un `mailto:` tuyo).
Sin las tres, la app funciona igual y los avisos no se mandan. En iPhone solo llegan si la app se agregó a la pantalla de
inicio. En *Más → Avisos de reservas* cada persona los enciende en su celular.

### C. Vercel

1. **Add New → Project** e importa el repositorio. Framework: **Next.js** (lo detecta solo; el comando de compilación es
   `npm run build`). Usa Node 20.9 o más (*Settings → General → Node.js Version*: 22.x).
2. Antes de desplegar, en **Environment Variables** agrega:

   | Variable | Valor | ¿Obligatoria? |
   |---|---|---|
   | `SUPABASE_URL` | la Project URL del paso A.5 (**solo servidor**) | Sí |
   | `SUPABASE_ANON_KEY` | la llave anon public del paso A.5 (**solo servidor**) | Sí |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | la llave pública del paso B | Solo con avisos |
   | `VAPID_PRIVATE_KEY` | la llave privada del paso B (**solo servidor**) | Solo con avisos |
   | `VAPID_SUBJECT` | `mailto:tu-correo@ejemplo.com` | Solo con avisos |
   | `DEMO_EMAIL` y `DEMO_PASSWORD` | el usuario de la demo (**solo servidor**, ver E) | Solo si quieres la demo |

   **No** definas `DEMO_BD` en Vercel (el modo local está bloqueado en producción de todos modos).
3. **Deploy.** Abre la dirección que te da Vercel (algo como `barberias-xxxx.vercel.app`). Debe mostrar la pantalla
   «Entrar a mi barbería».
4. (Opcional) **Settings → Domains** para ponerle tu dominio.
5. En el celular: Chrome → menú → **Instalar aplicación** (en iPhone: Safari → Compartir → *Agregar a inicio*).

> Cada vez que cambies una variable en Vercel hay que **volver a desplegar** para que la tome.

### D. Dar de alta una barbería de verdad

No hay registro abierto: tú creas la cuenta del dueño y le das de alta la barbería.

1. **Authentication → Users → Add user → Create new user:** el correo del dueño y una contraseña temporal, con
   **Auto Confirm User** marcado.
2. **SQL Editor:**

   ```sql
   select public.fn_crear_barberia('correo@del-dueno.com', 'Nombre de la barbería', 'Nombre del dueño');
   ```

   Crea la barbería **vacía** (sin servicios ni barberos: los arma el dueño), con los roles *Barbero* y *Recepción* y su
   enlace público. Devuelve algo como `{"slug": "la-fina", "enlace_reservas": "/reservar/la-fina"}`: **anota el `slug`**.
3. **Su WhatsApp y su dirección** (los ve el cliente en la reserva, en su cita y en los textos legales). **No hace falta
   cargarlos tú:** el dueño los pone y los cambia cuando quiera en *Más → WhatsApp y dirección* (el WhatsApp se escribe
   como siempre, «300 123 4567»). Si prefieres dejarlos listos al dar de alta, es esta alternativa; el WhatsApp va con
   `+57` y sin espacios:

   ```sql
   update public.barberias
      set whatsapp = '+573001234567', direccion = 'Carrera 9 #12-34, Centro'
    where slug = 'la-fina';
   ```
4. Entrégale al dueño su correo y la contraseña temporal. No hay recuperación automática de contraseña: si la olvida, la
   cambias tú desde *Authentication → Users* (menú del usuario: restablecer o cambiar su contraseña; el nombre exacto de
   la opción depende de la versión del panel) y se la das.
5. El dueño entra en `/entrar` y arma su barbería, en este orden:
   **Más → Servicios y precios** · **Barberos y horarios** (qué hace cada uno y cuándo trabaja) ·
   **Porcentajes de comisión** · **WhatsApp y dirección** · **Ajustes de la agenda** · **Equipo** (invita a su gente con un
   código) · **Cartel y enlace de reservas** (el QR para el mostrador).

### E. La demo (opcional, para enseñar la app)

La demo es una barbería de **mentira** con datos relativos a hoy (siempre igual, nunca fechas fijas), con un recorrido
guiado de 2 minutos y un botón para reiniciarla. Cualquiera que la abra es su dueño, así que **no la mezcles con una
barbería de verdad**: usa un usuario propio.

1. **Authentication → Users → Add user:** un correo y una contraseña para la demo, con **Auto Confirm User**.
2. **SQL Editor:**

   ```sql
   select public.fn_provisionar_demo('demo@tu-dominio.com');
   ```

   Crea la barbería «Barbería Demo» y carga los datos de ejemplo. Se puede volver a correr: solo recarga los datos.
3. En Vercel define `DEMO_EMAIL` y `DEMO_PASSWORD` con ese usuario y **vuelve a desplegar**. Aparece el botón
   **Probar la demo** en `/entrar`; al tocarlo entra solo y arranca el recorrido.
4. **PIN de reinicio (recomendado si le dejas el celular a alguien):** como todos entran con el mismo usuario, cualquiera
   podría reiniciar la demo en plena visita. Ponle un PIN **desde el SQL Editor** (nunca desde la app):

   ```sql
   select public.fn_definir_pin_reinicio('4821');   -- ponerlo o cambiarlo (4 a 8 dígitos; usa el tuyo)
   select public.fn_definir_pin_reinicio(null);     -- quitarlo
   ```

   Con PIN, *Más → Reiniciar la demo* lo pide; se guarda cifrado en una tabla que nadie lee, y cinco intentos
   fallidos bloquean el reinicio 5 minutos. Reiniciar no quita el PIN.

Antes de enseñarla: abre la URL en tu celular, toca **Probar la demo** (debe llegar a Inicio con números y arrancar el
recorrido), instálala como app y, al terminar, **Más → Reiniciar la demo** para dejarla limpia.

### F. Comprobar que quedó bien (10 minutos)

Con una barbería de prueba creada en D (puedes llamarla «Prueba» y no entregarla):

- [ ] `/entrar` con el correo del dueño entra a **Inicio**.
- [ ] **Más → Servicios y precios:** crea «Corte» ($ 20.000, 30 min). **Barberos y horarios:** crea un barbero, asígnale el
      servicio y un horario de hoy.
- [ ] **Más → WhatsApp y dirección:** escribe el de la barbería (prueba el botón *Probar en WhatsApp*) y guarda. Un número
      malo («123») se rechaza con un mensaje.
- [ ] Abre `/reservar/<slug>` **en otro celular** (o una ventana privada): se ven la dirección y *Escribir por WhatsApp*;
      reserva la primera hora libre.
- [ ] En el celular del dueño, la cita aparece en **Agenda** (y suena el aviso si activaste los push).
- [ ] **Caja → cobrar** esa cita en efectivo: queda cobrada y el vuelto se ve bien.
- [ ] **Más → Gastos:** anota uno **con foto** (comprueba que la foto se ve al abrirlo: es el bucket privado).
- [ ] **Más → Cierre del día:** cuenta el efectivo y cierra; **Enviar resumen por WhatsApp** abre WhatsApp con el mensaje.
- [ ] En el celular del cliente, abre el enlace de su cita (`/cita/…`) y **cancélala**: en la agenda aparece cancelada.
- [ ] Un código de invitación (**Más → Equipo**) abierto en otro celular entra como ese rol y solo ve lo suyo.

Si algo falla, mira **Problemas frecuentes** al final.

---

## 3. Actualizar una instalación que ya existe

Cuando el código trae migraciones nuevas (archivos en `supabase/migrations/` con número mayor):

1. **Antes de desplegar** el código nuevo, en el **SQL Editor** de Supabase pega y ejecuta `supabase/esquema-completo.sql`
   completo (es seguro repetirlo: crea lo que falta y redefine las funciones, sin tocar tus datos), o solo los archivos
   nuevos, **en orden**.
2. Después, **despliega** en Vercel.
3. Si agregó variables de entorno, defínelas antes de desplegar (mira `.env.example`).

Las funciones nuevas deben terminar con `select public.fn_aplicar_permisos();` (una prueba lo exige): es lo que cierra
quién las puede ejecutar.

---

## Variables de entorno

Todas están en [`.env.example`](.env.example). Cópialo a `.env.local` para trabajar en tu computador; en Vercel se
definen en *Settings → Environment Variables*.

| Variable | Para qué | Quién la ve |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Conectar con Supabase | Solo el servidor (la app nunca habla con Supabase desde el navegador) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Avisos al celular del equipo | La privada, solo el servidor |
| `DEMO_EMAIL`, `DEMO_PASSWORD` | «Probar la demo» | Solo el servidor |
| `DEMO_BD=local` | Modo local con PGlite (solo en tu computador) | - |
| `DEMO_BD_DIR` | Carpeta de la base local (por defecto `.local`); la usa la prueba e2e | - |

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (http://localhost:3000) |
| `npm run build` / `npm start` | Compilar y servir en producción |
| `npm run verificar` | Lint + tipos + pruebas (lo que debe estar en verde antes de dar algo por terminado) |
| `npm run lint` · `npm run typecheck` · `npm test` | Cada parte por separado |
| `npm run esquema` | Regenera `supabase/esquema-completo.sql` desde las migraciones (una prueba falla si no está al día) |
| `npm run vapid` | Genera las llaves de los avisos push (una sola vez) |
| `npm run iconos` | Regenera los íconos de la PWA (`public/icons`) |
| `npm run e2e:reservas` | Prueba de punta a punta de la reserva con dos celulares en Chrome real (cierra cualquier `npm run dev` antes) |

## Estructura

```
src/app/(app)/        Pantallas con barra de navegación: Inicio, Agenda, Caja, Clientes, Más y lo de cuentas y ajustes
src/app/(tarea)/      Pantallas de una sola tarea, sin barra: nueva cita, cobrar, nuevo gasto, ficha de cliente, cartel
src/app/reservar/     La reserva pública (/reservar/<slug>) y /cita/<token>: lo que ve el CLIENTE sin cuenta
src/app/privacidad/   Política de datos y aviso de privacidad (borradores, ver docs/legal)
src/app/acciones/     Acciones del servidor: validan con Zod y llaman funciones SQL
src/components/       ui (botón, hoja, teclado numérico…), layout, agenda, caja, demo y guía
src/lib/              dinero.ts (TODOS los cálculos), areas (qué ve cada rol), fechas, whatsapp, guia, legal, datos/ (lecturas)
src/lib/local/        Modo local de desarrollo (PGlite)
supabase/migrations/  Tablas, RLS, funciones, demo, permisos y almacenamiento
docs/legal/           Aviso, política y cláusula de encargo de datos (borradores para el abogado)
public/               sw.js (service worker) e íconos
```

## Reglas del proyecto (resumen)

- **UI toda en español.** Datos de demo **siempre** ficticios.
- **Dinero en pesos enteros.** Los cálculos viven en `src/lib/dinero.ts` y una prueba verifica que den **lo mismo que la
  base de datos**.
- **Anular en vez de borrar:** cobros, gastos, liquidaciones y cierres se anulan con motivo (queda quién y cuándo). El
  borrado está bloqueado por trigger incluso para el dueño de la base (la única excepción es reiniciar la demo).
- **Multi-barbería desde la primera tabla:** toda tabla lleva `barberia_id` y RLS; las llaves foráneas son compuestas.
- **El cliente de la app no escribe tablas:** toda escritura pasa por funciones SQL `security definer` que validan
  barbería y **área** (agenda, caja, gastos, cierre, comisiones, servicios, equipo). Quien no tiene cuenta solo ejecuta las
  funciones `publico_*` (una prueba fija la lista).
- **Next.js 16 con cambios de API:** antes de escribir código de Next, lee la guía en `node_modules/next/dist/docs/`.

## Seguridad

- Sin secretos en el repositorio: `.env.example` solo trae nombres. `.env.local` está en `.gitignore`.
- HTTPS lo da Vercel. Cabeceras: CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy` y `Permissions-Policy`.
- **Aislamiento entre barberías demostrado con pruebas** (Postgres real, `src/test/aislamiento.test.ts`): un usuario de la
  barbería A no lee ni escribe nada de la B, por ninguna tabla ni función; sin sesión no se ejecuta ninguna función de la
  API ni se lee ninguna tabla.
- **Lo que puede hacer alguien SIN cuenta** se limita a las funciones `publico_*`. La cita se consulta por un enlace
  secreto (uuid) imposible de adivinar, que devuelve **solo esa cita**: nada de otros clientes.
- **Fotos de recibos privadas:** se sirven solo con sesión y solo de la propia barbería.
- **La app nunca envía mensajes de WhatsApp:** arma el enlace `wa.me` y la persona lo manda desde su celular.

## Qué NO hace (aplazado a propósito)

Facturación electrónica, pagos en línea o anticipos, WhatsApp automático u oficial, multi-sede, app en tiendas y la renta
de silla (solo hay comisión por porcentaje). Tampoco recuperación automática de contraseña.

## Problemas frecuentes

- **«La app todavía no está configurada»** en `/entrar`: faltan las variables `SUPABASE_URL` y
  `SUPABASE_ANON_KEY` en Vercel (¿quedaron con el nombre viejo `NEXT_PUBLIC_…`? Ya no se leen) (o están mal copiadas), o no se volvió a desplegar después de definirlas.
- **El dueño entra pero ve «Falta tu barbería»:** su usuario existe en Authentication pero no corriste
  `fn_crear_barberia` con **ese mismo correo** (paso D.2).
- **«Tengo un código de invitación» dice que las invitaciones no están encendidas:** falta **Allow anonymous sign-ins**
  (paso A.4).
- **No aparece «Probar la demo»:** faltan `DEMO_EMAIL` o `DEMO_PASSWORD` en Vercel (o no se volvió a desplegar). Si
  aparece pero dice «no está disponible», el usuario de la demo no existe o la contraseña no coincide.
- **`fn_provisionar_demo` dice «No existe el usuario»:** creaste el usuario con otro correo, o sin *Auto Confirm User*;
  míralo en *Authentication → Users*.
- **El cliente no ve horas libres:** el barbero no tiene horario ni servicios asignados, o la barbería tiene apagadas las
  reservas en línea (*Más → Ajustes de la agenda*).
- **Los avisos no llegan:** faltan las tres variables VAPID, el celular no los activó en *Más → Avisos de reservas*, o es
  un iPhone con la app sin agregar a la pantalla de inicio. Cada persona puede tener avisos en 5 celulares como máximo (apaga uno
  para activar otro), y solo funcionan los navegadores con servicio push propio (Chrome, Edge, Firefox, Safari).
- **La foto del gasto no se ve:** corre de nuevo `supabase/esquema-completo.sql` (crea el bucket y sus políticas) y
  comprueba en *Storage* que `gastos-fotos` existe y es privado.
- **Cambié una migración:** corre `npm run esquema` (una prueba falla si el archivo unido no está al día) y vuelve a
  pegarlo en el SQL Editor.
