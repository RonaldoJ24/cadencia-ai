import type { Language } from './i18n.ts';

export type StageId =
  | 'check_request'
  | 'check_availability'
  | 'reserve'
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
  duration: (ms: number) => string;
  detail: {
    request: (days: number, minutes: number, weeklyMinutes: number) => string;
    availability: (count: number, selectedDays: number, dayNames: string[], weeklyMinutes: number) => string;
    reserve: string;
    draftModel: (count: number) => string;
    draftSample: (count: number) => string;
    draftDeclined: string;
    draftSampleDeclined: string;
    checkDraft: (count: number) => string;
    checkDeclined: string;
    fit: (placed: string[], time: string) => string;
    fitNone: string;
  };
  failure: {
    checkDraft: string;
    fit: string;
    streamEnded: string;
    timeout: string;
  };
};

function seconds(ms: number, decimal: string): string {
  return (ms / 1000).toFixed(1).replace('.', decimal);
}

function list(items: string[], and: string): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

const EN: StepsCopy = {
  heading: 'How this plan was made',
  demoNote: 'Demo: the draft comes from a built-in sample, not a model. Every other step runs on your inputs.',
  liveNote: 'Each step is reported as it runs. Steps marked Model call the AI; the rest is code.',
  labels: {
    check_request: 'Checking your request',
    check_availability: 'Checking your availability',
    reserve: 'Checking live AI limits',
    draft: 'Drafting sessions',
    check_draft: 'Checking the draft',
    fit: 'Fitting sessions into your week',
  },
  actors: { code: 'Code', model: 'Model', sample: 'Sample' },
  running: 'Running…',
  waiting: 'Waiting',
  duration: (ms) => (ms < 1 ? 'under 1 ms' : ms < 1000 ? `${Math.round(ms)} ms` : `${seconds(ms, '.')} s`),
  detail: {
    request: (days, minutes, weeklyMinutes) =>
      `${days} ${days === 1 ? 'day' : 'days'}, ${minutes} min per session, up to ${weeklyMinutes} min this week`,
    availability: (count, selectedDays, dayNames, weeklyMinutes) =>
      count < selectedDays
        ? `Your ${weeklyMinutes}-minute cap fits ${count} of ${selectedDays} days: ${list(dayNames, 'and')}`
        : `Room for ${count} ${count === 1 ? 'session' : 'sessions'}: ${list(dayNames, 'and')}`,
    reserve: 'Live AI slot reserved',
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
  failure: {
    checkDraft: 'The draft broke a planning rule, so nothing was scheduled.',
    fit: 'The plan could not be scheduled.',
    streamEnded: 'The connection ended before the plan was ready. Try again.',
    timeout: 'The plan took too long. Try again in a moment.',
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
    draft: 'Redactando sesiones',
    check_draft: 'Revisando el borrador',
    fit: 'Acomodando sesiones en tu semana',
  },
  actors: { code: 'Código', model: 'Modelo', sample: 'Muestra' },
  running: 'En curso…',
  waiting: 'En espera',
  duration: (ms) => (ms < 1 ? 'menos de 1 ms' : ms < 1000 ? `${Math.round(ms)} ms` : `${seconds(ms, ',')} s`),
  detail: {
    request: (days, minutes, weeklyMinutes) =>
      `${days} ${days === 1 ? 'día' : 'días'}, ${minutes} min por sesión, hasta ${weeklyMinutes} min esta semana`,
    availability: (count, selectedDays, dayNames, weeklyMinutes) =>
      count < selectedDays
        ? `Tu tope de ${weeklyMinutes} min alcanza para ${count} de ${selectedDays} días: ${list(dayNames, 'y')}`
        : `Hay lugar para ${count} ${count === 1 ? 'sesión' : 'sesiones'}: ${list(dayNames, 'y')}`,
    reserve: 'Turno de IA reservado',
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
  failure: {
    checkDraft: 'El borrador rompió una regla de planeación, así que no se programó nada.',
    fit: 'No se pudo programar el plan.',
    streamEnded: 'La conexión terminó antes de que el plan estuviera listo. Inténtalo de nuevo.',
    timeout: 'El plan tardó demasiado. Inténtalo de nuevo en un momento.',
  },
};

export function stepsCopyFor(language: Language): StepsCopy {
  return language === 'es' ? ES : EN;
}
