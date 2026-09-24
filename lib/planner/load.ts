// Weekly limits for fitness plans and the trim that enforces them. The
// scheduler applies these rules; the independent plan check re-derives them
// from the placed sessions and shares only the numbers below.

import type { GoalSpec, Intensity, Level, Role } from './types.ts';

export const FITNESS_LOAD = {
  /** First-week minutes by stated level, and the floor after a lighter stretch. */
  startMinutes: { beginner: 90, unknown: 90, intermediate: 120, advanced: 150 },
  /** Weekly ceilings grow to at most this percentage of the week before. */
  growthPercent: 110,
  /** A week may hold at most this percentage of the average of the weeks before it. */
  jumpPercent: 130,
  /** How many earlier weeks that average covers. */
  jumpWeeks: 4,
  maxHardPerWeek: 2,
} as const;

/**
 * Most minutes each week may hold. Fitness volume starts from the level and
 * grows at most 10% a week up to the cap; other goals can use the whole cap.
 */
export function weeklyCeilings(spec: GoalSpec, weeks: number): number[] {
  if (spec.domain !== 'fitness') return Array.from({ length: weeks }, () => spec.weeklyCapMinutes);
  let ceiling = Math.min(spec.weeklyCapMinutes, FITNESS_LOAD.startMinutes[spec.level]);
  return Array.from({ length: weeks }, (_, index) => {
    if (index > 0) ceiling = Math.min(spec.weeklyCapMinutes, Math.floor((ceiling * FITNESS_LOAD.growthPercent) / 100));
    return ceiling;
  });
}

/**
 * Most minutes a fitness week may hold after the weeks already placed: at
 * most 30% above their recent average, a conservative heuristic borrowed
 * from acute-to-chronic workload ratios (their evidence is debated, so this
 * is a guard, not a safety guarantee), and never below the level's starting
 * volume, so a light or empty stretch can return to where the plan began.
 */
export function loadLimit(previous: readonly number[], level: Level): number | null {
  if (previous.length === 0) return null;
  const recent = previous.slice(-FITNESS_LOAD.jumpWeeks);
  const total = recent.reduce((sum, minutes) => sum + minutes, 0);
  return Math.max(
    Math.floor((total * FITNESS_LOAD.jumpPercent) / (100 * recent.length)),
    FITNESS_LOAD.startMinutes[level],
  );
}

export type Trimmable = { minutes: number; intensity: Intensity; role: Role };
export type WeekLimits = { maxCount: number; maxMinutes: number; maxHard: number };

/** Only this many items are weighed; a week can hold at most seven sessions. */
const MAX_WEIGHED = 12;

type Candidate = { keep: number[]; key: number; minutes: number };

function better(a: Candidate, b: Candidate): boolean {
  if (a.key !== b.key) return a.key > b.key;
  if (a.minutes !== b.minutes) return a.minutes > b.minutes;
  if (a.keep.length !== b.keep.length) return a.keep.length > b.keep.length;
  const differs = a.keep.findIndex((position, index) => position !== b.keep[index]);
  return differs !== -1 && a.keep[differs] < b.keep[differs];
}

export function fits(items: readonly Trimmable[], limits: WeekLimits): boolean {
  const minutes = items.reduce((total, item) => total + item.minutes, 0);
  const hard = items.filter((item) => item.intensity === 'hard').length;
  return items.length <= limits.maxCount && minutes <= limits.maxMinutes && hard <= limits.maxHard;
}

/**
 * Positions of the items to keep, in their original order, so a week fits
 * its limits: the most key sessions, then the most minutes, then the most
 * sessions, then the earliest ones. Nothing is added or shortened.
 */
export function keepBest(items: readonly Trimmable[], limits: WeekLimits): number[] {
  if (fits(items, limits)) return items.map((_, index) => index);
  const count = Math.min(items.length, MAX_WEIGHED);
  let best: Candidate | null = null;
  for (let mask = 0; mask < 1 << count; mask += 1) {
    const candidate: Candidate = { keep: [], key: 0, minutes: 0 };
    let hard = 0;
    for (let index = 0; index < count; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      const item = items[index];
      candidate.keep.push(index);
      candidate.minutes += item.minutes;
      if (item.intensity === 'hard') hard += 1;
      if (item.role === 'key') candidate.key += 1;
    }
    if (candidate.keep.length > limits.maxCount || candidate.minutes > limits.maxMinutes || hard > limits.maxHard) continue;
    if (!best || better(candidate, best)) best = candidate;
  }
  return best?.keep ?? [];
}
