// Validation for everything the planner schedules against. Values arrive
// from page controls, the model's reading of a goal, or an imported
// calendar, so each one is checked here before any scheduling runs.

import { isLanguage } from '../i18n.ts';
import { daysBetween, isLocalDate, isLocalTime, minutesOf, splitDateTime } from './time.ts';
import type { BusyInterval, Domain, GoalSpec, Level, Weekday } from './types.ts';

export const PLAN_LIMITS = {
  maxHorizonDays: 26 * 7,
  minSessionMinutes: 15,
  maxSessionMinutes: 240,
  minWeeklyCapMinutes: 15,
  maxWeeklyCapMinutes: 1_200,
  maxTitleChars: 160,
  maxBusyIntervals: 2_000,
  maxBusyDays: 31,
} as const;

export class SpecError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'SpecError';
    this.field = field;
  }
}

const DOMAINS: readonly Domain[] = ['fitness', 'learning', 'creative', 'general'];
const LEVELS: readonly Level[] = ['beginner', 'intermediate', 'advanced', 'unknown'];

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SpecError(field, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new SpecError(field, `${field} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function validateGoalSpec(raw: unknown): GoalSpec {
  const value = record(raw, 'spec');
  const title = value.title;
  if (typeof title !== 'string' || !title.trim() || title.length > PLAN_LIMITS.maxTitleChars || hasControl(title)) {
    throw new SpecError('title', `title must be 1 to ${PLAN_LIMITS.maxTitleChars} characters of plain text`);
  }
  if (!DOMAINS.includes(value.domain as Domain)) throw new SpecError('domain', 'domain is not supported');
  if (!isLanguage(value.language)) throw new SpecError('language', 'language must be en or es');
  if (!isLocalDate(value.startDate)) throw new SpecError('startDate', 'startDate must be a calendar date');
  if (!isLocalDate(value.deadline)) throw new SpecError('deadline', 'deadline must be a calendar date');
  const span = daysBetween(value.startDate, value.deadline);
  if (span < 0) throw new SpecError('deadline', 'deadline must not be before startDate');
  if (span >= PLAN_LIMITS.maxHorizonDays) {
    throw new SpecError('deadline', `a plan can cover at most ${PLAN_LIMITS.maxHorizonDays / 7} weeks`);
  }

  if (!Array.isArray(value.days) || value.days.length === 0 || value.days.length > 7) {
    throw new SpecError('days', 'days must list 1 to 7 weekdays');
  }
  const days = value.days.map((day, index) => integer(day, `days[${index}]`, 0, 6) as Weekday);
  if (new Set(days).size !== days.length) throw new SpecError('days', 'days must not repeat');

  const window = record(value.window, 'window');
  if (!isLocalTime(window.start) || !isLocalTime(window.end)) {
    throw new SpecError('window', 'window times must use HH:mm');
  }
  if (minutesOf(window.end) - minutesOf(window.start) < PLAN_LIMITS.minSessionMinutes) {
    throw new SpecError('window', `window must be at least ${PLAN_LIMITS.minSessionMinutes} minutes long`);
  }
  const weeklyCapMinutes = integer(
    value.weeklyCapMinutes,
    'weeklyCapMinutes',
    PLAN_LIMITS.minWeeklyCapMinutes,
    PLAN_LIMITS.maxWeeklyCapMinutes,
  );
  const level = value.level === undefined ? 'unknown' : value.level;
  if (!LEVELS.includes(level as Level)) throw new SpecError('level', 'level is not supported');
  const maxSessionMinutes = value.maxSessionMinutes === undefined
    ? undefined
    : integer(value.maxSessionMinutes, 'maxSessionMinutes', PLAN_LIMITS.minSessionMinutes, PLAN_LIMITS.maxSessionMinutes);

  return {
    title: title.trim(),
    domain: value.domain as Domain,
    language: value.language,
    startDate: value.startDate,
    deadline: value.deadline,
    days: [...days].sort((a, b) => a - b),
    window: { start: window.start, end: window.end },
    weeklyCapMinutes,
    level: level as Level,
    ...(maxSessionMinutes === undefined ? {} : { maxSessionMinutes }),
  };
}

/** Busy times from a calendar; each must be a forward interval of at most a month. */
export function validateBusy(raw: unknown): BusyInterval[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > PLAN_LIMITS.maxBusyIntervals) {
    throw new SpecError('busy', `busy must list at most ${PLAN_LIMITS.maxBusyIntervals} intervals`);
  }
  return raw.map((item, index) => {
    const value = record(item, `busy[${index}]`);
    const start = typeof value.start === 'string' ? splitDateTime(value.start) : null;
    const end = typeof value.end === 'string' ? splitDateTime(value.end) : null;
    if (!start || !end) throw new SpecError(`busy[${index}]`, 'busy times must use YYYY-MM-DDTHH:mm');
    const days = daysBetween(start.date, end.date);
    if (days < 0 || (days === 0 && end.minutes <= start.minutes) || days > PLAN_LIMITS.maxBusyDays) {
      throw new SpecError(`busy[${index}]`, 'a busy time must end after it starts and last at most a month');
    }
    return { start: value.start as string, end: value.end as string };
  });
}
