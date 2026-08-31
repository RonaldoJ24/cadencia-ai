export type RoutineInput = {
  request: string;
  days: number[];
  sessionMinutes: number;
  weeklyMinutes: number;
  startDate: string;
  time: string;
};

export type Intent = {
  title: string;
  goal: string;
  domain: 'learning' | 'creative' | 'general';
  steps: { title: string; instructions: string }[];
};

export type Session = {
  id: string;
  date: string;
  dayIndex: number;
  title: string;
  minutes: number;
  instructions: string;
  status: 'planned' | 'done' | 'missed';
};

export type RoutinePlan = {
  input: RoutineInput;
  intent: Intent;
  mode: 'demo' | 'deepseek';
  sessions: Session[];
  checks: { label: string; passed: boolean; detail: string }[];
  warnings: string[];
  explanation: string;
};

const MAX_REQUEST_CHARS = 2_000;
const MAX_WEEKLY_MINUTES = 10_080;
const MAX_SESSION_MINUTES = 1_440;
const MAX_INTENT_STEPS = 12;
const MAX_TITLE_CHARS = 160;
const MAX_GOAL_CHARS = 600;
const MAX_INSTRUCTIONS_CHARS = 2_000;

type Dict = Record<string, unknown>;

function dict(value: unknown): Dict | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function invalid(message: string): never {
  throw new Error(`Entrada inválida: ${message}`);
}

function hasControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(`${label} debe ser texto no vacío.`);
  }
  if (value.length > max) {
    invalid(`${label} supera el límite permitido.`);
  }
  if (hasControl(value)) {
    invalid(`${label} contiene caracteres de control.`);
  }
  return value;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    invalid(`${label} debe ser un entero finito.`);
  }
  if (value < min || value > max) {
    invalid(`${label} debe estar entre ${min} y ${max}.`);
  }
  return value;
}

function isoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    invalid(`${label} debe usar el formato YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || year > 9_999) {
    invalid(`${label} no es una fecha válida.`);
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    invalid(`${label} no es una fecha válida.`);
  }
  return value;
}

function dateValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(start: string, offset: number): string {
  const date = dateValue(start);
  date.setUTCDate(date.getUTCDate() + offset);
  return dateString(date);
}

function dayOffset(start: string, date: string): number {
  return Math.round((dateValue(date).getTime() - dateValue(start).getTime()) / 86_400_000);
}

function mondayIndex(date: string): number {
  return (dateValue(date).getUTCDay() + 6) % 7;
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function timeValue(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/u.test(value)) {
    invalid('time debe usar el formato HH:mm.');
  }
  const [hours, minutesPart] = value.split(':').map(Number);
  if (hours > 23 || minutesPart > 59) {
    invalid('time debe ser una hora local válida.');
  }
  return value;
}

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function restrictedRequest(request: string): boolean {
  const normalized = request
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  return /\b(?:diagnos(?:is|tico|tica|ticos|ticas|ticar)?|sintom(?:a|as)?|tratamiento(?:s)?|medicamento(?:s)?|dosis|enfermedad(?:es)?|lesion(?:es)?|dolor(?:es)?|ejercicio(?:s)?|entrenamiento(?:s)?|fitness|calorias|dieta(?:s)?|nutricion|perder peso|ganar musculo|symptom(?:s)?|medical|medicine|medication|dosage|disease(?:s)?|injur(?:y|ies)|pain|exercise|workout|calorie(?:s)?|diet(?:s)?|weight loss|muscle gain|invertir|inversion(?:es)?|acciones|cripto(?:moneda)?|trading|prestamo(?:s)?|credito|hipoteca|impuesto(?:s)?|finanzas personales|asesoria financiera|ganar dinero|invest(?:ment|ing)?|stocks?|crypto(?:currency)?|loan|credit|mortgage|tax(?:es)?|personal finance|financial advice|make money|abogado(?:s)?|asesoria legal|demanda(?:s)?|contrato(?:s)?|litigio|derechos legales|divorcio|visa|inmigracion|testamento|lawyer|legal advice|lawsuit|contract|litigation|legal rights|divorce|immigration)\b/u.test(normalized);
}

function scopeIntent(): Intent {
  return {
    title: 'Solicitud fuera de alcance',
    goal: 'Cadencia organiza aprendizaje, práctica creativa y trabajo personal general; no ofrece orientación médica, de ejercicio, financiera ni legal.',
    domain: 'general',
    steps: [
      {
        title: 'Reformula el objetivo',
        instructions:
          'Pide una rutina de aprendizaje, creatividad u organización general sin asesoría especializada.',
      },
    ],
  };
}

function domainFor(request: string): Intent['domain'] {
  if (/(?:aprender|estudiar|idioma|inglés|ingles|curso|lectura|leer|programar|programación|programacion|learn|study|language|course|read|code)/iu.test(request)) {
    return 'learning';
  }
  if (/(?:dibujar|pintar|acuarela|escribir|música|musica|diseño|diseno|fotografía|fotografia|crear|draw|paint|write|music|design|create)/iu.test(request)) {
    return 'creative';
  }
  return 'general';
}

function demoSteps(domain: Intent['domain']): Intent['steps'] {
  if (domain === 'learning') {
    return [
      {
        title: 'Define una evidencia',
        instructions: 'Escribe qué podrás explicar o producir al terminar la semana.',
      },
      {
        title: 'Practica en un bloque',
        instructions: 'Trabaja con una sola fuente o ejercicio y anota la parte que te costó.',
      },
      {
        title: 'Recuerda y revisa',
        instructions: 'Cierra sin consultar tus notas y registra qué conservarás para la próxima sesión.',
      },
    ];
  }
  if (domain === 'creative') {
    return [
      {
        title: 'Elige un foco',
        instructions: 'Reduce la idea a un detalle concreto que puedas explorar esta semana.',
      },
      {
        title: 'Crea una versión breve',
        instructions: 'Haz una primera versión sin pulirla durante el bloque completo.',
      },
      {
        title: 'Observa y guarda',
        instructions: 'Anota una decisión que funcionó y guarda una muestra para comparar después.',
      },
    ];
  }
  return [
    {
      title: 'Aclara el siguiente paso',
      instructions: 'Escribe el resultado pequeño que dejará esta sesión terminada.',
    },
    {
      title: 'Haz el bloque principal',
      instructions: 'Trabaja en una sola tarea y aparta las ideas secundarias para después.',
    },
    {
      title: 'Cierra con una nota',
      instructions: 'Registra lo que avanzó y el primer movimiento de la próxima sesión.',
    },
  ];
}

function cloneInput(input: RoutineInput): RoutineInput {
  return { ...input, days: [...input.days] };
}

function cloneIntent(intent: Intent): Intent {
  return { ...intent, steps: intent.steps.map((step) => ({ ...step })) };
}

function cloneSession(session: Session): Session {
  return { ...session };
}

export function validateInput(input: unknown): RoutineInput {
  const value = dict(input);
  if (!value) invalid('input debe ser un objeto.');

  const request = text(value.request, 'request', MAX_REQUEST_CHARS);
  if (!Array.isArray(value.days) || value.days.length === 0 || value.days.length > 7) {
    invalid('days debe contener entre 1 y 7 días.');
  }
  const days = value.days.map((day, index) => integer(day, `days[${index}]`, 0, 6));
  if (new Set(days).size !== days.length) {
    invalid('days no puede contener días repetidos.');
  }

  const sessionMinutes = integer(value.sessionMinutes, 'sessionMinutes', 1, MAX_SESSION_MINUTES);
  const weeklyMinutes = integer(value.weeklyMinutes, 'weeklyMinutes', 1, MAX_WEEKLY_MINUTES);
  if (weeklyMinutes < sessionMinutes) {
    invalid('weeklyMinutes debe cubrir al menos una sesión completa.');
  }

  const startDate = isoDate(value.startDate, 'startDate');
  if (mondayIndex(startDate) !== 0) {
    invalid('startDate debe ser lunes.');
  }
  const time = timeValue(value.time);
  if (timeMinutes(time) + sessionMinutes >= 1_440) {
    invalid('La sesión debe terminar antes de cambiar de día.');
  }

  return { request, days: [...days], sessionMinutes, weeklyMinutes, startDate, time };
}

export function validateIntent(input: unknown): Intent {
  const value = dict(input);
  if (!value) invalid('intent debe ser un objeto.');
  const title = text(value.title, 'intent.title', MAX_TITLE_CHARS);
  const goal = text(value.goal, 'intent.goal', MAX_GOAL_CHARS);
  if (value.domain !== 'learning' && value.domain !== 'creative' && value.domain !== 'general') {
    invalid('intent.domain no es válido.');
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > MAX_INTENT_STEPS) {
    invalid('intent.steps debe contener entre 1 y 12 pasos.');
  }
  const steps = value.steps.map((step, index) => {
    const item = dict(step);
    if (!item) invalid(`intent.steps[${index}] debe ser un objeto.`);
    return {
      title: text(item.title, `intent.steps[${index}].title`, MAX_TITLE_CHARS),
      instructions: text(
        item.instructions,
        `intent.steps[${index}].instructions`,
        MAX_INSTRUCTIONS_CHARS,
      ),
    };
  });
  return { title, goal, domain: value.domain, steps };
}

export function demoIntent(request: string): Intent {
  const safeRequest = text(request, 'request', MAX_REQUEST_CHARS);
  if (restrictedRequest(safeRequest)) return scopeIntent();
  const label = compact(safeRequest).slice(0, 96);
  const domain = domainFor(safeRequest);
  const prefix = domain === 'learning' ? 'Aprendizaje' : domain === 'creative' ? 'Práctica creativa' : 'Trabajo personal';
  return {
    title: `${prefix}: ${label}`,
    goal: `Avanzar en «${label}» con pasos pequeños y comprobables.`,
    domain,
    steps: demoSteps(domain),
  };
}

function checksFor(input: RoutineInput, sessions: Session[]) {
  const allowed = new Set(input.days);
  const dates = new Set<string>();
  const validDates = sessions.every((session) => {
    const offset = dayOffset(input.startDate, session.date);
    const dateMatchesIndex = offset === session.dayIndex;
    const inWeek = offset >= 0 && offset <= 6;
    dates.add(session.date);
    return inWeek && dateMatchesIndex && allowed.has(session.dayIndex);
  });
  const sameDuration = sessions.every((session) => session.minutes === input.sessionMinutes);
  const activeMinutes = sessions
    .filter((session) => session.status !== 'missed')
    .reduce((total, session) => total + session.minutes, 0);
  return [
    {
      label: 'Días elegidos',
      passed: validDates,
      detail: validDates
        ? 'Cada sesión cae en un día permitido de la semana seleccionada.'
        : 'Hay una sesión fuera de los días o de la semana seleccionada.',
    },
    {
      label: 'Duración por sesión',
      passed: sameDuration,
      detail: `${input.sessionMinutes} min por sesión.`,
    },
    {
      label: 'Tope semanal',
      passed: activeMinutes <= input.weeklyMinutes,
      detail: `${activeMinutes} de ${input.weeklyMinutes} min en sesiones programadas o hechas.`,
    },
    {
      label: 'Sin colisiones',
      passed: dates.size === sessions.length,
      detail: dates.size === sessions.length ? 'Una sesión como máximo por día.' : 'Hay dos sesiones el mismo día.',
    },
  ];
}

function baseExplanation(input: RoutineInput, mode: RoutinePlan['mode'], sessions: Session[]): string {
  const activeMinutes = sessions
    .filter((session) => session.status !== 'missed')
    .reduce((total, session) => total + session.minutes, 0);
  const source = mode === 'demo'
    ? 'El contenido es una salida determinista de demostración.'
    : 'El contenido fue propuesto por DeepSeek y el calendario fue validado de forma determinista.';
  return `${source} Se conservaron los días y la hora indicados; ${sessions.length} sesión(es) usan ${activeMinutes} de ${input.weeklyMinutes} min del tope semanal.`;
}

function planWithChecks(
  plan: RoutinePlan,
  warnings: string[] = plan.warnings,
  explanation = plan.explanation,
): RoutinePlan {
  return {
    input: cloneInput(plan.input),
    intent: cloneIntent(plan.intent),
    mode: plan.mode,
    sessions: plan.sessions.map(cloneSession),
    checks: checksFor(plan.input, plan.sessions),
    warnings: [...new Set(warnings)],
    explanation,
  };
}

export function buildPlan(
  rawInput: RoutineInput,
  rawIntent?: Intent,
  mode: RoutinePlan['mode'] = 'demo',
): RoutinePlan {
  const input = validateInput(rawInput);
  if (mode !== 'demo' && mode !== 'deepseek') invalid('mode no es válido.');
  const candidate = rawIntent === undefined ? demoIntent(input.request) : validateIntent(rawIntent);
  const warnings: string[] = [];
  const unsafe = restrictedRequest(input.request);
  const intent = unsafe ? scopeIntent() : candidate;
  if (unsafe) {
    warnings.push('Esta solicitud queda fuera de alcance; no se ofrece orientación médica, de ejercicio, financiera ni legal.');
  }

  const capacity = Math.floor(input.weeklyMinutes / input.sessionMinutes);
  const selectedDays = [...input.days].sort((a, b) => a - b);
  const sessionCount = unsafe ? 0 : Math.min(selectedDays.length, capacity);
  if (!unsafe && sessionCount < selectedDays.length) {
    warnings.push(
      `El tope semanal permite ${sessionCount} de ${selectedDays.length} días elegidos; se dejaron días sin sesión.`,
    );
  }
  const sessions = selectedDays.slice(0, sessionCount).map((dayIndex, index) => {
    const date = addDays(input.startDate, dayIndex);
    const step = intent.steps[index % intent.steps.length];
    const prefix = `Paso ${index + 1}: `;
    return {
      id: `session-${date}`,
      date,
      dayIndex,
      title: `${prefix}${step.title.slice(0, MAX_TITLE_CHARS - prefix.length)}`,
      minutes: input.sessionMinutes,
      instructions: step.instructions,
      status: 'planned' as const,
    };
  });
  const plan: RoutinePlan = {
    input: cloneInput(input),
    intent: cloneIntent(intent),
    mode,
    sessions,
    checks: [],
    warnings,
    explanation: baseExplanation(input, mode, sessions),
  };
  return planWithChecks(plan);
}

function validateSession(input: RoutineInput, value: unknown, index: number): Session {
  const item = dict(value);
  if (!item) invalid(`sessions[${index}] debe ser un objeto.`);
  const id = text(item.id, `sessions[${index}].id`, 160);
  if (!/^[A-Za-z0-9:_-]+$/u.test(id)) invalid(`sessions[${index}].id no es válido.`);
  const date = isoDate(item.date, `sessions[${index}].date`);
  const dayIndex = integer(item.dayIndex, `sessions[${index}].dayIndex`, 0, 6);
  if (dayOffset(input.startDate, date) !== dayIndex) {
    invalid(`sessions[${index}] no coincide con su día.`);
  }
  const minutes = integer(item.minutes, `sessions[${index}].minutes`, 1, MAX_SESSION_MINUTES);
  const title = text(item.title, `sessions[${index}].title`, MAX_TITLE_CHARS);
  const instructions = text(item.instructions, `sessions[${index}].instructions`, MAX_INSTRUCTIONS_CHARS);
  if (item.status !== 'planned' && item.status !== 'done' && item.status !== 'missed') {
    invalid(`sessions[${index}].status no es válido.`);
  }
  return { id, date, dayIndex, title, minutes, instructions, status: item.status };
}

function copyPlan(rawPlan: RoutinePlan): RoutinePlan {
  const source = dict(rawPlan);
  if (!source) invalid('plan debe ser un objeto.');
  const input = validateInput(source.input);
  const intent = validateIntent(source.intent);
  if (source.mode !== 'demo' && source.mode !== 'deepseek') invalid('plan.mode no es válido.');
  if (!Array.isArray(source.sessions)) invalid('plan.sessions debe ser una lista.');
  const sessions = source.sessions.map((session, index) => validateSession(input, session, index));
  const ids = new Set<string>();
  const dates = new Set<string>();
  for (const session of sessions) {
    if (ids.has(session.id)) invalid('plan contiene IDs repetidos.');
    if (dates.has(session.date)) invalid('plan contiene días ocupados repetidos.');
    ids.add(session.id);
    dates.add(session.date);
  }
  if (!Array.isArray(source.warnings) || source.warnings.some((warning) => typeof warning !== 'string')) {
    invalid('plan.warnings no es válido.');
  }
  if (typeof source.explanation !== 'string') invalid('plan.explanation no es válido.');
  if (!Array.isArray(source.checks)) invalid('plan.checks debe ser una lista.');
  return {
    input,
    intent,
    mode: source.mode,
    sessions,
    checks: source.checks.map((check, index) => {
      const item = dict(check);
      if (!item || typeof item.label !== 'string' || typeof item.passed !== 'boolean' || typeof item.detail !== 'string') {
        invalid(`plan.checks[${index}] no es válido.`);
      }
      return { label: item.label, passed: item.passed, detail: item.detail };
    }),
    warnings: [...source.warnings],
    explanation: source.explanation,
  };
}

function replacementId(date: string, sessions: Session[]): string {
  const ids = new Set(sessions.map((session) => session.id));
  const base = `session-${date}`;
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function replan(plan: RoutinePlan, missedId: string): RoutinePlan {
  const next = copyPlan(plan);
  if (typeof missedId !== 'string' || missedId.trim() === '') invalid('missedId debe ser texto.');
  const index = next.sessions.findIndex((session) => session.id === missedId);
  if (index < 0) throw new Error('Sesión no encontrada.');
  const missed = next.sessions[index];
  if (missed.status === 'missed') throw new Error('La sesión ya está marcada como perdida.');
  if (missed.status === 'done') throw new Error('No se puede reprogramar una sesión hecha.');

  next.sessions[index] = { ...missed, status: 'missed' };
  const occupied = new Set(next.sessions.map((session) => session.date));
  const activeMinutes = next.sessions
    .filter((session) => session.status !== 'missed')
    .reduce((total, session) => total + session.minutes, 0);
  const missedOffset = dayOffset(next.input.startDate, missed.date);
  let replacement: Session | undefined;
  if (missedOffset >= 0 && missedOffset < 6 && activeMinutes + missed.minutes <= next.input.weeklyMinutes) {
    for (let offset = missedOffset + 1; offset <= 6; offset += 1) {
      if (!next.input.days.includes(offset)) continue;
      const date = addDays(next.input.startDate, offset);
      if (occupied.has(date)) continue;
      replacement = {
        ...missed,
        id: replacementId(date, next.sessions),
        date,
        dayIndex: offset,
        status: 'planned',
      };
      break;
    }
  }

  const warnings = [...next.warnings];
  const explanation = replacement
    ? `${next.explanation} Se marcó la sesión del ${missed.date} como perdida y se reprogramó para el ${replacement.date}.`
    : `${next.explanation} Se marcó la sesión del ${missed.date} como perdida, pero no hay un día permitido y libre posterior en esta semana.`;
  if (!replacement) {
    warnings.push('No hay un día permitido y libre después de la sesión perdida dentro de esta semana; no se creó una sesión adicional.');
  } else {
    next.sessions.push(replacement);
  }
  next.sessions.sort((a, b) => a.date.localeCompare(b.date));
  return planWithChecks(next, warnings, explanation);
}

export function markDone(plan: RoutinePlan, id: string): RoutinePlan {
  const next = copyPlan(plan);
  if (typeof id !== 'string' || id.trim() === '') invalid('id debe ser texto.');
  const index = next.sessions.findIndex((session) => session.id === id);
  if (index < 0) throw new Error('Sesión no encontrada.');
  if (next.sessions[index].status === 'missed') {
    throw new Error('No se puede marcar como hecha una sesión perdida.');
  }
  if (next.sessions[index].status === 'planned') {
    next.sessions[index] = { ...next.sessions[index], status: 'done' };
  }
  return planWithChecks(next);
}

function markdownText(value: string): string {
  return compact(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/([\\`*_{}[\]()#+.!|])/gu, '\\$1');
}

export function toMarkdown(plan: RoutinePlan): string {
  const current = copyPlan(plan);
  const mode = current.mode === 'demo' ? 'Demo · salida determinista de ejemplo' : 'IA real · proveedor DeepSeek opcional';
  const lines = [
    `# ${markdownText(current.intent.title)}`,
    '',
    `**Solicitud:** ${markdownText(current.input.request)}`,
    `**Objetivo:** ${markdownText(current.intent.goal)}`,
    `**Modo:** ${mode}`,
    '',
    current.explanation,
    '',
    '## Sesiones',
    '',
  ];
  for (const session of current.sessions) {
    const marker = session.status === 'done' ? 'x' : session.status === 'missed' ? '-' : ' ';
    lines.push(`- [${marker}] ${session.date} · ${markdownText(session.title)} · ${session.minutes} min (${session.status})`);
    lines.push(`  ${markdownText(session.instructions)}`);
  }
  lines.push('', '## Comprobaciones', '');
  for (const check of current.checks) {
    lines.push(`- [${check.passed ? 'x' : ' '}] ${markdownText(check.label)}: ${markdownText(check.detail)}`);
  }
  if (current.warnings.length > 0) {
    lines.push('', '## Avisos', '');
    for (const warning of current.warnings) lines.push(`- ${markdownText(warning)}`);
  }
  return `${lines.join('\n')}\n`;
}

function icsText(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/\r\n|\r|\n/gu, '\\n')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,');
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function foldLine(line: string): string {
  if (byteLength(line) <= 75) return line;
  const chunks: string[] = [];
  let chunk = '';
  let limit = 75;
  for (const character of line) {
    if (chunk && byteLength(`${chunk}${character}`) > limit) {
      chunks.push(chunk);
      chunk = '';
      limit = 74;
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((part, index) => (index === 0 ? part : ` ${part}`)).join('\r\n');
}

function icsDateTime(date: string, time: string): string {
  return `${date.replace(/-/gu, '')}T${time.replace(':', '')}00`;
}

function icsEnd(date: string, time: string, minutes: number): string {
  const end = dateValue(date);
  end.setUTCMinutes(timeMinutes(time) + minutes);
  const hours = String(end.getUTCHours()).padStart(2, '0');
  const mins = String(end.getUTCMinutes()).padStart(2, '0');
  return `${dateString(end).replace(/-/gu, '')}T${hours}${mins}00`;
}

function routineFingerprint(input: RoutineInput): string {
  let hash = 2_166_136_261;
  const material = `${input.request}|${input.startDate}|${input.time}|${input.days.join(',')}`;
  for (const character of material) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function exportStamp(): string {
  return `${new Date().toISOString().slice(0, 19).replace(/[-:]/gu, '')}Z`;
}

export function toICS(plan: RoutinePlan): string {
  const current = copyPlan(plan);
  const routineId = routineFingerprint(current.input);
  const stamp = exportStamp();
  const weekStart = current.input.startDate;
  const events = current.sessions.filter((session) => {
    const offset = dayOffset(weekStart, session.date);
    return session.status !== 'missed' && offset >= 0 && offset <= 6;
  });
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cadencia//Plan semanal//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const session of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:routine-${routineId}-${session.id}@cadencia.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDateTime(session.date, current.input.time)}`,
      `DTEND:${icsEnd(session.date, current.input.time, session.minutes)}`,
      `SUMMARY:${icsText(session.title)}`,
      `DESCRIPTION:${icsText(session.instructions)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
