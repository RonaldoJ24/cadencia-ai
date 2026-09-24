// Reads busy times from a calendar file (.ics) on the person's device. Only
// when each event starts and ends is kept: titles, places, people and notes
// are never read. Times move to the person's time zone, events that repeat
// daily or weekly are expanded, and everything is clipped to the dates a plan
// can use.

import { addDays, dateFromMs, dateMs, daysBetween, isLocalDate, weekdayOf } from './planner/time.ts';
import type { BusyInterval, LocalDate, Weekday } from './planner/types.ts';

export const CALENDAR_LIMITS = {
  /** Longest file read, in characters (about its size in bytes). */
  maxBytes: 10_000_000,
  maxEvents: 50_000,
  /** Times one repeating event is expanded, counting those before the range. */
  maxRepeatsPerEvent: 5_000,
  /** Busy times kept after merging, earliest first. */
  maxIntervals: 2_000,
} as const;

export type CalendarSummary = {
  events: number;
  /** Cancelled events and events marked as free time. */
  skipped: number;
  /** Repeating events with a rule this reader does not expand: only their first time counts. */
  repeatsReadOnce: number;
  /** Time zone names not recognized; those times were read as local time. */
  unknownZones: string[];
  /** More busy times than the limit, or a repeat cut short: the earliest were kept. */
  truncated: boolean;
};

export type CalendarBusy = { busy: BusyInterval[]; summary: CalendarSummary };

export type CalendarErrorReason = 'too_large' | 'not_a_calendar' | 'too_many_events';

export class CalendarError extends Error {
  readonly reason: CalendarErrorReason;

  constructor(reason: CalendarErrorReason) {
    super(reason);
    this.name = 'CalendarError';
    this.reason = reason;
  }
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const WEEKDAYS: Record<string, Weekday> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

/** Windows time zone names that calendar apps export, mapped as in CLDR. */
const WINDOWS_ZONES: Record<string, string> = {
  'Pacific Standard Time': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'Atlantic Standard Time': 'America/Halifax',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'Eastern Standard Time (Mexico)': 'America/Cancun',
  'Central America Standard Time': 'America/Guatemala',
  'SA Pacific Standard Time': 'America/Bogota',
  'SA Western Standard Time': 'America/La_Paz',
  'Venezuela Standard Time': 'America/Caracas',
  'Pacific SA Standard Time': 'America/Santiago',
  'Argentina Standard Time': 'America/Buenos_Aires',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GTB Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Kiev',
  'Russian Standard Time': 'Europe/Moscow',
  'India Standard Time': 'Asia/Calcutta',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  UTC: 'UTC',
};

type Property = { name: string; params: Record<string, string>; value: string };

type RawEvent = {
  uid?: string;
  start?: Property;
  end?: Property;
  duration?: string;
  rule?: string;
  exdates: Property[];
  recurrenceId?: Property;
  skip: boolean;
};

/** A calendar time: a whole day, or a wall-clock time (milliseconds as if UTC) in a zone. */
type Moment = { allDay: true; date: LocalDate } | { allDay: false; wall: number; zone: string };

type Rule = {
  freq: 'DAILY' | 'WEEKLY';
  interval: number;
  count?: number;
  until?: Moment;
  byDay?: Weekday[];
  weekStart: Weekday;
};

function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/u)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) lines[lines.length - 1] += raw.slice(1);
    else lines.push(raw);
  }
  return lines;
}

/** NAME;PARAM=VALUE;PARAM="quoted,value":VALUE, per RFC 5545 section 3.1. */
function parseProperty(line: string): Property | null {
  const name = /^[A-Za-z0-9-]+/u.exec(line)?.[0];
  if (!name) return null;
  let index = name.length;
  const params: Record<string, string> = {};
  while (line[index] === ';') {
    const equals = line.indexOf('=', index);
    if (equals < 0) return null;
    const key = line.slice(index + 1, equals).toUpperCase();
    index = equals + 1;
    const values: string[] = [];
    for (;;) {
      if (line[index] === '"') {
        const close = line.indexOf('"', index + 1);
        if (close < 0) return null;
        values.push(line.slice(index + 1, close));
        index = close + 1;
      } else {
        let end = index;
        while (end < line.length && !';:,'.includes(line[end])) end += 1;
        values.push(line.slice(index, end));
        index = end;
      }
      if (line[index] !== ',') break;
      index += 1;
    }
    params[key] = values.join(',');
  }
  if (line[index] !== ':') return null;
  return { name: name.toUpperCase(), params, value: line.slice(index + 1).trim() };
}

/** Collects VEVENTs, reading only the properties that say when; nested components are ignored. */
function readEvents(text: string): RawEvent[] {
  const events: RawEvent[] = [];
  const stack: string[] = [];
  let current: RawEvent | null = null;
  let sawCalendar = false;
  for (const line of unfold(text)) {
    const property = parseProperty(line);
    if (!property) continue;
    if (property.name === 'BEGIN') {
      const component = property.value.toUpperCase();
      stack.push(component);
      if (component === 'VCALENDAR') sawCalendar = true;
      if (component === 'VEVENT') {
        if (events.length >= CALENDAR_LIMITS.maxEvents) throw new CalendarError('too_many_events');
        current = { exdates: [], skip: false };
      }
      continue;
    }
    if (property.name === 'END') {
      const component = stack.pop();
      if (component === 'VEVENT' && current) {
        events.push(current);
        current = null;
      }
      continue;
    }
    if (!current || stack[stack.length - 1] !== 'VEVENT') continue;
    switch (property.name) {
      case 'UID': current.uid = property.value; break;
      case 'DTSTART': current.start = property; break;
      case 'DTEND': current.end = property; break;
      case 'DURATION': current.duration = property.value; break;
      case 'RRULE': current.rule = property.value; break;
      case 'EXDATE': current.exdates.push(property); break;
      case 'RECURRENCE-ID': current.recurrenceId = property; break;
      case 'STATUS': if (property.value.toUpperCase() === 'CANCELLED') current.skip = true; break;
      case 'TRANSP': if (property.value.toUpperCase() === 'TRANSPARENT') current.skip = true; break;
      default: break;
    }
  }
  if (!sawCalendar) throw new CalendarError('not_a_calendar');
  return events;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat | null {
  if (!formatters.has(zone)) {
    try {
      formatters.set(zone, new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }));
    } catch {
      return null;
    }
  }
  return formatters.get(zone) ?? null;
}

/** The wall clock in a zone at an instant, as milliseconds if that wall clock were UTC. */
function wallAt(zone: string, instant: number): number {
  const parts: Record<string, number> = {};
  for (const part of formatter(zone)!.formatToParts(new Date(instant))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
}

/**
 * The instant a wall-clock time names in a zone. A time the clocks skip moves
 * forward by the change; a time they repeat is the first of the two.
 */
function instantOf(wall: number, zone: string): number {
  const before = wallAt(zone, wall - DAY_MS) - (wall - DAY_MS);
  const after = wallAt(zone, wall + DAY_MS) - (wall + DAY_MS);
  const valid = [wall - before, wall - after].filter((instant) => wallAt(zone, instant) === wall);
  return valid.length > 0 ? Math.min(...valid) : wall - before;
}

const zones = new Map<string, string | null>();

/** An IANA name, a path ending in one, or a Windows name; null when none works. */
function resolveZone(tzid: string): string | null {
  if (!zones.has(tzid)) {
    const name = tzid.trim();
    const segments = name.split('/').filter(Boolean);
    const candidates = [name, segments.slice(-3).join('/'), segments.slice(-2).join('/'), WINDOWS_ZONES[name]];
    zones.set(tzid, candidates.find((candidate) => candidate && formatter(candidate)) ?? null);
  }
  return zones.get(tzid) ?? null;
}

const DATE_VALUE = /^(\d{4})(\d{2})(\d{2})$/u;
const DATE_TIME_VALUE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/u;

function localDate(year: string, month: string, day: string): LocalDate | null {
  const date = `${year}-${month}-${day}`;
  return isLocalDate(date) ? date : null;
}

type ZoneContext = { target: string; unknown: Set<string> };

/** Parses one DATE or DATE-TIME value; floating and unknown zones read as the person's own. */
function momentOf(value: string, params: Record<string, string>, context: ZoneContext): Moment | null {
  const dateOnly = DATE_VALUE.exec(value);
  if (dateOnly || params.VALUE?.toUpperCase() === 'DATE') {
    const date = dateOnly ? localDate(dateOnly[1], dateOnly[2], dateOnly[3]) : null;
    return date ? { allDay: true, date } : null;
  }
  const match = DATE_TIME_VALUE.exec(value);
  if (!match) return null;
  const date = localDate(match[1], match[2], match[3]);
  const [hours, minutes, seconds] = [Number(match[4]), Number(match[5]), Math.min(59, Number(match[6]))];
  if (!date || hours > 23 || minutes > 59) return null;
  let zone = context.target;
  if (match[7] === 'Z') zone = 'UTC';
  else if (params.TZID) {
    const resolved = resolveZone(params.TZID);
    if (resolved) zone = resolved;
    else context.unknown.add(params.TZID.slice(0, 60));
  }
  return { allDay: false, wall: dateMs(date) + ((hours * 60 + minutes) * 60 + seconds) * 1000, zone };
}

/** ISO 8601 durations: days are calendar days, the rest exact time. */
function durationOf(value: string): { days: number; ms: number } | null {
  const match = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u.exec(value);
  if (!match || value.endsWith('P') || value.endsWith('T')) return null;
  const [weeks, days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  return { days: weeks * 7 + days, ms: ((hours * 60 + minutes) * 60 + seconds) * 1000 };
}

/** Daily and weekly rules; anything else is 'unsupported' and read once. */
function ruleOf(value: string, context: ZoneContext): Rule | 'unsupported' {
  const parts = new Map(value.split(';').map((part) => {
    const [key, ...rest] = part.split('=');
    return [key.trim().toUpperCase(), rest.join('=').trim()] as const;
  }));
  const freq = parts.get('FREQ')?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return 'unsupported';
  if ([...parts.keys()].some((key) => key.startsWith('BY') && key !== 'BYDAY')) return 'unsupported';
  const interval = Number(parts.get('INTERVAL') ?? 1);
  const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : undefined;
  if (!Number.isInteger(interval) || interval < 1 || interval > 1_000) return 'unsupported';
  if (count !== undefined && (!Number.isInteger(count) || count < 1)) return 'unsupported';
  let byDay: Weekday[] | undefined;
  if (parts.has('BYDAY')) {
    byDay = [];
    for (const day of parts.get('BYDAY')!.toUpperCase().split(',')) {
      if (!(day in WEEKDAYS)) return 'unsupported';
      byDay.push(WEEKDAYS[day]);
    }
  }
  const until = parts.has('UNTIL') ? momentOf(parts.get('UNTIL')!, {}, context) : undefined;
  if (until === null) return 'unsupported';
  const weekStart = WEEKDAYS[parts.get('WKST')?.toUpperCase() ?? 'MO'] ?? 0;
  return { freq, interval, weekStart, ...(count !== undefined ? { count } : {}), ...(until ? { until } : {}), ...(byDay ? { byDay } : {}) };
}

/** A key that matches a start in EXDATE, RECURRENCE-ID and expansion alike. */
function momentKey(moment: Moment): string {
  return moment.allDay ? `d:${moment.date}` : `t:${instantOf(moment.wall, moment.zone)}`;
}

/**
 * The dates a rule makes, in the event's own calendar, from `first` on and in
 * order. The first date always counts, as RFC 5545 says of DTSTART.
 */
function* ruleDates(first: LocalDate, rule: Rule, skipTo: LocalDate | null): Generator<LocalDate> {
  const days = new Set<Weekday>(rule.byDay ?? (rule.freq === 'WEEKLY' ? [weekdayOf(first)] : [0, 1, 2, 3, 4, 5, 6]));
  yield first;
  if (rule.freq === 'DAILY') {
    let period = skipTo ? Math.max(0, Math.floor(daysBetween(first, skipTo) / rule.interval)) : 0;
    for (;; period += 1) {
      const date = addDays(first, period * rule.interval);
      if (date > first && days.has(weekdayOf(date))) yield date;
    }
  } else {
    const offset = (day: Weekday) => (day - rule.weekStart + 7) % 7;
    const order = [...days].sort((a, b) => offset(a) - offset(b));
    const firstWeek = addDays(first, -offset(weekdayOf(first)));
    let period = skipTo ? Math.max(0, Math.floor(daysBetween(firstWeek, skipTo) / (7 * rule.interval))) : 0;
    for (;; period += 1) {
      const week = addDays(firstWeek, period * 7 * rule.interval);
      for (const day of order) {
        const date = addDays(week, offset(day));
        if (date > first) yield date;
      }
    }
  }
}

type Span = { start: number; end: number };

/** Wall-clock milliseconds in the person's zone, start down and end up to the minute. */
function toTarget(startInstant: number, endInstant: number, target: string): Span {
  const start = Math.floor(wallAt(target, startInstant) / MINUTE_MS) * MINUTE_MS;
  let end = Math.ceil(wallAt(target, endInstant) / MINUTE_MS) * MINUTE_MS;
  // Across the hour clocks repeat, the end can read earlier than the start:
  // keep the event's real length instead of losing it.
  if (end <= start) end = start + Math.ceil((endInstant - startInstant) / MINUTE_MS) * MINUTE_MS;
  return { start, end };
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

export type ReadOptions = {
  /** The person's IANA time zone. */
  zone: string;
  /** First and last local dates a plan can use. */
  from: LocalDate;
  to: LocalDate;
};

/** Busy times from a calendar file, in the person's zone, clipped to [from, to]. */
export function readBusyTimes(text: string, options: ReadOptions): CalendarBusy {
  if (text.length > CALENDAR_LIMITS.maxBytes) throw new CalendarError('too_large');
  if (!formatter(options.zone)) throw new RangeError(`unknown time zone ${options.zone}`);
  const context: ZoneContext = { target: options.zone, unknown: new Set() };
  const events = readEvents(text);
  const summary: CalendarSummary = { events: events.length, skipped: 0, repeatsReadOnce: 0, unknownZones: [], truncated: false };
  // Event dates are in the event's own zone, so the window is widened by two
  // days on each side; the exact clip happens in the person's zone.
  const earliest = addDays(options.from, -2);
  const latest = addDays(options.to, 2);
  const rangeStart = dateMs(options.from);
  const rangeEnd = dateMs(addDays(options.to, 1));

  const overridden = new Map<string, Set<string>>();
  for (const event of events) {
    if (!event.uid || !event.recurrenceId) continue;
    const moment = momentOf(event.recurrenceId.value, event.recurrenceId.params, context);
    if (moment) overridden.set(event.uid, (overridden.get(event.uid) ?? new Set()).add(momentKey(moment)));
  }

  const spans: Span[] = [];
  const keep = (span: Span) => {
    const start = Math.max(span.start, rangeStart);
    const end = Math.min(span.end, rangeEnd);
    if (end > start) spans.push({ start, end });
  };

  for (const event of events) {
    if (event.skip) {
      summary.skipped += 1;
      continue;
    }
    const start = event.start ? momentOf(event.start.value, event.start.params, context) : null;
    if (!start) continue;
    const endMoment = event.end ? momentOf(event.end.value, event.end.params, context) : null;
    const duration = event.duration ? durationOf(event.duration) : null;

    // How long each occurrence lasts: whole days, or exact milliseconds.
    let days = 1;
    let length = 0;
    if (start.allDay) {
      if (endMoment?.allDay) days = daysBetween(start.date, endMoment.date);
      else if (duration) days = duration.days + Math.ceil(duration.ms / DAY_MS);
      if (days < 1) continue;
    } else {
      const begin = instantOf(start.wall, start.zone);
      if (endMoment && !endMoment.allDay) length = instantOf(endMoment.wall, endMoment.zone) - begin;
      else if (duration) length = instantOf(start.wall + duration.days * DAY_MS, start.zone) + duration.ms - begin;
      if (length <= 0) continue;
    }

    const occurrence = (date: LocalDate) => {
      if (start.allDay) {
        keep({ start: dateMs(date), end: dateMs(addDays(date, days)) });
        return;
      }
      const wall = dateMs(date) + (start.wall % DAY_MS);
      const instant = instantOf(wall, start.zone);
      const span = toTarget(instant, instant + length, options.zone);
      keep(span);
    };
    const firstDate = start.allDay ? start.date : dateFromMs(start.wall);

    const rule = event.rule && !event.recurrenceId ? ruleOf(event.rule, context) : undefined;
    if (!rule || rule === 'unsupported') {
      if (rule === 'unsupported') summary.repeatsReadOnce += 1;
      occurrence(firstDate);
      continue;
    }

    const excluded = new Set(overridden.get(event.uid ?? '') ?? []);
    for (const exdate of event.exdates) {
      for (const value of exdate.value.split(',')) {
        const moment = momentOf(value.trim(), exdate.params, context);
        if (moment) excluded.add(momentKey(moment));
      }
    }
    // UNTIL is compared as an instant when both it and the start have a time,
    // otherwise by date.
    const until = rule.until;
    const untilDate = until ? (until.allDay ? until.date : dateFromMs(until.wall)) : undefined;
    const untilInstant = until && !until.allDay && !start.allDay ? instantOf(until.wall, until.zone) : undefined;
    // An occurrence that starts before the window can still reach into it.
    const reach = start.allDay ? days : Math.ceil(length / DAY_MS);
    const skipTo = rule.count === undefined && firstDate < earliest ? addDays(earliest, -reach) : null;
    let made = 0;
    let steps = 0;
    for (const date of ruleDates(firstDate, rule, skipTo)) {
      steps += 1;
      if (steps > CALENDAR_LIMITS.maxRepeatsPerEvent) {
        summary.truncated = true;
        break;
      }
      const moment: Moment = start.allDay ? { allDay: true, date } : { allDay: false, wall: dateMs(date) + (start.wall % DAY_MS), zone: start.zone };
      const past = untilInstant !== undefined && !moment.allDay
        ? instantOf(moment.wall, moment.zone) > untilInstant
        : untilDate !== undefined && date > untilDate;
      if (past) break;
      made += 1;
      if (rule.count !== undefined && made > rule.count) break;
      if (date > latest) break;
      if (addDays(date, reach) < earliest) continue;
      if (excluded.has(momentKey(moment)) || excluded.has(`d:${date}`)) continue;
      occurrence(date);
    }
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  if (merged.length > CALENDAR_LIMITS.maxIntervals) summary.truncated = true;
  summary.unknownZones = [...context.unknown].sort();
  return {
    busy: merged.slice(0, CALENDAR_LIMITS.maxIntervals).map((span) => ({ start: stamp(span.start), end: stamp(span.end) })),
    summary,
  };
}
