# Investigación breve

Fuentes consultadas el 30 de agosto de 2026; sólo páginas oficiales.

## Observaciones competitivas

1. **Motion.** Su calendario de IA prioriza tareas, programa según duración, fechas límite y prioridades, y reajusta el plan cuando hay cambios. [Página oficial de AI Calendar](https://www.usemotion.com/features/ai-calendar). Cadencia toma el principio de hacer visibles las restricciones, pero reduce el alcance a una rutina semanal sin calendario conectado y con un tope explícito.

2. **Reclaim.** Sus Habits usan preferencias, reglas y prioridades para reservar tiempo flexible y reprogramarlo ante conflictos. [Guía oficial de Habits](https://help.reclaim.ai/en/articles/4129152-habits-overview-auto-schedule-flexible-time-for-your-routines). Cadencia se diferencia al permitir revisar la intención y conservar el objetivo después de cambiar una restricción, con exportación local.

3. **Todoist Assist.** Su conjunto de funciones inteligentes convierte tareas dispersas en planes, acepta filtros en lenguaje natural y puede dividir tareas en subtareas. [Página oficial en español](https://www.todoist.com/es/todoist-assist). Cadencia explora el paso anterior: transformar una petición breve en una rutina acotada, validada y explicada, sin cuenta ni integración en V0.

## Evaluación de IA sin maquillaje

Los fixtures son solicitudes ficticias en español. En V0 comprueban forma de intención, restricciones, reproducibilidad, preservación del objetivo y claridad; se reportan `n`, fallos y ejemplos. La demo sólo prueba el motor determinista; no miden DeepSeek ni extraen días desde lenguaje natural.

El adaptador server-side de DeepSeek ya está implementado, pero permanece desactivado hasta configurar y activar el proveedor. La evaluación viva será opt-in: registrará modelo, fecha, prompt, muestra y revisión humana en una tabla distinta. Fixtures no son medición del modelo; hasta ejecutar esa muestra no se afirma calidad de IA.
