import { type RoutinePlan, type Session } from './routine.ts';

const GOOGLE_CALENDAR_URL = 'https://calendar.google.com/calendar/render';
const MAX_TIME_ZONE_CHARS = 128;
const MAX_EVENT_TITLE_CHARS = 160;
const MAX_EVENT_DETAILS_CHARS = 2_000;
const MAX_SHARE_CHARS = 8_000;
const MAX_SHARE_SESSIONS = 32;

const DAY_NAMES = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
];

function invalid(message: string): never {
  throw new Error(`Datos de calendario inválidos: ${message}`);
}

function bounded(value: string, max: number): string {
  const characters = Array.from(value);
  return characters.length <= max
    ? value
    : `${characters.slice(0, Math.max(0, max - 1)).join('')}…`;
}

function sourceText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    invalid(`${label} no es texto válido.`);
  return bounded(value, max);
}

function sourceInteger(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    invalid(`${label} no es válido.`);
  }
  return value;
}

function sourceDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    invalid('session.date no es una fecha válida.');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    invalid('session.date no es una fecha válida.');
  }
  return value;
}

function sourceTime(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/u.test(value)) {
    invalid('plan.input.time no es una hora válida.');
  }
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59)
    invalid('plan.input.time no es una hora válida.');
  return value;
}

function localDate(date: string, time: string, minutes = 0): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minute] = time.split(':').map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(hours, minute + minutes, 0, 0);
  if (
    Number.isNaN(value.getTime()) ||
    value.getUTCFullYear() < 1 ||
    value.getUTCFullYear() > 9_999
  ) {
    invalid('la fecha de la sesión queda fuera del rango exportable.');
  }
  return value;
}

function googleDateTime(value: Date): string {
  const year = String(value.getUTCFullYear()).padStart(4, '0');
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}00`;
}

function validTimeZone(timeZone: string): string {
  if (
    typeof timeZone !== 'string' ||
    timeZone.length === 0 ||
    Array.from(timeZone).length > MAX_TIME_ZONE_CHARS
  ) {
    throw new Error('Zona horaria IANA inválida.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw new Error('Zona horaria IANA inválida.');
  }
  return timeZone;
}

function sessionForCalendar(session: Session): {
  date: string;
  title: string;
  minutes: number;
  instructions: string;
  status: Session['status'];
} {
  if (!session || typeof session !== 'object') invalid('session no es válida.');
  if (session.status === 'missed') {
    throw new Error('No se puede añadir una sesión perdida al calendario.');
  }
  if (session.status !== 'planned' && session.status !== 'done') {
    invalid('session.status no es válido.');
  }
  return {
    date: sourceDate(session.date),
    title: sourceText(session.title, 'session.title', MAX_EVENT_TITLE_CHARS),
    minutes: sourceInteger(session.minutes, 'session.minutes', 1, 1_440),
    instructions: sourceText(
      session.instructions,
      'session.instructions',
      MAX_EVENT_DETAILS_CHARS,
    ),
    status: session.status,
  };
}

function planTime(plan: RoutinePlan): string {
  if (
    !plan ||
    typeof plan !== 'object' ||
    !plan.input ||
    typeof plan.input !== 'object'
  ) {
    invalid('plan no es válido.');
  }
  return sourceTime(plan.input.time);
}

export function googleCalendarUrl(
  plan: RoutinePlan,
  session: Session,
  timeZone: string,
): string {
  const time = planTime(plan);
  const zone = validTimeZone(timeZone);
  const current = sessionForCalendar(session);
  const start = localDate(current.date, time);
  const end = localDate(current.date, time, current.minutes);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: current.title,
    dates: `${googleDateTime(start)}/${googleDateTime(end)}`,
    details: current.instructions,
    ctz: zone,
  });
  return `${GOOGLE_CALENDAR_URL}?${params.toString()}`;
}

function shareSession(session: Session, time: string): string {
  const current = sessionForCalendar(session);
  return [
    `- ${current.date} · ${time} · ${current.title} · ${current.minutes} min (${current.status})`,
    `  ${current.instructions}`,
  ].join('\n');
}

export function routineShareText(plan: RoutinePlan): string {
  if (
    !plan ||
    typeof plan !== 'object' ||
    !plan.input ||
    typeof plan.input !== 'object'
  ) {
    invalid('plan no es válido.');
  }
  const title = sourceText(
    plan.intent?.title,
    'plan.intent.title',
    MAX_EVENT_TITLE_CHARS,
  );
  const time = sourceTime(plan.input.time);
  if (!Array.isArray(plan.input.days) || plan.input.days.length === 0) {
    invalid('plan.input.days no es válido.');
  }
  const days = plan.input.days.map((day) => {
    if (
      typeof day !== 'number' ||
      !Number.isInteger(day) ||
      day < 0 ||
      day > 6
    ) {
      invalid('plan.input.days no es válido.');
    }
    return DAY_NAMES[day];
  });
  const sessionMinutes = sourceInteger(
    plan.input.sessionMinutes,
    'plan.input.sessionMinutes',
    1,
    1_440,
  );
  const weeklyMinutes = sourceInteger(
    plan.input.weeklyMinutes,
    'plan.input.weeklyMinutes',
    1,
    10_080,
  );
  if (!Array.isArray(plan.sessions)) invalid('plan.sessions no es válido.');
  const sessions = plan.sessions
    .filter((session) => session.status !== 'missed')
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, MAX_SHARE_SESSIONS)
    .map((session) => shareSession(session, time));
  const lines = [
    title,
    `Cadencia: ${days.join(', ')} · ${time} · ${sessionMinutes} min por sesión · ${weeklyMinutes} min semanales`,
    '',
    'Sesiones programadas:',
    ...(sessions.length > 0 ? sessions : ['- No hay sesiones programadas.']),
  ];
  return bounded(lines.join('\n'), MAX_SHARE_CHARS);
}
