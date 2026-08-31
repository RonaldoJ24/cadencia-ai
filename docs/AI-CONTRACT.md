# Contrato de IA de Cadencia

Cadencia separa el contenido de la agenda. Un modelo opcional propone sólo una
`Intent` (`title`, `goal`, `domain` y `steps`). El código valida esa salida y
decide las fechas, la hora, la duración, el tope semanal y la reprogramación.
El modelo no recibe herramientas, no ejecuta código y no puede escribir en el
calendario.

## Modo demo

`buildPlan(input)` usa `demoIntent` y selecciona pasos deterministas de ejemplo.
El plan conserva la solicitud original y lleva la explicación
`salida determinista de demostración`. Los fixtures del motor comprueban reglas
de agenda; no son una medición de calidad, precisión o desempeño de un modelo de
IA.

La entrada exige una solicitud de 2.000 caracteres como máximo, días únicos de
0 (lunes) a 6 (domingo), un `startDate` ISO que sea lunes, hora local `HH:mm`,
minutos enteros positivos y un `weeklyMinutes` entre la duración de una sesión
y 10.080 minutos. Una sesión debe terminar antes de cambiar de día. Se crea una
sesión como máximo por día seleccionado y sólo dentro de la semana
`startDate`–`startDate + 6`.

## Proveedor opcional

El adaptador usa exclusivamente
`https://api.deepseek.com/chat/completions`, el formato compatible con OpenAI.
Envía `response_format: {"type":"json_object"}`, una instrucción explícita de
JSON, `thinking: {"type":"disabled"}`, temperatura `0.2`, `max_tokens: 800` y
`stream: false`. La documentación actual muestra que el modo thinking puede
estar habilitado por defecto, por lo que se desactiva para reservar el límite
de salida para el JSON. El contrato actual
de DeepSeek documenta el modo JSON y los modelos disponibles en [JSON
Output](https://api-docs.deepseek.com/guides/json_mode/) y [Chat Completions
API](https://api-docs.deepseek.com/api/create-chat-completion/). El modelo por
defecto del endpoint es `deepseek-v4-flash`; se puede reemplazar con
`DEEPSEEK_MODEL`, según [Your First API Call](https://api-docs.deepseek.com/).

La solicitud del usuario se incluye como datos delimitados. No se registran la
solicitud, la clave ni la respuesta. El adaptador aborta después de 20 segundos,
limita la respuesta a 32 KiB y convierte errores HTTP, red, timeout, JSON
malformado y esquemas inválidos en un error genérico sin detalles sensibles.
`validateIntent` vuelve a comprobar todos los campos antes de entregar la
intención al planificador.

## Activación del servidor

El modo `deepseek` sólo se puede activar explícitamente en el cuerpo `POST` y
requiere `CADENCIA_ENABLE_LIVE=true` junto con `DEEPSEEK_API_KEY`. Si
`DEEPSEEK_MODEL` está vacío se usa `deepseek-v4-flash`. La clave se lee sólo en
el servidor desde `process.env`; nunca se usa `VITE_*` ni `NEXT_PUBLIC_*`.
`GET /api/routine` devuelve únicamente `{ "liveAvailable": boolean }`.

El `POST /api/routine` acepta `{ input, mode }`. El cuerpo está limitado a 32
KiB y, cuando el navegador lo envía, el origen debe coincidir con el origen de
la solicitud. Si no llega `Origin` ni `Referer`, se permite el uso de una
herramienta local o CLI; esta comprobación ofrece protección CSRF básica, no
autenticación ni límites de uso. Un cuerpo o input inválido devuelve 400, el
modo vivo sin configuración devuelve 503 y un fallo del proveedor devuelve
502. El modo demo no necesita clave ni red.

El modo vivo queda pensado para uso local o del propietario mientras no haya
autenticación, cuotas y controles de abuso delante del endpoint; no debe
publicarse con una clave compartida sin esas capas.

## Seguridad de contenido

Las solicitudes que piden orientación médica, de ejercicio, financiera o legal
reciben una intención breve de fuera de alcance y cero sesiones. Es una barrera
de alcance basada en palabras y patrones, no un sistema completo de moderación;
una revisión de producto debe cubrir los casos nuevos antes de ampliar el
alcance. Las rutinas de aprendizaje, práctica creativa y trabajo personal
general siguen disponibles.

## Replanificación y exportación

`replan` marca la sesión perdida, conserva intactas las sesiones hechas y busca
un día permitido, posterior y libre dentro de la misma semana. Si no existe,
conserva el plan y añade un aviso explícito. Las sesiones programadas y hechas
nunca superan el tope semanal.

Markdown trata el contenido generado como texto. ICS exporta sólo sesiones
programadas o hechas de esa semana; las perdidas no se convierten en nuevos
eventos. `DTSTART` y `DTEND` son horas flotantes locales sin `TZID` ni `Z` y
usan la duración de la sesión. `DTSTAMP` es la marca UTC de la exportación,
`UID` usa un fingerprint determinista de la rutina y el texto de eventos se
limita a `SUMMARY` e `DESCRIPTION`, con escape RFC 5545 y plegado de líneas.
El requisito de `DTSTAMP` sigue [RFC 5545, sección
3.8.7.2](https://www.rfc-editor.org/rfc/rfc5545#section-3.8.7.2).
