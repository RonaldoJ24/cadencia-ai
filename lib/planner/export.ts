// Calendar exports for goal plans. Times are floating local times, as in the
// one-week export: a calendar app shows them at the same wall-clock time the
// plan was made for.

import { copyFor, type Language } from '../i18n.ts';
import { addDays, minutesOf, timeOf } from './time.ts';
import type { GoalPlan, LocalDate, LocalTime, PlannedSession } from './types.ts';

const GOOGLE_CALENDAR_URL = 'https://calendar.google.com/calendar/render';

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

/** Folds a content line at 75 octets without splitting a character. */
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

/** Start and end as compact local date-times, e.g. 20261001T063000. */
export function sessionTimes(session: PlannedSession): { start: string; end: string } {
  const startMinutes = minutesOf(session.start);
  const endTotal = startMinutes + session.minutes;
  const endDate: LocalDate = addDays(session.date, Math.floor(endTotal / 1_440));
  const endTime: LocalTime = timeOf(endTotal % 1_440);
  const compact = (date: LocalDate, time: LocalTime) => `${date.replace(/-/gu, '')}T${time.replace(':', '')}00`;
  return { start: compact(session.date, session.start), end: compact(endDate, endTime) };
}

export function sessionDescription(session: PlannedSession, language: Language): string {
  const exportCopy = copyFor(language).export;
  return [
    `${exportCopy.agenda}:`,
    ...session.blocks.map((block, index) => `${index + 1}. ${block.minutes} min — ${block.activity}`),
    '',
    `${exportCopy.deliverable}: ${session.deliverable}`,
    `${exportCopy.doneWhen}: ${session.doneWhen}`,
  ].join('\n');
}

function planFingerprint(plan: GoalPlan): string {
  const { spec } = plan;
  let hash = 2_166_136_261;
  const material = `${spec.title}|${spec.startDate}|${spec.deadline}|${spec.window.start}|${spec.days.join(',')}`;
  for (const character of material) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Every session that is not marked missed, as one calendar file. */
export function toGoalICS(plan: GoalPlan, now: Date = new Date()): string {
  const language = plan.spec.language;
  const exportCopy = copyFor(language).export;
  const stamp = `${now.toISOString().slice(0, 19).replace(/[-:]/gu, '')}Z`;
  const planId = planFingerprint(plan);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Cadencia//${exportCopy.icsProductId}//${language.toUpperCase()}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const session of plan.weeks.flatMap((week) => week.sessions)) {
    if (session.status === 'missed') continue;
    const times = sessionTimes(session);
    lines.push(
      'BEGIN:VEVENT',
      `UID:goal-${planId}-${session.id}@cadencia.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${times.start}`,
      `DTEND:${times.end}`,
      `SUMMARY:${icsText(session.title)}`,
      `DESCRIPTION:${icsText(sessionDescription(session, language))}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

function validTimeZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** A link that opens Google Calendar with one session filled in. */
export function googleCalendarLink(session: PlannedSession, language: Language, timeZone: string): string {
  const times = sessionTimes(session);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: session.title,
    dates: `${times.start}/${times.end}`,
    details: sessionDescription(session, language),
    ctz: validTimeZone(timeZone),
  });
  return `${GOOGLE_CALENDAR_URL}?${params.toString()}`;
}
