---
title: Mensajes personalizados y SOS del personal
category: Emergency System
updated: 2026-10-26
excerpt: Escriba su propio mensaje y póngalo en sus pantallas — una franja en la parte superior o la pantalla completa —, en todas las pantallas o solo en las que elija, y vea quién puede enviarlo y finalizarlo, qué muestran las pantallas y qué guarda el registro de auditoría.
---

# Mensajes personalizados y SOS del personal

Un **mensaje personalizado** pone sus propias palabras en sus pantallas: "Todo el personal preséntese en la oficina principal", "Salida anticipada a la 1:00 p. m.", "El estacionamiento B está cerrado". Es más ligero que una alerta como Confinamiento o Incendio / Evacuación, que reemplaza todo lo que hay en pantalla por el contenido de esa alerta. Para las alertas, vea el [resumen del sistema de emergencia](/help/emergency-system).

## Abrir Mensaje personalizado

Mensaje personalizado es una tarjeta de la página de **Emergencia**, la misma de los botones de alerta, así que no hay nada aparte que buscar:

- **En un teléfono**, pulse el botón rojo **Emergencia** de la parte superior y toque **Mensaje personalizado**, debajo de **Enviar a**.
- **En una computadora**, pulse **Emergencia** en la barra lateral y elija **Mensaje personalizado** al final de la ventana. **Configuración → Emergencia** también tiene un botón **Abrir Mensaje personalizado**.

Se muestra a todas las personas que pueden enviar. La dirección anterior de esta página, su espacio de trabajo seguido de `/emergency/broadcast`, sigue funcionando y lo lleva directamente a la tarjeta, así que un marcador o un correo antiguo siguen sirviendo. Mientras hay una alerta activa, el banner rojo del panel tiene un botón **Consola de emergencia** que abre la página de Emergencia.

## Enviar un mensaje personalizado

1. Elija cómo debe **aparecer**: **Aviso** o **Crítico** (abajo se explica cómo se ve cada uno).
2. Escriba su **mensaje**, de hasta 500 caracteres. La vista previa muestra cómo se verá.
3. En **Enviar a**, deje **Todas las pantallas** o pulse **Elegir pantallas** para escoger un grupo de pantallas o pantallas concretas (siguiente sección).
4. Elija **Mostrar durante**: 5, 15, 30 minutos o 1 hora. El valor predeterminado es 5.
5. Mantenga pulsado **Mantenga 3 segundos para enviar** hasta que se llene. Si suelta antes, se cancela y no se envía nada. Con teclado, mantenga Espacio o Intro.

Una nota verde confirma que salió y el mensaje aparece en **En pantalla ahora**. Si el envío falla, un mensaje rojo lo dice: no salió nada, así que inténtelo de nuevo. Después de enviar, la línea **Enviar a** vuelve a **Todas las pantallas**, para que el siguiente mensaje nunca vaya a un público más reducido por descuido.

## Elegir qué pantallas

**Todas las pantallas** es la opción predeterminada: todas las pantallas del lugar donde trabaja y, si trabaja en una organización con ubicaciones debajo, también todas las pantallas de esas ubicaciones. Para enviar a menos, pulse **Elegir pantallas**. Es el mismo selector que usan las alertas:

- Toque un **grupo** para enviar a ese grupo de pantallas.
- Toque **pantallas** una por una para elegir pantallas concretas; puede elegir todas las que quiera. **Buscar** reduce la lista, **Seleccionar todas** elige todas las que muestra y **Seleccionadas: 3 pantallas** las cuenta. Pulse **Listo** para confirmar.

Una pantalla de doble cara recibe el mensaje por los dos lados, elija el lado que elija. Solo las pantallas que eligió lo muestran; las demás siguen con normalidad. Un administrador de organización puede elegir pantallas de distintas ubicaciones en un mismo mensaje.

## Qué muestran las pantallas

| Usted envió | Las pantallas muestran |
|---|---|
| **Aviso** | Una franja en la parte superior con su mensaje. Lo que se estaba reproduciendo sigue reproduciéndose debajo: baja y se reduce para caber bajo la franja, de modo que la franja nunca lo tapa, y vuelve a su sitio cuando el mensaje termina. |
| **Crítico** | Toda la pantalla se pone roja con un borde parpadeante, la palabra **Transmisión** y su mensaje. |
| Un SOS del personal | Toda la pantalla: **SOS del personal**, el correo de quien lo envía y el lugar que indicó. |

Un mensaje enviado con el nivel anterior **Advertencia** (antes del 2026-10-26, o mediante la API) se muestra como **Aviso**. El texto se reduce para caber en pantallas verticales, tipo cinta y LED pequeñas en lugar de cortarse. Las pantallas reciben el mensaje en segundos por su conexión en vivo; una pantalla cuya conexión en vivo está caída lo recibe en su siguiente comprobación, cada 10 segundos aproximadamente.

## SOS del personal y notas de voz

Un SOS del personal es una petición de ayuda en pantalla completa de un miembro del personal y puede llevar una nota de voz grabada. Las pantallas pueden mostrarlo y un SOS activo aparece en **En pantalla ahora** como cualquier otro mensaje, pero todavía no hay ningún botón, ni en el panel ni en `/panic`, para enviar un SOS o grabar una nota de voz. Para dar la alarma desde un teléfono hoy, abra `/panic`, inicie sesión y mantenga pulsada la alerta que corresponda; vea el [resumen del sistema de emergencia](/help/emergency-system).

El interruptor **Voz activada** / **Silencio** de la parte superior de `/panic` solo hace que su teléfono lea en voz alta el estado de las alertas. No graba ni envía nada.

## Cuánto dura un mensaje y cómo finalizarlo antes

| Mensaje | Permanece en pantalla |
|---|---|
| Mensaje personalizado | El tiempo que eligió: 5, 15, 30 o 60 minutos (5 si no lo cambia) |
| SOS del personal | 30 minutos |

Las pantallas retiran un mensaje por sí solas cuando se acaba su tiempo. Para finalizarlo antes, pulse **Finalizar** junto a él en **En pantalla ahora**; puede hacerlo cualquiera que pueda enviar. La lista aparece al principio de la tarjeta cuando hay algo en pantalla, así que **Finalizar** es lo primero que ve. Finalizar un mensaje enviado a pantallas concretas lo termina exactamente en esas pantallas, y finalizar uno enviado desde una organización también lo finaliza en todas las ubicaciones que tiene debajo. Las pantallas vuelven directamente a lo que estaban reproduciendo; no aparece ninguna pantalla de alerta por el camino. Si la página dice que no se pudo finalizar, el mensaje puede seguir en las pantallas: pulse **Finalizar** de nuevo.

Una alerta completa (Confinamiento, Evacuación y las demás) termina de otra forma: escriba **CLEAR** y pulse **Terminate Emergency (All Clear)** en el panel, o use **Mantenga para enviar el fin de alerta** en `/panic`.

## Siempre en vivo: practique con un simulacro

Mensaje personalizado no tiene interruptor **LIVE | DRILL**: todos los mensajes son reales y las pantallas nunca los marcan como simulacro, así que no lo use para practicar. Para ensayar, inicie un simulacro desde el botón **Emergencia** de la barra superior o desde `/panic`: ponga el interruptor en **DRILL** (siempre empieza en **LIVE** cada vez que se abre) y las pantallas mostrarán su contenido de simulacro bajo un banner "THIS IS A DRILL".

## Quién puede enviar

- Los **Super administradores** y **Administradores** pueden enviar mensajes personalizados.
- Los **Editores** solo pueden enviarlos cuando un administrador les ha activado el permiso **Alertas de emergencia**; vea [delegar el acceso de pánico](/help/panic-delegation). Sin él, el envío se rechaza y la tarjeta no se muestra.
- Los **Lectores** no pueden enviar ni finalizar.
- **Finalizar** se muestra a todas las personas que pueden enviar: la misma regla que aplica el servidor.
- Las **claves de API** nunca pueden enviar ni finalizar un mensaje.

## Qué registra el registro de auditoría

Cada envío y cada finalización añade una entrada permanente al registro de auditoría. Los administradores lo abren desde **Configuración → Emergencia → Ver quién hizo qué**, pueden filtrarlo y exportarlo como archivo CSV. Las entradas no se pueden editar ni eliminar.

| Entrada | Qué registra |
|---|---|
| `BROADCAST_TEXT` | Quién lo envió y cuándo, la gravedad, la longitud del mensaje, la duración y adónde fue: para pantallas concretas, las pantallas exactas que eligió, cada lado de pantalla que lo lleva, sus nombres y las ubicaciones |
| `MEDIA_ALERT` | Quién lo envió y cuándo, adónde fue, la gravedad, cuántos archivos multimedia, si llevaba sonido y a cuántas ubicaciones llegó (se envía por la API; la tarjeta envía texto) |
| `SOS_TRIGGER` | Quién lo envió y cuándo, el lugar que escribió y si llevaba una nota de voz |
| `CLEAR_EMERGENCY_MESSAGE` | Quién finalizó qué mensaje y cuándo; en un mensaje enviado a pantallas concretas, en qué pantallas exactas lo finalizó |

El registro guarda la longitud de un mensaje, no sus palabras. Las alertas y los simulacros tienen entradas propias: `TRIGGER_EMERGENCY`, `CLEAR_EMERGENCY`, `TRIGGER_EMERGENCY_DRILL` y `CLEAR_EMERGENCY_DRILL`.
