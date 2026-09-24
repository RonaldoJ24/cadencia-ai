import type { Language } from './i18n.ts';

type SettingName = 'deadline' | 'days' | 'window' | 'weeklyMinutes' | 'sessionMinutes' | 'level';
type DeclineReason =
  | 'medical'
  | 'eating'
  | 'extreme_timeline'
  | 'harm'
  | 'specialized_advice'
  | 'not_a_goal'
  | 'unclear';

/** Counts from a finished fit, for its step detail. */
export type FitCounts = { placed: number; trimmed: number; moved: number; unplaced: number };

export type GoalStepsCopy = {
  request: (characters: number, touched: SettingName[]) => string;
  readPlan: (title: string, deadline: string | null, basis: 'stated' | 'inferred' | 'none') => string;
  readClarify: string;
  readDeclined: (reason: DeclineReason) => string;
  readGuard: string;
  availability: (weeks: number, first: string, last: string, days: string, window: string, cap: number, start: number | null) => string;
  draft: (phases: number, types: number, sessions: number) => string;
  checkPassed: string;
  checkOver: (weeks: number) => string;
  checkRetry: (problems: number, first: string) => string;
  fit: (counts: FitCounts) => string;
  settings: Readonly<Record<SettingName, string>>;
  declines: Readonly<Record<DeclineReason, string>>;
  failure: {
    request: (field: string) => string;
    reading: string;
    draftTwice: string;
    noRoom: string;
    fit: string;
  };
};

export type StageId =
  | 'check_request'
  | 'check_availability'
  | 'reserve'
  | 'read_goal'
  | 'draft'
  | 'check_draft'
  | 'fit';

export type StageActor = 'code' | 'model' | 'sample';

export type StepsCopy = {
  heading: string;
  demoNote: string;
  liveNote: string;
  labels: Readonly<Record<StageId, string>>;
  actors: Readonly<Record<StageActor, string>>;
  running: string;
  waiting: string;
  skipped: string;
  attempt: (n: number) => string;
  duration: (ms: number) => string;
  detail: {
    request: (days: number, minutes: number, weeklyMinutes: number) => string;
    availability: (count: number, selectedDays: number, dayNames: string[], weeklyMinutes: number) => string;
    reserve: string;
    reserveBudget: (used: string, cap: string) => string;
    draftModel: (count: number) => string;
    draftSample: (count: number) => string;
    draftDeclined: string;
    draftSampleDeclined: string;
    checkDraft: (count: number) => string;
    checkDeclined: string;
    fit: (placed: string[], time: string) => string;
    fitNone: string;
  };
  spend: {
    disabled: string;
    dailyCap: string;
    monthlyCap: string;
  };
  failure: {
    checkDraft: string;
    fit: string;
    streamEnded: string;
    timeout: string;
  };
  goal: GoalStepsCopy;
};

function seconds(ms: number, decimal: string): string {
  return (ms / 1000).toFixed(1).replace('.', decimal);
}

function list(items: string[], and: string): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const FIELD_NAMES_EN: Readonly<Record<string, string>> = {
  text: 'the goal text',
  language: 'the language',
  today: 'your device’s date',
  deadline: 'the deadline',
  days: 'the days',
  window: 'the time window',
  weeklyMinutes: 'the weekly minutes',
  sessionMinutes: 'the session length',
  level: 'the level',
  busy: 'the calendar import',
  question: 'your answer',
  answer: 'your answer',
  clarification: 'your answer',
};

const FIELD_NAMES_ES: Readonly<Record<string, string>> = {
  text: 'el texto de la meta',
  language: 'el idioma',
  today: 'la fecha de tu dispositivo',
  deadline: 'la fecha límite',
  days: 'los días',
  window: 'el horario',
  weeklyMinutes: 'los minutos por semana',
  sessionMinutes: 'la duración de cada sesión',
  level: 'el nivel',
  busy: 'el calendario importado',
  question: 'tu respuesta',
  answer: 'tu respuesta',
  clarification: 'tu respuesta',
};

const EN: StepsCopy = {
  heading: 'How this plan was made',
  demoNote: 'Demo: the draft comes from a built-in sample, not a model. Every other step runs on your inputs.',
  liveNote: 'Each step is reported as it runs. Steps marked Model call the AI; the rest is code.',
  labels: {
    check_request: 'Checking your request',
    check_availability: 'Checking your availability',
    reserve: 'Checking live AI limits',
    read_goal: 'Reading your goal',
    draft: 'Drafting sessions',
    check_draft: 'Checking the draft',
    fit: 'Fitting sessions into your calendar',
  },
  actors: { code: 'Code', model: 'Model', sample: 'Sample' },
  running: 'Running…',
  waiting: 'Waiting',
  skipped: 'Not needed',
  attempt: (n) => `(attempt ${n})`,
  duration: (ms) => (ms < 1 ? 'under 1 ms' : ms < 1000 ? `${Math.round(ms)} ms` : `${seconds(ms, '.')} s`),
  detail: {
    request: (days, minutes, weeklyMinutes) =>
      `${days} ${days === 1 ? 'day' : 'days'}, ${minutes} min per session, up to ${weeklyMinutes} min this week`,
    availability: (count, selectedDays, dayNames, weeklyMinutes) =>
      count < selectedDays
        ? `Your ${weeklyMinutes}-minute cap fits ${count} of ${selectedDays} days: ${list(dayNames, 'and')}`
        : `Room for ${count} ${count === 1 ? 'session' : 'sessions'}: ${list(dayNames, 'and')}`,
    reserve: 'Live AI slot reserved',
    reserveBudget: (used, cap) => `Live AI slot reserved; ${used} of today’s ${cap} cap committed, counting this plan at its worst case`,
    draftModel: (count) => `Draft has ${count} ${count === 1 ? 'session' : 'sessions'}`,
    draftSample: (count) => `Sample draft with ${count} ${count === 1 ? 'session' : 'sessions'} (no model)`,
    draftDeclined: 'Declined: the request asks for specialized advice Cadencia does not give',
    draftSampleDeclined: 'Sample draft declined: the request is outside Cadencia’s scope',
    checkDraft: (count) =>
      `${count} ${count === 1 ? 'session' : 'sessions'} passed: count, block minutes and text limits`,
    checkDeclined: 'The decline notice passed the checks',
    fit: (placed, time) => `Placed ${placed.length} ${placed.length === 1 ? 'session' : 'sessions'}: ${list(placed, 'and')} at ${time}`,
    fitNone: 'Nothing scheduled',
  },
  spend: {
    disabled: 'Live AI is paused right now. The demo still works.',
    dailyCap: 'Live AI reached today’s spending cap. It resets at 00:00 UTC; the demo still works.',
    monthlyCap: 'Live AI reached this month’s spending cap. The demo still works.',
  },
  failure: {
    checkDraft: 'The draft broke a planning rule, so nothing was scheduled.',
    fit: 'The plan could not be scheduled.',
    streamEnded: 'The connection ended before the plan was ready. Try again.',
    timeout: 'The plan took too long. Try again in a moment.',
  },
  goal: {
    request: (characters, touched) =>
      touched.length > 0
        ? `${characters}-character goal; you set ${list(touched.map((name) => EN.goal.settings[name]), 'and')}`
        : `${characters}-character goal; code fills every setting you left open`,
    readPlan: (title, deadline, basis) =>
      deadline === null
        ? `“${title}”; no deadline in your words`
        : `“${title}”; deadline ${deadline}, ${basis === 'stated' ? 'as you wrote it' : 'worked out from your words'}`,
    readClarify: 'Needs one answer before planning',
    readDeclined: (reason) => `Declined: ${EN.goal.declines[reason]}`,
    readGuard: 'Declined by the scope check before any model call',
    availability: (weeks, first, last, days, window, cap, start) =>
      `${plural(weeks, 'week', 'weeks')}, ${first} to ${last}; ${days}, ${window}; up to ${cap} min a week` +
      (start === null ? '' : `, starting at ${start}`),
    draft: (phases, types, sessions) =>
      `${plural(phases, 'phase', 'phases')}, ${plural(types, 'session type', 'session types')}, ${plural(sessions, 'session', 'sessions')}`,
    checkPassed: 'Well-formed; every week is within its limits',
    checkOver: (weeks) => `Well-formed; ${plural(weeks, 'week is', 'weeks are')} over their limits and will be trimmed`,
    checkRetry: (problems, first) => `${plural(problems, 'problem', 'problems')}, such as “${first}”; asking the model again`,
    fit: ({ placed, trimmed, moved, unplaced }) =>
      [
        `Placed ${plural(placed, 'session', 'sessions')}`,
        trimmed > 0 ? `trimmed ${trimmed} to fit weekly limits` : '',
        moved > 0 ? `moved ${moved}` : '',
        unplaced > 0 ? `${unplaced} had no free slot` : '',
        'every rule checked',
      ].filter(Boolean).join('; '),
    settings: {
      deadline: 'the deadline',
      days: 'the days',
      window: 'the time window',
      weeklyMinutes: 'the weekly minutes',
      sessionMinutes: 'the session length',
      level: 'the level',
    },
    declines: {
      medical: 'it needs a health professional',
      eating: 'diets and eating plans need a professional',
      extreme_timeline: 'this timeline could hurt you',
      harm: 'it could cause harm',
      specialized_advice: 'it needs specialized advice',
      not_a_goal: 'there is nothing to practise over time',
      unclear: 'it is still unclear after your answer',
    },
    failure: {
      request: (field) => `Check ${FIELD_NAMES_EN[field] ?? 'the request'} and try again.`,
      reading: 'The model’s reading of your goal broke the expected format, so nothing was planned.',
      draftTwice: 'The model’s draft broke the expected format twice, so nothing was scheduled.',
      noRoom: 'Your days and time window leave no room for a session before the deadline.',
      fit: 'The plan broke a scheduling rule, so it was not shown.',
    },
  },
};

const ES: StepsCopy = {
  heading: 'Cómo se hizo este plan',
  demoNote: 'Demo: el borrador viene de una muestra incluida, no de un modelo. Los demás pasos usan tus datos.',
  liveNote: 'Cada paso se informa mientras ocurre. Los pasos marcados Modelo llaman a la IA; el resto es código.',
  labels: {
    check_request: 'Revisando tu solicitud',
    check_availability: 'Revisando tu disponibilidad',
    reserve: 'Revisando los límites de la IA',
    read_goal: 'Leyendo tu meta',
    draft: 'Redactando sesiones',
    check_draft: 'Revisando el borrador',
    fit: 'Acomodando sesiones en tu calendario',
  },
  actors: { code: 'Código', model: 'Modelo', sample: 'Muestra' },
  running: 'En curso…',
  waiting: 'En espera',
  skipped: 'No hizo falta',
  attempt: (n) => `(intento ${n})`,
  duration: (ms) => (ms < 1 ? 'menos de 1 ms' : ms < 1000 ? `${Math.round(ms)} ms` : `${seconds(ms, ',')} s`),
  detail: {
    request: (days, minutes, weeklyMinutes) =>
      `${days} ${days === 1 ? 'día' : 'días'}, ${minutes} min por sesión, hasta ${weeklyMinutes} min esta semana`,
    availability: (count, selectedDays, dayNames, weeklyMinutes) =>
      count < selectedDays
        ? `Tu tope de ${weeklyMinutes} min alcanza para ${count} de ${selectedDays} días: ${list(dayNames, 'y')}`
        : `Hay lugar para ${count} ${count === 1 ? 'sesión' : 'sesiones'}: ${list(dayNames, 'y')}`,
    reserve: 'Turno de IA reservado',
    reserveBudget: (used, cap) => `Turno de IA reservado; ${used} del tope diario de ${cap} comprometidos, contando este plan a su costo máximo`,
    draftModel: (count) => `El borrador tiene ${count} ${count === 1 ? 'sesión' : 'sesiones'}`,
    draftSample: (count) => `Borrador de muestra con ${count} ${count === 1 ? 'sesión' : 'sesiones'} (sin modelo)`,
    draftDeclined: 'Rechazada: la solicitud pide asesoría especializada que Cadencia no da',
    draftSampleDeclined: 'Borrador de muestra rechazado: la solicitud queda fuera del alcance de Cadencia',
    checkDraft: (count) =>
      `${count} ${count === 1 ? 'sesión pasó' : 'sesiones pasaron'}: número, minutos por bloque y límites de texto`,
    checkDeclined: 'El aviso de rechazo pasó las revisiones',
    fit: (placed, time) => `${placed.length === 1 ? 'Se acomodó 1 sesión' : `Se acomodaron ${placed.length} sesiones`}: ${list(placed, 'y')} a las ${time}`,
    fitNone: 'No se programó nada',
  },
  spend: {
    disabled: 'La IA en vivo está en pausa. La demo sigue funcionando.',
    dailyCap: 'La IA en vivo alcanzó el tope de gasto de hoy. Se reinicia a las 00:00 UTC; la demo sigue funcionando.',
    monthlyCap: 'La IA en vivo alcanzó el tope de gasto del mes. La demo sigue funcionando.',
  },
  failure: {
    checkDraft: 'El borrador rompió una regla de planeación, así que no se programó nada.',
    fit: 'No se pudo programar el plan.',
    streamEnded: 'La conexión terminó antes de que el plan estuviera listo. Inténtalo de nuevo.',
    timeout: 'El plan tardó demasiado. Inténtalo de nuevo en un momento.',
  },
  goal: {
    request: (characters, touched) =>
      touched.length > 0
        ? `Meta de ${characters} caracteres; tú fijaste ${list(touched.map((name) => ES.goal.settings[name]), 'y')}`
        : `Meta de ${characters} caracteres; el código completa lo que dejaste abierto`,
    readPlan: (title, deadline, basis) =>
      deadline === null
        ? `“${title}”; tu texto no trae fecha límite`
        : `“${title}”; fecha límite ${deadline}, ${basis === 'stated' ? 'tal como la escribiste' : 'deducida de tus palabras'}`,
    readClarify: 'Necesita una respuesta antes de planear',
    readDeclined: (reason) => `Rechazada: ${ES.goal.declines[reason]}`,
    readGuard: 'Rechazada por la revisión de alcance antes de llamar al modelo',
    availability: (weeks, first, last, days, window, cap, start) =>
      `${plural(weeks, 'semana', 'semanas')}, del ${first} al ${last}; ${days}, ${window}; hasta ${cap} min por semana` +
      (start === null ? '' : `, empezando con ${start}`),
    draft: (phases, types, sessions) =>
      `${plural(phases, 'fase', 'fases')}, ${plural(types, 'tipo de sesión', 'tipos de sesión')}, ${plural(sessions, 'sesión', 'sesiones')}`,
    checkPassed: 'Bien formado; cada semana está dentro de sus límites',
    checkOver: (weeks) => `Bien formado; ${plural(weeks, 'semana se pasa', 'semanas se pasan')} de sus límites y se recortarán`,
    checkRetry: (problems, first) => `${plural(problems, 'problema', 'problemas')}, como “${first}”; se le pide otro borrador al modelo`,
    fit: ({ placed, trimmed, moved, unplaced }) =>
      [
        placed === 1 ? 'Se acomodó 1 sesión' : `Se acomodaron ${placed} sesiones`,
        trimmed > 0 ? `se recortaron ${trimmed} para respetar los límites semanales` : '',
        moved > 0 ? `se movieron ${moved}` : '',
        unplaced > 0 ? `${unplaced} sin hueco libre` : '',
        'todas las reglas revisadas',
      ].filter(Boolean).join('; '),
    settings: {
      deadline: 'la fecha límite',
      days: 'los días',
      window: 'el horario',
      weeklyMinutes: 'los minutos por semana',
      sessionMinutes: 'la duración de cada sesión',
      level: 'el nivel',
    },
    declines: {
      medical: 'necesita a un profesional de la salud',
      eating: 'las dietas y planes de alimentación necesitan a un profesional',
      extreme_timeline: 'este plazo podría lastimarte',
      harm: 'podría causar daño',
      specialized_advice: 'necesita asesoría especializada',
      not_a_goal: 'no hay nada que practicar con el tiempo',
      unclear: 'sigue sin quedar claro después de tu respuesta',
    },
    failure: {
      request: (field) => `Revisa ${FIELD_NAMES_ES[field] ?? 'la solicitud'} e inténtalo de nuevo.`,
      reading: 'La lectura del modelo no respetó el formato esperado, así que no se planeó nada.',
      draftTwice: 'El borrador del modelo no respetó el formato esperado dos veces, así que no se programó nada.',
      noRoom: 'Tus días y horario no dejan lugar para ninguna sesión antes de la fecha límite.',
      fit: 'El plan rompió una regla de programación, así que no se mostró.',
    },
  },
};

export function stepsCopyFor(language: Language): StepsCopy {
  return language === 'es' ? ES : EN;
}
