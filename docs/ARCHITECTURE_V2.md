# Arquitectura V2 de Cadencia

Estado: decisión de diseño para una versión futura. La fuente técnica existente
es el prototipo V0 descrito en `docs/AI-CONTRACT.md` y `docs/ROADMAP.md`; este
documento no afirma que las capas futuras ya estén implementadas.

Cadencia V2 convierte una intención expresada en español en un ritmo semanal
que puede llegar al calendario, aprender de los check-ins y, si la persona lo
elige, compartirse con una persona de confianza. La unidad del producto sigue
siendo una rutina explicable, no una colección de hábitos aislados.

## Decisión central y límites

La frontera que no cambia es la siguiente:

| Parte                   | Puede hacer                                                                                                                                                                | No puede hacer                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| IA opcional             | Proponer una intención, pasos, preguntas de aclaración, variantes de contenido y una lectura de la reflexión del usuario.                                                  | Decidir fechas, horas, duración, tope semanal, estado de una sesión, permisos, destinatarios o exportaciones. No escribe en un calendario. |
| Código determinista     | Normalizar y validar restricciones; calcular fechas y duración; respetar días permitidos, zona horaria y tope semanal; replanificar; generar ICS y comprobar idempotencia. | Inventar el objetivo del usuario o aceptar una salida del modelo sin esquema y validación.                                                 |
| Usuario                 | Confirmar o editar la intención, resolver ambigüedades, aceptar cambios de rutina, elegir el calendario y autorizar conexiones.                                            | —                                                                                                                                          |
| Adaptador de calendario | Traducir un plan confirmado a un evento del proveedor y reportar éxito, revocación o error.                                                                                | Cambiar el plan canónico, enviar invitaciones a terceros o leer más datos de los autorizados.                                              |

El texto libre puede aportar contexto, pero los controles explícitos de días,
hora local, minutos por sesión, semana de referencia y tope semanal son la
fuente autoritativa. La IA devuelve contenido estructurado; el planificador
determinista es la única puerta que puede producir `Session`. `buildPlan`,
`replan`, `validateInput` y `toICS` conservan este contrato de V0 aunque en el
futuro reciban datos persistidos.

La conversación tampoco puede convertir una suposición en un compromiso. Si
faltan zona horaria, semana, disponibilidad o una restricción que afecta al
calendario, devuelve una pregunta con opciones y espera la respuesta. Si el
usuario no resuelve la ambigüedad, se conserva el estado
`needs_clarification`; no se agenda silenciosamente.

## Capas del sistema

Cada capa tiene una interfaz estrecha y datos versionados. Una capa posterior
puede fallar sin modificar la verdad de las capas anteriores: por ejemplo, un
fallo de calendario deja intacta la rutina y permite descargar el ICS.

| Capa                                  | Responsabilidad                                                                                                                                                                                        | Entrada y salida principal                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 1. Intake y aclaración conversacional | Recoger objetivo, resultado deseado, disponibilidad, duración, tope, zona horaria, preferencia de entrega y deseo de accountability. Detectar datos faltantes y presentar preguntas breves en español. | `ConversationTurn` → `Clarification[]` o `IntakeDraft`.              |
| 2. Intención y contenido              | Validar la propuesta de contenido (`title`, `goal`, `domain`, `steps`), conservar el texto que el usuario pueda revisar y producir variantes de pasos.                                                 | `IntakeDraft` → `IntentProposal` versionada, sin fechas.             |
| 3. Planificador determinista          | Convertir una intención aceptada y restricciones canónicas en sesiones, comprobaciones, conflictos y una explicación. Aplicar replanificación y límites sin depender del modelo.                       | `IntentProposal` + `PlanConstraints` → `RoutinePlan`.                |
| 4. Adaptadores de calendario          | Exponer exportación ICS, enlaces de evento y, más adelante, escritura OAuth. Mantener la identidad de eventos de Cadencia y separar capacidades de lectura, escritura y suscripción.                   | `CalendarEventDraft[]` → resultado de entrega y `CalendarLink`.      |
| 5. Progreso y adaptación              | Registrar estado de sesión y check-ins, ofrecer una revisión semanal y preparar una propuesta de ajuste. Los cambios que afectan fechas o límites pasan otra vez por el planificador.                  | `Session` + `CheckIn` → `AdaptationProposal` o rutina versionada.    |
| 6. Conexiones privadas                | Crear un enlace privado de accountability con alcance, consentimiento, expiración y revocación. Mostrar sólo el resumen que el propietario eligió.                                                     | `ConnectionInvite` → `Connection` aceptada, pendiente o revocada.    |
| 7. Persistencia e identidad           | Asociar datos a una cuenta, conservar versiones, gestionar zona horaria, sesión, exportación y borrado. Separar referencias a tokens de contenido de rutinas.                                          | Entidades y eventos versionados en D1 o equivalente.                 |
| 8. Observabilidad                     | Medir el flujo sin guardar prompts o reflexiones por defecto; auditar consentimiento, cambios, exportaciones, revocaciones y errores de proveedor.                                                     | `DomainEvent` sin contenido sensible → métricas, trazas y auditoría. |

El flujo nominal es:

```text
intake → aclaración → propuesta de intención → confirmación
       → planificador determinista → entrega / check-in
       → propuesta de adaptación → confirmación → nueva versión de rutina
```

El flujo de calendario y el de accountability son salidas optativas del mismo
plan confirmado. Ninguno puede saltarse la validación ni alterar el objetivo
sin una edición visible del usuario.

## Contratos entre capas

Estos contratos son de diseño; no implican crear tipos ni endpoints en V2 de
esta entrega.

```text
IntentProposal = {
  title: string,
  goal: string,
  domain: string,
  steps: string[],
  source: "demo" | "provider" | "user-edited",
  version: integer
}

PlanConstraints = {
  timezone: IANA timezone,
  weekStart: ISO date that is Monday,
  allowedWeekdays: unique integers 0..6,
  localStartTime: HH:mm,
  sessionMinutes: positive integer,
  weeklyCapMinutes: integer >= sessionMinutes
}

RoutinePlan = {
  routineId: ID,
  intent: IntentProposal,
  constraints: PlanConstraints,
  sessions: Session[],
  checks: DeterministicCheck[],
  conflicts: Conflict[]
}
```

La propuesta de IA no contiene `date`, `startDate`, `localStartTime`,
`sessionMinutes`, `weeklyCapMinutes`, identificadores de calendario ni
destinatarios. El planificador recalcula el resultado cuando cambia una
restricción y conserva `goal` salvo que el usuario lo edite. Una adaptación
puede cambiar el contenido o pedir una nueva restricción, pero no la aplica
hasta que la persona la acepta.

## Entrega al calendario

La escalera de calendario separa una copia portable de una escritura
autorizada:

### Ahora: ICS y enlaces de un clic

El ICS actual sigue siendo una descarga local de la semana confirmada. Mantiene
horas locales flotantes y el `UID` determinista de cada sesión; no representa
sincronización. Un enlace de un clic es un evento prellenado en la interfaz del
proveedor: la persona revisa y confirma allí. No requiere tokens, no puede
leer el calendario y no debe prometer que el evento seguirá los cambios de la
rutina.

Esta primera capa debe ofrecer una salida útil aunque no haya cuenta. Si un
enlace no es compatible con un cliente concreto, se conserva el ICS como
fallback. El proveedor seleccionado y el contenido a enviar se muestran antes
de abrir otra página.

### Después: escritura OAuth autorizada por el propietario

Google y Microsoft se implementan como adaptadores separados y sólo después de
tener identidad, almacenamiento seguro de tokens, consentimiento y una ruta de
desconexión. El flujo es:

1. La persona elige proveedor y calendario, ve el alcance solicitado y vuelve a
   Cadencia mediante un redirect con estado y protección contra replay.
2. Cadencia guarda sólo el token cifrado o una referencia a un almacén de
   secretos; nunca lo mezcla con la intención ni lo registra en eventos.
3. El usuario pulsa `Enviar al calendario` para la rutina o la sesión. Se crean
   o actualizan sólo eventos cuyo origen e identificador pertenecen a Cadencia.
4. El adaptador usa una clave de idempotencia y la versión de rutina para evitar
   duplicados. Un cambio o una cancelación conserva el historial de la sesión y
   reporta el resultado visible.
5. Desconectar revoca o invalida el vínculo, detiene nuevas escrituras y deja
   disponible la exportación local. Los eventos ya creados no se borran sin una
   acción explícita del propietario.

La API de Google representa un evento con título, inicio y fin, y documenta
`events.insert` para añadirlo al calendario; su guía también recomienda crear
credenciales OAuth y comprobar el acceso de escritura. Esto sustenta el
adaptador de escritura, pero no autoriza a Cadencia a pedir ese permiso en la
versión actual: [Google Calendar API overview](https://developers.google.com/workspace/calendar/api/guides/overview) y
[Create events en Google Calendar](https://developers.google.com/workspace/calendar/api/guides/create-events).
El flujo OAuth de servidor de Google está diseñado para consentimiento del
usuario, tokens de acceso y refresh tokens, por lo que la implementación debe
mantener estado y usar librerías mantenidas: [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server).

Microsoft Graph expone crear, leer, actualizar y borrar eventos. Para crear un
evento en el calendario de una persona exige un bearer token y, en el permiso
delegado, `Calendars.ReadWrite`; el alcance se debe reducir al mínimo que el
adaptador necesite y revisar en la configuración de la aplicación. Fuentes
primarias: [Calendar overview de Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/resources/calendar-overview?view=graph-rest-1.0) y
[Create event de Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0).

La decisión de producto es empezar con escritura explícita de eventos de
Cadencia y posponer la lectura completa de la agenda. Leer disponibilidad puede
ser una capacidad posterior, con consentimiento separado y filtrado de datos;
no es requisito para probar la entrega de una rutina.

### Separación Apple, suscripciones y CalDAV

Apple documenta que una persona agrega una suscripción introduciendo la
dirección web de un calendario en Calendar y puede cancelar la suscripción
después: [Add calendar subscriptions in iCloud](https://support.apple.com/en-us/102301).
La inferencia de diseño es que una URL ICS publicada por Cadencia ofrece una
vista de suscripción que el cliente Apple consulta, pero no equivale a una
escritura OAuth, a un identificador de evento editable por Cadencia ni a una
confirmación inmediata en todos los dispositivos. Por eso:

- `apple-subscription` es una capacidad de publicación unidireccional, con URL
  revocable y sin promesa de frecuencia de actualización.
- `caldav` es otro adaptador, dependiente del servidor y de sus métodos de
  autenticación; no se presenta como sinónimo de Apple ni se incluye en el
  OAuth de Google o Microsoft.
- Ninguna suscripción se considera confirmación de que la persona vio,
  aceptó o completó una sesión. El estado canónico permanece en Cadencia.

## Check-ins y adaptación

Una sesión tiene estados explícitos: `planned`, `done`, `skipped`, `missed` o
`rescheduled`. El usuario puede marcar una sesión, omitirla, explicar el
obstáculo de forma opcional y pedir una revisión. No hay racha obligatoria ni
penalización.

El sistema propone un check-in posterior a una sesión y una revisión de la
semana, pero la cadencia exacta queda en una política versionada y configurable.
La política determinista puede conservar sesiones hechas, calcular minutos
realizados, detectar que el tope ya está lleno y ofrecer alternativas dentro de
los días permitidos. La IA puede proponer una variación de paso o resumir la
reflexión; el código decide si una opción es válida y el usuario confirma
cualquier cambio relevante.

Un check-in nunca reescribe una sesión completada. Una replanificación crea una
nueva versión de la rutina o deja un conflicto visible si no existe un día
posterior que cumpla las restricciones. El historial permite explicar por qué
cambió el siguiente plan.

## Accountability privado

La primera experiencia humana es un enlace privado de una rutina concreta, no
un directorio de personas. El propietario elige qué se comparte: por ejemplo,
nombre de la rutina, próximo compromiso, estado agregado y una nota que haya
revisado. El contenido de pasos, reflexiones y calendario completo permanece
oculto salvo selección expresa.

El enlace usa un identificador opaco almacenado como hash, tiene alcance,
expiración y revocación, y muestra al propietario la vista que verá la otra
persona antes de compartir. La aceptación registra consentimiento y la
revocación corta el acceso futuro. Una conexión pendiente no puede ver check-ins
ni enviar mensajes.

Cadencia V2 excluye deliberadamente:

- feed público, perfiles buscables o ranking;
- scraping de contactos o importación de libretas de direcciones;
- mensajes o recordatorios a terceros sin invitación y consentimiento;
- comunidad, coincidencias o testimonios fabricados;
- compartir automáticamente el texto de una conversación con otra persona.

El referente Focusmate muestra que un enlace puede permitir que una amistad
elija una sesión futura y que la sesión puede tener una breve declaración de
compromiso al inicio y una revisión al cierre: [Invite Link de Focusmate](https://support.focusmate.com/en/articles/5567939-invite-link) y
[What happens during a Focusmate session?](https://support.focusmate.com/en/articles/4044432-what-happens-during-a-focusmate-session-do-s-don-ts).
Cadencia toma esa señal como evidencia de que el vínculo explícito puede ser
útil; la decisión propia es limitarlo a rutinas en español, con alcance privado
y consentimiento reversible.

## Persistencia e identidad

La persistencia futura puede usar D1 o un equivalente relacional. La siguiente
lista es un modelo mínimo de diseño, no un esquema de migración:

| Entidad        | Campos mínimos                                                                                                                                                                    | Relación e invariantes                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `User`         | `id`, `locale` (por defecto `es`), `timezone` IANA, `authRef`, `createdAt`, `deletedAt` opcional                                                                                  | Un propietario puede tener varias metas. `authRef` apunta al proveedor de identidad; no contiene tokens de calendario.                 |
| `Goal`         | `id`, `userId`, `title`, `desiredOutcome`, `domain`, `status`, `createdAt`, `updatedAt`                                                                                           | Pertenece a un usuario. Su objetivo es estable entre versiones de rutina hasta que el usuario lo edita.                                |
| `Routine`      | `id`, `goalId`, `version`, `intentSnapshot`, `constraints`, `status`, `source`, `createdAt`, `updatedAt`                                                                          | Cada versión conserva intención y restricciones aceptadas; las fechas son producto del planificador, no del modelo.                    |
| `Session`      | `id`, `routineId`, `sequence`, `localDate`, `localStartTime`, `timezone`, `durationMinutes`, `content`, `status`, `completedAt`, `supersedesSessionId` opcional                   | Pertenece a una rutina. Sus minutos, fecha y estado pasan por validación determinista; una sesión hecha es inmutable en lo esencial.   |
| `CheckIn`      | `id`, `userId`, `routineId`, `sessionId` opcional, `kind`, `status`, `response` opcional, `createdAt`                                                                             | Registra respuesta o ausencia de respuesta. El texto libre se minimiza, cifra y retiene con política explícita.                        |
| `Connection`   | `id`, `ownerUserId`, `recipientUserId` opcional, `inviteTokenHash`, `scope`, `status`, `consentAt`, `expiresAt`, `revokedAt`                                                      | Sólo el propietario puede crear o revocar. `pending` no concede acceso; `accepted` sólo expone el alcance elegido.                     |
| `CalendarLink` | `id`, `userId`, `routineId` opcional, `provider`, `capability`, `externalCalendarId` opcional, `externalEventMap` opcional, `tokenRef` opcional, `scopes`, `status`, `lastSyncAt` | Distingue `ics`, `google`, `microsoft`, `apple-subscription` y `caldav`. Un vínculo OAuth no autoriza eventos que no sean de Cadencia. |

Todas las entidades llevan ID opaco y timestamps. La entrada de calendario se
interpreta en la zona horaria IANA del usuario y se conserva la fecha local
original junto con el instante UTC cuando exista. La eliminación debe permitir
exportar antes de borrar y revocar conexiones y credenciales; la política
concreta de retención se decide antes de abrir persistencia pública.

### Eventos de dominio

Un sobre `DomainEvent` contiene `id`, `type`, `occurredAt`, `actor`,
`aggregateType`, `aggregateId`, `userId`, `schemaVersion` y metadatos mínimos.
Por defecto no incluye prompt, respuesta completa del modelo, reflexión o
contenido de calendario.

Los eventos clave son:

```text
user.created / user.deleted
intake.started / clarification.requested / clarification.resolved
intent.proposed / intent.edited / intent.accepted
routine.created / routine.versioned / routine.paused / routine.resumed
session.scheduled / session.rescheduled / session.completed
session.skipped / session.missed
checkin.requested / checkin.submitted / adaptation.proposed / adaptation.accepted
calendar.delivery_started / calendar.exported
calendar.linked / calendar.event_created / calendar.event_updated
calendar.event_deleted / calendar.sync_failed / calendar.disconnected
connection.invited / connection.accepted / connection.revoked
consent.granted / consent.revoked / data.exported / data.deleted
```

Los nombres son contrato de analítica y auditoría, no una promesa de que todos
los consumidores existan en V0. Los reintentos de proveedor deben ser seguros
frente a duplicados y llevar `correlationId` y `idempotencyKey` sin exponer
contenido personal.

## Observabilidad y controles

- **Contenido y modelos:** guardar modelo, versión de prompt y resultado sólo en
  una traza de evaluación opt-in y separada. Producción registra clase de error,
  latencia y versión de esquema, no el prompt completo.
- **Planificación:** auditar entrada canónica, versión de política, checks y
  conflicto; poder reproducir el plan con un `routineId` sin llamar de nuevo a
  la IA.
- **Calendarios:** registrar proveedor, operación, estado HTTP normalizado,
  reintentos e identificador externo cifrado o minimizado. Nunca registrar
  access tokens ni incluir eventos ajenos en métricas de negocio.
- **Consentimiento:** auditar quién otorgó, qué alcance, cuándo expiró y cuándo
  revocó tanto OAuth como una conexión humana.
- **Seguridad operativa:** aplicar límites de tamaño y tiempo ya existentes,
  protección CSRF en rutas de cuenta, rate limits antes de abrir generación
  pública y borrado verificable.

## Fases y puertas de salida

### Ahora

Se conserva el flujo V0: intake explícito, propuesta de contenido, planificador
determinista, replanificación, exportación ICS y explicación de checks. Esta
entrega añade un enlace de Google Calendar para la sesión seleccionada y texto
compartible, ambos sin cuenta ni token y claramente marcados como copias. No hay
OAuth, sincronización en segundo plano, cuentas persistentes ni mensajes a
terceros.

Puerta de salida: con solicitudes ficticias en español, cada rutina respeta días,
hora local, duración y tope; el usuario puede inspeccionar y corregir la
intención; ICS y enlaces nunca escriben sin una acción visible; y un fallo de
enlace conserva el ICS. La medición se registra como evidencia cuando se ejecute,
no se presume por la existencia del diseño.

### Next

Se priorizan identidad y persistencia, check-ins, versiones de rutina, enlaces
privados y escritura OAuth para Google y Microsoft. El primer adaptador OAuth
escribe únicamente eventos de Cadencia después de una acción explícita; la
lectura completa de agenda queda separada.

Puerta de salida: una prueba con cuentas de prueba permite autorizar, conectar,
crear, actualizar, desconectar y repetir una entrega sin duplicados; revocar
detiene nuevas escrituras; los errores y conflictos son recuperables; una
conexión humana sólo funciona después de aceptar el alcance; y el usuario puede
eliminar sus datos y ver los efectos de esa acción.

### Later

Se estudian publicación de suscripción Apple, compatibilidad CalDAV, lectura
filtrada de disponibilidad, mejores políticas de adaptación y planes pagos.
Cada capacidad mantiene un adaptador separado y una etiqueta clara de
`subscription`, `read` o `write`.

Puerta de salida: evidencia de demanda por la capacidad, revisión de privacidad
y seguridad, pruebas con clientes y servidores representativos, recuperación de
revocaciones y documentación de la frescura de datos. Si no se puede explicar
qué controla Cadencia y qué controla el proveedor, la capacidad permanece fuera
de alcance.
