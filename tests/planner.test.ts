import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSkeleton, freeRanges, planWeeks } from '../lib/planner/availability.ts';
import { checkPlan } from '../lib/planner/check.ts';
import { allowedNextWeekMinutes, validateDraft } from '../lib/planner/draft.ts';
import { schedulePlan } from '../lib/planner/schedule.ts';
import { SpecError, validateBusy, validateGoalSpec } from '../lib/planner/spec.ts';
import { addDays, weekdayOf } from '../lib/planner/time.ts';
import type { BusyInterval, Draft, GoalSpec, SessionType, Weekday } from '../lib/planner/types.ts';

// "Run a 10K by December, weekday mornings only, 3 hours a week max",
// asked on Thursday 2026-09-24.
const tenK: GoalSpec = validateGoalSpec({
  title: 'Run a 10K',
  domain: 'fitness',
  language: 'en',
  startDate: '2026-09-24',
  deadline: '2026-12-01',
  days: [0, 1, 2, 3, 4],
  window: { start: '06:00', end: '09:00' },
  weeklyCapMinutes: 180,
});

function type(id: string, minutes: number, intensity: SessionType['intensity']): SessionType {
  return {
    id,
    title: id.replace('_', ' '),
    minutes,
    intensity,
    blocks: [
      { minutes: 10, activity: 'Warm up with brisk walking.' },
      { minutes: minutes - 15, activity: 'Main set at the planned effort.' },
      { minutes: 5, activity: 'Cool down and stretch.' },
    ],
    deliverable: 'A logged session with time and effort.',
    doneWhen: 'The session is logged.',
  };
}

// Weekly minutes 60, 65, 75, 80, 90, 95, 105, 110, 110, 110, then a 60-minute
// taper: never more than 10% or 10 minutes above the week before.
const TEN_K_WEEKS: string[][] = [
  ['easy_run', 'easy_run'],
  ['easy_run', 'intervals'],
  ['easy_run', 'long_run'],
  ['intervals', 'long_run'],
  ['easy_run', 'easy_run', 'easy_run'],
  ['easy_run', 'easy_run', 'intervals'],
  ['easy_run', 'easy_run', 'long_run'],
  ['easy_run', 'intervals', 'long_run'],
  ['easy_run', 'intervals', 'long_run'],
  ['easy_run', 'intervals', 'long_run'],
  ['easy_run', 'easy_run'],
];

function tenKDraft(weeks: number): Draft {
  return {
    phases: [{ title: 'Base', fromWeek: 1, toWeek: weeks, focus: 'Build easy volume.' }],
    sessionTypes: [type('easy_run', 30, 'easy'), type('intervals', 35, 'hard'), type('long_run', 45, 'moderate')],
    weeks: Array.from({ length: weeks }, (_, index) => ({
      week: index + 1,
      sessions: [...(TEN_K_WEEKS[index] ?? ['easy_run'])],
    })),
    templateId: null,
  };
}

void test('plan weeks follow the calendar from the start date to the deadline', () => {
  const weeks = planWeeks(tenK);
  assert.equal(weeks[0].start, '2026-09-21');
  assert.deepEqual(weeks[0].dates, ['2026-09-24', '2026-09-25']);
  assert.equal(weeks.at(-1)?.start, '2026-11-30');
  assert.deepEqual(weeks.at(-1)?.dates, ['2026-11-30', '2026-12-01']);
  assert.equal(weeks.length, 11);
});

void test('free time is the window minus busy times, including ones that cross midnight', () => {
  const busy: BusyInterval[] = [
    { start: '2026-09-29T06:30', end: '2026-09-29T07:00' },
    { start: '2026-09-29T23:00', end: '2026-09-30T06:45' },
  ];
  assert.deepEqual(freeRanges('2026-09-29', tenK, busy), [[360, 390], [420, 540]]);
  assert.deepEqual(freeRanges('2026-09-30', tenK, busy), [[405, 540]]);
  assert.deepEqual(freeRanges('2026-10-01', tenK, busy), [[360, 540]]);
});

void test('the skeleton reports the real room in each week', () => {
  const allBusyFriday: BusyInterval[] = [{ start: '2026-09-25T00:00', end: '2026-09-26T00:00' }];
  const skeleton = buildSkeleton(tenK, allBusyFriday);
  assert.deepEqual(skeleton.weeks[0], { week: 1, start: '2026-09-21', usableDays: 2, freeDays: 1, maxSessions: 1 });
  assert.equal(skeleton.weeks[1].maxSessions, 5);
  assert.deepEqual(skeleton.sessionMinutes, { min: 15, max: 180 });
});

void test('specs and busy times are validated before scheduling', () => {
  const base = { ...tenK };
  assert.throws(() => validateGoalSpec({ ...base, deadline: '2026-09-01' }), SpecError);
  assert.throws(() => validateGoalSpec({ ...base, deadline: '2027-06-01' }), /at most 26 weeks/u);
  assert.throws(() => validateGoalSpec({ ...base, window: { start: '08:50', end: '09:00' } }), /at least 15 minutes/u);
  assert.throws(() => validateGoalSpec({ ...base, days: [0, 0] }), /must not repeat/u);
  assert.throws(() => validateGoalSpec({ ...base, startDate: '2026-02-30' }), /calendar date/u);
  assert.throws(() => validateBusy([{ start: '2026-10-01T09:00', end: '2026-10-01T08:00' }]), SpecError);
  assert.deepEqual(validateBusy(undefined), []);
});

void test('a valid 10K draft passes and each broken rule is reported', () => {
  const skeleton = buildSkeleton(tenK, []);
  assert.equal(validateDraft(tenKDraft(skeleton.weeks.length), tenK, skeleton).ok, true);

  const brokenBlocks = tenKDraft(skeleton.weeks.length);
  brokenBlocks.sessionTypes[0] = { ...brokenBlocks.sessionTypes[0], blocks: [{ minutes: 20, activity: 'Run.' }] };
  const overCap = tenKDraft(skeleton.weeks.length);
  overCap.weeks[3] = { week: 4, sessions: ['long_run', 'long_run', 'long_run', 'long_run', 'intervals'] };
  const tooHard = tenKDraft(skeleton.weeks.length);
  tooHard.weeks[2] = { week: 3, sessions: ['intervals', 'intervals', 'intervals'] };
  const unknown = tenKDraft(skeleton.weeks.length);
  unknown.weeks[1] = { week: 2, sessions: ['tempo'] };

  const codes = (draft: Draft) => {
    const result = validateDraft(draft, tenK, skeleton);
    return result.ok ? [] : result.issues.map((issue) => issue.code);
  };
  assert.deepEqual(codes(brokenBlocks), ['blocks_sum']);
  assert.ok(codes(overCap).includes('week_cap'));
  assert.deepEqual(codes(tooHard), ['hard_sessions']);
  assert.deepEqual(codes(unknown), ['week_session']);
  assert.deepEqual(codes({ ...tenKDraft(3) }), ['weeks']);
});

void test('fitness volume may not jump more than 10% or 10 minutes a week', () => {
  assert.equal(allowedNextWeekMinutes(60), 70);
  assert.equal(allowedNextWeekMinutes(150), 165);
  const skeleton = buildSkeleton(tenK, []);
  const jump = tenKDraft(skeleton.weeks.length);
  jump.weeks[1] = { week: 2, sessions: ['easy_run', 'easy_run', 'long_run', 'long_run'] };
  const result = validateDraft(jump, tenK, skeleton);
  assert.equal(result.ok, false);
  assert.deepEqual(result.ok ? [] : result.issues.map((issue) => issue.code), ['progression']);
});

void test('a recurring Tuesday meeting moves sessions and every rule still holds', () => {
  const tuesdays: BusyInterval[] = Array.from({ length: 11 }, (_, index) => {
    const tuesday = addDays('2026-09-22', index * 7);
    return { start: `${tuesday}T06:00`, end: `${tuesday}T08:40` };
  });
  const plan = schedulePlan(tenK, tenKDraft(11), tuesdays);
  assert.deepEqual(checkPlan(plan, tuesdays), []);

  const moved = plan.notes.filter((note) => note.kind === 'moved');
  assert.ok(moved.length > 0);
  const first = moved[0];
  assert.equal(first.kind === 'moved' ? first.reason : '', 'busy');
  assert.equal(first.kind === 'moved' ? first.conflict?.start : '', `${first.kind === 'moved' ? first.from.date : ''}T06:00`);
  assert.equal(weekdayOf(first.kind === 'moved' ? first.from.date : '2026-09-21'), 1);

  // The final week has only Monday and a blocked Tuesday before the deadline,
  // so its second session has nowhere to go and is dropped, not forced.
  const dropped = plan.notes.filter((note) => note.kind === 'dropped');
  assert.deepEqual(dropped, [{ kind: 'dropped', week: 11, typeId: 'easy_run', reason: 'no_free_slot' }]);
  const sessions = plan.weeks.flatMap((week) => week.sessions);
  assert.equal(sessions.length, TEN_K_WEEKS.flat().length - dropped.length);
  assert.ok(sessions.every((session) => session.start >= '06:00'));
});

void test('with no free time the scheduler drops sessions instead of forcing them', () => {
  const allBusy: BusyInterval[] = [{ start: '2026-09-24T00:00', end: '2026-10-05T00:00' }];
  const plan = schedulePlan(tenK, tenKDraft(11), allBusy);
  assert.deepEqual(checkPlan(plan, allBusy), []);
  assert.deepEqual(plan.weeks[0].sessions, []);
  assert.deepEqual(plan.weeks[1].sessions, []);
  assert.equal(plan.notes.filter((note) => note.kind === 'dropped' && note.reason === 'no_free_slot').length, 4);
  assert.equal(plan.weeks[2].sessions.length, 2);
});

// Seeded generator so a failure can be replayed exactly.
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

void test('property: any draft, spec and calendar yield a plan that passes every check', () => {
  const failures: string[] = [];
  for (let seed = 1; seed <= 400; seed += 1) {
    const random = mulberry32(seed);
    const pick = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    const start = addDays('2026-01-01', pick(0, 360));
    const windowStart = pick(5, 20) * 60 + pick(0, 3) * 15;
    const windowEnd = Math.min(23 * 60 + 45, windowStart + pick(1, 8) * 30);
    const days = [0, 1, 2, 3, 4, 5, 6].filter(() => random() < 0.6) as Weekday[];
    if (days.length === 0) days.push(pick(0, 6) as Weekday);
    const spec = validateGoalSpec({
      title: `Seed ${seed}`,
      domain: (['fitness', 'learning', 'creative', 'general'] as const)[pick(0, 3)],
      language: 'en',
      startDate: start,
      deadline: addDays(start, pick(0, 150)),
      days,
      window: {
        start: `${String(Math.floor(windowStart / 60)).padStart(2, '0')}:${String(windowStart % 60).padStart(2, '0')}`,
        end: `${String(Math.floor(windowEnd / 60)).padStart(2, '0')}:${String(windowEnd % 60).padStart(2, '0')}`,
      },
      weeklyCapMinutes: pick(3, 60) * 15,
    });
    const busy: BusyInterval[] = Array.from({ length: pick(0, 40) }, () => {
      const day = addDays(start, pick(-3, 160));
      const from = pick(0, 1_400);
      const to = Math.min(1_439, from + pick(5, 300));
      const at = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      return random() < 0.1
        ? { start: `${day}T${at(from)}`, end: `${addDays(day, pick(1, 3))}T${at(to)}` }
        : { start: `${day}T${at(from)}`, end: `${day}T${at(to)}` };
    });
    // Deliberately unvalidated drafts: over the cap, crowded weeks, many hard sessions.
    const types = Array.from({ length: pick(1, 5) }, (_, index) => {
      const minutes = pick(3, 36) * 5;
      return {
        id: `type_${index}`,
        title: `Type ${index}`,
        minutes,
        intensity: (['easy', 'moderate', 'hard'] as const)[pick(0, 2)],
        blocks: [{ minutes, activity: 'Work.' }],
        deliverable: 'Evidence.',
        doneWhen: 'Done.',
      } satisfies SessionType;
    });
    const weekCount = planWeeks(spec).length;
    const draft: Draft = {
      phases: [{ title: 'All', fromWeek: 1, toWeek: weekCount, focus: 'Everything.' }],
      sessionTypes: types,
      weeks: Array.from({ length: weekCount }, (_, index) => ({
        week: index + 1,
        sessions: Array.from({ length: pick(0, 9) }, () => types[pick(0, types.length - 1)].id),
      })),
      templateId: null,
    };
    const plan = schedulePlan(spec, draft, busy);
    const violations = checkPlan(plan, busy);
    if (violations.length > 0) failures.push(`seed ${seed}: ${JSON.stringify(violations.slice(0, 3))}`);
    assert.deepEqual(schedulePlan(spec, draft, busy), plan, `seed ${seed} is not deterministic`);
  }
  assert.deepEqual(failures, []);
});
