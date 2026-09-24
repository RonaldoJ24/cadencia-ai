// Places a draft on the calendar. A week over its limits is first trimmed to
// the best-fitting subset of its sessions, key sessions first. The rest are
// spread evenly over the allowed days and start at the beginning of the
// window; when that slot is taken, the session moves to the next day that
// fits and a note records why. A session with nowhere to go is dropped with a
// reason, never forced.

import { busyIndex, earliestFit, planWeeks } from './availability.ts';
import { FITNESS_LOAD, keepBest, loadLimit, weeklyCeilings, type WeekLimits } from './load.ts';
import { addDays, dateTime, minutesOf, timeOf } from './time.ts';
import type {
  BusyInterval,
  Draft,
  DropReason,
  GoalPlan,
  GoalSpec,
  LocalDate,
  MoveReason,
  PlannedSession,
  PlanWeek,
  ScheduleNote,
  SessionType,
} from './types.ts';

/** The first busy time that overlaps the window on a date, clipped to that date. */
function conflictOn(date: LocalDate, spec: GoalSpec, busy: readonly BusyInterval[]): BusyInterval | undefined {
  const windowStart = minutesOf(spec.window.start);
  const windowEnd = minutesOf(spec.window.end);
  const first = busyIndex(busy).get(date)?.find(([from, to]) => to > windowStart && from < windowEnd);
  return first ? { start: dateTime(date, first[0]), end: dateTime(date, Math.min(first[1], 1_439)) } : undefined;
}

/** Which fixed limit a week breaks first: its days, hard sessions, cap or ceiling. */
function trimReason(types: SessionType[], limits: WeekLimits, spec: GoalSpec): DropReason {
  const minutes = types.reduce((total, type) => total + type.minutes, 0);
  if (types.length > limits.maxCount) return 'no_free_slot';
  if (types.filter((type) => type.intensity === 'hard').length > limits.maxHard) return 'hard_sessions';
  return minutes > spec.weeklyCapMinutes ? 'weekly_cap' : 'week_minutes';
}

/** Keeps the best-fitting subset and notes every session it leaves out. */
function trim(types: SessionType[], limits: WeekLimits, reason: () => DropReason, week: number, notes: ScheduleNote[]) {
  const keep = keepBest(types, limits);
  if (keep.length === types.length) return types;
  const why = reason();
  types.forEach((type, position) => {
    if (!keep.includes(position)) notes.push({ kind: 'dropped', week, typeId: type.id, reason: why });
  });
  return keep.map((position) => types[position]);
}

export type ScheduleOptions = {
  /**
   * Sessions already behind the person, kept as they are with their status.
   * Only dates on or after `from` get new sessions. Kept sessions count toward
   * their week's cap, day and hard-session limits and rest spacing whatever
   * their status; toward the load rule's history only when not missed.
   */
  keep?: readonly PlannedSession[];
  from?: LocalDate;
};

/** The draft's request for a week, less what kept sessions already cover. */
function stillRequested(requested: readonly string[], kept: readonly PlannedSession[]): string[] {
  const rest = [...requested];
  for (const session of kept) {
    const slot = rest.indexOf(session.typeId);
    if (slot !== -1) rest.splice(slot, 1);
  }
  return rest;
}

export function schedulePlan(spec: GoalSpec, draft: Draft, busy: readonly BusyInterval[], options: ScheduleOptions = {}): GoalPlan {
  const typeById = new Map(draft.sessionTypes.map((type) => [type.id, type]));
  const windowStart = minutesOf(spec.window.start);
  const fitness = spec.domain === 'fitness';
  const calendar = planWeeks(spec);
  const ceilings = weeklyCeilings(spec, calendar.length);
  // A first week cut short by the start date says nothing about training
  // load, so it stays out of the recent average the load rule uses.
  const firstWeek = calendar[0]?.start;
  const firstWeekCut = firstWeek !== undefined && spec.days.some((day) => addDays(firstWeek, day) < spec.startDate);
  const from = options.from;
  const keep = from ? (options.keep ?? []).filter((session) => session.date < from) : [];
  const placedMinutes: number[] = [];
  const hardDates = new Set<LocalDate>();
  const notes: ScheduleNote[] = [];
  const weeks: PlanWeek[] = [];

  for (const [weekIndex, calendarWeek] of calendar.entries()) {
    const week = calendarWeek.week;
    const kept = keep
      .filter((session) => session.date >= calendarWeek.start && session.date <= calendarWeek.end)
      .map((session) => ({ ...session, week, blocks: session.blocks.map((block) => ({ ...block })) }));
    for (const session of kept) if (session.intensity === 'hard') hardDates.add(session.date);
    const keptMinutes = kept.reduce((total, session) => total + session.minutes, 0);
    const doneMinutes = kept.reduce((total, session) => total + (session.status === 'missed' ? 0 : session.minutes), 0);
    const dates = from ? calendarWeek.dates.filter((date) => date >= from) : calendarWeek.dates;
    if (from && calendarWeek.end < from) {
      // A week entirely behind the person: kept as it is.
      if (weekIndex > 0 || !firstWeekCut) placedMinutes.push(doneMinutes);
      weeks.push({ week, start: calendarWeek.start, end: calendarWeek.end, sessions: kept.sort((a, b) => a.date.localeCompare(b.date)) });
      continue;
    }
    const requested = stillRequested(draft.weeks.find((entry) => entry.week === week)?.sessions ?? [], kept)
      .map((typeId) => typeById.get(typeId))
      .filter((type): type is SessionType => type !== undefined);

    // Every weekly limit is enforced here, not only in the draft check: first
    // the fixed ones, then the load rule, which depends on the weeks before.
    const fixed: WeekLimits = {
      maxCount: dates.length,
      maxMinutes: Math.max(0, Math.min(spec.weeklyCapMinutes, ceilings[weekIndex]) - keptMinutes),
      maxHard: fitness
        ? Math.max(0, FITNESS_LOAD.maxHardPerWeek - kept.filter((session) => session.intensity === 'hard').length)
        : Number.POSITIVE_INFINITY,
    };
    const withinFixed = trim(requested, fixed, () => trimReason(requested, fixed, spec), week, notes);
    const limit = fitness ? loadLimit(placedMinutes, spec.level) : null;
    const load = limit === null ? null : Math.max(0, limit - doneMinutes);
    const wanted = load === null
      ? withinFixed
      : trim(withinFixed, { ...fixed, maxMinutes: Math.min(fixed.maxMinutes, load) }, () => 'load', week, notes);

    const taken = new Set<LocalDate>();
    const sessions: PlannedSession[] = [...kept];
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
          id: `w${week}-${kept.length + index + 1}`,
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
    const newMinutes = sessions.reduce((total, session) => total + session.minutes, 0) - keptMinutes;
    if (weekIndex > 0 || !firstWeekCut) placedMinutes.push(doneMinutes + newMinutes);
    weeks.push({ week, start: calendarWeek.start, end: calendarWeek.end, sessions });
  }

  return { spec, draft, weeks, notes };
}
