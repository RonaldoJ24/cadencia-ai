# Recorrido de Cadencia

Cadencia parte de una situación cotidiana: quieres practicar algo con constancia,
pero tu disponibilidad cambia. La página permite observar un reajuste antes de
configurar una rutina propia.

## Una semana en acción

El ejemplo contiene tres sesiones de inglés de 30 minutos. El lunes ya está
completado. Al marcar el martes como perdido, se ejecuta `replan`:

- Con disponibilidad de lunes a jueves, el miércoles está ocupado y el jueves
  queda libre: la sesión se reubica allí y el total activo sigue en 90 minutos.
- Con disponibilidad solo de lunes a miércoles, no existe otro hueco permitido:
  se conserva lo hecho, se muestra el límite y el total activo queda en 60 minutos.

El contenido de las prácticas está preparado. La planificación y sus
comprobaciones usan las mismas funciones del producto. La semana fija del
31 de agosto de 2026 permite reproducir ambos resultados y está identificada
en los detalles. No se ejecuta un modelo ni se guarda el estado al recargar.

## Planificar con tus datos

El formulario conserva objetivos, días, duración, tope, hora local y semana.
Al cargar la página selecciona el lunes de la semana local actual. Cambiar un
ejemplo mantiene la semana elegida. El resultado permite completar y reajustar
sesiones, revisar comprobaciones y exportar una copia.

## Entender las decisiones

«Cómo funciona» explica tres decisiones: respetar el tiempo disponible, separar
la propuesta de contenido de las reglas del calendario y conservar el trabajo
completado durante un reajuste. Cada explicación ofrece detalles y un enlace
a la implementación o sus pruebas.

El alcance visible coincide con el producto: sesión local, copias de calendario
y generación conectada opcional. Persistencia, sincronización y recordatorios
automáticos siguen fuera del alcance actual.
