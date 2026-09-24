import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSkeleton, busyIndex, freeRanges, planWeeks } from '../lib/planner/availability.ts';
import { checkPlan } from '../lib/planner/check.ts';
import { ruleIssues, validateDraft } from '../lib/planner/draft.ts';
import { keepBest, loadLimit } from '../lib/planner/load.ts';
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

function type(id: string, minutes: number, intensity: SessionType['intensity'], role: SessionType['role']): SessionType {
  return {
    id,
    title: id.replace('_', ' '),
    minutes,
    intensity,
    role,
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
// taper: under every weekly ceiling, with no jump in load.
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
    sessionTypes: [
      type('easy_run', 30, 'easy', 'support'),
      type('intervals', 35, 'hard', 'key'),
      type('long_run', 45, 'moderate', 'key'),
    ],
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
  assert.deepEqual(skeleton.weeks[0], {
    week: 1,
    start: '2026-09-21',
    usableDays: 2,
    freeDays: 1,
    maxSessions: 1,
    maxMinutes: 90,
  });
  assert.equal(skeleton.weeks[1].maxSessions, 5);
  // Fitness volume ramps from 90 minutes by 10% a week until the 180-minute cap.
  assert.deepEqual(skeleton.weeks.map((week) => week.maxMinutes), [90, 99, 108, 118, 129, 141, 155, 170, 180, 180, 180]);
  const learning = buildSkeleton({ ...tenK, domain: 'learning' }, []);
  assert.ok(learning.weeks.every((week) => week.maxMinutes === 180));
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
  const valid = validateDraft(tenKDraft(skeleton.weeks.length), tenK, skeleton);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.ok ? valid.overLimits : null, []);

  const brokenBlocks = tenKDraft(skeleton.weeks.length);
  brokenBlocks.sessionTypes[0] = { ...brokenBlocks.sessionTypes[0], blocks: [{ minutes: 20, activity: 'Run.' }] };
  const overCap = tenKDraft(skeleton.weeks.length);
  overCap.weeks[3] = { week: 4, sessions: ['long_run', 'long_run', 'long_run', 'long_run', 'intervals'] };
  const tooHard = tenKDraft(skeleton.weeks.length);
  tooHard.weeks[2] = { week: 3, sessions: ['intervals', 'intervals', 'intervals'] };
  const unknown = tenKDraft(skeleton.weeks.length);
  unknown.weeks[1] = { week: 2, sessions: ['tempo'] };

  const overCeiling = tenKDraft(skeleton.weeks.length);
  overCeiling.weeks[1] = { week: 2, sessions: ['easy_run', 'easy_run', 'long_run'] };
  const eightSessions = tenKDraft(skeleton.weeks.length);
  eightSessions.weeks[4] = { week: 5, sessions: Array.from({ length: 8 }, () => 'easy_run') };

  // Structural problems fail the check; weeks over their limits pass it and
  // are listed for the scheduler to trim.
  const codes = (draft: Draft) => {
    const result = validateDraft(draft, tenK, skeleton);
    return result.ok ? result.overLimits.map((issue) => issue.code) : result.issues.map((issue) => `structure:${issue.code}`);
  };
  assert.deepEqual(codes(brokenBlocks), ['structure:blocks_sum']);
  assert.deepEqual(codes(unknown), ['structure:week_session']);
  assert.deepEqual(codes({ ...tenKDraft(3) }), ['structure:weeks']);
  assert.deepEqual(codes(eightSessions), ['structure:week_length']);
  assert.ok(codes(overCap).includes('week_cap'));
  assert.deepEqual(codes(tooHard), ['hard_sessions']);
  // 105 minutes in week 2, whose ceiling is 99.
  assert.deepEqual(codes(overCeiling), ['week_minutes']);
});

void test('fitness load may not jump more than 30% above the average of the last four weeks', () => {
  assert.equal(loadLimit([], 'beginner'), null);
  assert.equal(loadLimit([100], 'beginner'), 130);
  assert.equal(loadLimit([200, 200, 200, 200], 'intermediate'), 260);
  // Only the four most recent weeks count: 500 * 1.3 / 4 = 162.5.
  assert.equal(loadLimit([100, 100, 100, 100, 200], 'advanced'), 162);
  // A light or empty stretch can always return to the starting volume.
  assert.equal(loadLimit([60, 60, 60, 60], 'beginner'), 90);
  assert.equal(loadLimit([0, 0], 'intermediate'), 120);
});

void test('trimming keeps key sessions first, then the most minutes', () => {
  const easy = { minutes: 30, intensity: 'easy', role: 'support' } as const;
  const long = { minutes: 45, intensity: 'moderate', role: 'key' } as const;
  const tempo = { minutes: 40, intensity: 'hard', role: 'key' } as const;
  const limits = { maxCount: 5, maxMinutes: 90, maxHard: 2 };
  assert.deepEqual(keepBest([easy, long, easy, tempo], limits), [1, 3]);
  assert.deepEqual(keepBest([easy, easy, easy], limits), [0, 1, 2]);
  assert.deepEqual(keepBest([easy, easy, easy, easy], limits), [0, 1, 2]);
  assert.deepEqual(keepBest([tempo, tempo, tempo], { ...limits, maxMinutes: 200 }), [0, 1]);
  assert.deepEqual(keepBest([long, long], { ...limits, maxMinutes: 30 }), []);
  // Only one key session fits in 80 minutes. The long run is kept over tempo
  // work even though tempo plus two support sessions would fill all 80.
  const stretch = { minutes: 10, intensity: 'easy', role: 'support' } as const;
  assert.deepEqual(keepBest([easy, long, tempo, stretch], { ...limits, maxMinutes: 80 }), [0, 1]);
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
      level: (['beginner', 'intermediate', 'advanced', 'unknown'] as const)[pick(0, 3)],
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
        role: random() < 0.5 ? 'key' : 'support',
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
    // What was placed also meets every rule the draft check applies.
    const placed: Draft = { ...draft, weeks: plan.weeks.map((week) => ({ week: week.week, sessions: week.sessions.map((session) => session.typeId) })) };
    const overLimits = ruleIssues(placed, spec, buildSkeleton(spec, busy));
    if (overLimits.length > 0) failures.push(`seed ${seed} placed: ${JSON.stringify(overLimits.slice(0, 3))}`);
    assert.deepEqual(schedulePlan(spec, draft, busy), plan, `seed ${seed} is not deterministic`);
  }
  assert.deepEqual(failures, []);
});


void test('a planned lighter week does not block the return to earlier volume', () => {
  const deload = tenKDraft(11);
  deload.weeks[8] = { week: 9, sessions: ['easy_run', 'easy_run'] };
  // Week 10 returns to 110 minutes after a 60-minute week: the average of
  // weeks 6 to 9 is 92.5, so up to 120 is allowed.
  const plan = schedulePlan(tenK, deload, []);
  assert.deepEqual(plan.notes.filter((note) => note.kind === 'dropped'), []);
  assert.deepEqual(checkPlan(plan, []), []);
});

void test('a first week cut short by the start date does not hold back later weeks', () => {
  // The plan starts on a Thursday, so week 1 holds only Thursday and Friday.
  const draft = tenKDraft(11);
  draft.weeks[0] = { week: 1, sessions: ['easy_run'] };
  for (const index of [1, 2, 3]) draft.weeks[index] = { week: index + 1, sessions: ['easy_run', 'easy_run', 'easy_run'] };
  // 110 minutes is within 30% of the 90-minute weeks 2 to 4; counting the
  // 30-minute partial week would have capped it at 97.
  draft.weeks[4] = { week: 5, sessions: ['long_run', 'intervals', 'easy_run'] };
  const plan = schedulePlan(tenK, draft, []);
  assert.deepEqual(plan.notes.filter((note) => note.kind === 'dropped'), []);
  assert.equal(plan.weeks[4].sessions.reduce((total, session) => total + session.minutes, 0), 110);
  assert.deepEqual(checkPlan(plan, []), []);
});

void test('a jump after a light stretch is trimmed, keeping the key sessions', () => {
  const draft = tenKDraft(11);
  for (let index = 0; index < 11; index += 1) draft.weeks[index] = { week: index + 1, sessions: ['easy_run', 'easy_run'] };
  // 140 minutes fits week 7's 155-minute ceiling, but after four 60-minute
  // weeks the load limit is the 90-minute starting volume.
  draft.weeks[6] = { week: 7, sessions: ['easy_run', 'long_run', 'intervals', 'easy_run'] };
  const plan = schedulePlan(tenK, draft, []);
  assert.deepEqual(plan.notes.filter((note) => note.kind === 'dropped'), [
    { kind: 'dropped', week: 7, typeId: 'easy_run', reason: 'load' },
    { kind: 'dropped', week: 7, typeId: 'easy_run', reason: 'load' },
  ]);
  assert.deepEqual(plan.weeks[6].sessions.map((session) => session.typeId), ['long_run', 'intervals']);
  assert.deepEqual(checkPlan(plan, []), []);
});

void test('weeks over their fixed limits are trimmed to their best subset, with a reason each', () => {
  const draft = tenKDraft(11);
  draft.weeks[2] = { week: 3, sessions: ['intervals', 'intervals', 'intervals'] };
  draft.weeks[4] = { week: 5, sessions: ['long_run', 'long_run', 'long_run', 'easy_run'] };
  const plan = schedulePlan(tenK, draft, []);
  // Week 5 first drops a long run to fit its 129-minute ceiling, then the
  // easy run, because weeks 1 to 4 averaged under 70 minutes.
  assert.deepEqual(plan.notes.filter((note) => note.kind === 'dropped'), [
    { kind: 'dropped', week: 3, typeId: 'intervals', reason: 'hard_sessions' },
    { kind: 'dropped', week: 5, typeId: 'long_run', reason: 'week_minutes' },
    { kind: 'dropped', week: 5, typeId: 'easy_run', reason: 'load' },
  ]);
  assert.deepEqual(checkPlan(plan, []), []);
});

void test('the independent check catches load rules a plan breaks', () => {
  const learning = validateGoalSpec({ ...tenK, domain: 'learning' });
  const draft = tenKDraft(11);
  draft.weeks[1] = { week: 2, sessions: ['intervals', 'intervals', 'intervals'] };
  draft.weeks[2] = { week: 3, sessions: ['easy_run'] };
  draft.weeks[3] = { week: 4, sessions: ['easy_run'] };
  draft.weeks[4] = { week: 5, sessions: ['long_run', 'long_run', 'long_run', 'long_run'] };
  // Scheduled as a learning goal, nothing limits load; checked as fitness, it breaks the rules.
  const plan = schedulePlan(learning, draft, []);
  const rules = checkPlan({ ...plan, spec: tenK }, []).map((violation) => `${violation.rule}:${violation.week ?? ''}`);
  assert.ok(rules.includes('hard_per_week:2'));
  assert.ok(rules.includes('week_ceiling:2'));
  assert.ok(rules.includes('week_ceiling:5'));
  assert.ok(rules.includes('load_jump:5'));
});

void test('busy times are indexed by date once per list: split at midnight, sorted and merged', () => {
  const busy: BusyInterval[] = [
    { start: '2026-10-02T09:30', end: '2026-10-02T11:00' },
    { start: '2026-10-01T22:00', end: '2026-10-03T01:00' },
    { start: '2026-10-04T08:00', end: '2026-10-04T09:45' },
    { start: '2026-10-04T07:00', end: '2026-10-04T08:00' },
    { start: '2026-10-04T12:00', end: '2026-10-04T13:00' },
  ];
  const index = busyIndex(busy);
  assert.deepEqual(Object.fromEntries(index), {
    '2026-10-01': [[1320, 1440]],
    '2026-10-02': [[0, 1440]],
    '2026-10-03': [[0, 60]],
    '2026-10-04': [[420, 585], [720, 780]],
  });
  assert.equal(busyIndex(busy), index, 'the index is kept with its list');
});

void test('scheduling reads each busy time once, however many there are', () => {
  // 2,000 busy times over 26 weeks, some inside the plan's morning window.
  const busy: BusyInterval[] = Array.from({ length: 2_000 }, (_, index) => {
    const date = addDays('2026-09-24', index % 182);
    const hour = 6 + 2 * Math.floor(index / 182);
    return { start: `${date}T${String(hour).padStart(2, '0')}:00`, end: `${date}T${String(hour).padStart(2, '0')}:40` };
  });
  let reads = 0;
  const watched = new Proxy(busy, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/u.test(key)) reads += 1;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  buildSkeleton(tenK, watched);
  const plan = schedulePlan(tenK, tenKDraft(11), watched);
  assert.equal(reads, busy.length);
  // The independent check still reads the plain list and finds no overlap.
  assert.deepEqual(checkPlan(plan, busy), []);
  assert.ok(plan.notes.some((note) => note.kind === 'moved' && note.reason === 'busy'));
});
