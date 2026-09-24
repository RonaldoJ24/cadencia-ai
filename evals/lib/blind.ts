// Blind rating (pre-registration, section 6). A pack holds, for every case
// where both arms made a ready plan, the goal text and the two plans as
// "Plan 1" and "Plan 2" in a seeded random order. The key that says which arm
// made which plan, and the seed that would rebuild it, are in a separate file
// the rating page never loads.

import { createHash } from 'node:crypto';
import type { GoalPlan } from '../../lib/planner/types.ts';
import type { EvalCase } from './cases.ts';
import type { ResultLine } from './runner.ts';

/** What the rater sees of a plan: the plan itself, nothing about its arm. */
export type PlanView = {
  settings: { deadline: string; days: number[]; window: { start: string; end: string }; weeklyCapMinutes: number; maxSessionMinutes?: number };
  phases: Array<{ title: string; fromWeek: number; toWeek: number; focus: string }>;
  sessionTypes: Array<{ id: string; title: string; minutes: number; intensity: string; role: string; blocks: Array<{ minutes: number; activity: string }>; deliverable: string; doneWhen: string }>;
  weeks: Array<{ week: number; start: string; sessions: Array<{ date: string; start: string; typeId: string; minutes: number }> }>;
};

export type PackItem = { id: string; text: string; language: 'en' | 'es'; plans: [PlanView, PlanView] };
export type RatingPack = { pack: string; items: PackItem[] };
export type PackKey = { pack: string; runId: string; seed: number; arms: [string, string]; items: Array<{ id: string; caseId: string; order: [string, string] }> };

/** Scores for one plan: 1 (disagree) to 5 (agree). */
export type PlanScores = { fit: number; progression: number; clarity: number };
export type Rating = { id: string; plan1: PlanScores; plan2: PlanScores; preferred: '1' | '2' | 'tie' };
export type Ratings = { pack: string; rater: string; ratedAt: string; ratings: Rating[] };

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function planView(plan: GoalPlan): PlanView {
  return {
    settings: {
      deadline: plan.spec.deadline,
      days: [...plan.spec.days],
      window: { ...plan.spec.window },
      weeklyCapMinutes: plan.spec.weeklyCapMinutes,
      ...(plan.spec.maxSessionMinutes !== undefined ? { maxSessionMinutes: plan.spec.maxSessionMinutes } : {}),
    },
    phases: plan.draft.phases.map((phase) => ({ ...phase })),
    sessionTypes: plan.draft.sessionTypes.map((type) => ({ ...type, blocks: type.blocks.map((block) => ({ ...block })) })),
    weeks: plan.weeks.map((week) => ({
      week: week.week,
      start: week.start,
      sessions: week.sessions.map((session) => ({ date: session.date, start: session.start, typeId: session.typeId, minutes: session.minutes })),
    })),
  };
}

/**
 * One item per case where both arms produced a ready plan (the final round
 * when a case had a scripted answer), in case id order, each pair shuffled
 * with the seed.
 */
export function makePack(cases: EvalCase[], results: ResultLine[], arms: [string, string], seed: number, runId: string): { pack: RatingPack; key: PackKey } {
  const random = mulberry32(seed);
  const finalReady = (caseId: string, arm: string) => {
    const lines = results
      .filter((line) => line.caseId === caseId && line.arm === arm && !line.harness)
      .sort((a, b) => b.round - a.round);
    const last = lines[0];
    return last?.outcome === 'ready' && last.planData ? last.planData : null;
  };
  const items: PackItem[] = [];
  const keyItems: PackKey['items'] = [];
  for (const item of [...cases].sort((a, b) => a.id.localeCompare(b.id))) {
    const first = finalReady(item.id, arms[0]);
    const second = finalReady(item.id, arms[1]);
    if (!first || !second) continue;
    const swap = random() < 0.5;
    const id = `p${String(items.length + 1).padStart(3, '0')}`;
    items.push({ id, text: item.text, language: item.language, plans: swap ? [planView(second), planView(first)] : [planView(first), planView(second)] });
    keyItems.push({ id, caseId: item.id, order: swap ? [arms[1], arms[0]] : [arms[0], arms[1]] });
  }
  // Named by its content, so the name says nothing about the seed or the arms.
  const packId = `${runId}-${createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 12)}`;
  return { pack: { pack: packId, items }, key: { pack: packId, runId, seed, arms, items: keyItems } };
}

export type RatingTable = {
  pairs: number;
  /** Pairs in the key that the ratings leave out. */
  unrated: number;
  preferred: Record<string, number> & { tie: number };
  /** For each arm and statement, how many plans got each score from 1 to 5. */
  scores: Record<string, Record<keyof PlanScores, [number, number, number, number, number]>>;
};

/** Unblinds ratings with the key and counts them per arm. */
export function unblind(key: PackKey, ratings: Ratings): RatingTable {
  if (ratings.pack !== key.pack) throw new Error(`ratings are for pack ${ratings.pack}, key is for ${key.pack}`);
  const order = new Map(key.items.map((item) => [item.id, item.order]));
  const empty = () => ({ fit: [0, 0, 0, 0, 0], progression: [0, 0, 0, 0, 0], clarity: [0, 0, 0, 0, 0] }) as RatingTable['scores'][string];
  const table: RatingTable = {
    pairs: 0,
    unrated: 0,
    preferred: { [key.arms[0]]: 0, [key.arms[1]]: 0, tie: 0 } as RatingTable['preferred'],
    scores: { [key.arms[0]]: empty(), [key.arms[1]]: empty() },
  };
  const rated = new Set<string>();
  for (const rating of ratings.ratings) {
    const arms = order.get(rating.id);
    if (!arms) throw new Error(`rating ${rating.id} is not in the key`);
    if (rated.has(rating.id)) throw new Error(`pair ${rating.id} is rated twice`);
    if (!['1', '2', 'tie'].includes(rating.preferred)) throw new Error(`rating ${rating.id} has no preference`);
    rated.add(rating.id);
    table.pairs += 1;
    if (rating.preferred === 'tie') table.preferred.tie += 1;
    else table.preferred[arms[rating.preferred === '1' ? 0 : 1]] += 1;
    for (const [position, scores] of [[0, rating.plan1], [1, rating.plan2]] as const) {
      for (const statement of ['fit', 'progression', 'clarity'] as const) {
        const score = scores[statement];
        if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error(`rating ${rating.id} has a score outside 1 to 5`);
        table.scores[arms[position]][statement][score - 1] += 1;
      }
    }
  }
  table.unrated = key.items.length - rated.size;
  return table;
}
