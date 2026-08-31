# Capa de insights de Cadencia

`buildInsights(plan)` explica el plan semanal que ya existe. Es una función
pura: no llama modelos, no guarda datos y no modifica el `RoutinePlan`.

## Campos

- `capacity` compara los días elegidos con las sesiones activas del plan y
  muestra los minutos semanales frente al tope configurado. Una sesión marcada
  como `missed` deja de contar como tiempo disponible; las sesiones `planned` y
  `done` sí forman parte de la cadencia.
- `fourWeekProjection` suma los minutos de las sesiones activas de esta semana
  y multiplica el total por cuatro. Describe tiempo de práctica disponible, no
  éxito, porcentaje, probabilidad ni resultado esperado.
- `clarifyingQuestions` contiene como máximo tres preguntas. Se inspecciona
  únicamente el texto libre, con heurísticas acotadas de palabras y frases.
  Reconoce horizontes comunes como «esta semana», «en cuatro semanas», fechas y
  meses, y señales de nivel como «desde cero», «principiante», «intermedio» o
  «avanzado». Por dominio puede preguntar por nivel y evidencia (aprendizaje),
  formato y muestra (creatividad), o resultado y límites (trabajo general).
  Cuando el plan quedó fuera de alcance y tiene cero sesiones, no pide contexto
  adicional.
- `successSignals` ofrece dos o tres señales observables en español, elegidas
  por dominio. Para un plan sin sesiones declara que todavía no hay práctica
  que observar.
- `recommendation` señala primero el desfase entre días elegidos y sesiones
  que caben en el tope. Si no hay desfase, propone un check-in breve al cierre
  de la semana; un plan sin sesiones se expresa como tal.

La proyección usa la cadencia real del plan (`sesiones activas × minutos de
cada sesión × 4`), mientras que la capacidad programable se calcula como
`floor(weeklyMinutes / sessionMinutes)`. Estas cifras explican restricciones;
no predicen desempeño ni sustituyen orientación médica, de ejercicio,
financiera o legal.
