---
title: Requisitos de red y de firewall
category: IT & Security
updated: 2026-10-22
excerpt: Lo que la red de una escuela o empresa debe permitir para que las pantallas y el panel lleguen a VenueOS — solo HTTPS saliente, ningún puerto entrante.
---

# Requisitos de red y de firewall

Las pantallas solo necesitan **acceso a internet**. No tienen que estar en su red interna, y nada se conecta *hacia* su red.

## En resumen

- **HTTPS saliente (TCP 443)** es el único requisito. Sin conexiones entrantes, redirección de puertos, VPN ni aperturas en el firewall.
- El reproductor de VenueOS **no abre puertos de escucha**: la pantalla inicia cada conexión.
- Recomendamos poner las pantallas en un **segmento de red de invitados o IoT** aislado de sus sistemas internos.
- Las pantallas necesitan un reloj exacto: permita **NTP (UDP 123)** o proporcione una fuente de hora local. La verificación de certificados y los horarios dependen de ello.

## Destinos que debe permitir (TCP 443 saliente)

| Destino | Para qué se usa |
|---|---|
| `venue-os.app` | El panel y la aplicación de reproducción de las pantallas |
| `api-production-39a1.up.railway.app` | El servicio de VenueOS, incluida la conexión en tiempo real con las pantallas (WebSocket seguro, `wss://`) |
| `bhdaxzfalaycfopvcopm.supabase.co` | Sus archivos de contenido y las actualizaciones del reproductor |
| `github.com`, `*.githubusercontent.com` | Actualizaciones del reproductor Android (ruta de descarga de respaldo) |
| `fonts.googleapis.com`, `fonts.gstatic.com` | Fuentes web que usan muchas plantillas de diseño |
| `api.open-meteo.com`, `geocoding-api.open-meteo.com`, `ipapi.co` | Solo widgets del clima: el pronóstico local y una ciudad aproximada cuando el widget no tiene ubicación |
| `*.sentry.io` | Informes de errores. Opcional: bloquearlo no afecta la reproducción |
| Sus propias fuentes de contenido | Solo si agrega sitios web, transmisiones de video, redes sociales u otro contenido en línea a las pantallas |

Si su red bloquea los WebSockets, las pantallas pasan solas a solicitudes HTTPS normales al mismo servicio: el contenido y las alertas de emergencia siguen llegando, unos segundos más tarde.

## Inspección TLS

Excluya los destinos anteriores de la inspección SSL/TLS. Las pantallas verifican los certificados del servidor y no se conectan a través de un proxy de inspección cuyo certificado no reconocen.

## Ancho de banda y cortes

- El contenido se descarga **una sola vez**, se verifica con su huella digital y se guarda en la pantalla. Después, el tráfico es sobre todo consultas de estado y cambios pequeños.
- Los videos grandes se descargan en pasos cortos que se pueden reanudar, así que una conexión lenta o interrumpida continúa donde se quedó.
- Si se cae internet, las pantallas siguen reproduciendo el contenido guardado y se ponen al día cuando vuelve la conexión. Una pantalla que ya muestra una alerta de emergencia la sigue mostrando hasta que llega el fin de alerta.

## Usuarios del panel

El personal que administra las pantallas solo necesita un navegador moderno con acceso HTTPS a `venue-os.app` y al servicio de VenueOS indicado arriba. No se instala nada en sus computadoras.

## Integraciones

El inicio de sesión único, los menús de punto de venta, las redes sociales y otras integraciones se conectan **desde la nube de VenueOS hacia el proveedor**. Nada se conecta hacia su red.

## ¿Sigue bloqueado?

Escriba a support@venue-os.app con el nombre de la pantalla, lo que muestra y, si lo sabe, su producto de firewall o filtro web. Ayudaremos a su equipo de TI a encontrar la regla que lo impide.
