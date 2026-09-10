import type { Locale, RoutineInput } from './routine.ts';

export const DAY_NAMES: Record<Locale, string[]> = {
  en: [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ],
  es: [
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado',
    'Domingo',
  ],
};
export const DAY_SHORT: Record<Locale, string[]> = {
  en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  es: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
};
export const DEFAULT_START_DATE = '2026-08-31';

export function subscribeToWeekStart() {
  return () => {};
}

export function getServerWeekStart() {
  return DEFAULT_START_DATE;
}

export function getLocalWeekStart() {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return [
    monday.getFullYear(),
    String(monday.getMonth() + 1).padStart(2, '0'),
    String(monday.getDate()).padStart(2, '0'),
  ].join('-');
}

const EXAMPLES_ES: Array<{ label: string; input: RoutineInput }> = [
  {
    label: 'Inglés para entrevistas',
    input: {
      request:
        'Practicar inglés para entrevistas de trabajo, con foco en responder con más seguridad.',
      days: [0, 1, 2, 3, 4],
      sessionMinutes: 30,
      weeklyMinutes: 90,
      startDate: DEFAULT_START_DATE,
      time: '07:30',
    },
  },
  {
    label: 'Aprender TypeScript',
    input: {
      request:
        'Aprender TypeScript construyendo un pequeño proyecto lateral y entendiendo sus tipos.',
      days: [1, 3, 5],
      sessionMinutes: 45,
      weeklyMinutes: 135,
      startDate: DEFAULT_START_DATE,
      time: '19:00',
    },
  },
  {
    label: 'Escribir cada semana',
    input: {
      request:
        'Escribir una pieza breve cada semana, empezando por un esquema y una primera versión.',
      days: [0, 2, 5],
      sessionMinutes: 35,
      weeklyMinutes: 105,
      startDate: DEFAULT_START_DATE,
      time: '08:00',
    },
  },
];
const EXAMPLES_EN: Array<{ label: string; input: RoutineInput }> = [
  {
    label: 'English for interviews',
    input: {
      request:
        'Practice English for job interviews, focusing on answering with more confidence.',
      days: [0, 1, 2, 3, 4],
      sessionMinutes: 30,
      weeklyMinutes: 90,
      startDate: DEFAULT_START_DATE,
      time: '07:30',
    },
  },
  {
    label: 'Learn TypeScript',
    input: {
      request:
        'Learn TypeScript by building a small side project and understanding its type system.',
      days: [1, 3, 5],
      sessionMinutes: 45,
      weeklyMinutes: 135,
      startDate: DEFAULT_START_DATE,
      time: '19:00',
    },
  },
  {
    label: 'Write every week',
    input: {
      request:
        'Write one short piece every week, starting with an outline and a first draft.',
      days: [0, 2, 5],
      sessionMinutes: 35,
      weeklyMinutes: 105,
      startDate: DEFAULT_START_DATE,
      time: '08:00',
    },
  },
];
export const EXAMPLES: Record<
  Locale,
  Array<{ label: string; input: RoutineInput }>
> = {
  en: EXAMPLES_EN,
  es: EXAMPLES_ES,
};

export const PAGE_COPY = {
  en: {
    completed: 'Completed',
    missed: 'Missed',
    planned: 'Planned',
    learning: 'Learning',
    creative: 'Creative practice',
    general: 'General',
    map: 'Weekly session map',
    sessionsIn: 'sessions across',
    availableDays: 'available days',
    live: 'Connected AI · server',
    demo: 'Local demo · no model',
    reset: 'Return to the example',
    stale:
      'You changed a condition. This view keeps the previous plan until you generate it again.',
    weeklyCadence: 'Weekly cadence',
    sessions: 'sessions',
    review: 'Something needs review',
    advanced: 'Plan reading',
    allows: 'What this rhythm allows',
    fourWeeks: '4 weeks',
    nextDecision: 'Next decision',
    refine: 'To refine the plan',
    answer: 'Add answers to my request',
    signals: 'Progress signals',
    completedOf: 'completed',
    localTime: 'local time',
    sessionList: 'Routine sessions',
    emptySessions: 'No sessions fit these limits yet.',
    decided: 'How this was decided',
    intent: 'Understood intent',
    checks: 'Deterministic checks',
    deepseekHonesty:
      'AI proposed the intent; Cadencia checked dates, days, and time before showing it.',
    demoHonesty:
      'This output was built locally with deterministic rules. It is not an AI response.',
    calendar: 'Calendar and sharing',
    copies: 'One-time copies; changes do not sync.',
    google: 'Google · session',
    googleTitle: 'Add the selected session to Google Calendar',
    summary: 'Summary .md',
    summaryTitle: 'Download a routine summary',
    ics: 'Apple / Outlook · routine',
    icsTitle: 'Download the full routine in ICS format',
    share: 'Share',
    selected: 'Selected session',
    mark: 'Mark complete',
    replan: 'I missed it, replan',
    doneCopy: 'Done. Your goal remains intact.',
    missedNoSlot: 'Marked as missed; review the plan warning.',
    missedMoved: 'Replanned while preserving completed sessions.',
    staleDetail:
      'Generate the routine again to edit a session with your new limits.',
    shareDone: 'Routine shared.',
    shareCopied: 'Routine copied for sharing.',
    shareError: 'This browser could not share the routine.',
    updateError: 'The routine could not be updated.',
    calendarError: 'The calendar event could not be prepared.',
    providerError: 'Could not connect to the AI provider.',
    createError: 'The routine could not be created.',
    skip: 'Skip to planner',
    home: 'Cadencia, home',
    brand: 'your week, at your pace',
    navPlan: 'Plan',
    navHow: 'How it works',
    now: 'Now, with your week',
    plannerTitle: 'Make room for what you want to sustain.',
    plannerLead:
      'Choose a goal and your limits. You can try, replan, and take a copy with you.',
    question: 'What do you want to make consistent?',
    questionHelp: 'Write it as you would explain it to another person.',
    examples: 'Intent examples',
    try: 'Try',
    pulses: 'Choose your rhythm',
    daysRule: 'Your days have the final say.',
    daysLegend: 'Available days',
    none: 'no days',
    day: 'day',
    days: 'days',
    perSession: 'Minutes per session',
    weeklyLimit: 'Weekly limit',
    weekStarts: 'Week starting (Monday)',
    capacityOver: (n: number) =>
      `Your selected days add up to ${n} min; the limit may reduce the number of sessions.`,
    capacityFits: (n: number) => `This selection has room for ${n} min.`,
    authority:
      'Selected days, minutes, time, and limit take priority over the text; the week must start on Monday.',
    who: 'Who proposes the content',
    rulesLead: 'Your selected days and minutes still lead.',
    generation: 'Generation mode',
    localDemo: 'Local demo',
    deterministic: 'Deterministic output, no model.',
    connected: 'Connected AI',
    optional: 'Optional DeepSeek.',
    unavailable: 'Not available here.',
    unavailableTitle: 'Connected mode is not available in this version.',
    modeHelp:
      'Explore the full planner with sample content and no AI calls. Connected mode is enabled separately.',
    liveWarning:
      'When you create the plan, your request will be sent to DeepSeek. Avoid sensitive data and consider possible costs.',
    creating: 'Creating…',
    create: 'Create my routine',
    closeError: 'Dismiss error',
    weekView: 'Week view',
    yourPlan: 'YOUR PLAN',
    toCreate: 'TO CREATE',
    emptyTitle: 'Your week starts here.',
    emptyText:
      'Create your routine to see its sessions, time, and plan checks.',
    empty1: 'A goal you want to sustain.',
    empty2: 'The days and minutes you have.',
    empty3: 'A plan you can adjust.',
    emptyNote:
      'The demo uses sample content and resets when you reload. You can download the result.',
    language: 'Language',
    metaTitle: 'Cadencia · Give your goal a rhythm',
    metaDescription:
      'Turn an intention into sessions that fit your week. See how Cadencia replans a missed day while preserving completed work.',
  },
  es: {
    completed: 'Completada',
    missed: 'Perdida',
    planned: 'Pendiente',
    learning: 'Aprendizaje',
    creative: 'Práctica creativa',
    general: 'General',
    map: 'Mapa semanal de sesiones',
    sessionsIn: 'sesiones en',
    availableDays: 'días disponibles',
    live: 'IA real · servidor',
    demo: 'Demo local · sin modelo',
    reset: 'Volver al ejemplo',
    stale:
      'Cambiaste una condición. Esta vista conserva el plan anterior hasta que lo regeneres.',
    weeklyCadence: 'Cadencia semanal',
    sessions: 'sesiones',
    review: 'Hay algo que revisar',
    advanced: 'Lectura avanzada',
    allows: 'Lo que este ritmo permite',
    fourWeeks: '4 semanas',
    nextDecision: 'Siguiente decisión',
    refine: 'Para afinar el plan',
    answer: 'Responder en mi petición',
    signals: 'Señales de avance',
    completedOf: 'completadas',
    localTime: 'hora local',
    sessionList: 'Sesiones de la rutina',
    emptySessions: 'No hay sesiones compatibles con estos límites todavía.',
    decided: 'Cómo se decidió',
    intent: 'Intención entendida',
    checks: 'Comprobaciones deterministas',
    deepseekHonesty:
      'La IA propuso la intención; Cadencia comprobó las fechas, los días y el tiempo antes de mostrarla.',
    demoHonesty:
      'Esta salida se construyó localmente con reglas deterministas. No es una respuesta de IA.',
    calendar: 'Calendario y acompañamiento',
    copies: 'Copias puntuales; no sincronizan cambios.',
    google: 'Google · sesión',
    googleTitle: 'Añadir la sesión seleccionada a Google Calendar',
    summary: 'Resumen .md',
    summaryTitle: 'Descargar un resumen de la rutina',
    ics: 'Apple / Outlook · rutina',
    icsTitle: 'Descargar toda la rutina en formato ICS',
    share: 'Compartir',
    selected: 'Sesión seleccionada',
    mark: 'Marcar completada',
    replan: 'No pude, reajustar',
    doneCopy: 'Hecha. Tu objetivo sigue intacto.',
    missedNoSlot: 'Marcada como perdida; revisa el aviso del plan.',
    missedMoved: 'Se reajustó conservando las sesiones completadas.',
    staleDetail:
      'Regenera la rutina para editar una sesión con tus nuevos límites.',
    shareDone: 'Rutina compartida.',
    shareCopied: 'Rutina copiada para compartir.',
    shareError: 'No pudimos compartir la rutina en este navegador.',
    updateError: 'No pudimos actualizar esta rutina.',
    calendarError: 'No pudimos preparar el evento de calendario.',
    providerError: 'No pudimos conectar con el proveedor de IA.',
    createError: 'No pudimos crear esta rutina.',
    skip: 'Ir al planificador',
    home: 'Cadencia, inicio',
    brand: 'tu semana, a tu ritmo',
    navPlan: 'Planificar',
    navHow: 'Cómo funciona',
    now: 'Ahora, con tu semana',
    plannerTitle: 'Haz espacio para lo que quieres sostener.',
    plannerLead:
      'Elige un objetivo y tus límites. Puedes probar, reajustar y llevarte una copia del plan.',
    question: '¿Qué quieres volver constante?',
    questionHelp: 'Puedes escribirlo como se lo contarías a una persona.',
    examples: 'Ejemplos de intención',
    try: 'Prueba con',
    pulses: 'Elige tus pulsos',
    daysRule: 'Tus días tienen la última palabra.',
    daysLegend: 'Días disponibles',
    none: 'ningún día',
    day: 'día',
    days: 'días',
    perSession: 'Minutos por sesión',
    weeklyLimit: 'Tope semanal',
    weekStarts: 'Semana que empieza (lunes)',
    capacityOver: (n: number) =>
      `Tus días configurarían ${n} min; el tope puede reducir sesiones.`,
    capacityFits: (n: number) =>
      `Hay espacio para ${n} min con esta selección.`,
    authority:
      'Los días, minutos, hora y tope elegidos prevalecen sobre el texto; la semana debe empezar en lunes.',
    who: 'Quién propone el contenido',
    rulesLead: 'Los días y minutos que elegiste siguen mandando.',
    generation: 'Modo de generación',
    localDemo: 'Demo local',
    deterministic: 'Salida determinista, sin modelo.',
    connected: 'IA conectada',
    optional: 'DeepSeek opcional.',
    unavailable: 'No disponible aquí.',
    unavailableTitle: 'El modo conectado no está disponible en esta versión.',
    modeHelp:
      'Puedes explorar todo el planificador con contenido de ejemplo, sin llamadas a IA. El modo conectado se habilita por separado.',
    liveWarning:
      'Al crear, tu petición se enviará a DeepSeek; evita datos sensibles y considera posibles costes.',
    creating: 'Creando…',
    create: 'Crear mi rutina',
    closeError: 'Cerrar error',
    weekView: 'Vista de la semana',
    yourPlan: 'TU PLAN',
    toCreate: 'POR CREAR',
    emptyTitle: 'Tu semana empieza aquí.',
    emptyText:
      'Al crear tu rutina verás las sesiones, el tiempo que ocupan y las comprobaciones del plan.',
    empty1: 'Un objetivo que quieras sostener.',
    empty2: 'Los días y minutos que tienes.',
    empty3: 'Un plan que puedes ajustar.',
    emptyNote:
      'La demo usa contenido de ejemplo y se reinicia al recargar. Puedes descargar el resultado.',
    language: 'Idioma',
    metaTitle: 'Cadencia · Haz que una meta tenga ritmo',
    metaDescription:
      'Convierte una intención en sesiones que caben en tu semana. Descubre cómo Cadencia reajusta un día perdido y conserva lo que ya hiciste.',
  },
} as const;
