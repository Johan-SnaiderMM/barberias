# Barberías · Paquete para revisión legal

> **Para:** abogado/a que revisará los textos de tratamiento de datos personales de «Barberías».
> **Preparado el:** 18 de octubre de 2026, sobre la **versión 1 · 17 de octubre de 2026** de los tres textos de datos (el contrato de la sección 7 es un borrador sin versión, redactado el 21 de octubre de 2026).
> **Estado:** borradores de partida, escritos sin asesoría jurídica. **Nada se ha usado todavía con datos reales de clientes**:
> la aplicación solo se ha probado con datos inventados. Este paquete reúne todo lo necesario para revisarlos en un solo lugar.

## Contenido

1. Qué se pide y cómo leer este documento
2. El producto y el flujo de los datos (los hechos)
3. Preguntas para el abogado
4. **Texto 1 · Aviso de privacidad** (lo que lee el cliente antes de reservar)
5. **Texto 2 · Política de tratamiento de datos personales** (el texto completo)
6. **Texto 3 · Cláusula de encargo del tratamiento** (para el contrato con cada barbería)
7. **Texto 4 · Contrato de servicio y condiciones de uso** (con cada barbería y para su equipo)
8. Anexo A · Cómo se le muestran los textos al cliente (casilla y enlaces)
9. Anexo B · Inventario de datos personales
10. Anexo C · Lo que no cubren estos borradores

---

# 1. Qué se pide y cómo leer este documento

**Lo que se pide:**

1. Revisar y corregir los **cuatro textos** (secciones 4, 5, 6 y 7) para que cumplan la Ley 1581 de 2012, el Decreto 1377 de 2013
   (compilado en el Decreto 1074 de 2015) y las normas aplicables, y para que sean ejecutables en el modelo descrito abajo.
2. Responder las **preguntas de la sección 3** (cada una dice qué hace hoy la aplicación, para que la respuesta se pueda
   convertir en un cambio concreto).
3. Decir qué **falta**: trámites, documentos o textos que un negocio como este debería tener antes de empezar con clientes
   reales (la sección 10 enumera lo que sabemos que no está).

**Cómo leerlo:** la sección 2 explica los hechos; la 3 trae las dudas; las 4, 5 y 6 son los textos **tal como están hoy**
(en las páginas de la aplicación, el nombre, la dirección y el WhatsApp de la barbería se completan solos con los datos de
cada una; aquí aparecen entre corchetes). Lo que va entre **[corchetes]** en la cláusula son plazos y datos que se deben acordar.

---

# 2. El producto y el flujo de los datos (los hechos)

### 2.1 Qué es y quién es quién

- **Barberías** es una aplicación web instalable en el celular (PWA) para **barberías pequeñas de Colombia** (1 a 8 barberos):
  agenda del personal, **reserva de citas por el cliente desde su casa** (sin cuenta ni app) y las cuentas del negocio (cobros,
  comisiones de los barberos, gastos y cierre del día).
- **Modelo:** un **solo despliegue** sirve a todas las barberías. Los datos de cada una están separados por reglas en la base
  de datos (seguridad por filas): una barbería no puede leer ni escribir datos de otra.
- **Roles que proponemos:** la **barbería** (cliente del servicio) es la **responsable** del tratamiento de los datos de sus
  clientes; quien administra la plataforma (el **proveedor**, hoy una persona natural: la que desarrolla y opera la aplicación)
  es el **encargado**. El proveedor ofrece la aplicación por una mensualidad.
- **Infraestructura de terceros:** Supabase (base de datos, autenticación y almacenamiento; la región sugerida en las
  instrucciones de instalación es São Paulo, Brasil) y Vercel (alojamiento de la aplicación). Los avisos al equipo usan los
  servicios de notificaciones push propios de cada navegador (por ejemplo, Google, Apple o Mozilla). **No hay analítica, publicidad ni
  cookies de seguimiento**; solo la sesión de quien inicia sesión en el personal.

### 2.2 Los titulares y cómo entran sus datos

| Quién | Cómo llega el dato | Qué datos |
|---|---|---|
| **Cliente que reserva en línea** | Abre el enlace o el QR de la barbería, elige servicio, barbero, día y hora, y escribe **nombre y celular**. Para confirmar **debe marcar una casilla** (texto literal en el Anexo A); la aplicación guarda la **fecha y la hora** en que la marcó. | Nombre, celular, datos de la cita. |
| **Cliente que se agenda en el local** | El equipo de la barbería lo anota (nombre y, normalmente, celular). **No hay casilla ni constancia de autorización.** | Igual. |
| **Barberos y demás personal** | Entran con un código de invitación (sin correo) o, el dueño, con correo y contraseña. | Nombre dentro de la aplicación, rol; correo del dueño; suscripción push del celular. |

Con el enlace secreto que recibe al reservar, el cliente puede **ver, mover o cancelar** su cita; no necesita cuenta. Otras
personas que reservan **nunca ven** datos de otros clientes: solo ven que una hora está ocupada.

### 2.3 Qué hace y qué no hace la aplicación

- **No envía mensajes.** Para recordar una cita, la aplicación arma un enlace de WhatsApp (`wa.me`) con el mensaje escrito y
  **la persona del equipo lo envía desde su propio celular**. La aplicación solo marca que se abrió el enlace.
- **No recibe pagos en línea.** Los cobros se registran en el mostrador (efectivo o Nequi) y quedan asociados a la cita o al
  cliente; el cobro admite una referencia de la transferencia escrita por el equipo.
- **No pide** documento de identidad, correo, dirección, fotos ni datos sensibles al cliente. (Ver pregunta 10: el equipo
  puede escribir **notas libres** sobre un cliente o una cita.)
- **Nada se borra:** lo registrado se **anula** con motivo; los clientes se **archivan**. **No existe hoy una función para
  suprimir o anonimizar a un cliente** (ver pregunta 2).
- **No hay un plazo de conservación automático:** los datos permanecen mientras la barbería use la aplicación.
- La aplicación **todavía no tiene un registro de consultas y reclamos** de titulares (ver pregunta 12).

### 2.4 Medidas de seguridad existentes

Conexiones cifradas (HTTPS) y cabeceras de seguridad; cuentas individuales para el personal con **permisos por rol** (el barbero
solo ve sus citas; recepción no ve comisiones ni cierre); datos de cada barbería aislados en la base (probado con pruebas
automáticas); las funciones públicas (sin cuenta) están limitadas a un conjunto cerrado; el enlace de cada cita es un código
aleatorio no adivinable; las fotos de recibos de gastos (no son datos de clientes) están en almacenamiento privado; sin llaves
de administración en la aplicación. **No se ha hecho** auditoría de seguridad externa ni prueba de intrusión.

---

# 3. Preguntas para el abogado

Cada pregunta dice **qué hace hoy** la aplicación o qué dicen los textos, y qué se necesita saber. Las marcadas con ★ son las que
conviene resolver **antes** de empezar con clientes reales.

### A. Autorización y titulares

1. ★ **Menores de edad.** Una barbería atiende niños (por ejemplo, un servicio «Corte niño»). Los textos dicen que quien reserva escribe
   **sus propios datos** (los de su representante) y que **no se recogen datos del menor**; pero en el local el equipo puede
   anotar al niño por su nombre. ¿Es suficiente esa redacción, o hace falta una autorización específica del representante
   y/o un tratamiento distinto de los datos de menores?
2. ★ **Autorización en el local.** Cuando el equipo agenda a un cliente que no pasó por la reserva en línea, **no hay casilla**.
   ¿Basta con avisarle de palabra y tener el aviso a la vista (por ejemplo, en el cartel del mostrador), o debe quedar
   constancia (firmada, registrada, grabada)? Hoy la aplicación no guarda nada en ese caso.
3. ★ **Prueba de la autorización.** En la reserva en línea se guarda **solo la fecha y la hora** en que se marcó la casilla. No se
   guarda qué versión del aviso o de la política estaba vigente ni el texto exacto de la casilla. ¿Es suficiente como prueba
   (art. 8 de la Ley 1581, solicitar prueba de la autorización) o conviene guardar también la versión del texto?
4. **Reserva para un tercero.** Una persona puede reservar con su nombre y celular para otra (un familiar, un amigo). Además, el celular
   identifica la ficha del cliente: quien reserva con un celular ajeno queda ligado a la ficha de su dueño; la cita guarda también el nombre
   que escribió y la agenda lo muestra como «Reservó como …» cuando es distinto (la aplicación no devuelve el nombre de la ficha a quien reserva). ¿Hay algo
   que deba decir el aviso al respecto?
5. **El texto de la casilla.** Hoy dice: «Autorizo a [barbería] a tratar mi nombre y mi celular para gestionar mi cita, según el
   aviso de privacidad y la política de datos.» ¿Cumple con el carácter **previo, expreso e informado** de la autorización?
   ¿Debe indicar las finalidades dentro de la casilla misma (recordatorio por WhatsApp, historial de visitas, registro del cobro)?

### B. Derechos, conservación y supresión

6. ★ **Supresión.** La política promete que, si el titular lo pide, la barbería **elimina o deja sin nombre y celular** sus datos,
   salvo lo que una norma obligue a conservar. **Hoy no existe una función** para hacerlo (los clientes se archivan): quien
   administra la plataforma lo haría a mano en la base. ¿Es aceptable un procedimiento manual con plazo definido (la cláusula
   propone [5] días hábiles) o debe existir una función propia antes de empezar? Si se construye: ¿qué debe quedar del cliente
   en los cobros y citas ya registradas?
7. **Conservación de cobros y cuentas.** Los cobros se **anulan, no se borran**, y cada uno puede quedar asociado a un cliente.
   ¿Cuánto tiempo deben conservarse los registros de cobros según las normas contables y tributarias aplicables a una barbería
   pequeña, y cómo se concilia con la supresión del nombre del cliente?
8. **Plazo de conservación.** La política dice «mientras sigas siendo cliente de la barbería o hasta que pidas suprimirlos».
   No hay depuración automática. ¿Se necesita un plazo máximo definido (p. ej., por inactividad) y un mecanismo para cumplirlo?

### C. Infraestructura y transmisión

9. ★ **Transmisión internacional.** Supabase y Vercel pueden tratar los datos en servidores fuera de Colombia (la región sugerida
   es Brasil). La política lo informa y la cláusula (numeral 9) lo autoriza expresamente. ¿Basta con eso, o se requiere algo
   más (contrato de transmisión, verificación del nivel de protección del país, declaración de conformidad)? ¿Cambia algo
   que el proveedor sea una persona natural?
10. ★ **Notas libres y datos sensibles.** El equipo puede escribir una **nota libre** en la ficha del cliente y en cada cita
    (hasta 300 caracteres). La aplicación de demostración trae ejemplos como «Piel sensible: sin talco», que podría
    considerarse un dato de salud. Los textos dicen que no se tratan datos sensibles y la cláusula obliga a la barbería a no
    registrarlos. ¿Es suficiente? ¿Conviene una advertencia en el campo de notas, o limitar el campo?
11. **Registros técnicos y cookies.** La infraestructura puede registrar direcciones IP y datos técnicos de acceso. La política
    dice que la aplicación «no usa cookies de seguimiento ni de publicidad» (solo la sesión del personal). ¿Debe decir algo más
    sobre registros técnicos o cookies de sesión?

### D. Relación contractual

12. **Consultas y reclamos.** La política dice que se atienden por el contacto de la barbería (WhatsApp y dirección) y que la
    persona responsable es «el dueño o quien él designe», con los plazos de consulta (10 días hábiles, prorrogables 5) y
    reclamo (15 días hábiles, prorrogables 8). No hay un registro de las solicitudes. ¿Se necesita llevar un registro? ¿Basta
    con un contacto por WhatsApp, o debe haber también un correo?
13. **Roles responsable / encargado.** ¿Es correcta esta calificación (barbería = responsable; proveedor = encargado) en un
    modelo de **un solo despliegue para varias barberías**? ¿Y respecto de los datos del **personal** de la barbería (nombre,
    cuenta de acceso, suscripción push), que los textos no cubren?
14. **La cláusula de encargo** (sección 6). ¿Falta algo? En especial: los plazos entre corchetes (aviso de incidentes [48] h,
    devolución [15] días, supresión [30] días, confidencialidad [5] años, remisión de reclamos [3] días hábiles), el límite
    de responsabilidad, y si debe firmarse o basta la aceptación por escrito (correo o WhatsApp).
15. **WhatsApp.** La aplicación solo arma el enlace `wa.me`; el equipo envía el mensaje desde su celular. ¿Qué debe decir el
    aviso sobre ese canal y sobre la política de WhatsApp (Meta)?

### E. Cumplimiento administrativo

16. **Registro Nacional de Bases de Datos (RNBD).** ¿Aplica a cada barbería (depende del tamaño del negocio)? ¿Y al proveedor
    como encargado?
17. **Quién firma y cómo se factura.** Si la barbería es persona natural o empresa, y si el proveedor presta el servicio como
    persona natural o como empresa (decisión del negocio aún sin tomar): ¿cambia algo en los textos o en la cláusula?
18. **Lo que falta.** ¿Qué otros documentos o trámites debería tener un servicio como este antes de empezar? (La sección 10 lista
    lo que sabemos que no está: política interna de datos del proveedor, facturación, plan de incidentes.)

---

# 4. Texto 1 · Aviso de privacidad

> *Dónde está:* `/aviso-de-privacidad?b=<nombre-corto-de-la-barbería>`. Es el resumen corto que el cliente puede leer **antes de
> reservar** y que lo remite a la política. En la página aparece, bajo el título, la advertencia «Borrador pendiente de revisión
> legal · versión 1 · 17 de octubre de 2026», y los datos de la barbería se completan solos.

## Aviso de privacidad

Antes de reservar, esto es lo que debes saber sobre tus datos personales.

### Quién es el responsable

La barbería donde reservas decide qué se hace con tus datos: es la responsable de su tratamiento.

**[Nombre de la barbería · dirección]** y un botón «Escribirle por WhatsApp». *(Si no se sabe de qué barbería viene la persona:
«La barbería donde haces tu reserva. Su nombre, su dirección y la forma de contactarla están en la página desde la que llegaste a
este texto.»)*

Barberías es la herramienta que la barbería usa para llevar su agenda y sus cuentas. Guarda tus datos por encargo de la
barbería y no los usa para nada más.

### Qué datos tratamos

Tu nombre y tu celular, y los datos de tu cita: servicio, barbero, día y hora. No pedimos documento, correo, dirección ni
datos sensibles.

Si reservas para un menor de edad, escribe tu nombre y tu celular (los de su representante), no los del menor.

### Para qué los usamos

- Agendar tu cita y avisarte si algo cambia.
- Recordártela por WhatsApp o por llamada.
- Llevar el historial de tus visitas y tus preferencias en esa barbería.
- Registrar el cobro del servicio en las cuentas de la barbería.

No los usamos para publicidad y no los vendemos ni los cedemos a terceros.

### Tus derechos

Como titular de tus datos puedes conocerlos, actualizarlos y corregirlos; pedir prueba de tu autorización; saber cómo se usan;
pedir que se supriman o retirar tu autorización; consultarlos gratis; y quejarte ante la Superintendencia de Industria y Comercio.

Para ejercerlos, escríbele a la barbería. Debe responder tus consultas en máximo 10 días hábiles y tus reclamos en máximo 15 días
hábiles.

### Tu autorización es voluntaria

Al marcar la casilla de la reserva autorizas este tratamiento. Es voluntario, pero sin tu nombre y tu celular no podemos agendar
tu cita. Puedes retirar tu autorización cuando quieras.

### La política completa

El detalle (qué guardamos, por cuánto tiempo, quién lo ve y cómo hacer una consulta o un reclamo) está en la política de
tratamiento de datos. Si cambia de forma importante, lo publicaremos allí. **[Enlace: «Leer la política de datos»]**

---

# 5. Texto 2 · Política de tratamiento de datos personales

> *Dónde está:* `/privacidad?b=<nombre-corto-de-la-barbería>`. Se enlaza desde la reserva y desde la página de la cita. Lleva la
> misma advertencia de borrador y versión que el aviso.

## Política de tratamiento de datos

### 1. Quién es el responsable

El responsable del tratamiento de tus datos es la barbería donde reservas. Ella decide para qué se usan y quién los ve.

**[Nombre de la barbería · dirección]** y un botón «Escribirle por WhatsApp».

Barberías es el encargado del tratamiento: la herramienta que aloja la agenda y las cuentas de la barbería. Solo trata los datos
siguiendo las instrucciones de la barbería y para prestarle el servicio.

### 2. Qué datos recogemos

- Tu nombre y tu celular, que escribes al reservar (o que le dices al equipo si te agenda en el local).
- Los datos de tu cita: servicio, barbero, día, hora, precio y su estado (confirmada, atendida, cancelada).
- Lo que la barbería anote de tus visitas: cuánto pagaste, cómo pagaste y, si quiere, una nota sobre tu corte.
- La fecha y la hora en que aceptaste esta política.

No pedimos documento de identidad, correo, dirección, fotos ni datos sensibles (salud, origen, ideas políticas o religiosas,
datos biométricos). Si reservas para un menor de edad, usa tu nombre y tu celular, que son los de su representante: no recogemos
datos del menor.

### 3. Para qué los usamos

- Agendar, mover y cancelar tu cita, y avisarte si algo cambia.
- Recordarte la cita por WhatsApp o por llamada.
- Llevar el historial de tus visitas y tus preferencias en esa barbería.
- Registrar el cobro del servicio en las cuentas de la barbería.
- Atender tus consultas y reclamos.

No los usamos para publicidad ni para otros fines, no los vendemos y no los cedemos a terceros. Si algún día la barbería quisiera
usarlos para otra cosa, te pediría una nueva autorización.

### 4. Tu autorización

Al reservar en línea marcas una casilla donde autorizas este tratamiento; queda registrada la fecha y la hora. Si te agendan en
el local, la barbería debe pedirte la autorización y avisarte de esta política. Autorizar es voluntario, pero sin tu nombre y tu
celular no podemos agendar. Puedes retirar tu autorización cuando quieras.

### 5. Quién ve tus datos

- El equipo de la barbería, según su rol: un barbero ve las citas que le tocan a él; recepción y el dueño ven la agenda completa.
- Quien administra Barberías, solo para dar soporte o resolver un problema, con el mismo deber de reserva.
- Otras personas que reservan nunca ven tu nombre ni tu celular: solo ven que una hora está ocupada.
- Tú, con el enlace secreto de tu cita, que recibes al reservar. Guárdalo: quien lo tenga puede ver tu cita.

### 6. Dónde se guardan y con quién

Los datos se guardan en servicios de infraestructura contratados por el encargado: Supabase (base de datos) y Vercel (alojamiento
de la aplicación). Sus servidores pueden estar fuera de Colombia, así que tus datos pueden viajar al exterior para ser guardados
y protegidos. Cuando el equipo te escribe por WhatsApp, esa conversación la rige además la política de WhatsApp.

### 7. Cómo los protegemos

Las conexiones van cifradas; cada persona del equipo entra con su propia cuenta y solo ve lo que su rol permite; los datos de
cada barbería están separados de los de las demás; y la aplicación no usa cookies de seguimiento ni de publicidad.

### 8. Cuánto tiempo los guardamos

Mientras sigas siendo cliente de la barbería o hasta que pidas suprimirlos. Si los pides suprimir, la barbería los elimina o los
deja sin tu nombre y tu celular, salvo lo que una norma obligue a conservar (por ejemplo, los registros de cobros), y te lo
confirma.

### 9. Tus derechos

- Conocer, actualizar y corregir tus datos.
- Pedir prueba de la autorización que diste.
- Ser informado de cómo se han usado tus datos.
- Pedir que se supriman tus datos o retirar tu autorización.
- Consultar tus datos gratis.
- Presentar una queja ante la Superintendencia de Industria y Comercio, después de haber reclamado a la barbería.

### 10. Cómo hacer una consulta o un reclamo

Escríbele a la barbería (arriba están sus datos de contacto) diciendo tu nombre completo, el celular con el que reservaste y qué
necesitas. La persona que atiende estas solicitudes es el dueño de la barbería o quien él designe.

- Consultas (saber qué datos tiene de ti): respuesta en máximo 10 días hábiles. Si necesita más tiempo, te avisa antes del
  vencimiento y responde en máximo 5 días hábiles más.
- Reclamos (corregir, suprimir, retirar tu autorización o denunciar un incumplimiento): respuesta en máximo 15 días hábiles,
  prorrogables por 8 días hábiles más si te avisan el motivo. Si tu reclamo está incompleto, te piden lo que falta dentro de los
  5 días siguientes.

### 11. Vigencia y cambios

Esta política es la versión 1 del 17 de octubre de 2026. Si cambia de forma importante, la nueva versión se publica en esta misma
dirección. Los datos se tratan mientras dure la relación de la barbería con sus clientes y la que ella tenga con Barberías.
**[Enlace: «Leer el aviso de privacidad»]**

---

# 6. Texto 3 · Cláusula de encargo del tratamiento

> *Dónde está:* `docs/legal/encargo-de-datos.md`. No se muestra en la aplicación: va **dentro del contrato de servicio** con cada
> barbería. «EL PROVEEDOR» es quien administra la plataforma; «LA BARBERÍA» es el negocio que contrata. Lo que va entre
> **[corchetes]** son plazos y datos por acordar. Parte de una cláusula modelo usada para otro proyecto del proveedor y está
> adaptada a la reserva en línea.

**CLÁUSULA [X]. TRATAMIENTO DE DATOS PERSONALES**

**1. Roles.** Para efectos de la Ley 1581 de 2012, el Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015) y las
demás normas que los modifiquen, LA BARBERÍA es la **responsable** del tratamiento de los datos personales de sus
clientes registrados en la plataforma, y EL PROVEEDOR actúa como **encargado** del tratamiento, en la medida en que, al
prestar el servicio, puede acceder, almacenar o procesar esos datos por cuenta de LA BARBERÍA.

**2. Finalidad.** EL PROVEEDOR tratará los datos únicamente para prestar los servicios contratados: alojamiento y
configuración de la plataforma, mantenimiento, soporte, corrección de errores, copias de seguridad y migraciones. No los
usará para ninguna otra finalidad; en particular, no los venderá, cederá ni compartirá con terceros salvo lo previsto en
esta cláusula, no creará bases de datos propias con ellos ni los usará para publicidad o fines propios.

**3. Datos tratados.** Nombre y celular de los clientes, los datos de sus citas (servicio, barbero, día, hora, precio y
estado), el registro de sus cobros, la fecha y hora de su autorización y las notas que LA BARBERÍA decida anotar. La
plataforma no pide documento de identidad, correo, dirección, fotografías ni datos sensibles, y LA BARBERÍA se obliga a no
registrarlos. Los datos de las personas del equipo (nombre y cuenta de acceso) se tratan para darles acceso a la
plataforma.

**4. Instrucciones.** EL PROVEEDOR seguirá las instrucciones de LA BARBERÍA sobre el tratamiento, que podrán darse por
escrito, incluido correo electrónico o mensaje de WhatsApp. Si considera que una instrucción infringe la ley, se lo
informará de inmediato.

**5. Autorización de los titulares.** LA BARBERÍA declara que cuenta con la autorización previa, expresa e informada de
los titulares para el tratamiento de sus datos y que publica y mantiene su aviso de privacidad y su política de
tratamiento. La plataforma le facilita borradores de ambos textos y la casilla de autorización de la reserva en línea
(que registra la fecha y la hora), pero **LA BARBERÍA es quien debe obtener la autorización de los clientes que agenda en
el local** y revisar con su asesor que los textos se ajusten a su caso. EL PROVEEDOR no obtiene ni administra las
autorizaciones.

**6. Confidencialidad.** EL PROVEEDOR guardará reserva sobre los datos a los que tenga acceso y solo los compartirá con
las personas que, bajo su responsabilidad, necesiten conocerlos para prestar el servicio y estén obligadas a la misma
confidencialidad. Esta obligación continúa después de terminado el contrato por [5] años.

**7. Acceso mínimo.** EL PROVEEDOR accederá a los datos reales solo cuando sea necesario para atender una solicitud de
soporte o un incidente. Las pruebas, las demostraciones y los desarrollos se harán con datos inventados. No copiará datos
reales a equipos, cuentas o servicios personales ni los exportará, salvo para una migración o copia de seguridad
autorizada por LA BARBERÍA.

**8. Seguridad e incidentes.** EL PROVEEDOR aplicará medidas razonables de seguridad: acceso con credenciales
individuales, comunicaciones cifradas, permisos por rol, separación de los datos de cada barbería, almacenamiento privado
de archivos, custodia de claves fuera del código y copias de seguridad. Si conoce un incidente que afecte los datos, lo
comunicará a LA BARBERÍA sin demora injustificada y, como máximo, dentro de [48] horas desde que lo conozca, con la
información disponible, para que LA BARBERÍA cumpla sus obligaciones ante los titulares y la autoridad.

**9. Subencargados y transmisión internacional.** LA BARBERÍA autoriza expresamente el uso de los siguientes proveedores
de infraestructura: Supabase (base de datos, autenticación y almacenamiento), Vercel (alojamiento) y, cuando se usen,
los servicios de notificaciones push de los navegadores y WhatsApp/Meta (esta última la usa el equipo de LA BARBERÍA por su
cuenta). Las partes reconocen que estos proveedores pueden tratar datos en servidores ubicados fuera de Colombia. EL
PROVEEDOR no incorporará otros subencargados sin avisar previamente a LA BARBERÍA.

**10. Derechos de los titulares.** Si EL PROVEEDOR recibe una solicitud o reclamo de un titular, la remitirá a LA
BARBERÍA dentro de los [3] días hábiles siguientes, sin responderla directamente. EL PROVEEDOR colaborará técnicamente, en
plazos que permitan a LA BARBERÍA cumplir los términos legales (10 días hábiles para consultas y 15 para reclamos), para
consultar, actualizar, rectificar o suprimir datos. Mientras la plataforma no tenga una función para suprimir un cliente,
EL PROVEEDOR lo hará a solicitud escrita de LA BARBERÍA, dentro de los [5] días hábiles siguientes, dejando el registro
sin nombre ni celular y conservando lo que una norma obligue a conservar (por ejemplo, los registros de cobros).

**11. Terminación, devolución y supresión.** Al terminar el contrato, EL PROVEEDOR entregará a LA BARBERÍA, dentro de los
[15] días siguientes y en formato de uso común (CSV/PDF), una copia de los datos, y dentro de los [30] días posteriores los
suprimirá de los sistemas bajo su control, salvo que una norma exija conservarlos. Las copias de seguridad de los
proveedores de infraestructura se eliminan según su ciclo ordinario.

**12. Información.** EL PROVEEDOR dará a LA BARBERÍA, a solicitud razonable, información sobre las medidas con las que
cumple esta cláusula.

**13. Responsabilidad.** Cada parte responde por el incumplimiento de sus obligaciones bajo esta cláusula. EL PROVEEDOR no
responde por el uso indebido de los datos por parte del personal o de los usuarios de LA BARBERÍA, ni por el contenido que
LA BARBERÍA registre en la plataforma. [Opcional: límite de responsabilidad: el equivalente a __ meses de mensualidad.]

**14. Vigencia.** Esta cláusula rige mientras dure el tratamiento de datos por cuenta de LA BARBERÍA; las obligaciones de
confidencialidad y de supresión subsisten según lo dicho en los numerales 6 y 11.

---

# 7. Texto 4 · Contrato de servicio y condiciones de uso

> *Dónde está:* `docs/legal/contrato-de-servicio.md`. No se muestra en la aplicación: es el borrador del contrato que se firma con
> cada barbería (la cláusula de la sección 6 se pega dentro como cláusula [X]) y de las condiciones de uso que lee su equipo. Los
> precios y márgenes no se escriben aquí. Lo que va entre **[corchetes]** son datos y plazos por acordar. Es la parte que más
> necesita criterio jurídico: **¿qué límites de responsabilidad y qué causales de suspensión son válidos?**

**CONTRATO DE PRESTACIÓN DEL SERVICIO «BARBERÍAS»**

**Partes.** [Nombre completo y documento de EL PROVEEDOR, con su ciudad y su correo] («EL PROVEEDOR») y [razón social o
nombre completo y documento/NIT de LA BARBERÍA, nombre comercial, ciudad, dirección y representante] («LA BARBERÍA»).

**1. Objeto.** EL PROVEEDOR da a LA BARBERÍA acceso a la aplicación web «Barberías» para que gestione su agenda, las
reservas de sus clientes, los cobros, las comisiones de su equipo, los gastos y el cierre del día. El servicio incluye el
alojamiento de la aplicación, la configuración inicial de la barbería, las mejoras y correcciones que EL PROVEEDOR
publique para todos sus clientes y el soporte descrito en este contrato.

**2. Lo que el servicio es y no es.** La aplicación es una herramienta de gestión. **No** factura electrónicamente, **no**
recibe pagos en línea, **no** envía mensajes de WhatsApp (arma el enlace y la persona lo envía desde su celular) y **no**
reemplaza la contabilidad ni la asesoría contable o tributaria de LA BARBERÍA. Las cifras que muestra dependen de lo que
el equipo de LA BARBERÍA registre.

**3. Duración y periodo de prueba.** El contrato empieza el [fecha] y se renueva mensualmente. [Opcional, si hay piloto: Los
primeros [2 semanas / 1 mes] son un **periodo de prueba** [sin costo / con el valor de $ ___]; al terminar, LA BARBERÍA
decide por escrito si continúa. Si no continúa, se aplican los numerales 11 y la cláusula de datos.]

**4. Precio y pago.** LA BARBERÍA paga **$ [___] COP por mes** [IVA incluido / más IVA, según corresponda], pagados por
adelantado dentro de los primeros [5] días de cada mes por [Nequi / transferencia / otro medio]. EL PROVEEDOR entregará
[cuenta de cobro / factura, según su régimen]. El precio solo cambia con aviso escrito de [30] días y rige desde el mes
siguiente; si LA BARBERÍA no lo acepta, puede terminar el contrato sin penalidad.

**5. Soporte.** EL PROVEEDOR atiende consultas y fallas por [WhatsApp / correo] de [lunes a viernes, de 8:00 a. m. a 6:00
p. m.], con respuesta en [1] día hábil. Una falla que impida cobrar o reservar se atiende con prioridad. El soporte no
incluye capacitar a personal nuevo después de la entrega inicial, desarrollos a la medida ni trabajos sobre equipos o redes
de LA BARBERÍA.

**6. Disponibilidad.** EL PROVEEDOR hará su mejor esfuerzo para que la aplicación esté disponible, pero **no garantiza un
servicio ininterrumpido**: depende de proveedores de infraestructura (Supabase, Vercel), de internet y del celular de quien
la usa. Los mantenimientos se avisan con anticipación cuando sea posible. La aplicación **todavía no funciona sin
conexión**: LA BARBERÍA debe llevar un respaldo manual de los cobros del día para caídas de internet o del servicio.

**7. Obligaciones de LA BARBERÍA.**
a) Dar a su equipo solo los permisos que necesite y no compartir cuentas ni códigos de invitación; es responsable de lo
que se haga con las cuentas de su equipo.
b) Registrar información veraz y no registrar datos que la plataforma no pide: documento de identidad, datos de salud u
otros sensibles, ni datos de menores de edad distintos del nombre con el que se agenda el servicio.
c) Cumplir sus obligaciones como **responsable** de los datos de sus clientes (cláusula [X]): en especial, obtener la
autorización de quien agenda en el local y atender sus consultas y reclamos.
d) Cerrar el día y conservar los comprobantes y soportes contables que la ley le exija; la aplicación no los reemplaza.
e) No usar la aplicación para fines ilegales, para enviar mensajes no solicitados ni para intentar acceder a datos de otras
barberías.
f) Pagar oportunamente.

**8. Obligaciones de EL PROVEEDOR.** Prestar el servicio con la diligencia de un profesional del ramo; mantener la
confidencialidad de la información de LA BARBERÍA; cumplir la cláusula [X] de tratamiento de datos; y avisar con
anticipación los cambios que afecten el uso del servicio.

**9. Propiedad.** La aplicación, su código, su diseño y sus mejoras son de EL PROVEEDOR; este contrato **no transfiere**
esa propiedad, solo da a LA BARBERÍA un derecho de uso, no exclusivo e intransferible, mientras el contrato esté vigente.
**Los datos que LA BARBERÍA registra** (su catálogo, sus clientes, sus cobros y demás) **son de LA BARBERÍA**; EL PROVEEDOR
solo los usa para prestar el servicio.

**10. Suspensión.** Si LA BARBERÍA no paga dentro de los [10] días siguientes a la fecha de pago, EL PROVEEDOR puede
suspender el acceso del equipo avisándole antes por [WhatsApp / correo]. Mientras dure la suspensión **la página de reservas
y las citas de los clientes dejan de funcionar**; EL PROVEEDOR no se hace responsable de las citas que se pierdan por esa
causa. Los datos se conservan [30] días; al pagar, el servicio se reactiva. También puede suspender de inmediato, con
aviso, si hay un uso que ponga en riesgo la seguridad del servicio o los datos de otras barberías.

**11. Terminación y entrega de los datos.** Cualquiera de las partes puede terminar el contrato con [15] días de aviso por
escrito (correo o WhatsApp), sin penalidad. EL PROVEEDOR puede terminarlo de inmediato por incumplimiento grave (por
ejemplo, no pagar por más de [30] días o usar la plataforma contra la ley). Al terminar, se aplica la cláusula [X] sobre la
devolución y la supresión de los datos: EL PROVEEDOR entrega una copia en formato de uso común y suprime lo demás dentro de
los plazos allí previstos. El cobro del mes en curso no se devuelve.

**12. Limitación de responsabilidad.** EL PROVEEDOR responde por los daños que cause por su dolo o culpa grave. Salvo eso, su
responsabilidad total frente a LA BARBERÍA se limita a [el equivalente a __ mensualidades pagadas] y **no incluye** lucro
cesante (por ejemplo, ventas perdidas por una caída del servicio), errores de LA BARBERÍA al registrar la información,
diferencias de caja, ni multas o sanciones tributarias o de protección de datos que se originen en el incumplimiento de
LA BARBERÍA. [Que el abogado confirme qué límites son válidos.]

**13. Confidencialidad.** Cada parte guardará reserva de la información no pública de la otra a la que acceda por este
contrato, durante la vigencia y por [5] años después, salvo lo que deba revelar por orden de autoridad.

**14. Cambios en el servicio.** EL PROVEEDOR puede mejorar, modificar o retirar funciones. Si el cambio quita algo
esencial para el uso de LA BARBERÍA, se lo avisa con [30] días de anticipación y ella puede terminar el contrato.

**15. Uso de la marca.** [Opcional] EL PROVEEDOR puede mencionar a LA BARBERÍA como cliente [solo con su autorización escrita].

**16. Ley y solución de conflictos.** Este contrato se rige por las leyes de Colombia. Las partes buscarán resolver las
diferencias directamente y, si no se logra, acudirán a [conciliación / la justicia ordinaria de la ciudad de ___].

**17. Aceptación.** Se firma, o se acepta por escrito (correo o WhatsApp, adjuntando el texto completo), en [ciudad], el
[fecha].

[Firma y documento de EL PROVEEDOR] · [Firma y documento de LA BARBERÍA]

---

## Anexo 1 · Condiciones de uso para el equipo de la barbería

> Para que las lea cada persona que reciba una cuenta o un código de invitación (el dueño las comparte; no se muestran en
> la aplicación). Lenguaje sencillo a propósito.

1. **Tu cuenta es tuya.** No prestes tu celular desbloqueado ni tu código de invitación. Lo que se registre con tu cuenta
   queda a tu nombre.
2. **Registra lo que pasó.** Los cobros y los gastos no se borran: si te equivocas, se anulan con un motivo, y queda
   escrito quién lo hizo y cuándo.
3. **Los datos de los clientes son de la barbería.** Su nombre y celular se usan solo para la cita, el cobro y avisarle de
   su cita. No los copies, no los compartas ni los uses para otra cosa.
4. **No anotes lo que no hace falta.** En las notas no escribas documento de identidad, enfermedades ni datos de salud, ni
   datos de los niños aparte de su nombre.
5. **WhatsApp lo mandas tú.** La aplicación solo arma el mensaje; revisa que sea el cliente correcto antes de enviarlo.
6. **Si pierdes el celular o sospechas que alguien entró a tu cuenta,** avísale al dueño de inmediato para que te quite el
   acceso.
7. **Reporta lo raro** (una cifra que no cuadra, una cita que no debería estar) al dueño o a soporte; no lo arregles
   inventando registros.

---

# 8. Anexo A · Cómo se le muestran los textos al cliente

**En la reserva en línea** (último paso, «Tus datos»), antes del botón «Confirmar reserva», el cliente ve:

1. Los campos **Tu nombre** y **Tu celular** (con la nota «Es para avisarte si algo cambia con tu cita.»).
2. Una **casilla sin marcar** con este texto, y el botón **no se activa** hasta que se marca:

   > ☐ Autorizo a **[nombre de la barbería]** a tratar mi nombre y mi celular para gestionar mi cita, según el aviso de privacidad y la política de datos.

3. Debajo, dos enlaces que abren **en una pestaña nueva**: **Aviso de privacidad** y **Política de datos**, ya personalizados
   con la barbería.

Al confirmar, la aplicación guarda en la cita la **fecha y la hora** en que se marcó la casilla. No guarda el texto ni la versión.

**En la página de la cita** (`/cita/<código>`, el enlace secreto que recibe el cliente), al final: los mismos dos enlaces.

**No hay** casilla ni aviso en la agenda del personal cuando el equipo anota a un cliente en el local (pregunta 2).

Las dos páginas legales son **públicas** (sin sesión) y llevan, bajo el título, la advertencia «Borrador pendiente de revisión legal ·
versión 1 · 17 de octubre de 2026». Esa advertencia debe retirarse cuando el texto sea el definitivo.

---

# 9. Anexo B · Inventario de datos personales

| Dato | Dónde se guarda | Quién lo ve | Para qué | Conservación |
|---|---|---|---|---|
| **Nombre del cliente** (hasta 60 caracteres) | Ficha del cliente | El equipo con acceso a agenda, caja o «mi agenda» | Agendar, historial, cobro | Indefinida (se archiva, no se borra) |
| **Celular del cliente** (formato +57…) | Ficha del cliente | Igual; se usa para armar el enlace de WhatsApp | Avisos y recordatorios | Igual |
| **Nota sobre el cliente** (texto libre, hasta 300) | Ficha del cliente | Igual | Preferencias de corte | Igual (ver pregunta 10) |
| **Cita**: servicio, barbero, día y hora, precio, estado (confirmada, atendida, cancelada, no asistió), origen (en línea o personal), nota libre (hasta 300), motivo de cancelación | Agenda | Equipo con agenda o caja; el barbero solo las suyas; **el cliente** con su enlace secreto | Agenda, historial | Indefinida |
| **Nombre escrito en la reserva** (hasta 60 caracteres) | En la cita | El equipo con agenda o caja, solo si es distinto del de la ficha; el barbero, el de sus citas | Detectar reservas con el celular de otra persona | Indefinida |
| **Autorización** (fecha y hora de la casilla; solo reserva en línea) | En la cita | Nadie en pantalla (solo la base) | Prueba de la autorización | Indefinida |
| **Enlace secreto de la cita** (código aleatorio) | En la cita | El cliente (y quien tenga el enlace) | Ver, mover o cancelar sin cuenta | Indefinida |
| **Cobro**: cliente (opcional), montos, medio de pago, propina, referencia de la transferencia (texto, hasta 60) | Caja | Equipo con caja, cierre o comisiones; el barbero los suyos | Cuentas, comisiones, cierre del día | Indefinida (se anula, no se borra) |
| **Personal**: nombre dentro de la aplicación, rol, correo del dueño, suscripción de avisos del celular | Cuentas | El dueño; cada quien ve lo suyo | Acceso y avisos | Mientras forme parte del equipo |
| **Registros técnicos** (direcciones IP, accesos) | Infraestructura de Supabase y Vercel | Esos proveedores y quien administra | Operación y seguridad | Según cada proveedor (ver pregunta 11) |

**No se recogen:** documento de identidad, correo ni dirección del cliente, fotografías del cliente, ubicación, datos de pago con tarjeta,
ni datos de navegación con fines publicitarios.

---

# 10. Anexo C · Lo que no cubren estos borradores

- **Precio y datos de cada contrato:** la sección 7 es un borrador con corchetes; el contrato real (precio, fechas, firmas) se arma
  aparte para cada barbería y la cláusula de la sección 6 se pega dentro.
- **Términos y condiciones públicos** en la aplicación: hoy solo hay condiciones de uso para el equipo (anexo 1 de la sección 7),
  no una página pública.
- **Política interna** de tratamiento de datos del proveedor (como encargado) y manual interno de atención de consultas y reclamos.
- **Datos del personal** de cada barbería como titulares (nombre, cuenta de acceso).
- **Facturación y aspectos tributarios** del servicio.
- **Plan de respuesta a incidentes** de seguridad (la cláusula solo fija el plazo de aviso).

---

*Fin del paquete. Los tres textos viven en el código de la aplicación (`src/app/privacidad/page.tsx` y
`src/app/aviso-de-privacidad/page.tsx`) y en `docs/legal/encargo-de-datos.md`; al incorporar los cambios del abogado se actualizan
ahí, se sube el número de versión en `src/lib/legal.ts` y se vuelve a generar este paquete.*
