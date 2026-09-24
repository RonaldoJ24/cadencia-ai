// Which days and minutes the person can actually use: allowed weekdays inside
// the date range, inside the daily window, minus busy times.

import { weeklyCeilings } from './load.ts';
import { PLAN_LIMITS } from './spec.ts';
import { addDays, daysBetween, minutesOf, mondayOf, splitDateTime, weekdayOf } from './time.ts';
import type { BusyInterval, GoalSpec, LocalDate, Skeleton } from './types.ts';

export type Range = [start: number, end: number];

export type CalendarWeek = {
  week: number;
  /** Monday. */
  start: LocalDate;
  /** Sunday. */
  end: LocalDate;
  /** Allowed weekdays inside the plan's date range, in order. */
  dates: LocalDate[];
};

/** Calendar weeks from the one holding startDate to the one holding the deadline. */
export function planWeeks(spec: GoalSpec): CalendarWeek[] {
  const allowed = new Set(spec.days);
  const firstMonday = mondayOf(spec.startDate);
  const count = Math.floor(daysBetween(firstMonday, spec.deadline) / 7) + 1;
  return Array.from({ length: count }, (_, index) => {
    const start = addDays(firstMonday, index * 7);
    const dates: LocalDate[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(start, offset);
      if (date < spec.startDate || date > spec.deadline) continue;
      if (allowed.has(weekdayOf(date))) dates.push(date);
    }
    return { week: index + 1, start, end: addDays(start, 6), dates };
  });
}

/** Busy minutes of the day for each date, sorted and merged. */
export type BusyIndex = Map<LocalDate, Range[]>;

const indexes = new WeakMap<readonly BusyInterval[], BusyIndex>();

/**
 * Busy times by date, built the first time a list is used and kept with that
 * list, so scheduling never scans every busy time for every date. Each
 * interval is parsed once and split at midnight. Lists are not changed once
 * planning starts, and requests clip them to the plan's dates first.
 */
export function busyIndex(busy: readonly BusyInterval[]): BusyIndex {
  const cached = indexes.get(busy);
  if (cached) return cached;
  const days = new Map<LocalDate, Range[]>();
  for (const interval of busy) {
    const start = splitDateTime(interval.start);
    const end = splitDateTime(interval.end);
    if (!start || !end) continue;
    for (let date = start.date; date <= end.date; date = addDays(date, 1)) {
      const from = date === start.date ? start.minutes : 0;
      const to = date === end.date ? end.minutes : 1_440;
      if (to <= from) continue;
      const ranges = days.get(date);
      if (ranges) ranges.push([from, to]);
      else days.set(date, [[from, to]]);
    }
  }
  const index: BusyIndex = new Map();
  for (const [date, ranges] of days) {
    const merged: Range[] = [];
    for (const [from, to] of ranges.sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && from <= last[1]) last[1] = Math.max(last[1], to);
      else merged.push([from, to]);
    }
    index.set(date, merged);
  }
  indexes.set(busy, index);
  return index;
}

/** Free minute ranges in the window on a date, after removing busy times. */
export function freeRanges(date: LocalDate, spec: GoalSpec, busy: readonly BusyInterval[]): Range[] {
  let free: Range[] = [[minutesOf(spec.window.start), minutesOf(spec.window.end)]];
  for (const blocked of busyIndex(busy).get(date) ?? []) {
    free = free.flatMap(([start, end]): Range[] => {
      if (blocked[1] <= start || blocked[0] >= end) return [[start, end]];
      const pieces: Range[] = [];
      if (blocked[0] > start) pieces.push([start, blocked[0]]);
      if (blocked[1] < end) pieces.push([blocked[1], end]);
      return pieces;
    });
  }
  return free;
}

/** The earliest start in a date's free ranges that fits `minutes`, if any. */
export function earliestFit(date: LocalDate, minutes: number, spec: GoalSpec, busy: readonly BusyInterval[]): number | null {
  for (const [start, end] of freeRanges(date, spec, busy)) {
    if (end - start >= minutes) return start;
  }
  return null;
}

/** The room each week really has, offered to the model before it drafts. */
export function buildSkeleton(spec: GoalSpec, busy: readonly BusyInterval[]): Skeleton {
  const windowMinutes = minutesOf(spec.window.end) - minutesOf(spec.window.start);
  const longest = Math.min(
    PLAN_LIMITS.maxSessionMinutes,
    windowMinutes,
    spec.weeklyCapMinutes,
    spec.maxSessionMinutes ?? PLAN_LIMITS.maxSessionMinutes,
  );
  const max = Math.max(PLAN_LIMITS.minSessionMinutes, longest - (longest % 5));
  const min = PLAN_LIMITS.minSessionMinutes;
  const weeks = planWeeks(spec);
  const ceilings = weeklyCeilings(spec, weeks.length);
  return {
    weeks: weeks.map((week, index) => {
      const freeDays = week.dates.filter((date) => earliestFit(date, min, spec, busy) !== null).length;
      return {
        week: week.week,
        start: week.start,
        usableDays: week.dates.length,
        freeDays,
        maxSessions: Math.min(freeDays, Math.floor(ceilings[index] / min)),
        maxMinutes: ceilings[index],
      };
    }),
    weeklyCapMinutes: spec.weeklyCapMinutes,
    sessionMinutes: { min, max },
  };
}
