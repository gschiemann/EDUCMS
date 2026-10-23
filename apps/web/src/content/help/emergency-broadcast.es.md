---
title: Transmisiones de emergencia y SOS del personal
category: Emergency System
updated: 2026-10-22
excerpt: Ponga un mensaje urgente encima de lo que muestran sus pantallas — texto, o imágenes, video y sonido — y vea quién puede enviarlo y finalizarlo, qué muestran las pantallas y qué guarda el registro de auditoría.
---

# Transmisiones de emergencia y SOS del personal

Una **transmisión de emergencia** pone un mensaje urgente encima de lo que estén reproduciendo sus pantallas: "Todo el personal preséntese en la oficina principal", "Salida anticipada a la 1:00 p. m.", "El estacionamiento B está cerrado". Es más ligera que una alerta como Confinamiento o Incendio / Evacuación, que reemplaza todo lo que hay en pantalla por el contenido de esa alerta. Para las alertas, vea el [resumen del sistema de emergencia](/help/emergency-system).

## Abrir la página de transmisión

**Transmisión de emergencia** está en la dirección de su espacio de trabajo seguida de `/emergency/broadcast`. Si su panel está en `venue-os.app/lincoln-high/dashboard`, abra `venue-os.app/lincoln-high/emergency/broadcast` y guárdela en favoritos. Mientras hay una alerta activa, el aviso rojo del panel también tiene un botón **Consola de emergencia** que la abre.

## Enviar una transmisión de texto

1. Elija la **Gravedad**: **Aviso**, **Alerta** o **Crítico** (más abajo verá cómo se ve cada una).
2. Escriba el **Mensaje**, de hasta 2.000 caracteres. La **Vista previa** lo muestra con los colores de esa gravedad.
3. Indique la **Duración (min)**: cuánto tiempo lo muestran las pantallas, de 1 a 120 minutos. El valor predeterminado es 5.
4. Mantenga pulsado **Mantenga 3 s para transmitir** hasta que se llene. Si suelta antes, se cancela y no se envía nada. Con el teclado, mantenga pulsada la barra espaciadora o Intro.

**Transmisión enviada.** confirma que salió, y el mensaje aparece en **Transmisiones activas**. Si el envío falla, un mensaje en rojo lo indica: no salió nada, así que vuelva a intentarlo.

Una transmisión llega a todas las pantallas de la ubicación en la que está trabajando; para llegar a las pantallas de una ubicación concreta, cámbiese primero a esa ubicación. Esta página no permite elegir pantallas ni grupos.

## Agregar imágenes, video o sonido

Marque **Incluir multimedia (imagen, video o audio)** para enviar en su lugar una **alerta con multimedia**:

1. En **Medios**, abra la imagen o el video y pulse **Copy link**.
2. Pegue el enlace en la página de transmisión y pulse **Agregar**. Las pantallas muestran hasta cuatro imágenes o videos.
3. Para agregar sonido, pegue el enlace de un archivo de audio en **URL de audio (opcional)**.
4. Escriba su mensaje y mantenga pulsado **Mantenga 3 s para transmitir**.

Una alerta con multimedia siempre ocupa toda la pantalla y se mantiene durante una hora; no hay duración que configurar. Los enlaces deben empezar por `https://` y apuntar a archivos guardados en VenueOS: los enlaces a otros sitios web se rechazan, para que nadie pueda poner una página externa en sus pantallas.

## Qué muestran las pantallas

| Lo que envió | Lo que muestran las pantallas |
|---|---|
| Texto **Aviso** | Una franja amarilla en la parte superior con su mensaje. Lo que se estaba reproduciendo sigue debajo. |
| Texto **Alerta** | La misma franja, en naranja. |
| Texto **Crítico** | Toda la pantalla se vuelve roja con un borde parpadeante, la palabra **Broadcast** y su mensaje. |
| Una alerta con multimedia | Toda la pantalla, con el color de la gravedad: **Emergency Alert**, su mensaje, sus imágenes o videos (los videos se reproducen sin sonido y en bucle) y un reproductor de audio si agregó sonido. |
| Un SOS del personal | Toda la pantalla: **Staff SOS**, el correo de quien lo envió y el lugar que indicó. |

El texto se reduce para caber en pantallas verticales, franjas y pantallas LED pequeñas en lugar de cortarse. Las pantallas reciben el mensaje en segundos por su conexión en vivo; una pantalla cuya conexión en vivo esté caída lo recibe en su siguiente consulta, aproximadamente cada 10 segundos.

## SOS del personal y notas de voz

Un SOS del personal es una llamada de ayuda a pantalla completa de un miembro del personal, que puede incluir una nota de voz grabada. Las pantallas pueden mostrarlo y un SOS activo aparece en **Transmisiones activas** como cualquier otro mensaje, pero todavía no hay un botón, ni en el panel ni en `/panic`, para enviar un SOS o grabar una nota de voz. Para dar la alarma desde un teléfono hoy, abra `/panic`, inicie sesión y mantenga pulsada la alerta que corresponda; vea el [resumen del sistema de emergencia](/help/emergency-system).

El interruptor **Voz activada** / **Silencio** de la parte superior de `/panic` solo hace que su teléfono lea en voz alta el estado de la alerta. No graba ni envía nada.

## Cuánto dura un mensaje y cómo finalizarlo antes

| Mensaje | Se muestra durante |
|---|---|
| Transmisión de texto | La duración que eligió: de 1 a 120 minutos (5 si no la cambia) |
| Alerta con multimedia | 1 hora |
| SOS del personal | 30 minutos |

Las pantallas retiran el mensaje solas cuando se acaba su tiempo. Para finalizarlo antes, un Superadministrador pulsa **Finalizar** junto a él en **Transmisiones activas**. Si la página indica que la finalización falló, el mensaje puede seguir en las pantallas: pulse **Finalizar** otra vez.

Una alerta completa (Confinamiento, Evacuación y las demás) termina de otra forma: escriba **CLEAR** y pulse **Finalizar la emergencia (fin de emergencia)** en el panel, o use **Mantén pulsado para enviar el fin de alerta** en `/panic`.

## Siempre real: practique con un simulacro

La página de transmisión no tiene el interruptor **REAL | SIMULACRO**: cada transmisión es real y las pantallas nunca la marcan como simulacro, así que no la use para practicar. Para ensayar, inicie un simulacro desde el botón **Emergencia** de la barra superior o desde `/panic`: cambie el interruptor a **SIMULACRO** (empieza en **REAL** cada vez que se abre) y las pantallas mostrarán su contenido de simulacro con un aviso de SIMULACRO.

## Quién puede enviar

- Los **Superadministradores** y los **Administradores** pueden enviar transmisiones de texto y alertas con multimedia.
- Los **Editores** solo pueden enviarlas cuando un administrador les activa el permiso **Alertas de emergencia**; vea [delegar el acceso al botón de pánico](/help/panic-delegation). Sin ese permiso, el envío se rechaza.
- Los **Visualizadores** ven **Transmisiones activas**, pero no pueden enviar.
- En esta página, **Finalizar** se muestra a los Superadministradores.
- Las **claves de API** nunca pueden enviar ni finalizar una transmisión.

## Qué guarda el registro de auditoría

Cada envío y cada finalización agregan una entrada permanente al registro de auditoría. Los administradores lo abren desde **Ajustes → Emergencia → Abrir el registro de auditoría**, pueden filtrarlo y exportarlo como archivo CSV. Las entradas no se pueden editar ni borrar.

| Entrada | Qué guarda |
|---|---|
| `BROADCAST_TEXT` | Quién la envió y cuándo, adónde fue, la gravedad, la longitud del mensaje, la duración y a cuántas ubicaciones llegó |
| `MEDIA_ALERT` | Quién la envió y cuándo, adónde fue, la gravedad, cuántos archivos multimedia, si tenía sonido y a cuántas ubicaciones llegó |
| `SOS_TRIGGER` | Quién lo envió y cuándo, el lugar que escribió y si incluía una nota de voz |
| `CLEAR_EMERGENCY_MESSAGE` | Quién finalizó qué mensaje, y cuándo |

El registro guarda la longitud de una transmisión de texto, no sus palabras. Las alertas y los simulacros tienen entradas propias: `TRIGGER_EMERGENCY`, `CLEAR_EMERGENCY`, `TRIGGER_EMERGENCY_DRILL` y `CLEAR_EMERGENCY_DRILL`.
