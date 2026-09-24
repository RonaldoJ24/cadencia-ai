// Calendar arithmetic on local dates and times. Dates are handled as UTC
// midnights so no time zone or daylight-saving shift can move a day.

import type { LocalDate, LocalTime, Weekday } from './types.ts';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/u;
const DAY_MS = 86_400_000;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isLocalTime(value: unknown): value is LocalTime {
  return typeof value === 'string' && TIME.test(value);
}

export function dateMs(date: LocalDate): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function dateFromMs(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return dateFromMs(dateMs(date) + days * DAY_MS);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((dateMs(to) - dateMs(from)) / DAY_MS);
}

/** Monday is 0, Sunday is 6. */
export function weekdayOf(date: LocalDate): Weekday {
  return ((new Date(dateMs(date)).getUTCDay() + 6) % 7) as Weekday;
}

export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, -weekdayOf(date));
}

export function minutesOf(time: LocalTime): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function timeOf(minutes: number): LocalTime {
  const clamped = Math.max(0, Math.min(1439, Math.floor(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/** Splits 'YYYY-MM-DDTHH:mm' into its date and minute of day. */
export function splitDateTime(value: string): { date: LocalDate; minutes: number } | null {
  const match = DATE_TIME.exec(value);
  if (!match || !isLocalDate(match[1])) return null;
  return { date: match[1], minutes: Number(match[2]) * 60 + Number(match[3]) };
}

export function dateTime(date: LocalDate, minutes: number): string {
  return `${date}T${timeOf(minutes)}`;
}
