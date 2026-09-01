# Evaluaciones de Cadencia

Este documento describe un snapshot de validación local. Los fixtures calibran
controles del software; no establecen calidad semántica, usuarios, despliegue ni
preparación para producción.

La evaluación separa cinco preguntas que no deben colapsarse en una sola tasa:

1. **Validez técnica:** HTTP, JSON, esquema, error y retry observados contra la etiqueta.
2. **Acuerdo de dominio:** `learning`, `creative` o `general`; no implica relevancia.
3. **Guard:** qué solicitudes rechazó el filtro léxico antes del proveedor, incluidos falsos positivos.
4. **Comportamiento adversarial:** señales automatizadas y casos que todavía necesitan revisión semántica.
5. **Calidad de respuesta:** la línea base live pequeña ya existe, pero sólo una
   revisión humana ciega puede establecerla; permanece `not_established`.

Un intent válido de dominio `learning` sobre tejer no responde a una solicitud de
TypeScript. Los tests conservan ese contraejemplo, una salida válida pero vaga y una
salida que obedece instrucciones inseguras. Son controles negativos sintéticos de
software; no son fallos observados de DeepSeek ni evaluaciones humanas. No se usa una
regla de palabras clave ni un LLM judge para decidir calidad.

## Corpus y replay local

`cases.jsonl` tiene 60 solicitudes públicas sintéticas: 40 éxitos esperados, 8
rechazos del guard, 5 entradas inválidas y 7 fallos simulados del proveedor. Las
respuestas de replay independientes están en `fixtures/provider_responses.json`.
`heldout.jsonl` congela 8 casos adicionales, separados del desarrollo: cuatro
solicitudes indirectas fuera de alcance y cuatro coincidencias benignas cercanas.
`catalog.json` fija sus hashes y expectativas de revisión. El held-out es una línea
base congelada ya revelada para esta corrección; se conserva para regresión y no se
considera evidencia independiente de calidad.

El replay atraviesa FastAPI y el proveedor real hasta `httpx.MockTransport`. No hay
bandera de producción para activar fixtures y el modo por defecto no usa red. Cada
ruta de salida es nueva: el runner se niega a sobrescribir una línea base.

Python es la autoridad de alcance para solicitudes enviadas al proveedor y devuelve
el booleano interno `scope_refused`. La demo mantiene en `lib/routine.ts` un guard
local con las señales directas y excepciones contextuales acotadas; `deepseek` usa
el booleano validado y no infiere alcance desde la `Intent`. Esta corrección no
demuestra calidad semántica de extremo a extremo ni preparación para producción.

```bash
uv run --project service --frozen python service/evals/run.py \
  --run-id '<new-dev-run-id>' --repeat-id 1 --export-review \
  --output 'outputs/evals/<new-dev-run-id>/report.json'

uv run --project service --frozen python service/evals/run.py \
  --cases service/evals/heldout.jsonl \
  --run-id '<new-heldout-run-id>' --repeat-id 1 --export-review \
  --output 'outputs/evals/<new-heldout-run-id>/report.json'
```

`--export-review` solo funciona si el hash coincide con un corpus declarado público
y sintético. El paquete acotado contiene solicitudes e intents para evaluación;
nunca sobrescribe ni amplía los logs de producción. Un corpus personalizado puede
ejecutar comprobaciones técnicas, pero no exportar respuestas hasta su declaración
explícita como corpus público sintético.

Los reportes registran `requested_model` por separado de los contadores
`observed_model_counts` y `system_fingerprint_counts`, además de prompt, run/repeat
ID, hash del corpus, HEAD, estado dirty, fingerprint reproducible y hashes de una
allowlist de archivos fuente. En replay determinista esos dos contadores quedan
vacíos (`{}`); nunca se copia el alias configurado como observación del proveedor.
La allowlist no incluye dotenv ni secretos. HEAD por sí solo no identifica cambios
sin commit.

## Paquetes de revisión y calibración

Crear una plantilla pendiente y resumirla sin notas:

```bash
uv run --project service --frozen python service/evals/review.py template \
  --packet outputs/evals/phase1-dev-replay-001/report.review-packet.json \
  --output outputs/evals/phase1-dev-replay-001/human-grades.pending.json

uv run --project service --frozen python service/evals/review.py score \
  --packet outputs/evals/phase1-dev-replay-001/report.review-packet.json \
  --output outputs/evals/phase1-dev-replay-001/quality.pending.json
```

Las plantillas y los paquetes sintéticos sirven para comprobar bindings, formato y
la aplicación mecánica de la rúbrica. Un fixture usa `synthetic_fixture` y no produce
aceptación humana ni evidencia de calidad del proveedor. Las filas sintéticas se
mantienen pendientes o se marcan como fixture; no se presentan como valor revisado.
El programa valida los metadatos declarados, pero no puede verificar la identidad ni
la honestidad de un revisor. Los archivos se escriben con modo exclusivo.

La línea base live acotada ya contiene respuestas reales del proveedor. Su revisión
humana ciega sigue pendiente; la aceptación y la calidad representativa permanecen
**no establecidas**.

## Denominadores y evidencia actual

- `provider.attempted` cuenta casos con uno o más intentos; `http_attempts_including_retries`
  cuenta requests upstream. En la suite de 60: 47 casos y 49 requests simulados.
- `provider_attempt_budget` registra el máximo configurado, los requests realmente
  usados y si el límite impidió un intento. En modo live el máximo debe ser positivo
  y es compartido por toda la ejecución, incluidos retries.
- `schema.evaluable` incluye respuestas completadas por proveedor. JSON truncado o
  inválido intencionalmente reduce la tasa; no es calidad del modelo.
- `domain.agreement_rate` solo compara etiquetas de outputs técnicos exitosos.
- `guard` informa rechazos antes del proveedor y falsos rechazos. Los 8 rechazos del
  corpus de desarrollo hicieron **cero** llamadas: prueban el guard, no la negativa del modelo.
- `critical_cases` separa casos pre-proveedor de casos que invocaron proveedor y deja
  `semantic_safety=not_established`; su valor requiere revisión humana ciega de la
  línea base live.
- `adversarial` separa contrato y warnings automatizados; el valor semántico queda para
  revisión humana ciega de la línea base live existente.
- Las latencias se dividen en `provider_invoked` y `pre_provider`. En replay son
  tiempos locales, no latencia real.
- Uso `synthetic_fixture` no es facturable. El costo queda `null` sin precios explícitos.

La ejecución held-out congelada conserva cuatro solicitudes indirectas fuera de
alcance que llegan al proveedor simulado y dos coincidencias benignas que antes
producían falsos rechazos. La corrección contextual permite ahora las dos solicitudes
benignas; el replay sigue siendo evidencia del guard, no una evaluación de DeepSeek.
Las respuestas sintéticas no reciben una interpretación de calidad; la revisión de
valor permanece pendiente de revisión humana ciega; existe una línea base live
pequeña separada y acotada.

## Live opt-in

Todo live genérico requiere `--live`, `--max-provider-attempts` positivo,
credenciales ya inyectadas y autorización de gasto. Los 7
fallos artificiales se excluyen: quedan 53 casos de servicio, normalmente **40 casos
que invocan el LLM**, 8 rechazos pre-proveedor y 5 entradas inválidas; retries pueden
cambiar el número de requests. Nunca describirlo como 53 generaciones reales.

```bash
uv run --project service --frozen python service/evals/run.py --live --export-review \
  --cases service/evals/live-baseline-v1.jsonl \
  --run-id '<new-live-run-id>' --repeat-id 1 \
  --max-provider-attempts '<capped-attempts>' \
  --input-usd-per-million 0.44 --cached-input-usd-per-million 0.014 \
  --output-usd-per-million 1.32 \
  --preflight 'outputs/evals/<new-live-run-id>/preflight.json' \
  --output 'outputs/evals/<new-live-run-id>/report.json'
```

El bloque anterior es la ruta estricta de evidencia `live-baseline-v1`; `--preflight`
es opcional para ejecuciones live genéricas y no cambia el workflow manual existente.
Ya existe una línea base live pequeña, ejecutada por el owner; aún no establece
calidad hasta completar una revisión humana ciega.
Seguridad crítica requiere cero fallos conocidos, sin pretender cobertura exhaustiva.
La preflight de esa ruta fija hash del corpus, fuente, prompt/modelo, límite,
precios y coste máximo antes de la primera llamada; no contiene dotenv, secretos
ni cuerpos.

## Smoke y ciclo de regresión

```bash
uv run --project service --frozen python service/evals/smoke.py
```

El smoke inicia Python en loopback, importa la ruta Next.js, prueba éxito/error y
confirma que demo no llama al proveedor. Usa un proveedor simulado.

Para un fallo real: localizar por request ID y metadatos allowlisted; reproducir sin
recuperar prompts privados; crear caso sintético/redactado; demostrar el fallo;
aplicar el cambio mínimo; repetir caso y corpus; registrar prompt o fingerprint que
lo corrigió. La regresión Unicode `scope-02` sigue etiquetada
`development-observed`: solo `restricted_request("漢dosis")` se demostró antes del
arreglo; la frase completa se añadió después y no es un incidente de producción.
