// Places a draft on the calendar. Each week's sessions are spread evenly over
// its allowed days and start at the beginning of the window; when that slot
// is taken, the session moves to the next day that fits and a note records
// why. A session with nowhere to go is dropped with a reason, never forced.

import { busyOn, earliestFit, planWeeks } from './availability.ts';
import { addDays, dateTime, minutesOf, timeOf } from './time.ts';
import type {
  BusyInterval,
  Draft,
  GoalPlan,
  GoalSpec,
  LocalDate,
  MoveReason,
  PlannedSession,
  PlanWeek,
  ScheduleNote,
  SessionType,
} from './types.ts';

/** The busy time that overlaps the window on a date, clipped to that date. */
function conflictOn(date: LocalDate, spec: GoalSpec, busy: BusyInterval[]): BusyInterval | undefined {
  const windowStart = minutesOf(spec.window.start);
  const windowEnd = minutesOf(spec.window.end);
  let first: [number, number] | null = null;
  for (const interval of busy) {
    const range = busyOn(date, interval);
    if (!range || range[1] <= windowStart || range[0] >= windowEnd) continue;
    if (!first || range[0] < first[0]) first = range;
  }
  return first ? { start: dateTime(date, first[0]), end: dateTime(date, Math.min(first[1], 1_439)) } : undefined;
}

export function schedulePlan(spec: GoalSpec, draft: Draft, busy: BusyInterval[]): GoalPlan {
  const typeById = new Map(draft.sessionTypes.map((type) => [type.id, type]));
  const windowStart = minutesOf(spec.window.start);
  const hardDates = new Set<LocalDate>();
  const notes: ScheduleNote[] = [];
  const weeks: PlanWeek[] = [];

  for (const calendarWeek of planWeeks(spec)) {
    const week = calendarWeek.week;
    const requested = draft.weeks.find((entry) => entry.week === week)?.sessions ?? [];

    // The weekly cap is enforced here too, not only in the draft check.
    const wanted: SessionType[] = [];
    let minutes = 0;
    for (const typeId of requested) {
      const type = typeById.get(typeId);
      if (!type) continue;
      if (minutes + type.minutes > spec.weeklyCapMinutes) {
        notes.push({ kind: 'dropped', week, typeId, reason: 'weekly_cap' });
        continue;
      }
      minutes += type.minutes;
      wanted.push(type);
    }

    const dates = calendarWeek.dates;
    const taken = new Set<LocalDate>();
    const sessions: PlannedSession[] = [];
    wanted.forEach((type, index) => {
      if (dates.length === 0) {
        notes.push({ kind: 'dropped', week, typeId: type.id, reason: 'no_free_slot' });
        return;
      }
      const preferred = Math.floor((index * dates.length) / wanted.length);
      const order = [
        ...Array.from({ length: dates.length - preferred }, (_, step) => preferred + step),
        ...Array.from({ length: preferred }, (_, step) => preferred - 1 - step),
      ];
      let obstacle: { reason: MoveReason; conflict?: BusyInterval } | undefined;
      for (const position of order) {
        const date = dates[position];
        if (taken.has(date)) {
          obstacle ??= { reason: 'day_taken' };
          continue;
        }
        const needsRest = spec.domain === 'fitness' && type.intensity === 'hard' &&
          (hardDates.has(addDays(date, -1)) || hardDates.has(addDays(date, 1)));
        if (needsRest) {
          obstacle ??= { reason: 'rest_spacing' };
          continue;
        }
        const start = earliestFit(date, type.minutes, spec, busy);
        if (start === null) {
          obstacle ??= { reason: 'busy', conflict: conflictOn(date, spec, busy) };
          continue;
        }
        if (start !== windowStart && position === preferred) {
          obstacle ??= { reason: 'busy', conflict: conflictOn(date, spec, busy) };
        }
        taken.add(date);
        if (type.intensity === 'hard') hardDates.add(date);
        sessions.push({
          id: `w${week}-${index + 1}`,
          week,
          date,
          start: timeOf(start),
          minutes: type.minutes,
          typeId: type.id,
          title: type.title,
          intensity: type.intensity,
          blocks: type.blocks.map((block) => ({ ...block })),
          deliverable: type.deliverable,
          doneWhen: type.doneWhen,
          status: 'planned',
        });
        if (position !== preferred || start !== windowStart) {
          notes.push({
            kind: 'moved',
            week,
            typeId: type.id,
            from: { date: dates[preferred], start: spec.window.start },
            to: { date, start: timeOf(start) },
            reason: obstacle?.reason ?? 'busy',
            ...(obstacle?.conflict ? { conflict: obstacle.conflict } : {}),
          });
        }
        return;
      }
      notes.push({ kind: 'dropped', week, typeId: type.id, reason: 'no_free_slot' });
    });

    sessions.sort((a, b) => a.date.localeCompare(b.date));
    weeks.push({ week, start: calendarWeek.start, end: calendarWeek.end, sessions });
  }

  return { spec, draft, weeks, notes };
}
