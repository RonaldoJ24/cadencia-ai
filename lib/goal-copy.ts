// Text for the goal planner page, in English and Mexican Spanish.

import type { SampleId } from './goal-demo.ts';
import type { Language } from './i18n.ts';
import type { Source } from './planner/goal-input.ts';
import type { DropReason, Intensity, Level, MoveReason, Role } from './planner/types.ts';

export type GoalCopy = {
  brandNote: string;
  modePill: { demo: string; live: string };
  eyebrow: string;
  intro: string;
  goalLabel: string;
  goalHelp: string;
  examplesLabel: string;
  examples: Readonly<Record<SampleId, string>>;
  demoLocked: string;
  writeOwn: string;
  settingsLabel: string;
  settingsHelp: string;
  auto: string;
  setByYou: string;
  backToAuto: string;
  fields: { deadline: string; days: string; window: string; from: string; to: string; weeklyMinutes: string; sessionMinutes: string; level: string };
  levels: Readonly<Record<Exclude<Level, 'unknown'>, string>>;
  modeLabel: string;
  modeHelp: string;
  demo: string;
  demoHelp: string;
  live: string;
  liveHelp: string;
  liveUnavailable: string;
  submit: string;
  planning: string;
  demoStepsNote: string;
  liveStepsNote: string;
  resultLabel: string;
  emptyTitle: string;
  emptyBody: string;
  question: { title: string; answerLabel: string; submit: string; liveNote: string; demoNote: string };
  decline: { title: string; byGuard: string; byModel: string; tryAgain: string };
  plan: {
    eyebrow: string;
    liveBadge: string;
    demoBadge: string;
    demoProvenance: (model: string, date: string) => string;
    stats: (weeks: number, sessions: number, hours: string) => string;
    provenanceTitle: string;
    sources: Readonly<Record<Source, string>>;
    inferred: string;
    past: string;
    tooFar: string;
    noCap: string;
    notStated: string;
    upTo: (minutes: number) => string;
    loadTitle: string;
    loadLegendPlanned: string;
    loadLegendLimit: string;
    loadAria: (week: number, minutes: number, limit: number) => string;
    phasesTitle: string;
    weeksRange: (from: number, to: number) => string;
    weeksTitle: string;
    week: (week: number) => string;
    weekSummary: (sessions: number, minutes: number) => string;
    emptyWeek: string;
    roles: Readonly<Record<Role, string>>;
    intensities: Readonly<Record<Intensity, string>>;
    deliverable: string;
    doneWhen: string;
    statuses: { planned: string; done: string; missed: string };
    markDone: string;
    markMissed: string;
    undo: string;
    changesTitle: string;
    noChanges: string;
    moved: (week: number, title: string, from: string, to: string, reason: string) => string;
    dropped: (week: number, title: string, reason: string) => string;
    moveReasons: Readonly<Record<MoveReason, string>>;
    dropReasons: Readonly<Record<DropReason, string>>;
    exportIcs: string;
    exportGoogle: string;
  };
  errors: { generic: string; reference: string; wait: (seconds: number) => string };
};

const EN: GoalCopy = {
  brandNote: 'Goal planner',
  modePill: { demo: 'Demo · recorded samples', live: 'Live AI · DeepSeek' },
  eyebrow: 'Your goal → a plan that fits your weeks',
  intro: 'Write what you want to reach and by when. A model reads it and drafts the sessions; code checks every rule and fits them into your calendar.',
  goalLabel: 'What do you want to reach?',
  goalHelp: 'Say what, by when and how much time you have, in English or Spanish.',
  examplesLabel: 'Try',
  examples: {
    ten_k: '10K by December',
    guitar: 'Guitar by year end',
    interview: 'Interview in 6 weeks',
    vague: 'A vague goal',
    marathon: 'A risky timeline',
  },
  demoLocked: 'The demo plans these recorded examples. To plan your own goal, switch to Live AI.',
  writeOwn: 'Write my own goal',
  settingsLabel: 'Your settings',
  settingsHelp: 'Optional. What you set here wins over what the model reads; anything left on Auto comes from your words or a default.',
  auto: 'Auto',
  setByYou: 'You',
  backToAuto: 'Back to Auto',
  fields: {
    deadline: 'Deadline',
    days: 'Days',
    window: 'Time of day',
    from: 'From',
    to: 'To',
    weeklyMinutes: 'Minutes a week',
    sessionMinutes: 'Longest session',
    level: 'Level',
  },
  levels: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' },
  modeLabel: 'Who reads and drafts',
  modeHelp: 'Either way, code sizes the calendar, checks the draft and places every session.',
  demo: 'Demo',
  demoHelp: 'Recorded model outputs for the examples. No model call.',
  live: 'Live AI',
  liveHelp: 'DeepSeek reads your goal and drafts sessions. Up to 5 plans a day.',
  liveUnavailable: 'Live AI is not available right now. The demo still works.',
  submit: 'Plan it',
  planning: 'Planning…',
  demoStepsNote: 'Demo: the reading and the draft are recorded model outputs for this example. Every code step runs now, on your settings.',
  liveStepsNote: 'Each step is reported as it runs. Steps marked Model call the AI; the rest is code.',
  resultLabel: 'Plan',
  emptyTitle: 'Your plan appears here',
  emptyBody: 'Week by week, with where each setting came from and every change code made to the draft.',
  question: {
    title: 'One question first',
    answerLabel: 'Your answer',
    submit: 'Answer and plan',
    liveNote: 'Answering starts a new live run, which counts toward today’s 5.',
    demoNote: 'In the demo, answering needs Live AI.',
  },
  decline: {
    title: 'Cadencia won’t plan this',
    byGuard: 'Declined by the scope check before any model call.',
    byModel: 'Declined by the model’s reading of your goal.',
    tryAgain: 'Rewrite the goal and try again, or pick an example.',
  },
  plan: {
    eyebrow: 'Goal plan',
    liveBadge: 'Live',
    demoBadge: 'Demo',
    demoProvenance: (model, date) => `Reading and draft recorded from ${model} on ${date}; dates moved to today.`,
    stats: (weeks, sessions, hours) => `${weeks} weeks · ${sessions} sessions · ${hours} h`,
    provenanceTitle: 'Where each setting came from',
    sources: { you: 'you set it', goal: 'from your words', default: 'default', adjusted: 'adjusted' },
    inferred: 'worked out from your words',
    past: 'the date in your words had passed',
    tooFar: 'plans cover at most 26 weeks',
    noCap: 'no cap',
    notStated: 'not stated',
    upTo: (minutes) => `up to ${minutes} min`,
    loadTitle: 'Minutes per week',
    loadLegendPlanned: 'Placed',
    loadLegendLimit: 'Week limit',
    loadAria: (week, minutes, limit) => `Week ${week}: ${minutes} minutes placed, limit ${limit}`,
    phasesTitle: 'Phases',
    weeksRange: (from, to) => (from === to ? `Week ${from}` : `Weeks ${from}–${to}`),
    weeksTitle: 'Week by week',
    week: (week) => `Week ${week}`,
    weekSummary: (sessions, minutes) => `${sessions} ${sessions === 1 ? 'session' : 'sessions'} · ${minutes} min`,
    emptyWeek: 'No sessions this week.',
    roles: { key: 'Key', support: 'Support' },
    intensities: { easy: 'Easy', moderate: 'Moderate', hard: 'Hard' },
    deliverable: 'Deliverable',
    doneWhen: 'Done when',
    statuses: { planned: 'Planned', done: 'Done', missed: 'Missed' },
    markDone: 'Mark done',
    markMissed: 'Missed it',
    undo: 'Undo',
    changesTitle: 'What code changed',
    noChanges: 'Code placed every session the draft asked for, at the start of your window.',
    moved: (week, title, from, to, reason) => `Week ${week}: ${title} moved from ${from} to ${to}, because ${reason}.`,
    dropped: (week, title, reason) => `Week ${week}: ${title} left out, ${reason}.`,
    moveReasons: {
      busy: 'that time was busy',
      rest_spacing: 'hard sessions need a rest day between them',
      day_taken: 'that day already had a session',
    },
    dropReasons: {
      no_free_slot: 'no free slot was left that week',
      weekly_cap: 'to stay within your weekly minutes',
      week_minutes: 'to fit this week’s limits',
      hard_sessions: 'to fit this week’s limits',
      load: 'to keep the week within 30% of the four before it',
    },
    exportIcs: 'Download calendar (.ics)',
    exportGoogle: 'Add the first session to Google Calendar',
  },
  errors: {
    generic: 'Something went wrong. Try again.',
    reference: 'Reference',
    wait: (seconds) => `try again in ${seconds} s`,
  },
};

const ES: GoalCopy = {
  brandNote: 'Planeador de metas',
  modePill: { demo: 'Demo · muestras grabadas', live: 'IA en vivo · DeepSeek' },
  eyebrow: 'Tu meta → un plan que cabe en tus semanas',
  intro: 'Escribe qué quieres lograr y para cuándo. Un modelo lo lee y propone las sesiones; el código revisa cada regla y las acomoda en tu calendario.',
  goalLabel: '¿Qué quieres lograr?',
  goalHelp: 'Di qué, para cuándo y cuánto tiempo tienes, en español o en inglés.',
  examplesLabel: 'Prueba',
  examples: {
    ten_k: '10 km para diciembre',
    guitar: 'Guitarra para fin de año',
    interview: 'Entrevista en 6 semanas',
    vague: 'Una meta vaga',
    marathon: 'Un plazo riesgoso',
  },
  demoLocked: 'La demo planea estos ejemplos grabados. Para planear tu propia meta, cambia a IA en vivo.',
  writeOwn: 'Escribir mi propia meta',
  settingsLabel: 'Tus ajustes',
  settingsHelp: 'Opcional. Lo que fijes aquí manda sobre lo que lea el modelo; lo que dejes en Auto sale de tus palabras o de un valor por defecto.',
  auto: 'Auto',
  setByYou: 'Tú',
  backToAuto: 'Volver a Auto',
  fields: {
    deadline: 'Fecha límite',
    days: 'Días',
    window: 'Horario',
    from: 'Desde',
    to: 'Hasta',
    weeklyMinutes: 'Minutos por semana',
    sessionMinutes: 'Sesión más larga',
    level: 'Nivel',
  },
  levels: { beginner: 'Principiante', intermediate: 'Intermedio', advanced: 'Avanzado' },
  modeLabel: 'Quién lee y propone',
  modeHelp: 'En ambos casos, el código dimensiona el calendario, revisa el borrador y acomoda cada sesión.',
  demo: 'Demo',
  demoHelp: 'Salidas del modelo grabadas para los ejemplos. Sin llamar al modelo.',
  live: 'IA en vivo',
  liveHelp: 'DeepSeek lee tu meta y propone sesiones. Hasta 5 planes al día.',
  liveUnavailable: 'La IA en vivo no está disponible ahora. La demo sigue funcionando.',
  submit: 'Planear',
  planning: 'Planeando…',
  demoStepsNote: 'Demo: la lectura y el borrador son salidas del modelo grabadas para este ejemplo. Cada paso de código corre ahora, con tus ajustes.',
  liveStepsNote: 'Cada paso se informa mientras ocurre. Los pasos marcados Modelo llaman a la IA; el resto es código.',
  resultLabel: 'Plan',
  emptyTitle: 'Tu plan aparece aquí',
  emptyBody: 'Semana por semana, con de dónde salió cada ajuste y cada cambio que el código le hizo al borrador.',
  question: {
    title: 'Una pregunta antes',
    answerLabel: 'Tu respuesta',
    submit: 'Responder y planear',
    liveNote: 'Responder inicia otra corrida en vivo, que cuenta para las 5 de hoy.',
    demoNote: 'En la demo, para responder necesitas la IA en vivo.',
  },
  decline: {
    title: 'Cadencia no planeará esto',
    byGuard: 'Rechazada por la revisión de alcance antes de llamar al modelo.',
    byModel: 'Rechazada por la lectura que hizo el modelo de tu meta.',
    tryAgain: 'Reescribe la meta e inténtalo de nuevo, o elige un ejemplo.',
  },
  plan: {
    eyebrow: 'Plan de meta',
    liveBadge: 'En vivo',
    demoBadge: 'Demo',
    demoProvenance: (model, date) => `Lectura y borrador grabados de ${model} el ${date}; fechas movidas a hoy.`,
    stats: (weeks, sessions, hours) => `${weeks} semanas · ${sessions} sesiones · ${hours} h`,
    provenanceTitle: 'De dónde salió cada ajuste',
    sources: { you: 'lo fijaste tú', goal: 'de tus palabras', default: 'por defecto', adjusted: 'ajustado' },
    inferred: 'deducida de tus palabras',
    past: 'la fecha de tus palabras ya pasó',
    tooFar: 'los planes cubren como máximo 26 semanas',
    noCap: 'sin tope',
    notStated: 'sin indicar',
    upTo: (minutes) => `hasta ${minutes} min`,
    loadTitle: 'Minutos por semana',
    loadLegendPlanned: 'Acomodado',
    loadLegendLimit: 'Límite de la semana',
    loadAria: (week, minutes, limit) => `Semana ${week}: ${minutes} minutos acomodados, límite ${limit}`,
    phasesTitle: 'Fases',
    weeksRange: (from, to) => (from === to ? `Semana ${from}` : `Semanas ${from}–${to}`),
    weeksTitle: 'Semana por semana',
    week: (week) => `Semana ${week}`,
    weekSummary: (sessions, minutes) => `${sessions} ${sessions === 1 ? 'sesión' : 'sesiones'} · ${minutes} min`,
    emptyWeek: 'Sin sesiones esta semana.',
    roles: { key: 'Clave', support: 'Apoyo' },
    intensities: { easy: 'Suave', moderate: 'Moderada', hard: 'Intensa' },
    deliverable: 'Entregable',
    doneWhen: 'Lista cuando',
    statuses: { planned: 'Planeada', done: 'Hecha', missed: 'No la hice' },
    markDone: 'Marcar hecha',
    markMissed: 'No la hice',
    undo: 'Deshacer',
    changesTitle: 'Qué cambió el código',
    noChanges: 'El código acomodó cada sesión que pidió el borrador, al inicio de tu horario.',
    moved: (week, title, from, to, reason) => `Semana ${week}: ${title} pasó de ${from} a ${to}, porque ${reason}.`,
    dropped: (week, title, reason) => `Semana ${week}: ${title} quedó fuera, ${reason}.`,
    moveReasons: {
      busy: 'ese horario estaba ocupado',
      rest_spacing: 'las sesiones intensas necesitan un día de descanso entre ellas',
      day_taken: 'ese día ya tenía una sesión',
    },
    dropReasons: {
      no_free_slot: 'no quedaba ningún hueco libre esa semana',
      weekly_cap: 'para no pasar tus minutos por semana',
      week_minutes: 'para respetar los límites de la semana',
      hard_sessions: 'para respetar los límites de la semana',
      load: 'para que la semana no pase del 30% sobre las cuatro anteriores',
    },
    exportIcs: 'Descargar calendario (.ics)',
    exportGoogle: 'Agregar la primera sesión a Google Calendar',
  },
  errors: {
    generic: 'Algo salió mal. Inténtalo de nuevo.',
    reference: 'Referencia',
    wait: (seconds) => `inténtalo de nuevo en ${seconds} s`,
  },
};

export function goalCopyFor(language: Language): GoalCopy {
  return language === 'es' ? ES : EN;
}
