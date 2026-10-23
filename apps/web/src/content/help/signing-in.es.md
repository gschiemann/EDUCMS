---
title: Iniciar sesión, claves de acceso y verificación en dos pasos
category: IT & Security
updated: 2026-10-22
excerpt: Su primer inicio de sesión, las claves de acceso en Mac, iPhone o PC con Windows, las apps de autenticación y los códigos de respaldo, cómo entrar desde un dispositivo nuevo y qué hacer si no puede entrar.
---

# Iniciar sesión, claves de acceso y verificación en dos pasos

Inicie sesión en **venue-os.app/login** con su correo de trabajo. Esta página explica su primer inicio de sesión, las formas en que VenueOS comprueba que realmente es usted y cómo volver a entrar cuando algo falla.

## Cómo funciona el inicio de sesión

1. Escriba su correo de trabajo y pulse **Continuar**.
2. VenueOS muestra solo lo que corresponde a esa dirección: un campo de contraseña, o **Continuar con inicio de sesión único** cuando su organización usa inicio de sesión único (vea [Configurar el inicio de sesión único](/help/sso)).
3. Si su cuenta usa verificación en dos pasos, después confirma con su clave de acceso o con un código.

Si este dispositivo ya tiene una clave de acceso para su cuenta, pulse **Iniciar sesión con una clave de acceso** en la primera pantalla: sin contraseña y sin código.

**Mantener la sesión iniciada**, junto a la contraseña, mantiene la sesión abierta en ese navegador hasta 30 días; sin esa opción, una sesión dura hasta 12 horas. Márquela solo en un dispositivo que sea suyo. Cambiar la contraseña cierra la sesión en todos los demás dispositivos.

## Su primer inicio de sesión

Cómo empieza depende de cómo lo agregó su administrador (administradores: vean [Invitar al personal y asignar roles](/help/invite-users)).

### Con una invitación por correo

Abra el enlace del correo de invitación; funciona durante 7 días. Elija una contraseña de al menos 8 caracteres, escríbala otra vez y pulse **Join workspace**. Si su organización exige la verificación en dos pasos, VenueOS le pide que inicie sesión una vez más para configurarla.

### Con un enlace de configuración o una contraseña inicial

Las organizaciones que configuran muchas ubicaciones a la vez crean cada cuenta antes de saber quién la usará, con un correo temporal y una contraseña inicial o con un enlace de configuración de un solo uso. Abra el enlace y pulse **Continuar**, o inicie sesión con el correo temporal y la contraseña inicial que le dieron. VenueOS muestra entonces **Termina de configurar tu cuenta**:

1. Escriba su dirección en **Tu correo de trabajo** y repítala en **Escribe tu correo otra vez**. Use un buzón que pueda abrir: ahí llegan los códigos de inicio de sesión y los restablecimientos de contraseña, y después no podrá cambiarlo usted mismo.
2. Elija una **Contraseña nueva** de al menos 8 caracteres, distinta de la contraseña inicial, y confírmela.
3. Pulse **Guardar y continuar**.
4. Si VenueOS le pide un código, abra el correo que acaba de enviar a esa dirección, escriba el código de 6 dígitos y pulse **Verificar y terminar**. El código sirve durante 10 minutos y se anula tras 5 intentos fallidos. Si no llega ningún correo, revise la carpeta de spam y pulse **Enviar un código nuevo**. ¿Escribió mal la dirección? Pulse **Usar otro correo**.

Un enlace de configuración funciona una sola vez y vence a los 7 días. Si dice que venció o que ya se usó, pida uno nuevo a su administrador. Si su cuenta debe usar la verificación en dos pasos, VenueOS lo lleva directamente a configurarla, con el correo que acaba de elegir.

### Con inicio de sesión único

Inicie sesión con la cuenta de su organización. No hay una contraseña de VenueOS aparte que elegir.

## Verificación en dos pasos

Con la verificación en dos pasos, la contraseña sola no basta: también confirma con algo que solo usted tiene, ya sea una clave de acceso o un código de una app de autenticación.

**Quién debe usarla.** Cuando un Superadministrador configura la organización con **Doble factor obligatorio** (**Ajustes → Personas y acceso → Política de MFA**), todos los Superadministradores, todos los Administradores y todas las personas autorizadas a enviar alertas de emergencia deben configurarla antes de poder iniciar sesión. Un administrador también puede exigirla a una sola persona con **Exigir 2FA** en la fila de esa persona. Cualquiera puede activarla para sí en **Ajustes → Mi seguridad**.

**Configurarla cuando es obligatoria.** Después de la contraseña, la página de inicio de sesión muestra **Configura la verificación en dos pasos**. Elija una opción:

- **Usar Face ID, Touch ID o una llave de seguridad**: crea una clave de acceso en este dispositivo. No hay nada que instalar.
- **Usar una app de autenticación en su lugar**: escanee el código QR con una app como Google Authenticator, Microsoft Authenticator, 1Password o Authy (o escriba la clave que aparece), introduzca el código de 6 dígitos que muestra y pulse **Terminar de entrar**.

Después guarde sus códigos de respaldo (más abajo) y pulse **Ya los guardé — continuar**.

## Claves de acceso

Una clave de acceso le permite entrar con su cara, su huella o el PIN de su dispositivo en lugar de una contraseña y un código. Es la forma más rápida de entrar y no se puede robar con un sitio falso: una clave de acceso solo funciona en la dirección real de VenueOS.

| Dispositivo | Confirma con |
|---|---|
| Mac | Touch ID, o la contraseña de inicio de sesión del Mac |
| iPhone o iPad | Face ID o Touch ID |
| PC con Windows | Windows Hello: su cara, su huella o su PIN |
| Teléfono Android | Su huella, su cara o el bloqueo de pantalla |
| Llave de seguridad (USB o NFC) | Un toque en la llave |

Las claves de acceso guardadas en el Llavero de iCloud (dispositivos Apple) o en el Gestor de contraseñas de Google también aparecen en sus otros dispositivos con la misma cuenta. Una clave de Windows Hello normalmente se queda en ese PC. Puede tener hasta 10 claves de acceso, así que agregue una en cada dispositivo que use.

**Agregar una clave de acceso.** Justo después de iniciar sesión, VenueOS puede preguntarle **¿Iniciar sesión con Face ID o Touch ID la próxima vez?** (en Windows, Windows Hello). Pulse el botón que nombra su dispositivo, por ejemplo **Añadir una clave de acceso para este Mac**, y siga las indicaciones del dispositivo. **Ahora no** vuelve a preguntar otro día; **No volver a preguntar en este dispositivo** deja de preguntar. O bien, en cualquier momento, abra **Ajustes → Mi seguridad**, vaya a **Claves de acceso**, pulse **Añadir una clave de acceso para este …**, confirme su contraseña y siga las indicaciones. En la misma lista puede cambiar el nombre de una clave o eliminarla; eliminarla pide su contraseña. Si una clave de acceso es su primer método de confirmación, VenueOS también le muestra códigos de respaldo: guárdelos.

**Entrar con una clave de acceso.** Pulse **Iniciar sesión con una clave de acceso** en la primera pantalla, o **Usa tu clave de acceso** después de la contraseña, y confirme en su dispositivo. En una computadora, el navegador también puede mostrar un código QR: escanéelo con el teléfono que tiene su clave de acceso (el Bluetooth debe estar activado en ambos).

## App de autenticación y códigos de respaldo

Para usar una app de autenticación, abra **Ajustes → Mi seguridad**, vaya a **Verificación en dos pasos** y pulse **Activar 2FA**. Escanee el código QR (o escriba la clave de configuración), introduzca el código de 6 dígitos y pulse **Verificar y activar**.

**Códigos de respaldo.** La primera vez que configura la verificación en dos pasos, VenueOS muestra 10 códigos de respaldo, una sola vez. Cada código le permite entrar una vez si pierde el teléfono o no puede usar su clave de acceso. Cópielos o descárguelos y guárdelos en un lugar seguro: un gestor de contraseñas, o impresos y bajo llave. **Regenerar códigos de respaldo** (pide su contraseña) crea un juego nuevo, y los códigos anteriores sin usar dejan de funcionar.

Para dejar de usar la app, pulse **Desactivar 2FA** y confirme su contraseña. Cuando su cuenta exige la verificación en dos pasos, VenueOS no le deja quitar su último método: agregue antes una clave de acceso.

## Entrar desde un dispositivo nuevo

- **Su clave de acceso se sincroniza con él** (Llavero de iCloud o Gestor de contraseñas de Google): pulse **Iniciar sesión con una clave de acceso**.
- **Su clave de acceso está en otro dispositivo:** escriba su correo y su contraseña, pulse **Usar otro método** y elija **Introducir un código de tu aplicación de autenticación**, **Usar un código de respaldo** o, cuando aparezca, **Enviarme un código por correo**: un código de 6 dígitos que se envía a su correo de inicio de sesión y funciona una sola vez, durante 10 minutos.
- **En un teléfono** también puede ver **Configurar una clave de acceso en este iPhone** (o teléfono Android): VenueOS le envía primero un código por correo y después activa el inicio de sesión con Face ID, Touch ID, huella o bloqueo de pantalla en ese teléfono.
- **Una vez dentro**, VenueOS le ofrece agregar una clave de acceso para el dispositivo nuevo, para que la próxima vez baste un toque.

Al entrar con un código por correo también recibe un correo de "nuevo inicio de sesión", para que sepa si no fue usted. El código por correo no se ofrece durante 7 días después de restablecer la contraseña: use entonces su clave de acceso, su app de autenticación o un código de respaldo.

## Si no puede entrar

| Qué pasó | Qué hacer |
|---|---|
| Olvidó su contraseña | En el paso de la contraseña, pulse **¿Olvidaste tu contraseña?** y escriba su correo. El enlace para restablecerla funciona durante una hora. La contraseña nueva cierra la sesión en todos sus dispositivos, y la verificación en dos pasos sigue aplicándose. |
| "Demasiados intentos de inicio de sesión con este correo" | VenueOS frena el inicio de sesión tras varias contraseñas incorrectas y, después de 20 en 15 minutos, bloquea ese correo durante 15 minutos, incluso con la contraseña correcta. Espere o restablezca su contraseña. |
| Demasiados códigos incorrectos | Tras 5 códigos incorrectos en un minuto, espere 5 minutos antes de volver a intentarlo. |
| Perdió el teléfono, sus claves de acceso y sus códigos de respaldo | Pida a un administrador con un rol superior al suyo que abra **Ajustes → Personas y acceso** y pulse **Restablecer 2FA** en su fila. Eso quita su app de autenticación y sus claves de acceso y cierra su sesión. Su contraseña no cambia, y volverá a configurar la verificación en dos pasos en su próximo inicio de sesión. |
| El correo de su cuenta está mal | Un administrador puede corregirlo con **Cambiar correo** en su fila de **Ajustes → Personas y acceso**. |
| Un enlace de invitación o de configuración venció o ya se usó | Pida uno nuevo a su administrador. |
| Su organización usa inicio de sesión único | Su contraseña y sus reglas dependen del proveedor de identidad de su organización: contacte a su equipo de TI. |
| Su cuenta fue desactivada | Solo un administrador puede volver a activarla. |

Si nadie en su organización puede restablecer su acceso (por ejemplo, porque usted es el único Superadministrador), escriba a support@venue-os.app desde su correo de trabajo.
