# Calendario y compartir

Cadencia ofrece dos salidas puntuales para una rutina ya generada. No crean
cuentas, guardan datos ni sincronizan cambios con un calendario.

`googleCalendarUrl(plan, session, timeZone)` crea una URL de plantilla para
añadir una sola sesión a Google Calendar. El título y los detalles salen de la
sesión; `dates` usa la fecha y la hora local de Cadencia y suma la duración; y
`ctz` conserva la zona IANA validada con `Intl.DateTimeFormat`. El contenido
generado se trata como texto y se codifica con `URLSearchParams`. Las sesiones
marcadas como perdidas se rechazan para evitar añadir un evento que ya no está
programado.

`routineShareText(plan)` produce texto plano con el título de la rutina, los
días, la hora, los límites de minutos y los resúmenes de las sesiones activas.
No incluye el modo, el proveedor, claves ni otros metadatos de configuración.

No se exporta `outlookCalendarUrl`: una URL de Outlook necesita una
interpretación de zona horaria y esta interfaz sólo tiene una hora local. Adivinar
la zona de la cuenta puede desplazar el evento. Para Outlook y Apple, `toICS`
es la vía fiable para exportar la rutina completa: mantiene horas locales
flotantes, excluye sesiones perdidas y deja que la aplicación de calendario
interprete la importación. También es una exportación de una sola vez, no una
sincronización bidireccional.
