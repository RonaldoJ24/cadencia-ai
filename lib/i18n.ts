export type Language = 'en' | 'es';

export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGE_STORAGE_KEY = 'cadencia-language';

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'es';
}

/** Missing preferences intentionally normalize to the cold-start English locale. */
export function normalizeLanguage(value: unknown): Language {
  if (value === undefined) return DEFAULT_LANGUAGE;
  if (isLanguage(value)) return value;
  throw new Error('language must be en or es');
}

export function languageFrom(value: unknown): Language {
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

export function isCurrentRequestGeneration(
  currentGeneration: number,
  requestGeneration: number,
): boolean {
  return currentGeneration === requestGeneration;
}

export type Copy = {
  dateLocale: string;
  dayNames: readonly string[];
  dayShort: readonly string[];
  status: Readonly<Record<'planned' | 'done' | 'missed', string>>;
  domain: Readonly<Record<'learning' | 'creative' | 'general', string>>;
  api: {
    invalidOrigin: string;
    invalidBody: string;
    bodyObject: string;
    invalidInput: string;
    invalidMode: string;
    notConfigured: string;
    providerError: string;
    rateLimited: (retryAfterSec?: number) => string;
    visitorQuotaExceeded: string;
    globalQuotaExceeded: string;
    visitorConcurrentLimit: string;
    globalConcurrentLimit: string;
    limitsNotConfigured: string;
  };
  routine: {
    scopeTitle: string;
    scopeGoal: string;
    scopeStepTitle: string;
    scopeStepInstructions: string;
    scopeWarning: string;
    capacityWarning: (scheduled: number, selected: number) => string;
    noFreeDayWarning: string;
    budgetWarning: string;
    sessionPrefix: (index: number) => string;
    learningDeliverable: (index: number) => string;
    creativeDeliverable: (index: number) => string;
    generalDeliverable: (index: number) => string;
    sessionInstructions: (index: number, count: number) => string;
    doneWhen: (minutes: number) => string;
    demoSource: string;
    liveSource: string;
    explanation: (count: number, activeMinutes: number, weeklyMinutes: number) => string;
    replanReplacement: (missedDate: string, replacementDate: string) => string;
    replanNoReplacement: (missedDate: string, reason: string) => string;
    notFound: string;
    alreadyMissed: string;
    cannotReplanDone: string;
    cannotCompleteMissed: string;
  };
  ui: {
    languageSelector: string;
    languageEnglish: string;
    languageSpanish: string;
    brandNote: string;
    liveMode: string;
    demoMode: string;
    homeAria: string;
    rhythmMap: string;
    sessionsInDays: (sessions: number, days: number) => string;
    sampleKicker: string;
    sampleTitle: string;
    sampleGoal: string;
    demoTag: string;
    weeklyRhythm: string;
    sessionCount: (count: number, minutes: number) => string;
    sampleRhythmMap: string;
    sampleSessions: string;
    sampleDisclaimer: string;
    sampleFooter: string;
    reset: string;
    stale: string;
    warningHeading: string;
    insightLabel: string;
    insightTitle: string;
    insightHorizon: string;
    nextDecision: string;
    refinePlan: string;
    successSignals: string;
    planProgress: (done: number, total: number) => string;
    localTime: string;
    routineSessions: string;
    emptyPlan: string;
    decisionSummary: string;
    understoodIntent: string;
    deterministicChecks: string;
    liveHonesty: string;
    demoHonesty: string;
    calendarCompanion: string;
    calendarCompanionHelp: string;
    addGoogle: string;
    downloadMarkdown: string;
    downloadIcs: string;
    downloadMarkdownFilename: string;
    downloadIcsFilename: string;
    share: string;
    addGoogleTitle: string;
    downloadMarkdownTitle: string;
    downloadIcsTitle: string;
    selectedSession: string;
    timedAgenda: string;
    deliverable: string;
    doneWhen: string;
    markDone: string;
    replan: string;
    doneCopy: string;
    missedWithWarning: string;
    missedReplanned: string;
    staleDetail: string;
    heroEyebrow: string;
    heroTitleFirst: string;
    heroTitleSecond: string;
    intro: string;
    goalLabel: string;
    goalHelp: string;
    examples: string;
    daySectionLabel: string;
    daySectionHelp: string;
    availableDays: string;
    sessionMinutes: string;
    weeklyCap: string;
    weekStart: string;
    weekStartHint: string;
    localTimeField: string;
    capacityOver: (minutes: number) => string;
    capacityWithin: (minutes: number) => string;
    authority: string;
    contentProposer: string;
    deterministicLimits: string;
    localDemo: string;
    localDemoHelp: string;
    connectedAi: string;
    deepseekOptional: string;
    providerDisabled: string;
    liveDisabledHelp: string;
    liveWarning: string;
    enableLiveTitle: string;
    createRoutine: string;
    creating: string;
    closeError: string;
    weekView: string;
    planIndex: string;
    sampleIndex: string;
    noProvider: string;
    requestError: string;
    createError: string;
    failureReference: string;
    updateError: string;
    calendarError: string;
    shareSuccess: string;
    copySuccess: string;
    shareError: string;
    waitSeconds?: (seconds: string | number) => string;
  };
  export: {
    objective: string;
    agenda: string;
    deliverable: string;
    doneWhen: string;
    cadence: string;
    perSession: string;
    perWeek: string;
    scheduled: string;
    noScheduled: string;
    modeDemo: string;
    modeLive: string;
    sessions: string;
    checks: string;
    warnings: string;
    planned: string;
    done: string;
    missed: string;
    icsProductId: string;
  };
};

const english: Copy = {
  dateLocale: 'en-US',
  dayNames: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  dayShort: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  status: { planned: 'Planned', done: 'Done', missed: 'Missed' },
  domain: { learning: 'Learning', creative: 'Creative practice', general: 'General' },
  api: {
    invalidOrigin: 'Origin not allowed.',
    invalidBody: 'The JSON body is invalid or exceeds the limit.',
    bodyObject: 'The JSON body must be an object.',
    invalidInput: 'The routine data is invalid.',
    invalidMode: 'The routine mode is invalid.',
    notConfigured: 'Live AI is not configured.',
    providerError: 'The AI provider is not available.',
    rateLimited: (retryAfterSec?: number) =>
      retryAfterSec
        ? `Too many requests. Please wait ${retryAfterSec} second${retryAfterSec === 1 ? '' : 's'} before trying again.`
        : 'Too many requests. Please wait a moment before trying again.',
    visitorQuotaExceeded: 'Daily Connected AI limit reached (5 routines/day). You can continue using Local Demo mode.',
    globalQuotaExceeded: 'Daily global capacity reached for Connected AI. Please try again tomorrow or use Local Demo mode.',
    visitorConcurrentLimit: 'A generation is already in progress for your connection. Please wait for it to finish.',
    globalConcurrentLimit: 'Service is temporarily busy with too many requests. Please try again shortly.',
    limitsNotConfigured: 'Service rate limits are not configured.',
  },
  routine: {
    scopeTitle: 'Out-of-scope request',
    scopeGoal: 'Cadencia organizes learning, creative practice, and general personal work; it does not provide medical, exercise, financial, or legal advice.',
    scopeStepTitle: 'Reframe the goal',
    scopeStepInstructions: 'Ask for a learning, creative, or general organization routine without specialized advice.',
    scopeWarning: 'This request is out of scope; Cadencia does not provide medical, exercise, financial, or legal advice.',
    capacityWarning: (scheduled, selected) => `The weekly cap allows ${scheduled} of ${selected} selected days; some days were left without a session.`,
    noFreeDayWarning: 'There is no allowed, free day after the missed session within this week; no additional session was created.',
    budgetWarning: 'The weekly cap leaves no minutes to replan the missed session; no additional session was created.',
    sessionPrefix: (index) => `Session ${index}: `,
    learningDeliverable: (index) => `One dated piece of evidence from session ${index}: an exercise, explanation, or sample you can review.`,
    creativeDeliverable: (index) => `One dated, comparable version produced in session ${index}.`,
    generalDeliverable: (index) => `One concrete, reviewable result from session ${index}.`,
    sessionInstructions: (index, count) => `Complete session ${index} of ${count} with one visible piece of evidence at the close.`,
    doneWhen: (minutes) => `The ${minutes} minutes are distributed in the agenda, the deliverable exists, and the next step is written down.`,
    demoSource: 'The content is a deterministic demo output.',
    liveSource: 'The content was proposed by DeepSeek and the calendar was validated deterministically.',
    explanation: (count, activeMinutes, weeklyMinutes) => `${count} session${count === 1 ? '' : 's'} use ${activeMinutes} of the ${weeklyMinutes} min weekly cap; the selected days and time were preserved.`,
    replanReplacement: (missedDate, replacementDate) => `The session on ${missedDate} was marked missed and replanned for ${replacementDate}.`,
    replanNoReplacement: (missedDate, reason) => `The session on ${missedDate} was marked missed, but ${reason.toLowerCase()}`,
    notFound: 'Session not found.',
    alreadyMissed: 'The session is already marked as missed.',
    cannotReplanDone: 'A completed session cannot be replanned.',
    cannotCompleteMissed: 'A missed session cannot be marked complete.',
  },
  ui: {
    languageSelector: 'Language',
    languageEnglish: 'English',
    languageSpanish: 'Spanish',
    brandNote: 'routine compiler',
    liveMode: 'Live AI · server',
    demoMode: 'Local demo · no model',
    homeAria: 'Cadencia, home',
    rhythmMap: 'Weekly session map',
    sessionsInDays: (sessions, days) => `${sessions} session${sessions === 1 ? '' : 's'} across ${days} available day${days === 1 ? '' : 's'}.`,
    sampleKicker: 'Local sample',
    sampleTitle: 'English for interviews',
    sampleGoal: 'Confidence to answer without translating every sentence.',
    demoTag: 'Demo',
    weeklyRhythm: 'Weekly rhythm',
    sessionCount: (count, minutes) => `${count} session${count === 1 ? '' : 's'} · ${minutes} min`,
    sampleRhythmMap: 'Sample weekly session map',
    sampleSessions: 'Sample sessions',
    sampleDisclaimer: 'Example structure. Generate a routine to see it with your data.',
    sampleFooter: 'Four short sessions, one clear goal.',
    reset: 'Back to sample',
    stale: 'You changed a condition. This view keeps the previous plan until you regenerate it.',
    warningHeading: 'Something to review',
    insightLabel: 'Advanced reading',
    insightTitle: 'What this rhythm makes possible',
    insightHorizon: '4 weeks',
    nextDecision: 'Next decision',
    refinePlan: 'Answer in my request',
    successSignals: 'Progress signals',
    planProgress: (done, total) => `${done} of ${total} completed`,
    localTime: 'local time',
    routineSessions: 'Routine sessions',
    emptyPlan: 'No sessions fit these limits yet.',
    decisionSummary: 'How it was decided',
    understoodIntent: 'Understood intention',
    deterministicChecks: 'Deterministic checks',
    liveHonesty: 'AI proposed the intention; Cadencia checked the dates, days, and time before showing it.',
    demoHonesty: 'This output was built locally with deterministic rules. It is not an AI response.',
    calendarCompanion: 'Calendar and follow-through',
    calendarCompanionHelp: 'One-time copies; changes are not synchronized.',
    addGoogle: 'Google · session',
    downloadMarkdown: 'Summary .md',
    downloadIcs: 'Apple / Outlook · routine',
    downloadMarkdownFilename: 'cadencia-routine.md',
    downloadIcsFilename: 'cadencia-routine.ics',
    share: 'Share',
    addGoogleTitle: 'Add the selected session to Google Calendar',
    downloadMarkdownTitle: 'Download a routine summary',
    downloadIcsTitle: 'Download the full routine as ICS',
    selectedSession: 'Selected session',
    timedAgenda: 'Timed agenda',
    deliverable: 'Deliverable',
    doneWhen: 'Done when',
    markDone: 'Mark complete',
    replan: 'Could not make it, replan',
    doneCopy: 'Done. Your goal stays intact.',
    missedWithWarning: 'Marked missed; review the plan notice.',
    missedReplanned: 'Replanned while keeping completed sessions.',
    staleDetail: 'Regenerate the routine to edit a session with your new limits.',
    heroEyebrow: 'Your intention → one possible week',
    heroTitleFirst: 'Give a goal',
    heroTitleSecond: 'a rhythm.',
    intro: 'Write what you want to sustain. Cadencia turns it into sessions that genuinely fit your week.',
    goalLabel: 'What do you want to make consistent?',
    goalHelp: 'Include your current level, the result you want, and any important resource or limit.',
    examples: 'Try',
    daySectionLabel: 'Choose your pulses',
    daySectionHelp: 'Your days have the final say.',
    availableDays: 'Available days',
    sessionMinutes: 'Minutes per session',
    weeklyCap: 'Weekly cap',
    weekStart: 'Week starting (Monday)',
    weekStartHint: 'Week starting Monday',
    localTimeField: 'Local time',
    capacityOver: (minutes) => `Your days would use ${minutes} min; the cap may reduce sessions.`,
    capacityWithin: (minutes) => `There is room for ${minutes} min with this selection.`,
    authority: 'Selected days, minutes, time, and cap override the text; the week must start on Monday.',
    contentProposer: 'Who proposes the content',
    deterministicLimits: 'Your limits remain deterministic.',
    localDemo: 'Local demo',
    localDemoHelp: 'Deterministic output, no model.',
    connectedAi: 'Connected AI',
    deepseekOptional: 'Optional DeepSeek.',
    providerDisabled: 'Provider not enabled.',
    liveDisabledHelp: 'Connected AI is disabled: the provider is not enabled or configured here.',
    liveWarning: 'When created, your request will be sent to DeepSeek; avoid sensitive data and consider possible costs.',
    enableLiveTitle: 'Connect the optional backend and configure a key to enable live AI.',
    createRoutine: 'Create my routine',
    creating: 'Creating…',
    closeError: 'Close error',
    weekView: 'Week view',
    planIndex: 'PLAN / 01',
    sampleIndex: 'SAMPLE / 01',
    noProvider: 'We could not connect to the AI provider.',
    requestError: 'We could not create this routine.',
    createError: 'We could not create this routine.',
    failureReference: 'Reference',
    updateError: 'We could not update this routine.',
    calendarError: 'We could not prepare the calendar event.',
    shareSuccess: 'Routine shared.',
    copySuccess: 'Routine copied to share.',
    shareError: 'We could not share the routine in this browser.',
    waitSeconds: (seconds: string | number) => `Wait ${seconds}s before retrying.`,
  },
  export: {
    objective: 'Objective',
    agenda: 'Agenda',
    deliverable: 'Deliverable',
    doneWhen: 'Done when',
    cadence: 'Cadence',
    perSession: 'min per session',
    perWeek: 'min per week',
    scheduled: 'Scheduled sessions:',
    noScheduled: 'No sessions scheduled.',
    modeDemo: 'Demo · deterministic sample output',
    modeLive: 'Live AI · optional DeepSeek provider',
    sessions: 'Sessions',
    checks: 'Checks',
    warnings: 'Notices',
    planned: 'planned',
    done: 'done',
    missed: 'missed',
    icsProductId: 'Weekly plan',
  },
};

const spanish: Copy = {
  dateLocale: 'es-MX',
  dayNames: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
  dayShort: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  status: { planned: 'Pendiente', done: 'Completada', missed: 'Perdida' },
  domain: { learning: 'Aprendizaje', creative: 'Práctica creativa', general: 'General' },
  api: {
    invalidOrigin: 'Origen no permitido.',
    invalidBody: 'El cuerpo JSON no es válido o supera el límite.',
    bodyObject: 'El cuerpo JSON debe ser un objeto.',
    invalidInput: 'Los datos de la rutina no son válidos.',
    invalidMode: 'El modo de rutina no es válido.',
    notConfigured: 'La IA real no está configurada.',
    providerError: 'El proveedor de IA no está disponible.',
    rateLimited: (retryAfterSec?: number) =>
      retryAfterSec
        ? `Demasiadas solicitudes. Espera ${retryAfterSec} segundo${retryAfterSec === 1 ? '' : 's'} antes de volver a intentar.`
        : 'Demasiadas solicitudes. Espera un momento antes de volver a intentar.',
    visitorQuotaExceeded: 'Límite diario de IA conectada alcanzado (5 rutinas/día). Puedes seguir usando el modo Demo local.',
    globalQuotaExceeded: 'Capacidad global diaria alcanzada para IA conectada. Vuelve a intentar mañana o usa el modo Demo local.',
    visitorConcurrentLimit: 'Ya hay una generación en curso para tu conexión. Espera a que termine.',
    globalConcurrentLimit: 'El servicio está ocupado con demasiadas solicitudes. Vuelve a intentar en un momento.',
    limitsNotConfigured: 'Los límites de tasa del servicio no están configurados.',
  },
  routine: {
    scopeTitle: 'Solicitud fuera de alcance',
    scopeGoal: 'Cadencia organiza aprendizaje, práctica creativa y trabajo personal general; no ofrece orientación médica, de ejercicio, financiera ni legal.',
    scopeStepTitle: 'Reformula el objetivo',
    scopeStepInstructions: 'Pide una rutina de aprendizaje, creatividad u organización general sin asesoría especializada.',
    scopeWarning: 'Esta solicitud queda fuera de alcance; no se ofrece orientación médica, de ejercicio, financiera ni legal.',
    capacityWarning: (scheduled, selected) => `El tope semanal permite ${scheduled} de ${selected} días elegidos; se dejaron días sin sesión.`,
    noFreeDayWarning: 'No hay un día permitido y libre después de la sesión perdida dentro de esta semana; no se creó una sesión adicional.',
    budgetWarning: 'El tope semanal no deja minutos para reprogramar la sesión perdida; no se creó una sesión adicional.',
    sessionPrefix: (index) => `Sesión ${index}: `,
    learningDeliverable: (index) => `Una evidencia fechada de la sesión ${index}: ejercicio, explicación o muestra que puedas revisar.`,
    creativeDeliverable: (index) => `Una versión fechada y comparable producida en la sesión ${index}.`,
    generalDeliverable: (index) => `Un resultado concreto y revisable de la sesión ${index}.`,
    sessionInstructions: (index, count) => `Completa la sesión ${index} de ${count} con una sola evidencia visible al cierre.`,
    doneWhen: (minutes) => `Los ${minutes} minutos están distribuidos en la agenda, el entregable existe y quedó escrito el siguiente paso.`,
    demoSource: 'El contenido es una salida determinista de demostración.',
    liveSource: 'El contenido fue propuesto por DeepSeek y el calendario fue validado de forma determinista.',
    explanation: (count, activeMinutes, weeklyMinutes) => `Se conservaron los días y la hora indicados; ${count} ${count === 1 ? 'sesión usa' : 'sesiones usan'} ${activeMinutes} de ${weeklyMinutes} min del tope semanal.`,
    replanReplacement: (missedDate, replacementDate) => `Se marcó la sesión del ${missedDate} como perdida y se reprogramó para el ${replacementDate}.`,
    replanNoReplacement: (missedDate, reason) => `Se marcó la sesión del ${missedDate} como perdida, pero ${reason.toLowerCase()}`,
    notFound: 'Sesión no encontrada.',
    alreadyMissed: 'La sesión ya está marcada como perdida.',
    cannotReplanDone: 'No se puede reprogramar una sesión hecha.',
    cannotCompleteMissed: 'No se puede marcar como hecha una sesión perdida.',
  },
  ui: {
    languageSelector: 'Idioma',
    languageEnglish: 'Inglés',
    languageSpanish: 'Español',
    brandNote: 'compilador de rutinas',
    liveMode: 'IA real · servidor',
    demoMode: 'Demo local · sin modelo',
    homeAria: 'Cadencia, inicio',
    rhythmMap: 'Mapa semanal de sesiones',
    sessionsInDays: (sessions, days) => `${sessions} ${sessions === 1 ? 'sesión' : 'sesiones'} en ${days} ${days === 1 ? 'día disponible' : 'días disponibles'}.`,
    sampleKicker: 'Muestra local',
    sampleTitle: 'Inglés para entrevistas',
    sampleGoal: 'Confianza para responder sin traducir cada frase.',
    demoTag: 'Demo',
    weeklyRhythm: 'Cadencia semanal',
    sessionCount: (count, minutes) => `${count} ${count === 1 ? 'sesión' : 'sesiones'} · ${minutes} min`,
    sampleRhythmMap: 'Mapa semanal de sesiones de ejemplo',
    sampleSessions: 'Sesiones de ejemplo',
    sampleDisclaimer: 'Ejemplo de estructura. Genera una rutina para verla con tus datos.',
    sampleFooter: '4 sesiones cortas, un objetivo claro.',
    reset: 'Volver al ejemplo',
    stale: 'Cambiaste una condición. Esta vista conserva el plan anterior hasta que lo regeneres.',
    warningHeading: 'Hay algo que revisar',
    insightLabel: 'Lectura avanzada',
    insightTitle: 'Lo que este ritmo permite',
    insightHorizon: '4 semanas',
    nextDecision: 'Siguiente decisión',
    refinePlan: 'Responder en mi petición',
    successSignals: 'Señales de avance',
    planProgress: (done, total) => `${done} de ${total} completadas`,
    localTime: 'hora local',
    routineSessions: 'Sesiones de la rutina',
    emptyPlan: 'No hay sesiones compatibles con estos límites todavía.',
    decisionSummary: 'Cómo se decidió',
    understoodIntent: 'Intención entendida',
    deterministicChecks: 'Comprobaciones deterministas',
    liveHonesty: 'La IA propuso la intención; Cadencia comprobó las fechas, los días y el tiempo antes de mostrarla.',
    demoHonesty: 'Esta salida se construyó localmente con reglas deterministas. No es una respuesta de IA.',
    calendarCompanion: 'Calendario y acompañamiento',
    calendarCompanionHelp: 'Copias puntuales; no sincronizan cambios.',
    addGoogle: 'Google · sesión',
    downloadMarkdown: 'Resumen .md',
    downloadIcs: 'Apple / Outlook · rutina',
    downloadMarkdownFilename: 'cadencia-rutina.md',
    downloadIcsFilename: 'cadencia-rutina.ics',
    share: 'Compartir',
    addGoogleTitle: 'Añadir la sesión seleccionada a Google Calendar',
    downloadMarkdownTitle: 'Descargar un resumen de la rutina',
    downloadIcsTitle: 'Descargar toda la rutina en formato ICS',
    selectedSession: 'Sesión seleccionada',
    timedAgenda: 'Agenda cronometrada',
    deliverable: 'Entregable',
    doneWhen: 'Termina cuando',
    markDone: 'Marcar completada',
    replan: 'No pude, reajustar',
    doneCopy: 'Hecha. Tu objetivo sigue intacto.',
    missedWithWarning: 'Marcada como perdida; revisa el aviso del plan.',
    missedReplanned: 'Se reajustó conservando las sesiones completadas.',
    staleDetail: 'Regenera la rutina para editar una sesión con tus nuevos límites.',
    heroEyebrow: 'Tu intención → una semana posible',
    heroTitleFirst: 'Haz que una meta',
    heroTitleSecond: 'tenga ritmo.',
    intro: 'Escribe lo que quieres sostener. Cadencia lo convierte en sesiones que caben de verdad en tu semana.',
    goalLabel: '¿Qué quieres volver constante?',
    goalHelp: 'Incluye tu nivel actual, el resultado que quieres obtener y cualquier recurso o límite importante.',
    examples: 'Prueba con',
    daySectionLabel: 'Elige tus pulsos',
    daySectionHelp: 'Tus días tienen la última palabra.',
    availableDays: 'Días disponibles',
    sessionMinutes: 'Minutos por sesión',
    weeklyCap: 'Tope semanal',
    weekStart: 'Semana que empieza (lunes)',
    weekStartHint: 'Semana que empieza lunes',
    localTimeField: 'Hora local',
    capacityOver: (minutes) => `Tus días configurarían ${minutes} min; el tope puede reducir sesiones.`,
    capacityWithin: (minutes) => `Hay espacio para ${minutes} min con esta selección.`,
    authority: 'Los días, minutos, hora y tope elegidos prevalecen sobre el texto; la semana debe empezar en lunes.',
    contentProposer: 'Quién propone el contenido',
    deterministicLimits: 'Tus límites siguen siendo deterministas.',
    localDemo: 'Demo local',
    localDemoHelp: 'Salida determinista, sin modelo.',
    connectedAi: 'IA conectada',
    deepseekOptional: 'DeepSeek opcional.',
    providerDisabled: 'Proveedor no habilitado.',
    liveDisabledHelp: 'IA conectada está desactivada: el proveedor no está habilitado o configurado aquí.',
    liveWarning: 'Al crear, tu petición se enviará a DeepSeek; evita datos sensibles y considera posibles costes.',
    enableLiveTitle: 'Conecta el backend opcional y configura una clave para activar IA real.',
    createRoutine: 'Crear mi rutina',
    creating: 'Creando…',
    closeError: 'Cerrar error',
    weekView: 'Vista de la semana',
    planIndex: 'PLAN / 01',
    sampleIndex: 'MUESTRA / 01',
    noProvider: 'No pudimos conectar con el proveedor de IA.',
    requestError: 'No pudimos crear esta rutina.',
    createError: 'No pudimos crear esta rutina.',
    failureReference: 'Referencia',
    updateError: 'No pudimos actualizar esta rutina.',
    calendarError: 'No pudimos preparar el evento de calendario.',
    shareSuccess: 'Rutina compartida.',
    copySuccess: 'Rutina copiada para compartir.',
    shareError: 'No pudimos compartir la rutina en este navegador.',
    waitSeconds: (seconds: string | number) => `Espera ${seconds}s antes de volver a intentar.`,
  },
  export: {
    objective: 'Objetivo',
    agenda: 'Agenda',
    deliverable: 'Entregable',
    doneWhen: 'Termina cuando',
    cadence: 'Cadencia',
    perSession: 'min por sesión',
    perWeek: 'min semanales',
    scheduled: 'Sesiones programadas:',
    noScheduled: 'No hay sesiones programadas.',
    modeDemo: 'Demo · salida determinista de ejemplo',
    modeLive: 'IA real · proveedor DeepSeek opcional',
    sessions: 'Sesiones',
    checks: 'Comprobaciones',
    warnings: 'Avisos',
    planned: 'pendiente',
    done: 'completada',
    missed: 'perdida',
    icsProductId: 'Plan semanal',
  },
};

export const COPY: Readonly<Record<Language, Copy>> = { en: english, es: spanish };

export function copyFor(language: Language): Copy {
  return COPY[language];
}
