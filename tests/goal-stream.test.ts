import test from 'node:test';
import assert from 'node:assert/strict';
import {
  plannedGoalSteps,
  retryProblems,
  runGoalPipeline,
  type DraftPayload,
  type GoalPipelineDeps,
  type ReadGoalPayload,
} from '../lib/goal-stream.ts';
import { checkPlan } from '../lib/planner/check.ts';
import { applyStageEvent, skipRemainingSteps, StageFailure, type StageEvent } from '../lib/plan-stream.ts';
import { ServiceFailure } from '../lib/server/live.ts';

const TODAY = '2026-09-24';

const READING = {
  decision: 'plan',
  title: 'Run a 10K',
  summary: 'Run 10 km by December on weekday mornings, up to 3 hours a week.',
  domain: 'fitness',
  level: 'unknown',
  deadline: '2026-12-01',
  deadline_basis: 'inferred',
  days: [0, 1, 2, 3, 4],
  window: 'morning',
  weekly_minutes: 180,
  session_minutes: null,
  question: null,
  abstain: null,
};

function sessionType(id: string, minutes: number, intensity: string, role: string) {
  return {
    id,
    title: id.replace('_', ' '),
    minutes,
    intensity,
    role,
    blocks: [
      { minutes: 5, activity: 'Walk to warm up.' },
      { minutes: minutes - 10, activity: 'Run at the planned effort.' },
      { minutes: 5, activity: 'Walk to cool down.' },
    ],
    deliverable: 'A logged run.',
    doneWhen: 'The run is logged.',
  };
}

// Eleven calendar weeks from Friday 2026-09-25 to Tuesday 2026-12-01.
const DRAFT = {
  phases: [{ title: 'Base', fromWeek: 1, toWeek: 11, focus: 'Easy running with one longer run.' }],
  sessionTypes: [sessionType('easy_run', 30, 'easy', 'support'), sessionType('long_run', 45, 'moderate', 'key')],
  weeks: Array.from({ length: 11 }, (_, index) => ({
    week: index + 1,
    sessions: index === 0 || index === 10 ? ['easy_run'] : ['easy_run', 'long_run'],
  })),
  templateId: null,
};

const BROKEN_DRAFT = {
  ...DRAFT,
  sessionTypes: [{ ...DRAFT.sessionTypes[0], blocks: [{ minutes: 20, activity: 'Run.' }] }, DRAFT.sessionTypes[1]],
};

function input(extra: Record<string, unknown> = {}) {
  return { text: 'I want to run a 10K by December, weekday mornings, 3 hours a week max', language: 'en', today: TODAY, ...extra };
}

function harness(overrides: Partial<GoalPipelineDeps> = {}) {
  const events: StageEvent[] = [];
  const reads: ReadGoalPayload[] = [];
  const drafts: DraftPayload[] = [];
  const state = { released: 0 };
  let clock = 0;
  const deps: GoalPipelineDeps = {
    mode: 'live',
    now: () => (clock += 5),
    serverToday: TODAY,
    emit: (event) => events.push(event),
    reserve: async () => ({
      allowed: true,
      release: async () => {
        state.released += 1;
      },
    }),
    readGoal: async (payload) => {
      reads.push(payload);
      return { reading: READING, scopeRefused: false, requestId: 'read-1' };
    },
    draft: async (payload) => {
      drafts.push(payload);
      return { draft: DRAFT, requestId: `draft-${drafts.length}` };
    },
    ...overrides,
  };
  return { deps, events, reads, drafts, state };
}

function trail(events: StageEvent[]): string[] {
  return events.map((event) => `${event.stage}${event.attempt ? `#${event.attempt}` : ''}:${event.status}`);
}

async function failure(run: Promise<unknown>): Promise<StageFailure> {
  try {
    await run;
  } catch (error) {
    if (error instanceof StageFailure) return error;
    throw error;
  }
  throw new Error('the run did not fail');
}

void test('a live goal run reports every stage in order and returns a checked plan', async () => {
  const { deps, events, reads, drafts, state } = harness();
  const outcome = await runGoalPipeline(input(), deps);
  assert.deepEqual(trail(events), [
    'check_request:started', 'check_request:completed',
    'reserve:started', 'reserve:completed',
    'read_goal:started', 'read_goal:completed',
    'check_availability:started', 'check_availability:completed',
    'draft:started', 'draft:completed',
    'check_draft:started', 'check_draft:completed',
    'fit:started', 'fit:completed',
  ]);
  assert.equal(events.find((event) => event.stage === 'read_goal' && event.status === 'completed')?.actor, 'model');
  assert.equal(outcome.outcome, 'ready');
  if (outcome.outcome !== 'ready') return;
  assert.equal(outcome.plan.weeks.length, 11);
  assert.deepEqual(checkPlan(outcome.plan, []), []);
  assert.deepEqual(outcome.provenance.deadline, { source: 'goal', basis: 'inferred' });
  assert.deepEqual(outcome.requestIds, ['read-1', 'draft-1']);
  assert.equal(state.released, 1);
  assert.deepEqual(reads[0], { text: input().text, language: 'en', today: TODAY, provided: [] });
  assert.equal(drafts[0].calendar.weeks.length, 11);
  assert.deepEqual(drafts[0].calendar.weeks[0], { week: 1, room: 1, maxMinutes: 90 });
  assert.equal('previousProblems' in drafts[0], false);
  const details = Object.fromEntries(
    events.filter((event) => event.status === 'completed').map((event) => [event.stage, event.status === 'completed' ? event.detail : '']),
  );
  assert.match(details.read_goal, /Run a 10K.*deadline Dec 1, worked out from your words/u);
  assert.match(details.check_availability, /^11 weeks, Sep 25 to Dec 1; Mon, Tue, Wed, Thu, Fri, 06:00–10:00; up to 180 min a week, starting at 90$/u);
  assert.match(details.fit, /^Placed 20 sessions; every rule checked$/u);
});

void test('a clarifying question ends the run after the reading, and later steps show as skipped', async () => {
  const { deps, events, drafts, state } = harness({
    readGoal: async () => ({
      reading: { ...READING, decision: 'clarify', question: 'What distance are you training for?' },
      scopeRefused: false,
    }),
  });
  const outcome = await runGoalPipeline(input(), deps);
  assert.deepEqual(outcome.outcome === 'needs_answer' ? outcome.question : null, 'What distance are you training for?');
  assert.equal(trail(events).at(-1), 'read_goal:completed');
  assert.equal(drafts.length, 0);
  assert.equal(state.released, 1);
  let steps = plannedGoalSteps('live');
  for (const event of events) steps = applyStageEvent(steps, event);
  assert.deepEqual(skipRemainingSteps(steps).map((step) => `${step.stage}:${step.status}`), [
    'check_request:done', 'reserve:done', 'read_goal:done',
    'check_availability:skipped', 'draft:skipped', 'check_draft:skipped', 'fit:skipped',
  ]);
});

void test('an answer that leaves the goal unclear ends the run instead of asking again', async () => {
  const { deps, reads } = harness({
    readGoal: async (payload) => {
      reads.push(payload);
      return { reading: { ...READING, decision: 'clarify', question: 'Which sport?' }, scopeRefused: false };
    },
  });
  const outcome = await runGoalPipeline(input({ clarification: { question: 'What do you want to improve?', answer: 'stuff' } }), deps);
  assert.equal(outcome.outcome, 'cannot_plan');
  assert.equal(outcome.outcome === 'cannot_plan' ? outcome.category : '', 'unclear');
  assert.deepEqual(reads[0].clarification, { question: 'What do you want to improve?', answer: 'stuff' });
});

void test('an abstention from the scope guard is credited to code, not the model', async () => {
  const { deps, events } = harness({
    readGoal: async () => ({
      reading: {
        ...READING,
        decision: 'abstain',
        deadline: null,
        deadline_basis: 'none',
        abstain: { category: 'specialized_advice', reason: 'Cadencia can’t plan this: it needs a professional.' },
      },
      scopeRefused: true,
    }),
  });
  const outcome = await runGoalPipeline(input({ text: 'Plan my medication doses' }), deps);
  assert.equal(outcome.outcome === 'cannot_plan' && outcome.byGuard, true);
  const read = events.find((event) => event.stage === 'read_goal' && event.status === 'completed');
  assert.equal(read?.actor, 'code');
  assert.equal(read?.status === 'completed' ? read.detail : '', 'Declined by the scope check before any model call');
});

void test('a draft with broken structure gets one retry, shown as its own steps', async () => {
  const { deps, events, drafts } = harness({
    draft: async (payload) => {
      drafts.push(payload);
      return { draft: drafts.length === 1 ? BROKEN_DRAFT : DRAFT };
    },
  });
  const outcome = await runGoalPipeline(input(), deps);
  assert.equal(outcome.outcome, 'ready');
  assert.deepEqual(trail(events).slice(8), [
    'draft:started', 'draft:completed',
    'check_draft:started', 'check_draft:completed',
    'draft#2:started', 'draft#2:completed',
    'check_draft#2:started', 'check_draft#2:completed',
    'fit:started', 'fit:completed',
  ]);
  assert.equal(drafts[1].previousProblems?.[0].code, 'blocks_sum');
  let steps = plannedGoalSteps('live');
  for (const event of events) steps = applyStageEvent(steps, event);
  assert.deepEqual(steps.map((step) => `${step.stage}${step.attempt && step.attempt > 1 ? `#${step.attempt}` : ''}:${step.status}`).slice(4), [
    'draft:done', 'check_draft:done', 'draft#2:done', 'check_draft#2:done', 'fit:done',
  ]);
});

void test('a session length the person states caps every session the model may propose', async () => {
  const short = {
    ...DRAFT,
    sessionTypes: [DRAFT.sessionTypes[0], { ...sessionType('long_run', 30, 'moderate', 'key') }],
  };
  const { deps, drafts } = harness({
    readGoal: async () => ({ reading: { ...READING, session_minutes: 30 }, scopeRefused: false }),
    draft: async (payload) => {
      drafts.push(payload);
      // The first draft keeps its 45-minute long run, which no longer fits.
      return { draft: drafts.length === 1 ? DRAFT : short };
    },
  });
  const outcome = await runGoalPipeline(input({ text: 'Run a 10K by December, 30 minutes a session, weekday mornings' }), deps);
  assert.equal(drafts[0].calendar.sessionMinutes.max, 30);
  assert.equal(drafts[1].previousProblems?.[0].code, 'session_minutes');
  assert.equal(outcome.outcome, 'ready');
  if (outcome.outcome !== 'ready') return;
  assert.deepEqual(outcome.provenance.sessionMinutes, { source: 'goal' });
  assert.ok(outcome.plan.weeks.every((week) => week.sessions.every((session) => session.minutes <= 30)));
  assert.deepEqual(checkPlan(outcome.plan, []), []);
});

void test('a second broken draft fails closed at the check and nothing is scheduled', async () => {
  const { deps, events, state } = harness({ draft: async () => ({ draft: BROKEN_DRAFT }) });
  const error = await failure(runGoalPipeline(input(), deps));
  assert.equal(error.stage, 'check_draft');
  assert.equal(error.code, 'invalid_draft');
  assert.equal(trail(events).at(-1), 'check_draft#2:failed');
  assert.equal(events.some((event) => event.stage === 'fit'), false);
  assert.equal(state.released, 1);
});

void test('problems sent back to the model are clamped to short plain ASCII', () => {
  const [problem] = retryProblems([{ code: 'c'.repeat(50), path: 'weeks[0]', message: 'título <b> & más' }]);
  assert.equal(problem.code.length, 40);
  assert.equal(problem.message, 't?tulo ?b? ? m?s');
  assert.equal(retryProblems(Array.from({ length: 30 }, () => ({ code: 'x', path: '', message: '' }))).length, 20);
});

void test('a reading that breaks the format fails the reading stage', async () => {
  const { deps } = harness({ readGoal: async () => ({ reading: { decision: 'plan' }, scopeRefused: false, requestId: 'read-9' }) });
  const error = await failure(runGoalPipeline(input(), deps));
  assert.equal(error.stage, 'read_goal');
  assert.equal(error.code, 'invalid_reading');
  assert.equal(error.options.requestId, 'read-9');
});

void test('a service failure while drafting names the stage and its reason', async () => {
  const { deps, state } = harness({
    draft: async () => {
      throw new ServiceFailure(undefined, false, 'upstream_timeout');
    },
  });
  const error = await failure(runGoalPipeline(input(), deps));
  assert.equal(error.stage, 'draft');
  assert.equal(error.code, 'upstream_timeout');
  assert.equal(state.released, 1);
});

void test('with no free day before the deadline the run stops before any draft', async () => {
  const { deps, drafts } = harness();
  const error = await failure(runGoalPipeline(input({ controls: { days: [5, 6], deadline: '2026-09-25' } }), deps));
  assert.equal(error.stage, 'check_availability');
  assert.equal(error.code, 'no_room');
  assert.equal(drafts.length, 0);
});

void test('a refused reservation stops the run before the model', async () => {
  const { deps, reads } = harness({
    reserve: async () => ({ allowed: false, status: 429, reason: 'spend_daily_cap', message: 'Cap reached.', retryAfterSec: 60 }),
  });
  const error = await failure(runGoalPipeline(input(), deps));
  assert.equal(error.stage, 'reserve');
  assert.equal(error.options.retryAfterSec, 60);
  assert.equal(reads.length, 0);
});

void test('the demo runs the same stages with samples and no reservation', async () => {
  const { deps, events } = harness({ mode: 'demo', reserve: undefined, serverToday: undefined });
  const outcome = await runGoalPipeline(input({ language: 'es' }), deps);
  assert.equal(outcome.outcome, 'ready');
  assert.equal(events.some((event) => event.stage === 'reserve'), false);
  assert.deepEqual(
    [...new Set(events.filter((event) => event.stage === 'read_goal' || event.stage === 'draft').map((event) => event.actor))],
    ['sample'],
  );
  assert.deepEqual(plannedGoalSteps('demo').map((step) => step.stage), [
    'check_request', 'read_goal', 'check_availability', 'draft', 'check_draft', 'fit',
  ]);
});
