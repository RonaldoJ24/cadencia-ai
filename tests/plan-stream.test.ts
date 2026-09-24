import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStageEvent,
  parseStageEvent,
  plannedSteps,
  runPlanPipeline,
  StageFailure,
  type DraftResult,
  type StageEvent,
} from '../lib/plan-stream.ts';
import { buildPlan, type RoutineInput } from '../lib/routine.ts';

const input: RoutineInput = {
  request: 'learn TypeScript by building a small tool',
  days: [0, 2],
  sessionMinutes: 30,
  weeklyMinutes: 90,
  startDate: '2026-09-21',
  time: '07:30',
  language: 'en',
};

const intent = {
  title: 'TypeScript practice',
  goal: 'Build a small typed tool.',
  domain: 'learning',
  steps: [
    {
      title: 'Types first',
      instructions: 'Write and check one typed function.',
      blocks: [{ minutes: 10, activity: 'Plan the function.' }, { minutes: 20, activity: 'Write it.' }],
      deliverable: 'One typed function.',
      doneWhen: 'It compiles with an example.',
    },
    {
      title: 'Use it',
      instructions: 'Apply the function to a second case.',
      blocks: [{ minutes: 30, activity: 'Solve the second case.' }],
      deliverable: 'A second working case.',
      doneWhen: 'Both cases pass.',
    },
  ],
};

/** A clock that advances 5 ms every time it is read. */
function steppingClock() {
  let now = 1_000;
  return () => (now += 5);
}

function recorder() {
  const events: StageEvent[] = [];
  return { events, emit: (event: StageEvent) => events.push(event) };
}

void test('demo runs every stage in order and labels the draft as a sample', async () => {
  const { events, emit } = recorder();
  const outcome = await runPlanPipeline(input, { mode: 'demo', now: steppingClock(), emit });

  assert.deepEqual(
    events.map((event) => `${event.stage}:${event.status}:${event.actor}`),
    [
      'check_request:started:code',
      'check_request:completed:code',
      'check_availability:started:code',
      'check_availability:completed:code',
      'draft:started:sample',
      'draft:completed:sample',
      'check_draft:started:code',
      'check_draft:completed:code',
      'fit:started:code',
      'fit:completed:code',
    ],
  );
  for (const event of events) {
    if (event.status !== 'started') assert.equal(event.durationMs, 5);
  }
  const details = Object.fromEntries(
    events.filter((event) => event.status === 'completed').map((event) => [event.stage, event.status === 'completed' ? event.detail : '']),
  );
  assert.equal(details.check_availability, 'Room for 2 sessions: Mon and Wed');
  assert.match(details.draft, /Sample draft with 2 sessions \(no model\)/u);
  assert.equal(details.fit, 'Placed 2 sessions: Mon 21 and Wed 23 at 07:30');
  assert.equal(outcome.outcome, 'ready');
  assert.deepEqual(outcome.plan, buildPlan(input, undefined, 'demo'));
});

void test('live stages start before their calls and complete after them', async () => {
  const { events, emit } = recorder();
  const seen: string[] = [];
  let releases = 0;
  const outcome = await runPlanPipeline(input, {
    mode: 'deepseek',
    now: steppingClock(),
    emit,
    reserve: async () => {
      seen.push(`reserve called after ${events.at(-1)?.stage}:${events.at(-1)?.status}`);
      return { allowed: true, release: async () => { releases += 1; } };
    },
    draft: async (_input, requirements) => {
      seen.push(`draft called after ${events.at(-1)?.stage}:${events.at(-1)?.status}`);
      assert.deepEqual(requirements, { sessionCount: 2, sessionMinutes: 30 });
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(`draft returned before ${events.at(-1)?.stage}:${events.at(-1)?.status}`);
      return { intent, scopeRefused: false, requestId: 'request-1' } satisfies DraftResult;
    },
  });

  assert.deepEqual(seen, [
    'reserve called after reserve:started',
    'draft called after draft:started',
    'draft returned before draft:started',
  ]);
  const draftEvents = events.filter((event) => event.stage === 'draft');
  assert.deepEqual(draftEvents.map((event) => `${event.status}:${event.actor}`), ['started:model', 'completed:model']);
  assert.equal(releases, 1);
  assert.equal(outcome.outcome, 'ready');
  assert.equal(outcome.requestId, 'request-1');
  assert.equal(outcome.plan.mode, 'deepseek');
  assert.equal(outcome.plan.sessions.length, 2);
});

void test('invalid input fails the first stage and nothing else starts', async () => {
  const { events, emit } = recorder();
  await assert.rejects(
    runPlanPipeline({ ...input, startDate: '2026-09-22' }, { mode: 'demo', now: steppingClock(), emit }),
    (error: unknown) => error instanceof StageFailure && error.stage === 'check_request' && error.options.status === 400,
  );
  assert.deepEqual(events.map((event) => `${event.stage}:${event.status}`), ['check_request:started', 'check_request:failed']);
});

void test('a model failure marks the draft stage, keeps the provider reason and releases the slot', async () => {
  const { events, emit } = recorder();
  let releases = 0;
  const failure = Object.assign(new Error('service-failure'), { reason: 'upstream_timeout', requestId: 'request-2' });
  await assert.rejects(
    runPlanPipeline(input, {
      mode: 'deepseek',
      now: steppingClock(),
      emit,
      reserve: async () => ({ allowed: true, release: async () => { releases += 1; } }),
      draft: async () => { throw failure; },
    }),
    (error: unknown) =>
      error instanceof StageFailure &&
      error.stage === 'draft' &&
      error.code === 'upstream_timeout' &&
      error.options.status === 502 &&
      error.options.requestId === 'request-2',
  );
  assert.deepEqual(events.slice(-2).map((event) => `${event.stage}:${event.status}`), ['draft:started', 'draft:failed']);
  assert.equal(events.some((event) => event.stage === 'check_draft'), false);
  assert.equal(releases, 1);
});

void test('a denied slot fails the limits stage and the model is never called', async () => {
  const { events, emit } = recorder();
  let drafts = 0;
  await assert.rejects(
    runPlanPipeline(input, {
      mode: 'deepseek',
      now: steppingClock(),
      emit,
      reserve: async () => ({
        allowed: false,
        status: 429,
        reason: 'visitor_quota_exceeded',
        message: 'Daily limit reached.',
        retryAfterSec: 3600,
      }),
      draft: async () => {
        drafts += 1;
        return { intent, scopeRefused: false };
      },
    }),
    (error: unknown) =>
      error instanceof StageFailure &&
      error.stage === 'reserve' &&
      error.options.status === 429 &&
      error.options.retryAfterSec === 3600,
  );
  assert.equal(drafts, 0);
  const failed = events.at(-1);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.status === 'failed' ? failed.detail : '', 'Daily limit reached.');
});

void test('a draft that breaks a rule fails the check stage, not the model stage', async () => {
  const { events, emit } = recorder();
  await assert.rejects(
    runPlanPipeline(input, {
      mode: 'deepseek',
      now: steppingClock(),
      emit,
      reserve: async () => ({ allowed: true, release: async () => undefined }),
      draft: async () => ({ intent: { ...intent, steps: intent.steps.slice(0, 1) }, scopeRefused: false }),
    }),
    (error: unknown) => error instanceof StageFailure && error.stage === 'check_draft' && error.code === 'upstream_invalid_response',
  );
  assert.deepEqual(
    events.filter((event) => event.stage === 'draft').map((event) => event.status),
    ['started', 'completed'],
  );
  assert.equal(events.at(-1)?.stage, 'check_draft');
  assert.equal(events.at(-1)?.status, 'failed');
});

void test('a declined request still runs the checks and ends as cannot_plan', async () => {
  const { events, emit } = recorder();
  const outcome = await runPlanPipeline(
    { ...input, request: '¿Cuántas pastillas debo tomar para el dolor?' },
    { mode: 'demo', now: steppingClock(), emit },
  );
  assert.equal(outcome.outcome, 'cannot_plan');
  assert.equal(outcome.plan.sessions.length, 0);
  const last = events.at(-1);
  assert.equal(last?.stage, 'fit');
  assert.equal(last?.status === 'completed' ? last.detail : '', 'Nothing scheduled');
});

void test('step views follow the events and reject malformed wire data', () => {
  let steps = plannedSteps('deepseek');
  assert.deepEqual(steps.map((step) => step.stage), ['check_request', 'check_availability', 'reserve', 'draft', 'check_draft', 'fit']);
  steps = applyStageEvent(steps, { type: 'stage', stage: 'draft', status: 'started', actor: 'model' });
  assert.equal(steps[3].status, 'running');
  steps = applyStageEvent(steps, { type: 'stage', stage: 'draft', status: 'completed', actor: 'model', durationMs: 4200, detail: 'Draft has 2 sessions' });
  assert.deepEqual(steps[3], { stage: 'draft', actor: 'model', status: 'done', durationMs: 4200, detail: 'Draft has 2 sessions' });

  assert.equal(parseStageEvent({ type: 'stage', stage: 'unknown', status: 'started', actor: 'code' }), null);
  assert.equal(parseStageEvent({ type: 'stage', stage: 'fit', status: 'completed', actor: 'code', durationMs: 'fast', detail: 'x' }), null);
  assert.equal(parseStageEvent({ type: 'stage', stage: 'fit', status: 'started', actor: 'robot' }), null);
  assert.deepEqual(
    parseStageEvent({ type: 'stage', stage: 'fit', status: 'started', actor: 'code', extra: true }),
    { type: 'stage', stage: 'fit', status: 'started', actor: 'code' },
  );
});
