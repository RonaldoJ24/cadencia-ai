// Options for the weeks ahead once sessions were missed. Code builds each
// option as a whole plan on the same calendar: sessions up to today keep
// their status, weeks keep their numbers, and only dates from tomorrow on
// change. The model may only pick one of these from the person's reason, and
// nothing changes until the person approves. An option that fails the
// independent checkPlan is never offered.

import { checkPlan } from './check.ts';
import { keepBest } from './load.ts';
import { schedulePlan } from './schedule.ts';
import { SpecError, validateGoalSpec } from './spec.ts';
import { addDays, daysBetween } from './time.ts';
import type { BusyInterval, Draft, GoalPlan, GoalSpec, LocalDate, PlannedSession, ReplanOptionId, SessionType } from './types.ts';

export type { ReplanOptionId };
export const REPLAN_OPTIONS = ['keep', 'repeat', 'extend', 'lighter'] as const satisfies readonly ReplanOptionId[];

/** Misses older than this before the change date are history, not something to redo. */
export const RECENT_MISS_DAYS = 14;
/** The share of each week's minutes the lighter option keeps. */
export const LIGHTER_PERCENT = 75;

export type ReplanSituation = {
  /** The first day that can change: tomorrow. */
  from: LocalDate;
  missedSessions: number;
  missedWeeks: number;
  /** Calendar weeks from the one holding `from` to the deadline. */
  weeksLeft: number;
};

/** What an option does, in numbers only. The model reads it; the page shows it. */
export type ReplanSummary = {
  id: ReplanOptionId;
  deadline: LocalDate;
  weeksLeft: number;
  sessionsLeft: number;
  minutesLeft: number;
  /** Minutes planned in the seven days from `from`. */
  nextSevenDaysMinutes: number;
  /** Of the sessions the current plan still has plus those just missed, how many this option leaves out. */
  sessionsLeftOut: number;
};

export type ReplanOption = { summary: ReplanSummary; plan: GoalPlan };
export type Replan = { situation: ReplanSituation; options: ReplanOption[] };

/**
 * Redoes the draft from week `first` at week `boundary`, `shift` weeks later,
 * for a calendar of `weeks` weeks: earlier weeks stay, the boundary week keeps
 * what was already done there, and content past the last week falls off.
 * Phases move with their weeks.
 */
function shiftedDraft(draft: Draft, first: number, boundary: number, weeks: number, keptAt: (week: number) => PlannedSession[]): Draft {
  const shift = boundary - first;
  const contentOf = (week: number) => draft.weeks.find((entry) => entry.week === week)?.sessions ?? [];
  const nextWeeks = Array.from({ length: weeks }, (_, index) => {
    const week = index + 1;
    if (week < boundary) return { week, sessions: [...contentOf(week)] };
    const moved = [...contentOf(week - shift)];
    return { week, sessions: week === boundary ? [...keptAt(week).map((session) => session.typeId), ...moved] : moved };
  });
  const phases = draft.phases
    .map((phase) => ({
      ...phase,
      // A phase that holds the first missed week keeps its start, so the weeks
      // already behind stay under it.
      fromWeek: phase.fromWeek > first ? phase.fromWeek + shift : phase.fromWeek,
      toWeek: phase.toWeek >= first ? phase.toWeek + shift : phase.toWeek,
    }))
    .map((phase) => ({ ...phase, toWeek: Math.min(phase.toWeek, weeks) }))
    .filter((phase) => phase.fromWeek <= phase.toWeek);
  return { ...draft, phases, weeks: nextWeeks };
}

/**
 * Each week from the boundary on keeps its best sessions within
 * LIGHTER_PERCENT of what keep actually placed that week. Trimming keep's
 * schedule rather than the draft is what makes it lighter: after a missed
 * week the load rule cuts heavier drafted weeks harder, so a trimmed draft
 * could end up with more time than keep.
 */
function lighterDraft(draft: Draft, boundary: number, keptAt: (week: number) => PlannedSession[], keepPlan: GoalPlan, from: LocalDate): Draft {
  const typeById = new Map(draft.sessionTypes.map((type) => [type.id, type]));
  return {
    ...draft,
    weeks: draft.weeks.map((entry) => {
      if (entry.week < boundary) return { ...entry, sessions: [...entry.sessions] };
      const kept = keptAt(entry.week);
      const placed = keepPlan.weeks.find((week) => week.week === entry.week)?.sessions.filter((session) => session.date >= from) ?? [];
      const types = placed.map((session) => typeById.get(session.typeId)).filter((type): type is SessionType => type !== undefined);
      const minutes = types.reduce((total, type) => total + type.minutes, 0);
      // Lighter, never empty: the shortest session always fits.
      const shortest = Math.min(...types.map((type) => type.minutes));
      const limit = Math.max(Math.floor((minutes * LIGHTER_PERCENT) / 100 / 5) * 5, types.length > 0 ? shortest : 0);
      const keep = keepBest(types, { maxCount: types.length, maxMinutes: limit, maxHard: Number.POSITIVE_INFINITY });
      return { ...entry, sessions: [...kept.map((session) => session.typeId), ...keep.map((position) => types[position].id)] };
    }),
  };
}

/**
 * The options after missed sessions, or null when there is nothing to adjust:
 * no miss in the last RECENT_MISS_DAYS, or the plan is over. `busy` counts
 * only from tomorrow, so an imported calendar never flags past sessions.
 */
export function replanOptions(plan: GoalPlan, busy: readonly BusyInterval[], today: LocalDate): Replan | null {
  const { spec, draft } = plan;
  const from = addDays(today, 1);
  if (from > spec.deadline || from < spec.startDate) return null;
  const sessions = plan.weeks.flatMap((week) => week.sessions);
  const kept = sessions.filter((session) => session.date < from);
  // Misses an approved adjustment already answered are not answered twice.
  const answered = plan.adjustments?.at(-1)?.on;
  const recent = kept.filter((session) =>
    session.status === 'missed' &&
    daysBetween(session.date, from) <= RECENT_MISS_DAYS &&
    (answered === undefined || session.date > answered));
  if (recent.length === 0) return null;
  const boundary = plan.weeks.find((week) => from >= week.start && from <= week.end)?.week;
  if (boundary === undefined) return null;
  const firstMissed = Math.min(...recent.map((session) => session.week));
  const shift = boundary - firstMissed;
  const keptAt = (week: number) => kept.filter((session) => session.week === week);

  const lower = `${from}T00:00`;
  const ahead: BusyInterval[] = busy.flatMap((interval) => {
    const start = interval.start > lower ? interval.start : lower;
    return interval.end > start ? [{ start, end: interval.end }] : [];
  });
  const ahead7 = addDays(from, 6);
  // What the current plan still has ahead, plus what was just missed.
  const stillToDo = sessions.filter((session) => session.date >= from).length + recent.length;

  const build = (id: ReplanOptionId, nextSpec: GoalSpec, nextDraft: Draft): ReplanOption | null => {
    const scheduled = schedulePlan(nextSpec, nextDraft, ahead, { keep: kept, from });
    const next: GoalPlan = { ...scheduled, notes: [...plan.notes.filter((note) => note.week < boundary), ...scheduled.notes] };
    if (checkPlan(next, ahead).length > 0) return null;
    const upcoming = next.weeks.flatMap((week) => week.sessions).filter((session) => session.date >= from);
    const minutesLeft = upcoming.reduce((total, session) => total + session.minutes, 0);
    return {
      summary: {
        id,
        deadline: nextSpec.deadline,
        weeksLeft: next.weeks.filter((week) => week.week >= boundary).length,
        sessionsLeft: upcoming.length,
        minutesLeft,
        nextSevenDaysMinutes: upcoming.filter((session) => session.date <= ahead7).reduce((total, session) => total + session.minutes, 0),
        sessionsLeftOut: Math.max(0, stillToDo - upcoming.length),
      },
      plan: next,
    };
  };

  const keep = build('keep', spec, draft);
  const candidates: Array<ReplanOption | null> = [keep];
  if (shift > 0) {
    const weeks = plan.weeks.length;
    candidates.push(build('repeat', spec, shiftedDraft(draft, firstMissed, boundary, weeks, keptAt)));
    try {
      const longer = validateGoalSpec({ ...spec, deadline: addDays(spec.deadline, shift * 7) });
      candidates.push(build('extend', longer, shiftedDraft(draft, firstMissed, boundary, weeks + shift, keptAt)));
    } catch (error) {
      // Past the longest plan allowed: extending is not an option.
      if (!(error instanceof SpecError)) throw error;
    }
  }
  if (keep) candidates.push(build('lighter', spec, lighterDraft(draft, boundary, keptAt, keep.plan, from)));

  // Two options that place the same sessions are one option.
  const options: ReplanOption[] = [];
  const seen = new Set<string>();
  for (const option of candidates) {
    if (!option) continue;
    const signature = JSON.stringify([
      option.plan.spec.deadline,
      option.plan.weeks.flatMap((week) => week.sessions).filter((session) => session.date >= from).map((session) => [session.date, session.start, session.typeId]),
    ]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    options.push(option);
  }
  return {
    situation: {
      from,
      missedSessions: recent.length,
      missedWeeks: new Set(recent.map((session) => session.week)).size,
      weeksLeft: plan.weeks.filter((week) => week.week >= boundary).length,
    },
    options,
  };
}
