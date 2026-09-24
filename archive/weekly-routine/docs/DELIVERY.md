# Entrega inicial de Cadencia

> Esta nota resume un snapshot de validación local del prototipo. No establece
> calidad semántica, uso externo, despliegue ni preparación para producción.

Cadencia convierte un objetivo escrito en sesiones semanales, con límites
explícitos de días, duración y tiempo total. La demo permite completar y
reajustar sesiones, inspeccionar las comprobaciones y descargar Markdown o
iCalendar. El planificador y las exportaciones siguen siendo deterministas y
locales.

## Evidencia local

Las pruebas del frontend verifican el planificador, los límites, la
replanificación, las exportaciones y la demo sin llamadas al proveedor. El
servicio Python valida entrada y salida con esquemas estrictos, usa respuestas
simuladas para las comprobaciones deterministas y conserva errores genéricos y
redacción segura. La guía de evaluación describe los denominadores y el
[snapshot de validación de Phase 1](PHASE1-VALIDATION.md).

La evaluación determinista recorre casos sintéticos mediante la ruta HTTP local
y un transporte simulado. Sus respuestas prefabricadas sirven para calibrar
controles, contratos, fallas y procedencia; no son evidencia de precisión,
relevancia o calidad del proveedor. Los metadatos de proveedor observados se
registran separados del modelo solicitado y los fixtures sin esos metadatos
mantienen ambos contadores vacíos.

## Límites actuales

La sesión vive en memoria del navegador y se pierde al recargar o cerrar la
página. La exportación es una copia, no una sincronización de calendario. El
modo con proveedor está desactivado por defecto y requiere configuración
explícita, credenciales fuera del repositorio y un límite positivo de intentos
compartido entre todos los casos y reintentos.

El guard de Python conserva las negativas directas para solicitudes médicas, de
ejercicio, financieras y legales. Permite las menciones de `dosis`/`dosage` en
análisis literario o lingüístico con una exclusión explícita de orientación de
salud, y `abogado`/`lawyer` en escritura de ficción sobre personajes, escenas,
diálogos o narrativa. Una señal de petición directa junto con una acción médica o
legal inequívoca en cualquier parte de la solicitud prevalece sobre una envoltura
literaria o ficticia. Python es la autoridad de alcance y devuelve el booleano
interno `scope_refused` para solicitudes enviadas al proveedor. La demo conserva
en `lib/routine.ts` un guard local con las mismas señales directas y excepciones
contextuales acotadas; `deepseek` usa el booleano validado y no infiere alcance
desde el texto de `Intent`. Ninguno de estos controles constituye una garantía
semántica de extremo a extremo.

No se han establecido calidad semántica, precisión del modelo, latencia
sostenida, coste real, usuarios, validación remota de CI, validación del
contenedor, operación desplegada ni preparación para producción. Tampoco se
realizaron llamadas reales al proveedor como parte de este snapshot.

## Próximas comprobaciones separadas

1. Mantener los paquetes sintéticos congelados como calibración de controles; sus
   grados no serían evidencia de calidad del proveedor.
2. Autorizar por separado una línea base real con un máximo positivo de
   intentos, registrar solicitudes y fallas, y someter sus respuestas a revisión
   humana de valor.
3. Verificar contenedor, autenticación de usuarios, cuotas, apagado y despliegue
   antes de cualquier uso externo.

Los cambios de esta fase están descritos en [AI-CONTRACT.md](AI-CONTRACT.md),
[PYTHON-SERVICE.md](PYTHON-SERVICE.md),
[PYTHON-VALIDATION.md](PYTHON-VALIDATION.md) y la
[guía de evaluación](../service/evals/README.md). No se generó ningún commit,
push, despliegue ni llamada real al proveedor para esta entrega.
