import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/routine/route.ts';
import { ServiceFailure } from '../lib/server/live.ts';
import { SseParser, type SseMessage } from '../lib/sse.ts';
import { migratedDb } from './helpers/sqlite-d1.ts';

const input = {
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
      blocks: [{ minutes: 30, activity: 'Write one typed function.' }],
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

const liveEnv = {
  CADENCIA_ENABLE_LIVE: 'true',
  CADENCIA_INTENT_SERVICE_URL: 'https://intents.example',
  CADENCIA_SERVICE_TOKEN: 'route-stream-test-token',
};

function streamRequest(body: unknown, ip = '203.0.113.7'): Request {
  return new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify(body),
  });
}

async function events(response: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const messages: SseMessage[] = [];
  const parser = new SseParser((message) => messages.push(message));
  parser.push(await response.text());
  parser.end();
  return messages.map((message) => ({ event: message.event, data: JSON.parse(message.data) as Record<string, unknown> }));
}

function stageTrail(list: Array<{ event: string; data: Record<string, unknown> }>): string[] {
  return list
    .filter((item) => item.event === 'stage')
    .map((item) => `${String(item.data.stage)}:${String(item.data.status)}`);
}

void test('the demo streams its stages and then the plan', async () => {
  const response = await POST(streamRequest({ input, mode: 'demo' }), { db: null });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/u);
  const list = await events(response);
  assert.deepEqual(stageTrail(list), [
    'check_request:started', 'check_request:completed',
    'check_availability:started', 'check_availability:completed',
    'draft:started', 'draft:completed',
    'check_draft:started', 'check_draft:completed',
    'fit:started', 'fit:completed',
  ]);
  const result = list.at(-1);
  assert.equal(result?.event, 'result');
  assert.equal(result?.data.outcome, 'ready');
  assert.equal((result?.data.plan as { mode?: string } | undefined)?.mode, 'demo');
});

void test('a live run streams the limits check and the model stage before the result', async () => {
  const db = migratedDb(['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql']);
  let calls = 0;
  const response = await POST(streamRequest({ input, mode: 'deepseek' }), {
    db,
    env: liveEnv,
    intentFetcher: async () => {
      calls += 1;
      return { intent, scopeRefused: false, requestId: '9f1c1a4e-2b7d-4c3a-8e6f-1a2b3c4d5e6f' };
    },
  });
  const list = await events(response);
  assert.equal(calls, 1);
  assert.deepEqual(stageTrail(list).slice(4, 8), ['reserve:started', 'reserve:completed', 'draft:started', 'draft:completed']);
  assert.equal(list.find((item) => item.event === 'stage' && item.data.stage === 'draft')?.data.actor, 'model');
  const result = list.at(-1);
  assert.equal(result?.event, 'result');
  assert.equal(result?.data.requestId, '9f1c1a4e-2b7d-4c3a-8e6f-1a2b3c4d5e6f');
  const inFlight = db.raw.prepare('SELECT COUNT(*) AS n FROM public_concurrency').get() as { n: number };
  assert.equal(inFlight.n, 0, 'the live slot is released');
});

void test('a live run the visitor leaves mid-draft still settles its spend and frees its slot', async () => {
  const db = migratedDb(['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql']);
  const kept: Array<Promise<unknown>> = [];
  let finishDraft = () => undefined as void;
  const draftDone = new Promise<void>((resolve) => {
    finishDraft = resolve;
  });
  const response = await POST(streamRequest({ input, mode: 'deepseek' }, '203.0.113.10'), {
    db,
    env: liveEnv,
    waitUntil: (promise) => kept.push(promise),
    intentFetcher: async () => {
      await draftDone;
      return {
        intent,
        scopeRefused: false,
        usage: { promptTokens: 300, completionTokens: 700, attempts: 1 },
      };
    },
  });
  // The visitor closes the page while the model is still drafting.
  const reader = response.body?.getReader();
  await reader?.read();
  await reader?.cancel();
  finishDraft();
  assert.equal(kept.length, 1, 'the run is registered to outlive the response');
  await kept[0];
  const row = db.raw.prepare('SELECT status, actual_microusd FROM spend_ledger').get() as Record<string, unknown>;
  assert.deepEqual({ ...row }, { status: 'settled', actual_microusd: 930 });
  const inFlight = db.raw.prepare('SELECT COUNT(*) AS n FROM public_concurrency').get() as { n: number };
  assert.equal(inFlight.n, 0);
});

void test('a failed model call ends the stream with an error that names the stage', async () => {
  const db = migratedDb(['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql']);
  const original = console.error;
  console.error = () => undefined;
  try {
    const response = await POST(streamRequest({ input, mode: 'deepseek' }, '203.0.113.8'), {
      db,
      env: liveEnv,
      intentFetcher: async () => {
        throw new ServiceFailure(undefined, false, 'upstream_timeout');
      },
    });
    const list = await events(response);
    assert.deepEqual(stageTrail(list).slice(-2), ['draft:started', 'draft:failed']);
    const error = list.at(-1);
    assert.equal(error?.event, 'error');
    assert.equal(error?.data.stage, 'draft');
    assert.match(String(error?.data.reference), /^[0-9a-f-]{36}$/u);
    assert.equal(list.some((item) => item.event === 'result'), false);
  } finally {
    console.error = original;
  }
});

void test('a quota refusal is streamed as a failed limits stage with retry time', async () => {
  const db = migratedDb(['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql']);
  db.raw.exec("UPDATE public_limits_config SET value = 0 WHERE key = 'visitor_daily_quota'");
  const original = console.error;
  console.error = () => undefined;
  try {
    const response = await POST(streamRequest({ input, mode: 'deepseek' }, '203.0.113.9'), {
      db,
      env: liveEnv,
      intentFetcher: async () => ({ intent, scopeRefused: false }),
    });
    const list = await events(response);
    assert.deepEqual(stageTrail(list).slice(-2), ['reserve:started', 'reserve:failed']);
    const error = list.at(-1);
    assert.equal(error?.data.stage, 'reserve');
    assert.equal(typeof error?.data.retryAfterSec, 'number');
  } finally {
    console.error = original;
  }
});

void test('requests without the stream header still get plain JSON', async () => {
  const response = await POST(
    new Request('http://localhost/api/routine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input, mode: 'demo' }),
    }),
    { db: null },
  );
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/u);
  const body = (await response.json()) as { plan?: { mode?: string } };
  assert.equal(body.plan?.mode, 'demo');
});
