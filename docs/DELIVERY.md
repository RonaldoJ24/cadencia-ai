# Entrega inicial de Cadencia

Cadencia convierte un objetivo escrito en sesiones semanales, con límites explícitos de días, duración y tiempo total. La demo permite completar y reajustar sesiones, inspeccionar las comprobaciones y descargar Markdown o iCalendar. Es un prototipo de producto, no una afirmación de preparación para producción.

## Orquestación realizada

Se utilizaron cuatro agentes `gpt-5.6-luna` con esfuerzo `max`, verificados en sus metadatos de ejecución:

| Responsabilidad | Entrega |
| --- | --- |
| Concepto y difusión | Concepto, roadmap, investigación oficial y narrativa de lanzamiento |
| Motor | Planificador, adaptador DeepSeek, endpoint, pruebas y contrato de IA |
| Experiencia | Interfaz, estados, exportaciones, configuración y CI |
| Imagen social | Una pieza original de marca |

El agente principal definió los contratos, integró los archivos, inspeccionó el código y repitió las comprobaciones. El trabajo no reutilizó código, datos o diseños de otros proyectos del usuario. El historial corresponde al trabajo realizado; no se fabricaron fechas ni actividad pasada.

## Evidencia reproducible

`npm test` ejecuta 20 pruebas: 19 casos del motor/proveedor/endpoint y una matriz adicional que recorre 1,524 combinaciones de días, duración y presupuesto. La matriz verifica límites, reproducibilidad, conservación de sesiones completadas, cambios inmutables y exportación. Los mocks comprueban el contrato del proveedor y sus errores; no envían solicitudes reales.

`npm run typecheck` y `npm run build` verifican la integración. La revisión de dependencias con `npm audit` no reportó vulnerabilidades al preparar esta entrega. Las comprobaciones HTTP locales verificaron generación demo, rechazo de origen cruzado, entrada inválida y proveedor deshabilitado. Una prueba autorizada con `deepseek-v4-flash` el 30 de agosto de 2026 verificó también el adaptador y la ruta completa: la API respondió 200, generó una intención válida en español y el plan respetó dos sesiones de 45 minutos, el tope de 90 minutos y cuatro comprobaciones deterministas. No se realizó una prueba automatizada de interacción en navegador ni una importación manual en una aplicación de calendario.

## Límites honestos de la IA

La demo usa ejemplos deterministas; no es una respuesta de un modelo. La prueba viva anterior es un caso sintético de funcionamiento, no una métrica de precisión, calidad, latencia sostenida o coste. Los límites de horario se introducen en controles; extraerlos de lenguaje libre y solicitar aclaraciones es el siguiente hito.

La sesión vive sólo en memoria del navegador. El estado se pierde al recargar o cerrar la página. La exportación es una copia, no una sincronización de calendario. El modo vivo permanece desactivado por defecto; antes de abrirlo al público necesita autenticación y límites de uso.

## Siguiente avance

1. Ampliar la evaluación opt-in del modelo real con peticiones ficticias en español y publicar los resultados por separado.
2. Extraer restricciones desde texto libre y pedir aclaración cuando sean ambiguas.
3. Probar el flujo con usuarios, corregir fricción y preparar una versión pública con el modo vivo protegido o desactivado.
