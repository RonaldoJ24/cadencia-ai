# Contrato de IA de Cadencia

Cadencia separa el contenido de la agenda. Un modelo opcional propone sólo una
`Intent` (`title`, `goal`, `domain` y `steps`). Python devuelve además la decisión
interna estricta `scope_refused`; esa decisión proviene del guard Python y no forma
parte de `Intent`. El código valida ambas partes antes de decidir las fechas, la
hora, la duración, el tope semanal y la reprogramación.
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

El único adaptador vivo está ahora en `service/provider.py`. FastAPI recibe sólo
la solicitud, valida JSON con modelos Pydantic estrictos y devuelve una intención
sin fechas ni agenda. El prompt versionado es `cadencia-intent-v1`. El proveedor
no recibe herramientas. La operación completa tiene un límite de 20 segundos;
sólo 429 y 5xx permiten un segundo intento. La respuesta está limitada a 32 KiB y
los errores de red, timeout, truncamiento, JSON o esquema se convierten en errores
genéricos con un ID opaco. No se registran prompts, respuestas crudas ni secretos.
`validateIntent` vuelve a comprobar la intención en TypeScript antes del motor, y
la ruta exige el booleano `scope_refused` antes de llamar a
`buildPlan(input, intent, 'deepseek', scopeRefused)`. El booleano es interno y no
se copia a la respuesta del navegador.
`IntentResult.model` y `ProviderError.model` conservan el modelo solicitado. El
adaptador puede conservar por separado `observed_model` y `system_fingerprint` del
envelope del proveedor sólo cuando cada valor es corto, ASCII, sin controles y no
parece secreto; los valores inválidos se convierten en `null`.
El runner de evaluación live añade un máximo positivo compartido de requests al
transporte, incluidos los retries; si se agota, falla antes del siguiente request.

## Activación del servidor

El modo `deepseek` conserva el contrato del navegador `{ input, mode }` y la
respuesta `{ plan }`. La ruta Next.js requiere `CADENCIA_ENABLE_LIVE=true`,
`CADENCIA_INTENT_SERVICE_URL` y `CADENCIA_SERVICE_TOKEN`. Envía únicamente
`{ request }` por HTTPS al servicio Python (HTTP sólo en loopback local), con el
token interno y un timeout independiente de 25 segundos. No sigue redirecciones
con la credencial. `GET /api/routine` devuelve sólo `{ "liveAvailable": boolean }`,
que indica configuración local válida, no disponibilidad comprobada de DeepSeek.

Python lee `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` y `CADENCIA_SERVICE_TOKEN` desde su
entorno del servidor. El frontend ya no necesita la clave de DeepSeek. No se usan
variables públicas `VITE_*` o `NEXT_PUBLIC_*` para secretos. `GET /healthz` no
requiere autenticación ni revela configuración. `POST /v1/intents` compara el
bearer token de forma segura, valida el cuerpo acotado y devuelve metadatos de
versión, modelo, latencia e intentos sin exponer datos privados.

El `POST /api/routine` limita el cuerpo a 32 KiB y comprueba el origen cuando
llegan `Origin` o `Referer`. Esto ofrece protección CSRF básica, no autenticación
de usuarios ni cuotas. El cuerpo/input inválido devuelve 400, el modo vivo sin
configuración devuelve 503 y un fallo del servicio devuelve 502. La demo no
necesita Python, clave ni red. El modo vivo debe permanecer local o del propietario
hasta tener autenticación, cuotas y controles de abuso para generación pagada.

Consulta [arquitectura y despliegue Python](PYTHON-SERVICE.md) y [evaluaciones y
regresiones](../service/evals/README.md). Los fixtures comprueban el código con
respuestas sintéticas; no miden precisión representativa del modelo. La evaluación
viva requiere credenciales explícitas y una acción opt-in separada de CI normal.

## Seguridad de contenido

Las solicitudes que piden orientación médica, de ejercicio, financiera o legal
reciben una intención breve de fuera de alcance y cero sesiones. El guard Python
permite una coincidencia de `dosis`/`dosage` sólo para análisis literario o
lingüístico que excluye de forma explícita recomendaciones de salud, y una
coincidencia de `abogado`/`lawyer` sólo en ficción o escritura creativa sobre
personajes, escenas, diálogos o narrativa. Cualquier otra coincidencia restringida
mantiene el rechazo. Una señal de petición directa junto con una acción médica o
legal inequívoca en cualquier parte de la misma solicitud prevalece sobre una
envoltura literaria o ficticia. Es una barrera basada en palabras y contexto
acotado, no un sistema completo de moderación. Python es la autoridad de alcance
para solicitudes enviadas al proveedor. La demo conserva un guard local con las
mismas señales directas y excepciones contextuales acotadas; en `deepseek`,
TypeScript usa únicamente el booleano validado por Python y no infiere el alcance
desde `Intent`. No se establece calidad semántica de extremo a extremo ni
preparación para producción.

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
