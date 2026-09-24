import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPlan } from '../lib/planner/check.ts';
import { FITNESS_LOAD } from '../lib/planner/load.ts';
import { replanOptions, type ReplanOption } from '../lib/planner/replan.ts';
import { schedulePlan } from '../lib/planner/schedule.ts';
import { PLAN_LIMITS, validateGoalSpec } from '../lib/planner/spec.ts';
import { addDays, weekdayOf } from '../lib/planner/time.ts';
import type { Draft, GoalPlan, PlannedSession, SessionType } from '../lib/planner/types.ts';

function type(id: string, minutes: number, intensity: SessionType['intensity'], role: SessionType['role']): SessionType {
  return {
    id,
    title: id,
    minutes,
    intensity,
    role,
    blocks: [{ minutes, activity: 'Main set.' }],
    deliverable: 'A logged session.',
    doneWhen: 'It is logged.',
  };
}

// Ten full weeks, Monday, Wednesday, Friday and Saturday, from 2026-09-28.
const BASE = {
  title: 'Goal',
  language: 'en',
  startDate: '2026-09-28',
  deadline: '2026-12-06',
  days: [0, 2, 4, 5],
  weeklyCapMinutes: 180,
} as const;

function draftOf(weeks: number, sessions: (week: number) => string[]): Draft {
  return {
    phases: [
      { title: 'Base', fromWeek: 1, toWeek: Math.floor(weeks / 2), focus: 'Foundations.' },
      { title: 'Build', fromWeek: Math.floor(weeks / 2) + 1, toWeek: weeks, focus: 'More at once.' },
    ],
    sessionTypes: [
      type('practice', 30, 'moderate', 'key'),
      type('review', 20, 'easy', 'support'),
      type('project', 60, 'moderate', 'key'),
      type('easy_run', 30, 'easy', 'support'),
      type('intervals', 35, 'hard', 'key'),
      type('long_run', 45, 'moderate', 'key'),
    ],
    weeks: Array.from({ length: weeks }, (_, index) => ({ week: index + 1, sessions: sessions(index + 1) })),
    templateId: null,
  };
}

// A learning plan whose weeks differ, so every option places something different.
const LEARNING_WEEKS: Record<number, string[]> = {
  1: ['practice', 'review'],
  2: ['practice', 'project'],
  3: ['practice', 'review', 'project'],
  4: ['practice', 'project', 'project'],
  5: ['practice', 'review', 'project'],
  6: ['practice', 'project', 'review', 'review'],
  7: ['practice', 'project', 'project'],
  8: ['practice', 'review', 'project'],
  9: ['project', 'project'],
  10: ['review'],
};
const learning = validateGoalSpec({ ...BASE, days: [...BASE.days], domain: 'learning', window: { start: '18:00', end: '21:00' } });
const LEARNING_DRAFT = draftOf(10, (week) => LEARNING_WEEKS[week]);

/** Sets a status on the sessions `pick` names; others keep theirs. */
function mark(plan: GoalPlan, pick: (session: PlannedSession) => PlannedSession['status'] | null): GoalPlan {
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      sessions: week.sessions.map((session) => ({ ...session, status: pick(session) ?? session.status })),
    })),
  };
}

const upcoming = (option: ReplanOption, from: string) => option.plan.weeks.flatMap((week) => week.sessions).filter((session) => session.date >= from);
const weekMinutes = (plan: GoalPlan, week: number) => plan.weeks.find((entry) => entry.week === week)!.sessions.reduce((total, session) => total + session.minutes, 0);

// Week 1 done, week 2 missed, asked on Sunday of week 2: changes start Monday.
const TODAY = '2026-10-11';
const FROM = '2026-10-12';
const original = schedulePlan(learning, LEARNING_DRAFT, []);
const missedWeek2 = mark(original, (session) => (session.week === 1 ? 'done' : session.week === 2 ? 'missed' : null));

void test('after a missed week every option is offered, keeps the past as it was and passes the independent check', () => {
  const replan = replanOptions(missedWeek2, [], TODAY);
  assert.ok(replan);
  assert.deepEqual(replan.situation, { from: FROM, missedSessions: 2, missedWeeks: 1, weeksLeft: 8 });
  assert.deepEqual(replan.options.map((option) => option.summary.id), ['keep', 'repeat', 'extend', 'lighter']);
  const past = missedWeek2.weeks.filter((week) => week.week <= 2);
  for (const option of replan.options) {
    assert.deepEqual(option.plan.weeks.filter((week) => week.week <= 2), past, `${option.summary.id} keeps weeks 1 and 2`);
    assert.deepEqual(checkPlan(option.plan, []), [], option.summary.id);
    const ids = option.plan.weeks.flatMap((week) => week.sessions.map((session) => session.id));
    assert.equal(new Set(ids).size, ids.length, `${option.summary.id} has unique session ids`);
    assert.deepEqual(option.plan.weeks.map((week) => week.week), Array.from({ length: option.plan.weeks.length }, (_, index) => index + 1));
    assert.ok(upcoming(option, FROM).every((session) => session.status === 'planned'));
  }
});

void test('repeat redoes the missed week and cuts the end; extend moves the deadline instead; lighter trims every week', () => {
  const replan = replanOptions(missedWeek2, [], TODAY)!;
  const byId = Object.fromEntries(replan.options.map((option) => [option.summary.id, option]));
  // Keep skips what was missed; repeat asks week 3 for week 2's sessions and loses the last week.
  assert.deepEqual(byId.keep.plan.draft.weeks.find((week) => week.week === 3)?.sessions, LEARNING_WEEKS[3]);
  assert.deepEqual(byId.repeat.plan.draft.weeks.find((week) => week.week === 3)?.sessions, LEARNING_WEEKS[2]);
  assert.deepEqual(byId.repeat.plan.draft.weeks.find((week) => week.week === 10)?.sessions, LEARNING_WEEKS[9]);
  assert.equal(byId.repeat.summary.deadline, learning.deadline);
  assert.equal(byId.keep.summary.sessionsLeftOut, 2, 'keep leaves out the two missed sessions');
  assert.equal(byId.repeat.summary.sessionsLeftOut, LEARNING_WEEKS[10].length, 'repeat leaves out the last week');
  // Extend: one more week, and the old last week's content becomes week 11.
  assert.equal(byId.extend.summary.deadline, addDays(learning.deadline, 7));
  assert.equal(byId.extend.plan.weeks.length, 11);
  assert.deepEqual(byId.extend.plan.draft.weeks.find((week) => week.week === 11)?.sessions, LEARNING_WEEKS[10]);
  assert.equal(byId.extend.summary.sessionsLeftOut, 0);
  // Phases move with their weeks and still start at week 1.
  assert.deepEqual(byId.extend.plan.draft.phases.map((phase) => [phase.fromWeek, phase.toWeek]), [[1, 6], [7, 11]]);
  // Lighter never plans more than keep in any week ahead, and never empties a week.
  for (let week = 3; week <= 10; week += 1) {
    assert.ok(weekMinutes(byId.lighter.plan, week) <= weekMinutes(byId.keep.plan, week), `week ${week}`);
    assert.ok(weekMinutes(byId.lighter.plan, week) > 0, `week ${week}`);
  }
  assert.ok(byId.lighter.summary.minutesLeft < byId.keep.summary.minutesLeft);
});

// A fitness plan that climbs above its starting volume: four runs a week from week 2.
const tenK = validateGoalSpec({ ...BASE, days: [...BASE.days], title: 'Run a 10K', domain: 'fitness', level: 'intermediate', window: { start: '06:00', end: '09:00' } });
const TEN_K_DRAFT = draftOf(10, (week) => (week === 1 ? ['easy_run', 'intervals', 'long_run'] : ['easy_run', 'intervals', 'long_run', 'easy_run']));
const tenKPlan = schedulePlan(tenK, TEN_K_DRAFT, []);

void test('a missed week lowers what the next fitness week may hold', () => {
  // Weeks 1 to 4 done, week 5 missed, asked on Sunday of week 5.
  const missed = mark(tenKPlan, (session) => (session.week <= 4 ? 'done' : session.week === 5 ? 'missed' : null));
  const replan = replanOptions(missed, [], '2026-11-01');
  assert.ok(replan);
  const keep = replan.options.find((option) => option.summary.id === 'keep')!;
  const done = [2, 3, 4].map((week) => weekMinutes(tenKPlan, week));
  const limit = Math.max(FITNESS_LOAD.startMinutes.intermediate, Math.floor(((done[0] + done[1] + done[2]) * FITNESS_LOAD.jumpPercent) / 400));
  assert.ok(weekMinutes(tenKPlan, 6) > limit, 'the plan asked for more than a return after a missed week allows');
  assert.ok(weekMinutes(keep.plan, 6) <= limit, `${weekMinutes(keep.plan, 6)} <= ${limit}`);
  assert.deepEqual(checkPlan(keep.plan, []), []);
});

void test('mid-week, sessions already behind count toward the rest of that week', () => {
  // Asked on Wednesday of week 3: week 2 missed, Monday's and today's runs done.
  const midWeek = mark(tenKPlan, (session) => {
    if (session.week === 1) return 'done';
    if (session.week === 2) return 'missed';
    return session.week === 3 && session.date <= '2026-10-14' ? 'done' : null;
  });
  const replan = replanOptions(midWeek, [], '2026-10-14');
  assert.ok(replan);
  assert.equal(replan.situation.from, '2026-10-15');
  // Every option is checked below, so none may be missing. Repeat folds into
  // keep here: weeks 2 and 3 ask for the same runs.
  assert.deepEqual(replan.options.map((option) => option.summary.id), ['keep', 'extend', 'lighter']);
  for (const option of replan.options) {
    const week3 = option.plan.weeks.find((week) => week.week === 3)!;
    const kept = midWeek.weeks.find((week) => week.week === 3)!.sessions.filter((session) => session.date <= '2026-10-14');
    assert.deepEqual(week3.sessions.filter((session) => session.date <= '2026-10-14'), kept, option.summary.id);
    assert.ok(weekMinutes(option.plan, 3) <= tenK.weeklyCapMinutes, option.summary.id);
    assert.deepEqual(checkPlan(option.plan, []), [], option.summary.id);
    assert.ok(week3.sessions.filter((session) => session.intensity === 'hard').length <= FITNESS_LOAD.maxHardPerWeek);
    // No hard session the day after today's hard one.
    const thursday = week3.sessions.find((session) => session.date === '2026-10-15');
    if (kept.some((session) => session.intensity === 'hard' && session.date === '2026-10-14')) {
      assert.notEqual(thursday?.intensity, 'hard', option.summary.id);
    }
  }
});

void test('mid-week, the rest of the week keeps under the cap once what was done counts', () => {
  // Every day allowed, so the cap binds before the number of days does.
  const daily = validateGoalSpec({ ...learning, days: [0, 1, 2, 3, 4, 5, 6] });
  const weeks: Record<number, string[]> = { 1: ['practice', 'review'], 2: ['project', 'project', 'practice'], 3: ['review', 'practice', 'project'] };
  const plan = schedulePlan(daily, draftOf(10, (week) => weeks[week] ?? ['practice', 'project']), []);
  // Week 2 missed; this week's review (Monday) and practice (Tuesday) are done; asked on Wednesday.
  const marked = mark(plan, (session) => {
    if (session.week === 1) return 'done';
    if (session.week === 2) return 'missed';
    return session.week === 3 && session.date <= '2026-10-14' ? 'done' : null;
  });
  const replan = replanOptions(marked, [], '2026-10-14');
  assert.deepEqual(replan?.options.map((option) => option.summary.id), ['keep', 'repeat', 'extend', 'lighter']);
  const repeat = replan!.options.find((option) => option.summary.id === 'repeat')!;
  // Redoing week 2 asks for 150 minutes on top of the 50 already done: the cap trims it.
  assert.ok(weekMinutes(repeat.plan, 3) <= daily.weeklyCapMinutes, `${weekMinutes(repeat.plan, 3)}`);
  assert.ok(weekMinutes(repeat.plan, 3) > 50);
});

void test('no hard session the day after one done today', () => {
  const everyDay = validateGoalSpec({ ...tenK, days: [0, 1, 2, 3, 4, 5, 6] });
  const hardFirst = draftOf(10, (week) => (week === 1 ? ['easy_run', 'long_run'] : ['intervals', 'easy_run', 'intervals', 'long_run']));
  const plan = schedulePlan(everyDay, hardFirst, []);
  const today = plan.weeks[2].sessions.find((session) => session.intensity === 'hard')!.date;
  const marked = mark(plan, (session) => {
    if (session.week === 1) return 'done';
    if (session.week === 2) return 'missed';
    return session.week === 3 && session.date <= today ? 'done' : null;
  });
  const replan = replanOptions(marked, [], today);
  assert.ok(replan && replan.options.some((option) => option.summary.id === 'keep'));
  for (const option of replan.options) {
    const next = option.plan.weeks.flatMap((week) => week.sessions).find((session) => session.date === addDays(today, 1));
    assert.notEqual(next?.intensity, 'hard', option.summary.id);
    assert.deepEqual(checkPlan(option.plan, []), [], option.summary.id);
  }
});

void test('busy times imported later never flag past sessions, and new sessions avoid them', () => {
  // A calendar imported after the plan: all of week 2 and next Monday are busy.
  const busy = [{ start: '2026-10-05T00:00', end: '2026-10-13T00:00' }];
  const replan = replanOptions(missedWeek2, busy, TODAY);
  assert.deepEqual(replan?.options.map((option) => option.summary.id), ['keep', 'repeat', 'extend', 'lighter']);
  for (const option of replan.options) {
    assert.ok(upcoming(option, FROM).every((session) => session.date !== '2026-10-12'), option.summary.id);
  }
});

void test('nothing to adjust: no recent miss, only old misses, or the plan is over', () => {
  assert.equal(replanOptions(mark(original, (session) => (session.week <= 2 ? 'done' : null)), [], TODAY), null);
  const oldMiss = mark(original, (session) => (session.week === 1 ? 'missed' : session.week <= 4 ? 'done' : null));
  assert.equal(replanOptions(oldMiss, [], '2026-10-25'), null);
  assert.equal(replanOptions(missedWeek2, [], learning.deadline), null);
});

void test('options that would place the same sessions are offered once', () => {
  // The same single session every week: redoing a week places what keep
  // places, and lighter keeps the only session, so both fold into keep.
  const plan = schedulePlan(learning, draftOf(10, () => ['project']), []);
  const replan = replanOptions(mark(plan, (session) => (session.week === 1 ? 'done' : session.week === 2 ? 'missed' : null)), [], TODAY);
  assert.deepEqual(replan?.options.map((option) => option.summary.id), ['keep', 'extend']);
});

void test('extend is not offered past the longest plan allowed', () => {
  const start = '2026-09-28';
  const longest = validateGoalSpec({ ...learning, startDate: start, deadline: addDays(start, PLAN_LIMITS.maxHorizonDays - 1) });
  const plan = schedulePlan(longest, draftOf(26, (week) => LEARNING_WEEKS[((week - 1) % 10) + 1]), []);
  const replan = replanOptions(mark(plan, (session) => (session.week === 1 ? 'done' : session.week === 2 ? 'missed' : null)), [], TODAY);
  const ids = replan?.options.map((option) => option.summary.id) ?? [];
  assert.ok(ids.includes('repeat'));
  assert.ok(!ids.includes('extend'));
  assert.equal(weekdayOf(FROM), 0);
});
