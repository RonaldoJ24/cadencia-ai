// What a person sends to plan a goal, what the model reads in it, and how
// code combines both into a GoalSpec. Settings the person touched always
// win, the model's reading fills what they left open, and code defaults fill
// the rest. Every field records where its value came from.

import { isLanguage, type Language } from '../i18n.ts';
import { PLAN_LIMITS, SpecError, hasControl, validateGoalSpec } from './spec.ts';
import { addDays, daysBetween, isLocalDate, isLocalTime, minutesOf } from './time.ts';
import type { BusyInterval, Domain, GoalSpec, Level, LocalDate, TimeWindow, Weekday } from './types.ts';

export const GOAL_LIMITS = {
  maxTextChars: 2_000,
  maxQuestionChars: 300,
  maxAnswerChars: 500,
  /** How far the browser's date may be from the server's UTC date. */
  todaySkewDays: 1,
} as const;

/** Time-of-day options the model picks from; the same spans are in its prompt. */
export const WINDOW_PRESETS = {
  early_morning: { start: '05:00', end: '08:00' },
  morning: { start: '06:00', end: '10:00' },
  midday: { start: '11:00', end: '14:00' },
  afternoon: { start: '14:00', end: '18:00' },
  evening: { start: '18:00', end: '21:00' },
  night: { start: '21:00', end: '23:30' },
} as const satisfies Record<string, TimeWindow>;

export type WindowPreset = keyof typeof WINDOW_PRESETS;

export const GOAL_DEFAULTS = {
  days: [0, 2, 4] as Weekday[],
  window: 'evening' as WindowPreset,
  weeklyMinutes: 150,
  weeks: 8,
} as const;

export const ABSTAIN_CATEGORIES = [
  'medical',
  'eating',
  'extreme_timeline',
  'harm',
  'specialized_advice',
  'not_a_goal',
] as const;
export type AbstainCategory = (typeof ABSTAIN_CATEGORIES)[number];

export type GoalControls = {
  deadline?: LocalDate;
  days?: Weekday[];
  window?: TimeWindow;
  weeklyMinutes?: number;
  level?: Level;
};

export type ControlName = keyof GoalControls;

export type GoalRequest = {
  text: string;
  language: Language;
  today: LocalDate;
  controls: GoalControls;
  busy: BusyInterval[];
  clarification: { question: string; answer: string } | null;
};

export type GoalReading = {
  decision: 'plan' | 'clarify' | 'abstain';
  title: string;
  summary: string;
  domain: Domain;
  level: Level;
  deadline: LocalDate | null;
  deadlineBasis: 'stated' | 'inferred' | 'none';
  days: Weekday[] | null;
  window: WindowPreset | null;
  weeklyMinutes: number | null;
  sessionMinutes: number | null;
  question: string | null;
  abstain: { category: AbstainCategory; reason: string } | null;
};

export type Source = 'you' | 'goal' | 'default' | 'adjusted';

export type Provenance = {
  deadline: { source: Source; basis?: 'stated' | 'inferred'; note?: 'past' | 'too_far' };
  days: { source: Source };
  window: { source: Source; preset?: WindowPreset };
  weeklyMinutes: { source: Source };
  level: { source: Source };
};

const DOMAINS: readonly Domain[] = ['fitness', 'learning', 'creative', 'general'];
const LEVELS: readonly Level[] = ['beginner', 'intermediate', 'advanced', 'unknown'];
const CONTROL_NAMES: readonly ControlName[] = ['deadline', 'days', 'window', 'weeklyMinutes', 'level'];
/** How the service names the settings the model must not ask about. */
const SERVICE_NAMES: Partial<Record<ControlName, string>> = {
  deadline: 'deadline',
  days: 'days',
  window: 'window',
  weeklyMinutes: 'weekly_minutes',
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Line breaks and tabs become spaces; any other control character is refused. */
function plainText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new SpecError(field, `${field} must be text`);
  const text = value.replace(/[\t\n\r]+/gu, ' ').trim();
  if (!text || text.length > max || hasControl(text)) {
    throw new SpecError(field, `${field} must be 1 to ${max} characters of plain text`);
  }
  return text;
}

function weekdays(value: unknown, field: string): Weekday[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 7 ||
    value.some((day) => !Number.isInteger(day) || (day as number) < 0 || (day as number) > 6) ||
    new Set(value).size !== value.length
  ) {
    throw new SpecError(field, `${field} must list distinct weekdays from 0 to 6`);
  }
  return [...(value as Weekday[])].sort((a, b) => a - b);
}

/** The earliest and latest deadline a plan starting tomorrow can have. */
export function deadlineRange(today: LocalDate): { first: LocalDate; last: LocalDate } {
  const first = addDays(today, 1);
  return { first, last: addDays(first, PLAN_LIMITS.maxHorizonDays - 1) };
}

function controlsOf(raw: unknown, today: LocalDate): GoalControls {
  if (raw === undefined || raw === null) return {};
  const value = record(raw);
  if (!value) throw new SpecError('controls', 'controls must be an object');
  const unknown = Object.keys(value).find((key) => !CONTROL_NAMES.includes(key as ControlName));
  if (unknown) throw new SpecError('controls', `unknown setting ${unknown.slice(0, 40)}`);
  const controls: GoalControls = {};
  if (value.deadline !== undefined) {
    const { first, last } = deadlineRange(today);
    if (!isLocalDate(value.deadline) || value.deadline < first || value.deadline > last) {
      throw new SpecError('deadline', `the deadline must fall between ${first} and ${last}`);
    }
    controls.deadline = value.deadline;
  }
  if (value.days !== undefined) controls.days = weekdays(value.days, 'days');
  if (value.window !== undefined) {
    const window = record(value.window);
    if (
      !window ||
      !isLocalTime(window.start) ||
      !isLocalTime(window.end) ||
      minutesOf(window.end) - minutesOf(window.start) < PLAN_LIMITS.minSessionMinutes
    ) {
      throw new SpecError('window', `the time window must be at least ${PLAN_LIMITS.minSessionMinutes} minutes, start before end`);
    }
    controls.window = { start: window.start, end: window.end };
  }
  if (value.weeklyMinutes !== undefined) {
    const minutes = value.weeklyMinutes;
    if (
      typeof minutes !== 'number' ||
      !Number.isInteger(minutes) ||
      minutes < PLAN_LIMITS.minWeeklyCapMinutes ||
      minutes > PLAN_LIMITS.maxWeeklyCapMinutes
    ) {
      throw new SpecError(
        'weeklyMinutes',
        `weekly minutes must be ${PLAN_LIMITS.minWeeklyCapMinutes} to ${PLAN_LIMITS.maxWeeklyCapMinutes}`,
      );
    }
    controls.weeklyMinutes = minutes;
  }
  if (value.level !== undefined) {
    if (!LEVELS.includes(value.level as Level)) throw new SpecError('level', 'level is not supported');
    controls.level = value.level as Level;
  }
  return controls;
}

/**
 * Checks a goal request from the browser. `serverToday` is the server's UTC
 * date; the browser's own date may differ from it by a day across time zones.
 */
export function validateGoalRequest(raw: unknown, serverToday?: LocalDate): GoalRequest {
  const value = record(raw);
  if (!value) throw new SpecError('input', 'the request must be an object');
  const text = plainText(value.text, 'text', GOAL_LIMITS.maxTextChars);
  if (!isLanguage(value.language)) throw new SpecError('language', 'language must be en or es');
  if (!isLocalDate(value.today)) throw new SpecError('today', 'today must be a calendar date');
  if (serverToday && Math.abs(daysBetween(serverToday, value.today)) > GOAL_LIMITS.todaySkewDays) {
    throw new SpecError('today', 'today does not match the current date');
  }
  const controls = controlsOf(value.controls, value.today);
  // Calendar import arrives with its own limits and indexing in a later phase.
  if (value.busy !== undefined && (!Array.isArray(value.busy) || value.busy.length > 0)) {
    throw new SpecError('busy', 'busy times are not accepted yet');
  }
  let clarification: GoalRequest['clarification'] = null;
  if (value.clarification !== undefined && value.clarification !== null) {
    const answer = record(value.clarification);
    if (!answer) throw new SpecError('clarification', 'clarification must be an object');
    clarification = {
      question: plainText(answer.question, 'question', GOAL_LIMITS.maxQuestionChars),
      answer: plainText(answer.answer, 'answer', GOAL_LIMITS.maxAnswerChars),
    };
  }
  return { text, language: value.language, today: value.today, controls, busy: [], clarification };
}

/** The settings the person touched, named as the service expects. */
export function providedSettings(controls: GoalControls): string[] {
  return CONTROL_NAMES.flatMap((name) => {
    const serviceName = SERVICE_NAMES[name];
    return controls[name] !== undefined && serviceName ? [serviceName] : [];
  });
}

function nullable<T>(value: unknown, check: (item: unknown) => item is T, field: string): T | null {
  if (value === null) return null;
  if (!check(value)) throw new SpecError('reading', `the reading has an invalid ${field}`);
  return value;
}

function isText(max: number) {
  return (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= max && !hasControl(value);
}

/**
 * Checks the service's reading again in code, since code acts on it: only
 * fixed options, real dates, distinct weekdays and in-range minutes pass.
 */
export function validateReading(raw: unknown): GoalReading {
  const value = record(raw);
  if (!value) throw new SpecError('reading', 'the reading must be an object');
  const decision = value.decision;
  if (decision !== 'plan' && decision !== 'clarify' && decision !== 'abstain') {
    throw new SpecError('reading', 'the reading has no valid decision');
  }
  if (!isText(80)(value.title) || !isText(300)(value.summary)) {
    throw new SpecError('reading', 'the reading needs a short title and summary');
  }
  if (!DOMAINS.includes(value.domain as Domain) || !LEVELS.includes(value.level as Level)) {
    throw new SpecError('reading', 'the reading has an unknown domain or level');
  }
  const deadline = nullable(value.deadline, isLocalDate, 'deadline');
  const basis = value.deadline_basis;
  if (
    (basis !== 'stated' && basis !== 'inferred' && basis !== 'none') ||
    (deadline === null) !== (basis === 'none')
  ) {
    throw new SpecError('reading', 'the reading has an inconsistent deadline');
  }
  const days = value.days === null ? null : weekdays(value.days, 'reading.days');
  const window = nullable(
    value.window,
    (item): item is WindowPreset => typeof item === 'string' && Object.hasOwn(WINDOW_PRESETS, item),
    'window',
  );
  const minutes = (min: number, max: number) => (item: unknown): item is number =>
    typeof item === 'number' && Number.isInteger(item) && item >= min && item <= max;
  const weeklyMinutes = nullable(value.weekly_minutes, minutes(15, 1_200), 'weekly_minutes');
  const sessionMinutes = nullable(value.session_minutes, minutes(15, 240), 'session_minutes');
  const question = nullable(value.question, isText(300), 'question');
  const abstainRecord = value.abstain === null ? null : record(value.abstain);
  if (value.abstain !== null && !abstainRecord) throw new SpecError('reading', 'abstain must be an object or null');
  const abstain = abstainRecord
    ? (() => {
      if (!ABSTAIN_CATEGORIES.includes(abstainRecord.category as AbstainCategory) || !isText(200)(abstainRecord.reason)) {
        throw new SpecError('reading', 'the reading has an invalid abstention');
      }
      return { category: abstainRecord.category as AbstainCategory, reason: abstainRecord.reason };
    })()
    : null;
  if ((decision === 'clarify') !== (question !== null) || (decision === 'abstain') !== (abstain !== null)) {
    throw new SpecError('reading', 'the reading decision does not match its question or abstention');
  }
  return {
    decision,
    title: value.title,
    summary: value.summary,
    domain: value.domain as Domain,
    level: value.level as Level,
    deadline,
    deadlineBasis: basis,
    days,
    window,
    weeklyMinutes,
    sessionMinutes,
    question,
    abstain,
  };
}

/** Combines the person's settings, the reading and defaults into a spec. */
export function buildGoalSpec(request: GoalRequest, reading: GoalReading): { spec: GoalSpec; provenance: Provenance } {
  const { controls } = request;
  const { first, last } = deadlineRange(request.today);

  let deadline: LocalDate;
  let deadlineSource: Provenance['deadline'];
  const defaultDeadline = addDays(first, GOAL_DEFAULTS.weeks * 7 - 1);
  if (controls.deadline) {
    deadline = controls.deadline;
    deadlineSource = { source: 'you' };
  } else if (reading.deadline && reading.deadline < first) {
    deadline = defaultDeadline;
    deadlineSource = { source: 'default', note: 'past' };
  } else if (reading.deadline && reading.deadline > last) {
    deadline = last;
    deadlineSource = { source: 'adjusted', note: 'too_far' };
  } else if (reading.deadline) {
    deadline = reading.deadline;
    deadlineSource = { source: 'goal', basis: reading.deadlineBasis === 'stated' ? 'stated' : 'inferred' };
  } else {
    deadline = defaultDeadline;
    deadlineSource = { source: 'default' };
  }

  const days = controls.days ?? reading.days ?? GOAL_DEFAULTS.days;
  const preset = controls.window ? undefined : reading.window ?? GOAL_DEFAULTS.window;
  const window = controls.window ?? WINDOW_PRESETS[preset ?? GOAL_DEFAULTS.window];
  const weeklyMinutes = controls.weeklyMinutes ?? reading.weeklyMinutes ?? GOAL_DEFAULTS.weeklyMinutes;
  const level = controls.level ?? reading.level;

  const spec = validateGoalSpec({
    title: reading.title,
    domain: reading.domain,
    language: request.language,
    startDate: first,
    deadline,
    days,
    window: { start: window.start, end: window.end },
    weeklyCapMinutes: weeklyMinutes,
    level,
  });
  const from = (mine: unknown, read: unknown): Source => (mine !== undefined ? 'you' : read !== null ? 'goal' : 'default');
  return {
    spec,
    provenance: {
      deadline: deadlineSource,
      days: { source: from(controls.days, reading.days) },
      window: { source: from(controls.window, reading.window), ...(preset ? { preset } : {}) },
      weeklyMinutes: { source: from(controls.weeklyMinutes, reading.weeklyMinutes) },
      level: {
        source: controls.level !== undefined ? 'you' : reading.level !== 'unknown' ? 'goal' : 'default',
      },
    },
  };
}
