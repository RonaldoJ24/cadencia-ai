# Dirección de mercado V2 de Cadencia

Estado: hipótesis de producto para validar. No es una estimación de mercado ni
una afirmación de tracción.

Cadencia es un producto en español que ayuda a convertir un objetivo difuso en
una rutina semanal que cabe, la lleva al calendario y usa check-ins para ajustar
el siguiente paso. La responsabilidad humana es privada y elegida. La promesa
es de seguimiento y organización, no de terapia, salud, finanzas, asesoría legal
ni coaching profesional.

## Beachhead

El primer segmento es **personas hispanohablantes que preparan una certificación
o desarrollan una habilidad profesional fuera de su horario laboral y quieren
sostener un plan semanal con una persona de confianza**.

Es una cuña concreta: tiene un resultado que se puede nombrar, sesiones de
estudio o práctica que pueden caber en bloques cortos, una necesidad razonable
de calendario y una razón clara para invitar a alguien. El uso para ejercicio,
tratamiento, dinero o decisiones legales queda fuera del segmento inicial por
los límites de seguridad ya definidos.

**Decisión de producto (inferencia):** empezar por esta cuña permite probar si
la combinación de conversación, límites explícitos, calendario y accountability
privado resuelve un trabajo completo sin necesitar un catálogo de hábitos o una
comunidad pública.

## Jobs to be done

Cuando tengo una meta profesional que compite con trabajo, familia y cansancio,
quiero decirla en español y responder sólo las preguntas necesarias para obtener
un plan semanal con días, minutos y un tope que yo pueda aceptar, para empezar
sin pasar otra tarde organizándome.

Cuando mi semana cambia, quiero registrar qué ocurrió, conservar lo que sí hice
y recibir una propuesta de ajuste que explique el cambio, para continuar sin
sentir que fallar una sesión invalida la meta.

Cuando necesito rendir cuentas, quiero compartir un resumen acotado con una
persona elegida, para tener una señal social sin publicar mi objetivo ni exponer
mis notas.

Cuando ya acepté el plan, quiero llevar sus sesiones a mi calendario con una
acción visible, para que el compromiso exista donde organizo mi tiempo y pueda
desconectarlo si deja de servirme.

El trabajo emocional asociado es recuperar sensación de control, reducir la
fricción de empezar y poder pedir apoyo sin convertir la meta en espectáculo.
Estas motivaciones son hipótesis para entrevistas y pruebas de uso, no datos
observados.

## Diferenciación que se debe probar

La propuesta se apoya en cuatro decisiones:

1. **Conversación antes del hábito:** la entrada empieza por intención y
   contexto, no por rellenar una lista de casillas.
2. **Límites que se pueden auditar:** la IA puede ayudar con lenguaje y pasos,
   pero el código manda sobre fechas, duración, tope, validación y exportación.
3. **Entrega en el calendario sin encierro:** el camino comienza con ICS y
   enlaces de un clic; la sincronización OAuth es una elección posterior y
   revocable.
4. **Accountability por consentimiento:** una persona de confianza recibe sólo
   el alcance elegido; no hay feed público ni red inventada.

**Inferencia competitiva:** Focusmate documenta un enlace por el que una amistad
puede elegir una sesión futura y un flujo breve de compromiso y revisión
([Invite Link](https://support.focusmate.com/en/articles/5567939-invite-link),
[What happens during a Focusmate session?](https://support.focusmate.com/en/articles/4044432-what-happens-during-a-focusmate-session-do-s-don-ts)).
Eso valida el patrón de un vínculo explícito, pero no demuestra que el segmento
de Cadencia pague por planificación conversacional en español. Coach.me
documenta objetivos, metas semanales, recordatorios, check-ins, privacidad,
comunidad y coaching ([Getting Started with Coach.me](https://support.coach.me/article/45-getting-started)).
La lectura de Cadencia es una hipótesis: competir sólo como otro rastreador de
hábitos sería débil; la diferencia debe aparecer antes del check-in, en el plan
que cabe y en el calendario, y después en una adaptación privada explicable.

No se copiarán nombres, interfaz, reglas sociales ni lenguaje de esos productos.
Las referencias sirven para delimitar el espacio de problemas, no para afirmar
paridad ni superioridad.

## Activación, retención y guardrails

Se deben instrumentar eventos de producto con IDs pseudónimos y sin guardar
prompts o reflexiones completas por defecto. Los porcentajes y objetivos se
definirán después de una línea base; aquí se fijan definiciones comparables.

| Señal                     | Definición operativa                                                                                                           | Por qué importa                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Inicio de intake          | Usuario inicia una conversación y llega a una propuesta o a una pregunta de aclaración válida.                                 | Mide si la promesa se entiende.                                |
| Activación primaria       | Usuario que empezó intake acepta una rutina y genera al menos una entrega visible (ICS o enlace de evento) en la misma sesión. | Une intención, plan y utilidad inmediata.                      |
| Activación profunda       | Usuario activado completa o marca el primer check-in de esa rutina dentro de su ventana prevista.                              | Comprueba que el plan se convierte en acción.                  |
| Retención semana 2        | Usuario activado vuelve a consultar la rutina, registrar un check-in o aceptar una adaptación durante la segunda semana.       | Mide continuidad sin exigir una nueva meta.                    |
| Retención semana 4        | Usuario activado conserva una rutina activa y registra actividad de progreso en la cuarta semana.                              | Distingue curiosidad inicial de un uso sostenido.              |
| Accountability consentido | Usuario crea un enlace, y la otra persona lo acepta dentro de su alcance y vigencia.                                           | Verifica el bucle humano sin contar invitaciones no aceptadas. |
| Salud de calendario       | Entregas que terminan en confirmación visible, con errores, duplicados, revocaciones y desconexiones separados.                | Evita llamar éxito a una escritura no comprobada.              |
| Guardrails                | Ediciones antes de aceptar, sesiones perdidas o reprogramadas, borrados, revocaciones y reportes de privacidad.                | Revela fricción y daño aunque suba el uso.                     |

El tablero debe separar demo determinista y proveedor IA, idioma y variante de
español, ICS/enlace/OAuth, rutina individual y rutina con conexión. No se
publicará una cifra de precisión o retención hasta tener denominador, ventana,
cohorte y revisión humana definidos.

## Hipótesis de precio y paquete

**Hipótesis:** comenzar con un nivel gratuito que permita una rutina activa,
ICS, enlaces de un clic y check-ins básicos; probar un nivel de suscripción
mensual para historial persistente, varias rutinas, adaptación acumulada,
controles de accountability y sincronización OAuth cuando esté disponible. El
precio debe probarse con entrevistas y una oferta real en moneda local; no se
fija aquí una cantidad inventada.

El producto no venderá datos de metas o reflexiones, ni usará anuncios dirigidos
basados en ellos. La sincronización y las conexiones humanas requieren un valor
comprensible antes de convertirse en motivo de pago. La primera prueba de
disposición a pagar debe comparar el paquete de continuidad (historial,
adaptación, varias rutinas) con el paquete de entrega (calendario y conexión),
sin hacer obligatorio exponer la agenda completa.

## Bucles de distribución

**Invitación privada:** una persona termina una rutina y comparte un enlace con
alcance explícito; la otra ve sólo la vista consentida y puede iniciar su propia
rutina si lo decide. El enlace invita a una acción concreta, no a una red.

**Artefacto de calendario:** el usuario descarga un ICS o abre un enlace de
evento y puede compartir voluntariamente la rutina junto con su contexto. El
artefacto debe contener sólo el texto que el usuario revisó, con una marca clara
de Cadencia si decide incluirla.

**Plantillas en español:** ejemplos para certificaciones y aprendizaje
profesional muestran cómo pasar de una intención a un plan con límite. Una
plantilla compartida lleva a un intake editable y no se presenta como consejo
experto ni como resultado garantizado.

**Bucle de continuidad:** el check-in semanal produce una explicación breve de
lo que cambió; el usuario puede conservarla, exportarla o compartirla con su
persona de confianza. El contenido completo permanece privado por defecto.

**Decisión de distribución (inferencia):** priorizar contenido y referencias de
personas que ya tienen una meta concreta reduce el costo de explicar un producto
nuevo. No se presupone tamaño de audiencia ni conversión; cada bucle requiere
una prueba con consentimiento y medición de activación.

## Riesgos y respuestas

| Riesgo                             | Señal temprana                                                                           | Respuesta de diseño o validación                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parecer otro habit tracker         | Usuarios saltan la conversación o sólo marcan sesiones.                                  | Medir comprensión del mensaje y mostrar primero el plan, la restricción y la explicación. Si no se percibe diferencia, no ampliar features de comunidad. |
| Planes que no caben                | Muchas ediciones antes de aceptar, conflictos o misses en la primera semana.             | Mantener restricciones visibles, pedir aclaración, replanificar de forma determinista y permitir reducir alcance sin castigo.                            |
| IA propone contenido inadecuado    | Rechazos, correcciones frecuentes o solicitudes fuera de alcance.                        | Esquema validado, demo/fallback, revisión humana opt-in, filtros de alcance y ningún poder del modelo sobre fechas o permisos.                           |
| Exposición de una meta sensible    | Revocaciones, enlaces reenviados o quejas de privacidad.                                 | Alcance mínimo, token opaco con expiración, vista previa, revocación inmediata, borrado y no feed público.                                               |
| OAuth frágil o demasiado invasivo  | Fallos de consentimiento, duplicados, tokens vencidos o desconexiones.                   | ICS y enlaces como fallback; adaptadores separados, permisos mínimos, idempotencia, pruebas con cuentas de prueba y estado visible.                      |
| Apple/CalDAV se confunden con sync | Usuarios esperan editar o recibir cambios al instante desde una suscripción.             | Etiquetar `subscription` como unidireccional, mostrar frescura desconocida y no prometer escritura; estudiar CalDAV aparte.                              |
| Accountability se vuelve presión   | Invitaciones no aceptadas, revocaciones o lenguaje de culpa.                             | Consentimiento reversible, check-ins neutrales, pausa, sin rachas obligatorias y sin mensajes no solicitados.                                            |
| Falta de efecto de red             | La persona no tiene a quién invitar o el enlace no se acepta.                            | El flujo individual debe ser útil; tratar la conexión como acelerador, no como requisito ni comunidad fabricada.                                         |
| Español insuficiente               | Traducciones literales, confusión entre variantes regionales o abandono en aclaraciones. | Empezar con español claro y locale explícito; revisar muestras con personas de la cuña antes de ampliar regionalismos.                                   |
| Scope de producto demasiado amplio | Solicitudes de salud, finanzas, legal, terapia o metas ilimitadas.                       | Mantener el segmento, rechazar o redirigir fuera de alcance y posponer nuevos dominios hasta revisión de seguridad.                                      |

## Fases y puertas de salida

### Ahora

El mensaje y la experiencia se prueban con intake en español, propuesta de
intención, plan determinista, ICS, enlace de un clic y un check-in simple. No se
prometen cuentas, OAuth, sincronización de fondo, pagos ni comunidad.

Puerta de salida: usuarios del beachhead pueden describir una meta, aceptar un
plan que respeta su tiempo, llevar al menos una sesión a su calendario y volver
a registrar un check-in; los errores no rompen la descarga ICS; y las entrevistas
confirman qué parte de la promesa entienden. La puerta se considera abierta sólo
cuando esas evidencias estén registradas, no por el diseño de la interfaz.

### Next

Se implementan persistencia e identidad, historial de check-ins, adaptación
explicable, enlaces privados con consentimiento y escritura OAuth de Google y
Microsoft sólo para eventos de Cadencia. Se mide activación primaria y profunda,
retención semana 2 y 4 y salud de conexiones/calendarios con cohortes definidas.

Puerta de salida: la ruta completa tiene recuperación de errores y revocación;
no crea duplicados ni envía a terceros sin consentimiento; el uso individual
funciona sin invitación; y la señal de retención y la disposición a pagar
justifican probar un paquete comercial. No se establece una cifra antes de
observar la línea base.

### Later

Se evalúan suscripción Apple, CalDAV, lectura filtrada de disponibilidad, más
variantes regionales, varias metas activas y funciones pagas adicionales. No se
construye un feed público ni un marketplace de coaches como atajo de crecimiento.

Puerta de salida: cada integración tiene pruebas con clientes reales o
representativos, límites de privacidad, recuperación ante revocación, demanda
repetida y una métrica de valor que supere el costo de soporte. Si la evidencia
no aparece, se mantiene el alcance actual y se mejora la rutina individual.
