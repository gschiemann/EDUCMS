---
title: Resumen de seguridad para equipos de TI
category: IT & Security
updated: 2026-10-22
excerpt: Dónde se aloja VenueOS, cómo funcionan el inicio de sesión y los permisos, cómo se protegen los datos y las pantallas, y a dónde enviar preguntas de seguridad.
---

# Resumen de seguridad para equipos de TI

VenueOS es un servicio en la nube de señalización digital y alertas de emergencia. Su personal administra las pantallas desde un panel web; cada pantalla ejecuta el reproductor de VenueOS y recibe su contenido y sus alertas desde la nube de VenueOS. Esta página está escrita para los equipos de TI y de seguridad que la evalúan.

## Alojamiento y ubicación de los datos

| Parte | Qué hace | Dónde se ejecuta |
|---|---|---|
| Panel | La aplicación web que usa su personal | Vercel, red perimetral global |
| Servicio de VenueOS | Inicio de sesión, contenido, programación, alertas y administración de pantallas | Railway, Estados Unidos |
| Base de datos y archivos | Cuentas, configuración y contenido subido | Supabase sobre Amazon Web Services, Estados Unidos |
| Reproductor | Reproduce el contenido en cada pantalla | App de Android en la pantalla o reproductor multimedia, o un navegador web |

Todos los datos de clientes se guardan en **Estados Unidos**. Cada uno de nuestros proveedores de alojamiento publica sus propios informes de auditoría de seguridad independientes. Los pagos con tarjeta se hacen en páginas alojadas por Stripe, así que los números de tarjeta nunca llegan a VenueOS.

Todos los proveedores que procesan datos de clientes, y cuándo lo hacen, están en el [Anexo B de nuestra Adenda de Procesamiento de Datos](/dpa#subprocessors).

## Inicio de sesión e identidad

- **Contraseñas**: de al menos 8 caracteres, guardadas solo como hashes Argon2 con sal. Los intentos de inicio de sesión tienen límite de frecuencia.
- **Verificación en dos pasos**: llaves de acceso (Face ID, Touch ID, Windows Hello o una llave de seguridad física), apps de autenticación con códigos de respaldo de un solo uso, y un código por correo como alternativa. El código por correo no se acepta durante 7 días después de restablecer la contraseña.
- **Quién debe usarla**: su organización puede exigir la verificación en dos pasos a todos los administradores y a todas las personas autorizadas a enviar alertas de emergencia, y un administrador puede exigirla a cualquier persona.
- **Primer inicio de sesión**: cada persona nueva define su propia contraseña y su correo la primera vez que inicia sesión.
- **Inicio de sesión único**: cualquier proveedor de identidad OpenID Connect (OIDC) — por ejemplo Google Workspace, Microsoft Entra ID u Okta — limitado a los dominios de correo que usted elija. Vea [Configurar el inicio de sesión único](/help/sso).
- **Sesiones**: el acceso vence en menos de una hora. "Mantener la sesión iniciada" usa una credencial de un solo uso, rotativa, en una cookie que los scripts de la página no pueden leer; si alguna vez se reutiliza una antigua, se cierra toda esa sesión.

## Quién puede hacer qué

| Rol | Puede |
|---|---|
| Administrador (organización) | Administrar todas las ubicaciones, usuarios, la marca y el contenido de la organización |
| Administrador (ubicación) | Administrar pantallas, listas de reproducción, horarios y personal de una ubicación |
| Editor | Subir y editar contenido y horarios |
| Lector | Acceso de solo lectura |

El permiso para enviar alertas de emergencia se otorga **por separado, persona por persona**. Cada solicitud se limita a la organización de la persona, y pruebas automáticas en cada cambio de código verifican que los datos de cada organización se mantengan separados.

## Protección de los datos

- **En tránsito**: todas las conexiones usan HTTPS (TLS), con HSTS en el panel.
- **En reposo**: el proveedor de alojamiento cifra la base de datos y los archivos. VenueOS además cifra los secretos de la verificación en dos pasos, los del inicio de sesión único y las credenciales de los servicios que usted conecta.
- **Las subidas** se revisan por su contenido real, no por el nombre del archivo. Se rechazan los archivos disfrazados, dañados o no compatibles.
- **Los archivos privados** — software del reproductor, planos de planta y capturas de reportes de problemas — solo se entregan mediante enlaces firmados de corta duración.
- VenueOS **no** necesita expedientes de estudiantes. Los nombres y fotos de estudiantes permanecen ocultos en las pantallas deportivas públicas hasta que un administrador escolar confirma sus políticas de información de directorio y de autorización de fotos.

## Registro de auditoría

Se registran las acciones privilegiadas: inicios de sesión y eventos de verificación en dos pasos, cambios de usuarios y permisos, cambios de contenido y horarios, alertas de emergencia y fines de alerta, y vinculación y retiro de pantallas. Cada registro indica la persona, la organización, la dirección de red, la acción, el objeto y la hora. Reglas de la base de datos impiden editar o borrar los registros, y los administradores pueden filtrarlos en el panel y exportarlos como CSV.

## Pantallas

- **Vinculación**: la pantalla muestra un código de un solo uso y un administrador lo escribe en el panel. La pantalla recibe entonces su propia credencial.
- **Las credenciales de dispositivo** son únicas para cada pantalla, de corta duración y se renuevan solas. Quitar una pantalla en el panel la desconecta en su siguiente solicitud.
- **Mínimo privilegio**: una pantalla solo puede obtener su propio contenido asignado e informar su propio estado.
- **Software del reproductor**: las versiones están firmadas, y cada actualización se compara con una huella que VenueOS registró antes de instalarse.
- **El contenido guardado** se verifica con su huella antes de quedar en la pantalla. El contenido de emergencia se guarda en un almacenamiento aparte y protegido.

Lo que su red debe permitir está en [Requisitos de red y de firewall](/help/network-requirements).

## Alertas de emergencia

Solo las personas con el permiso de alertas pueden enviarlas, con una pulsación sostenida deliberada o una confirmación escrita, y cada alerta y fin de alerta queda en el registro de auditoría. Los mensajes de alerta se firman criptográficamente antes de enviarse, llegan a las pantallas por la conexión en tiempo real y, si esa conexión no está disponible, por consultas periódicas normales. El [resumen del sistema de emergencia](/help/emergency-system) tiene los detalles, incluido lo que el sistema no cubre.

## Cómo lo construimos y operamos

- Cada cambio pasa por control de versiones y verificaciones automáticas: comprobación de tipos, pruebas automáticas que incluyen la ruta de las alertas de emergencia, verificación de separación entre organizaciones, detección de secretos y auditoría de vulnerabilidades en dependencias.
- Los secretos se guardan en los almacenes de secretos de los proveedores de alojamiento, nunca en el código fuente.
- El panel envía una Política de Seguridad de Contenido y está protegido contra falsificación de solicitudes entre sitios y clickjacking. Las solicitudes del servidor a direcciones que da un usuario no pueden llegar a redes internas.
- Las versiones nuevas reciben tráfico solo después de pasar las comprobaciones de salud. Las copias de seguridad cifradas de la base de datos se hacen cada noche y se guardan 30 días. El estado en vivo está en la [página de estado](/status).

## Preguntas y reportes de vulnerabilidades

Cuestionarios de seguridad y solicitudes de documentación: security@venue-os.app. Para reportar una vulnerabilidad, vea [Reportar una vulnerabilidad de seguridad](/security).
