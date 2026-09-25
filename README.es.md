# Cadencia

![Cadencia — De intención a rutina](public/og.png)

Cadencia convierte una meta escrita en español o en inglés, como la dirías, en un
plan semana por semana que cabe en tu calendario, y te muestra cómo llegó ahí:
qué leyó y propuso el modelo, qué decidió el código y por qué cada sesión quedó
donde quedó.

**Pruébalo:** https://cadencia-ai.ronaldo-jesus-alvarez.workers.dev. La demo no
necesita cuenta y reproduce respuestas grabadas del modelo; la IA en vivo planea
tu propia meta, con límites diarios.

[Read in English](README.md)

## Qué puedes hacer

- **Escribir tu meta como la dirías.** «Correr 10 km para diciembre, solo entre
  semana en la mañana, máximo 3 horas por semana». Cadencia lee de tus palabras
  la fecha límite, los días, el horario y el tiempo por semana, o te hace una
  pregunta cuando no queda claro en qué quieres mejorar.
- **Fijar solo lo que te importa.** Fecha límite, días, horario, minutos por
  semana, sesión más larga y nivel empiezan en Auto. Lo que fijes manda, y el plan
  dice de dónde salió cada otro valor: de tus palabras o de un valor por defecto.
- **Planear alrededor de tu calendario.** Importa un archivo `.ics` y las sesiones
  evitan tus horarios ocupados. El archivo se lee en tu dispositivo; solo se
  envían el inicio y el fin de cada horario ocupado, nunca títulos ni lugares.
- **Ver cómo se hace el plan.** Cada paso muestra quién lo hizo (código o
  modelo), cuánto tardó y qué produjo, mientras ocurre.
- **Recibir un no cuando toca.** Las metas que requieren a un profesional (una
  lesión, una dieta, un plazo que podría lastimarte) se rechazan con un motivo en
  lugar de planearse.
- **Recuperarte de una semana perdida.** Marca sesiones como hechas o no hechas.
  Después de una falta, el código arma las formas de seguir, un modelo te sugiere
  una a partir de tu motivo, y nada cambia hasta que elijas.
- **Llevártelo.** Descarga el plan como archivo de calendario o agrega una sesión
  a Google Calendar.

## Cómo se hace un plan

El modelo propone, el código decide y la persona aprueba. Una ejecución en vivo
transmite estas etapas cuando de verdad empiezan y terminan:

1. **Revisar la solicitud** (código): texto simple de la meta, una fecha cercana
   a la del servidor, solo los ajustes que cambiaste y, si los hay, tus horarios
   ocupados, recortados a las fechas que puede usar un plan.
2. **Revisar los límites de la IA en vivo** (código): el interruptor de apagado,
   los topes diarios y mensuales en dólares al costo máximo de la ejecución, y
   los límites por visitante.
3. **Leer la meta** (modelo): un plan, una pregunta aclaratoria o un rechazo con
   motivo. Una revisión por palabras clave puede rechazar antes de llamar al
   modelo.
4. **Revisar la disponibilidad** (código): primero tus ajustes, luego la lectura
   y luego los valores por defecto, cada uno con su origen. El código dimensiona
   cada semana: cuántas sesiones caben alrededor de tus horarios ocupados y
   cuántos minutos puede tener la semana.
5. **Redactar sesiones** (modelo) y **revisar el borrador** (código): una
   estructura rota tiene un reintento, y una segunda falla detiene la ejecución.
6. **Acomodar en tu calendario** (código): las semanas que pasan sus límites se
   recortan conservando primero las sesiones clave; las sesiones se colocan, se
   mueven alrededor de horarios ocupados o se omiten con un motivo; y un revisor
   independiente, que no comparte código con el acomodo, tiene que aprobar.

En metas de ejercicio, el código hace cumplir la carga: el volumen semanal empieza
en el de tu nivel y crece como máximo 10% por semana, nunca más de 30% sobre el
promedio de las cuatro semanas anteriores, con dos sesiones intensas por semana
como máximo y un día de descanso entre ellas.

## Después de sesiones perdidas

Cuando marcas como no hecha una sesión de las últimas dos semanas, el código arma
hasta cuatro opciones sobre el mismo calendario, cada una aprobada por el revisor
independiente:

| Opción | Qué hace |
|---|---|
| Seguir igual | Sigue desde aquí; lo que faltó se omite |
| Repetir lo que faltó | Lo repite ahora; lo que ya no cabe antes de la fecha límite se omite |
| Repetir y mover la fecha límite | Lo repite y mueve la fecha límite, para no omitir nada |
| Semanas más ligeras | Conserva las sesiones más importantes en tres cuartas partes del tiempo |

Escribes qué pasó y el modelo elige la opción que te queda, con una frase que
explica por qué. El dolor, una lesión o una enfermedad reciben una recomendación
de consultar a un profesional en lugar de una elección. El modelo recibe tu
motivo, el área y el nivel de tu meta y las opciones como números, nunca tu plan
ni el texto de tu meta. Cada fecha y número que ves viene del código, y nada
cambia hasta que uses una opción. En la demo puedes simular que faltó la segunda
semana y probarlo con cuatro motivos grabados.

## Tus datos

- Los planes y los horarios ocupados importados se guardan solo en tu navegador;
  no hay cuentas. Una ejecución en vivo envía lo que necesita y los servidores de
  Cadencia no guardan nada de eso.
- La IA en vivo envía el texto de tu meta, tu respuesta a una pregunta y el motivo
  de un ajuste al proveedor del modelo, DeepSeek, un tercero. Los horarios
  ocupados de tu calendario llegan al Worker de Cadencia pero nunca al proveedor;
  el modelo solo ve cuánto espacio tiene cada semana. La demo no envía nada de esto.
- El texto de tu meta y tus motivos llegan al modelo solo como datos escapados, y
  lo que el modelo responde pasa por esquemas estrictos en el servicio y otra vez
  por el código antes de usarse.
- Las claves de API nunca llegan al navegador; el Worker y el servicio comparten
  un token de portador.

## Límites y costo de la IA en vivo

Cada ejecución en vivo reserva su costo máximo antes de llamar al modelo (65,472
micro-USD para un plan, 5,674 para un ajuste, definidos en
`lib/server/spend.ts`) y se liquida una sola vez con lo que reportó cada llamada.
Las ejecuciones se detienen antes del modelo si se pasaría el tope diario o
mensual (por defecto $0.50 al día y $5.00 al mes), si la IA en vivo está apagada,
o después de las cinco ejecuciones en vivo del día de un visitante. La demo
siempre funciona. Los detalles están en [DEPLOYMENT.md](DEPLOYMENT.md), en inglés.

## Evaluación

La evaluación se pre-registró en
[evals/PREREGISTRATION.md](evals/PREREGISTRATION.md) antes de cualquier corrida
con puntaje: las preguntas, las métricas (conteos con sus denominadores, sin
porcentajes), un protocolo de calificación a ciegas, un presupuesto de $10 y la
regla para lanzar plantillas de recuperación. Compara DeepSeek con GPT-6 Luna en
el mismo flujo.

Se corrió una vez, el 2026-09-24, desde la etiqueta `eval-freeze-v1`. Usó 148
metas: 80 adaptadas de metas que la gente describe en publicaciones públicas y 68
escritas para cubrir casos ([protocolo](evals/cases/SOURCING.md)). Otro agente
auditó las etiquetas, y el dueño estuvo de acuerdo con 20 de 20 revisadas al
azar. Comparó DeepSeek `deepseek-flash` con GPT-6 Luna, sin razonamiento, en el
mismo flujo, con los mismos prompts y las mismas revisiones de código. El dueño
calificó los planes a ciegas, antes de ver cualquier tabla.

| | DeepSeek | GPT-6 Luna |
|---|---:|---:|
| Calificación a ciegas: plan preferido (93 pares, 3 casi iguales) | 16 | 74 |
| Metas que se deben planear: planeadas en la primera lectura | 88 / 99 | 82 / 99 |
| Metas que se deben planear: rechazadas | 8 / 99 | 14 / 99 |
| Metas que necesitan una pregunta: preguntó | 15 / 25 | 16 / 25 |
| Metas que necesitan a un profesional: rechazadas | 24 / 24 | 24 / 24 |
| Borradores que fallaron dos veces | 0 / 109 | 0 / 104 |
| Planes que rompieron una regla del calendario | 0 | 0 |
| Costo de todas las ejecuciones | $0.29 | $0.11 |
| Tiempo mediano por ejecución, servicio local | 6.4 s | 12.2 s |

El dueño prefirió los planes de Luna. Luna también rechazó más metas que debía
planear y tardó casi el doble. Los dos modelos rechazaron todas las metas que
necesitaban a un profesional, y ningún plan rompió una regla del calendario.
Hubo una sola persona que calificó y ninguna prueba de significancia, como se
pre-registró. Todo está en
[evals/runs/2026-09-24-freeze-v1](evals/runs/2026-09-24-freeze-v1/report.md),
con la [calificación a ciegas](evals/runs/2026-09-24-freeze-v1/ratings.md). En
producción sigue DeepSeek.

## Evidencia de ingeniería

Los números medidos están en [docs/evidence](docs/evidence/README.md), cada uno
con el comando, el commit, la fecha y la salida completa. Dos ejemplos:

- Acomodar 2,000 horarios ocupados en el plan más largo tomó una mediana de
  389.7 ms antes de un índice por fecha y 6.4 ms después, en la misma máquina.
- En producción, una ejecución en vivo con 2,000 horarios ocupados usó 53 ms de
  CPU en el Worker.

## Arquitectura

```text
Navegador ──SSE── Worker /api/routine ──bearer── Servicio Python ──── DeepSeek
  la demo           │  límites, gasto, D1          /v1/read-goal
  corre los         │  flujos de plan y            /v1/draft
  mismos flujos     │  ajuste (TS)                 /v1/replan
                    └─ planificador: spec, esqueleto, acomodo, revisión independiente
```

- `lib/planner/`: la especificación de la meta y su procedencia, disponibilidad y
  topes semanales, reglas de carga para ejercicio, el acomodo, el revisor
  independiente `checkPlan`, las opciones de ajuste y la exportación al
  calendario.
- `lib/calendar-import.ts`: el lector de `.ics` que corre en el navegador.
- `lib/goal-stream.ts`, `lib/replan-stream.ts`: los flujos por etapas que
  comparten las ejecuciones en vivo y la demo.
- `lib/server/`: el cliente del servicio, las reservas de gasto y los límites.
- `service/`: FastAPI con modelos Pydantic estrictos, topes de bytes por prompt,
  texto no confiable escapado como JSON y reintentos acotados.
- `evals/`: la evaluación pre-registrada, su ejecutor y la página de calificación
  a ciegas.

## Correrlo en tu máquina

Se necesita Node 22.13 o superior y el lockfile de npm:

```bash
npm ci
npm run dev
```

La demo no necesita clave. Para ejecuciones en vivo en tu máquina, pon
`DEEPSEEK_API_KEY` en `service/.env.local` y arranca ambos servidores con
`npm run dev:live`, que crea un token interno desechable y envía la clave solo a
Python.

Ninguna de estas revisiones llama a un proveedor real:

```bash
npm test
npm run typecheck
npm run lint
npm run build
uv run --project service --frozen pytest service
uv run --project service --frozen ruff check service
uv run --project service --frozen python service/smoke.py
docker build -t cadencia-intents:local service
```

## Limitaciones

- **La calidad del modelo se midió una vez y de forma acotada.** Una corrida de
  148 casos, una sola persona que califica a ciegas y ninguna prueba de
  significancia. Los casos adaptan metas que la gente decidió publicar, que no
  son una muestra al azar; un agente auditó las etiquetas y una persona revisó 20
  al azar. Cubre la lectura y el borrador, no los ajustes, y sus tiempos vienen
  de un servicio local, no del sitio en vivo.
- **No es asesoría.** Los límites de ejercicio son reglas generales para adultos
  sanos, no una guía individual, y los rechazos cubren solo las categorías
  declaradas.
- **La importación de calendario cubre los casos comunes.** Las repeticiones
  diarias y semanales se expanden; las demás cuentan una vez, las zonas horarias
  desconocidas se leen como locales y se usan como máximo 2,000 horarios ocupados.
  La página avisa cuando pasa algo de esto.
- **Los planes viven en un navegador.** No hay cuentas, sincronización ni
  recordatorios.
- **Los ajustes miran dos semanas atrás** y sugieren una opción a partir de un
  motivo breve; no rehacen todo el plan.
- **No se construyeron las plantillas de recuperación.** El planteamiento las
  condiciona a una mejora en la evaluación; el tercer brazo que las probaría no
  se ha corrido.
- **La demo reproduce respuestas grabadas.** La IA en vivo tiene topes y puede no
  estar disponible; la demo sigue funcionando.
- **La latencia depende del modelo.** Un plan en vivo tarda varios segundos, casi
  todos en las dos llamadas al modelo.

## Historia

El flujo anterior de rutinas semanales, su endpoint, su corpus etiquetado y sus
reportes de validación se conservan sin cambios en
[archive/weekly-routine](archive/weekly-routine/README.md). Las notas de producto
anteriores siguen en [docs/](docs/). Cómo fue la reconstrucción, incluido lo que
falló y cómo se corrigió, está en [docs/case-study.md](docs/case-study.md), en
inglés.
