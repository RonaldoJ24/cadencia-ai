import test from 'node:test';
import assert from 'node:assert/strict';
import { GoalRunError, parseGoalOutcome, streamGoalRun } from '../lib/goal-client.ts';
import type { StageEvent } from '../lib/plan-stream.ts';
import { formatSse, SSE_HEARTBEAT } from '../lib/sse.ts';

const input = { text: 'Learn chess openings', language: 'en' as const, today: '2026-09-24', controls: {} };
const options = (events: StageEvent[], activity: { count: number }) => ({
  signal: new AbortController().signal,
  onStage: (event: StageEvent) => events.push(event),
  onActivity: () => {
    activity.count += 1;
  },
  fallbackMessage: 'Something went wrong.',
  streamEndedMessage: 'The connection ended.',
});

function withFetch(response: Response, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => response) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function sseResponse(parts: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

const question = { outcome: 'needs_answer', question: 'Which opening?', reading: { title: 'Chess', summary: 'Learn chess.' }, requestIds: [] };

void test('only outcomes with the fields the page reads are accepted', () => {
  assert.ok(parseGoalOutcome(question));
  assert.ok(parseGoalOutcome({ outcome: 'cannot_plan', category: 'medical', reason: 'See a doctor.', byGuard: true }));
  assert.equal(parseGoalOutcome({ outcome: 'ready', reading: { title: 'x', summary: 'y' } }), null);
  assert.equal(parseGoalOutcome({ outcome: 'needs_answer', reading: { title: 'x' } }), null);
  assert.equal(parseGoalOutcome('ready'), null);
});

void test('a streamed run reports stages and every chunk, then returns its outcome', async () => {
  const events: StageEvent[] = [];
  const activity = { count: 0 };
  await withFetch(sseResponse([
    formatSse('stage', { type: 'stage', stage: 'check_request', status: 'started', actor: 'code' }),
    SSE_HEARTBEAT,
    formatSse('stage', { type: 'stage', stage: 'draft', status: 'started', actor: 'model', attempt: 2 }),
    formatSse('result', { type: 'result', ...question }),
  ]), async () => {
    const outcome = await streamGoalRun(input, options(events, activity));
    assert.equal(outcome.outcome, 'needs_answer');
  });
  assert.deepEqual(events.map((event) => `${event.stage}${event.attempt ? `#${event.attempt}` : ''}`), ['check_request', 'draft#2']);
  assert.equal(activity.count, 4, 'the heartbeat counts as activity');
});

void test('a failed stage and a refused request both surface what to show', async () => {
  await withFetch(sseResponse([
    formatSse('error', { type: 'error', stage: 'reserve', message: 'Cap reached.', reference: 'ref-1', retryAfterSec: 60 }),
  ]), async () => {
    await assert.rejects(streamGoalRun(input, options([], { count: 0 })), (error: unknown) => {
      assert.ok(error instanceof GoalRunError);
      assert.equal(error.message, 'Cap reached.');
      assert.equal(error.stage, 'reserve');
      assert.equal(error.retryAfterSec, 60);
      return true;
    });
  });
  await withFetch(new Response(JSON.stringify({ error: 'Too many requests.', reference: 'ref-2' }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': '30' },
  }), async () => {
    await assert.rejects(streamGoalRun(input, options([], { count: 0 })), (error: unknown) => {
      assert.ok(error instanceof GoalRunError);
      assert.equal(error.status, 429);
      assert.equal(error.reference, 'ref-2');
      assert.equal(error.retryAfterSec, 30);
      return true;
    });
  });
  await withFetch(sseResponse([SSE_HEARTBEAT]), async () => {
    await assert.rejects(streamGoalRun(input, options([], { count: 0 })), /The connection ended/u);
  });
});
