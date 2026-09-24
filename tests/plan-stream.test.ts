import test from 'node:test';
import assert from 'node:assert/strict';
import { plannedGoalSteps } from '../lib/goal-stream.ts';
import { applyStageEvent, parseStageEvent, skipRemainingSteps } from '../lib/plan-stream.ts';

void test('step views follow the events and reject malformed wire data', () => {
  let steps = plannedGoalSteps('live');
  assert.deepEqual(steps.map((step) => step.stage), ['check_request', 'reserve', 'read_goal', 'check_availability', 'draft', 'check_draft', 'fit']);
  for (const stage of ['check_request', 'reserve', 'check_availability'] as const) {
    steps = applyStageEvent(steps, { type: 'stage', stage, status: 'completed', actor: 'code', durationMs: 0, detail: 'ok' });
  }
  steps = applyStageEvent(steps, { type: 'stage', stage: 'read_goal', status: 'completed', actor: 'model', durationMs: 900, detail: 'ok' });
  steps = applyStageEvent(steps, { type: 'stage', stage: 'draft', status: 'started', actor: 'model' });
  assert.equal(steps[4].status, 'running');
  steps = applyStageEvent(steps, { type: 'stage', stage: 'draft', status: 'completed', actor: 'model', durationMs: 4200, detail: '3 phases' });
  assert.deepEqual(steps[4], { stage: 'draft', actor: 'model', status: 'done', durationMs: 4200, detail: '3 phases' });
  // A retry the list did not plan for goes before the first step not started.
  steps = applyStageEvent(steps, { type: 'stage', stage: 'draft', status: 'started', actor: 'model', attempt: 2 });
  assert.deepEqual(steps.map((step) => `${step.stage}${step.attempt === 2 ? '#2' : ''}:${step.status}`).slice(4), [
    'draft:done', 'draft#2:running', 'check_draft:pending', 'fit:pending',
  ]);
  assert.deepEqual(skipRemainingSteps(steps).slice(-2).map((step) => step.status), ['skipped', 'skipped']);

  assert.equal(parseStageEvent({ type: 'stage', stage: 'unknown', status: 'started', actor: 'code' }), null);
  assert.equal(parseStageEvent({ type: 'stage', stage: 'fit', status: 'completed', actor: 'code', durationMs: 'fast', detail: 'x' }), null);
  assert.equal(parseStageEvent({ type: 'stage', stage: 'fit', status: 'started', actor: 'robot' }), null);
  assert.equal(parseStageEvent({ type: 'stage', stage: 'draft', status: 'started', actor: 'model', attempt: 1 }), null);
  assert.deepEqual(
    parseStageEvent({ type: 'stage', stage: 'read_goal', status: 'started', actor: 'model', attempt: 2, extra: true }),
    { type: 'stage', stage: 'read_goal', status: 'started', actor: 'model', attempt: 2 },
  );
  assert.equal(
    parseStageEvent({ type: 'stage', stage: 'fit', status: 'completed', actor: 'code', durationMs: 1, detail: 'x'.repeat(400) })
      ?.status === 'completed',
    true,
  );
});
