import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/routine/route.ts';
import { GOAL_LEASE_SEC } from '../lib/server/goal-run.ts';
import { ServiceFailure, type DraftAnswer, type ReadGoalAnswer } from '../lib/server/live.ts';
import { GOAL_DRAFT_ATTEMPT_MICROUSD, GOAL_WORST_CASE_MICROUSD } from '../lib/server/spend.ts';
import { readSse, SseParser, type SseMessage } from '../lib/sse.ts';
import { migratedDb } from './helpers/sqlite-d1.ts';

const NOW_ISO = '2026-09-24T12:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const MIGRATIONS = ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql'];
const liveEnv = {
  CADENCIA_ENABLE_LIVE: 'true',
  CADENCIA_INTENT_SERVICE_URL: 'https://intents.example',
  CADENCIA_SERVICE_TOKEN: 'goal-route-test-token',
};

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

function sessionType(id: string, minutes: number, role: string, text = 'Run at the planned effort.') {
  return {
    id,
    title: id.replace('_', ' '),
    minutes,
    intensity: 'easy',
    role,
    blocks: [
      { minutes: 5, activity: 'Walk to warm up.' },
      { minutes: minutes - 10, activity: text },
      { minutes: 5, activity: 'Walk to cool down.' },
    ],
    deliverable: 'A logged run.',
    doneWhen: 'The run is logged.',
  };
}

const DRAFT = {
  phases: [{ title: 'Base', fromWeek: 1, toWeek: 11, focus: 'Easy running with one longer run.' }],
  sessionTypes: [sessionType('easy_run', 30, 'support'), sessionType('long_run', 45, 'key')],
  weeks: Array.from({ length: 11 }, (_, index) => ({
    week: index + 1,
    sessions: index === 0 || index === 10 ? ['easy_run'] : ['easy_run', 'long_run'],
  })),
  templateId: null,
};

const READ_USAGE = { promptTokens: 827, completionTokens: 133, attempts: 1, model: 'gpt-6-luna' };
const DRAFT_USAGE = { promptTokens: 952, completionTokens: 2_219, attempts: 1, model: 'gpt-6-luna' };

function goalRequest(input: Record<string, unknown>, ip: string, stream = true): Request {
  return new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': ip,
      ...(stream ? { accept: 'text/event-stream' } : {}),
    },
    body: JSON.stringify({
      mode: 'live',
      kind: 'goal',
      input: { text: 'I want to run a 10K by December, weekday mornings', language: 'en', today: '2026-09-24', ...input },
    }),
  });
}

async function events(response: Response) {
  const messages: SseMessage[] = [];
  const parser = new SseParser((message) => messages.push(message));
  parser.push(await response.text());
  parser.end();
  return messages.map((message) => ({ event: message.event, data: JSON.parse(message.data) as Record<string, unknown> }));
}

function ledger(db: ReturnType<typeof migratedDb>) {
  return { ...(db.raw.prepare('SELECT status, reserved_microusd, actual_microusd, prompt_tokens, completion_tokens, attempts, request_id FROM spend_ledger').get() as Record<string, unknown>) };
}

function quiet<T>(work: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => undefined;
  return work().finally(() => {
    console.error = original;
  });
}

void test('a live goal run reserves its worst case, settles every call and frees its slot', async () => {
  const db = migratedDb(MIGRATIONS);
  const seen: Array<Record<string, unknown>> = [];
  const response = await POST(goalRequest({}, '203.0.113.30'), {
    db,
    env: liveEnv,
    nowIso: () => NOW_ISO,
    nowMs: () => NOW_MS,
    readGoalFetcher: async (): Promise<ReadGoalAnswer> => {
      seen.push(ledger(db));
      const lease = db.raw.prepare('SELECT expires_at FROM public_concurrency').get() as { expires_at: number };
      assert.equal(lease.expires_at, NOW_MS + GOAL_LEASE_SEC * 1000);
      return { reading: READING, scopeRefused: false, requestId: '11111111-1111-4111-8111-111111111111', usage: READ_USAGE };
    },
    draftFetcher: async (): Promise<DraftAnswer> => ({
      draft: DRAFT,
      requestId: '22222222-2222-4222-8222-222222222222',
      usage: DRAFT_USAGE,
    }),
  });
  const list = await events(response);
  const result = list.at(-1);
  assert.equal(result?.event, 'result');
  assert.equal(result?.data.outcome, 'ready');
  assert.equal(seen[0].status, 'reserved');
  assert.equal(seen[0].reserved_microusd, GOAL_WORST_CASE_MICROUSD);
  // 827 in and 133 out cost 408 micro-USD; 952 in and 2,219 out cost 2,949.
  assert.deepEqual(ledger(db), {
    status: 'settled',
    reserved_microusd: GOAL_WORST_CASE_MICROUSD,
    actual_microusd: 1_355,
    prompt_tokens: 1_779,
    completion_tokens: 2_352,
    attempts: 2,
    request_id: '22222222-2222-4222-8222-222222222222',
  });
  const leases = db.raw.prepare('SELECT COUNT(*) AS n FROM public_concurrency').get() as { n: number };
  assert.equal(leases.n, 0);
});

void test('a refusal by the scope guard settles at zero', async () => {
  const db = migratedDb(MIGRATIONS);
  const response = await POST(goalRequest({ text: 'Plan my medication doses' }, '203.0.113.31'), {
    db,
    env: liveEnv,
    nowIso: () => NOW_ISO,
    nowMs: () => NOW_MS,
    readGoalFetcher: async (): Promise<ReadGoalAnswer> => ({
      reading: {
        ...READING,
        decision: 'abstain',
        deadline: null,
        deadline_basis: 'none',
        abstain: { category: 'specialized_advice', reason: 'It needs a professional.' },
      },
      scopeRefused: true,
      usage: { promptTokens: 0, completionTokens: 0, attempts: 0 },
    }),
    draftFetcher: async () => {
      throw new Error('no draft after an abstention');
    },
  });
  const result = (await events(response)).at(-1);
  assert.equal(result?.data.outcome, 'cannot_plan');
  assert.equal(result?.data.byGuard, true);
  assert.equal(ledger(db).actual_microusd, 0);
});

void test('a draft call that fails without usage is charged at its worst case', async () => {
  const db = migratedDb(MIGRATIONS);
  const response = await POST(goalRequest({}, '203.0.113.32'), {
    db,
    env: liveEnv,
    nowIso: () => NOW_ISO,
    nowMs: () => NOW_MS,
    readGoalFetcher: async () => ({ reading: READING, scopeRefused: false, usage: READ_USAGE }),
    draftFetcher: async () => {
      throw new ServiceFailure(undefined, false, 'upstream_timeout');
    },
  });
  const list = await quiet(() => events(response));
  assert.equal(list.at(-1)?.event, 'error');
  assert.equal(list.at(-1)?.data.stage, 'draft');
  assert.equal(ledger(db).actual_microusd, 150 + 2 * GOAL_DRAFT_ATTEMPT_MICROUSD);
});

void test('goal runs are live only on the server and answer JSON without the stream header', async () => {
  const demo = await quiet(() => POST(new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'demo', kind: 'goal', input: { text: 'learn chess', language: 'en', today: '2026-09-24' } }),
  }), { db: null }));
  assert.equal(demo.status, 400);

  const db = migratedDb(MIGRATIONS);
  const response = await POST(goalRequest({}, '203.0.113.33', false), {
    db,
    env: liveEnv,
    nowIso: () => NOW_ISO,
    nowMs: () => NOW_MS,
    readGoalFetcher: async () => ({
      reading: { ...READING, decision: 'clarify', question: 'Which distance?' },
      scopeRefused: false,
      usage: READ_USAGE,
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.outcome, 'needs_answer');
  assert.equal(body.question, 'Which distance?');
});

void test('the largest plan streams whole through the browser reader, in small chunks', async () => {
  // 27 calendar weeks, a session every day, and text at its length limits.
  const long = 'x'.repeat(290);
  const types = Array.from({ length: 8 }, (_, index) => ({
    ...sessionType(`topic_${index}`, 60, index === 0 ? 'key' : 'support', long),
    deliverable: long,
    doneWhen: long,
  }));
  const draft = {
    phases: [{ title: 'All', fromWeek: 1, toWeek: 27, focus: long }],
    sessionTypes: types,
    weeks: Array.from({ length: 27 }, (_, index) => ({ week: index + 1, sessions: types.slice(0, 7).map((type) => type.id) })),
    templateId: null,
  };
  const db = migratedDb(MIGRATIONS);
  const response = await POST(goalRequest({
    text: 'Study for a certification exam every day',
    controls: { days: [0, 1, 2, 3, 4, 5, 6], window: { start: '06:00', end: '22:00' }, weeklyMinutes: 1_200, deadline: '2027-03-25' },
  }, '203.0.113.34'), {
    db,
    env: liveEnv,
    nowIso: () => NOW_ISO,
    nowMs: () => NOW_MS,
    readGoalFetcher: async () => ({ reading: { ...READING, domain: 'learning' }, scopeRefused: false, usage: READ_USAGE }),
    draftFetcher: async () => ({ draft, usage: DRAFT_USAGE }),
  });
  const text = await response.text();
  const chunks = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(text);
      for (let offset = 0; offset < bytes.length; offset += 1_000) controller.enqueue(bytes.slice(offset, offset + 1_000));
      controller.close();
    },
  });
  let plan: { weeks: Array<{ sessions: unknown[] }> } | undefined;
  await readSse(chunks, (message) => {
    if (message.event === 'result') plan = (JSON.parse(message.data) as { plan: typeof plan }).plan;
  });
  assert.equal(plan?.weeks.length, 27);
  assert.equal(plan?.weeks.reduce((total, week) => total + week.sessions.length, 0), 3 + 25 * 7 + 4);
  assert.ok(text.length > 200_000, `the stream carried ${text.length} characters`);
});

void test('a goal run the visitor leaves mid-draft still settles its spend and frees its slot', async () => {
  const db = migratedDb(MIGRATIONS);
  const kept: Array<Promise<unknown>> = [];
  let finishDraft = () => undefined as void;
  const draftDone = new Promise<void>((resolve) => {
    finishDraft = resolve;
  });
  const response = await POST(goalRequest({}, '203.0.113.35'), {
    db,
    env: liveEnv,
    nowIso: () => NOW_ISO,
    nowMs: () => NOW_MS,
    waitUntil: (promise) => kept.push(promise),
    readGoalFetcher: async () => ({ reading: READING, scopeRefused: false, usage: READ_USAGE }),
    draftFetcher: async () => {
      await draftDone;
      return { draft: DRAFT, usage: DRAFT_USAGE };
    },
  });
  // The visitor closes the page while the model is still drafting.
  const reader = response.body?.getReader();
  await reader?.read();
  await reader?.cancel();
  finishDraft();
  assert.equal(kept.length, 1, 'the run is registered to outlive the response');
  await kept[0];
  assert.equal(ledger(db).status, 'settled');
  assert.equal(ledger(db).actual_microusd, 1_355);
  const leases = db.raw.prepare('SELECT COUNT(*) AS n FROM public_concurrency').get() as { n: number };
  assert.equal(leases.n, 0);
});

void test('a quota refusal streams as a failed limits step with its retry time, before any spend', async () => {
  const db = migratedDb(MIGRATIONS);
  db.raw.exec("UPDATE public_limits_config SET value = 0 WHERE key = 'visitor_daily_quota'");
  let reads = 0;
  const response = await POST(goalRequest({}, '203.0.113.36'), {
    db,
    env: liveEnv,
    nowIso: () => NOW_ISO,
    nowMs: () => NOW_MS,
    readGoalFetcher: async () => {
      reads += 1;
      return { reading: READING, scopeRefused: false };
    },
  });
  const list = await quiet(() => events(response));
  const stages = list.filter((item) => item.event === 'stage').map((item) => `${String(item.data.stage)}:${String(item.data.status)}`);
  assert.deepEqual(stages.slice(-2), ['reserve:started', 'reserve:failed']);
  const error = list.at(-1);
  assert.equal(error?.data.stage, 'reserve');
  assert.equal(typeof error?.data.retryAfterSec, 'number');
  assert.equal(reads, 0);
  const rows = db.raw.prepare('SELECT COUNT(*) AS n FROM spend_ledger').get() as { n: number };
  assert.equal(rows.n, 0, 'the refused run left no reservation');
});

void test('the kill switch stops goal runs before the model', async () => {
  const db = migratedDb(MIGRATIONS);
  db.raw.exec("UPDATE app_settings SET value = '0' WHERE key = 'live_enabled'");
  let reads = 0;
  const response = await POST(goalRequest({}, '203.0.113.37'), {
    db,
    env: liveEnv,
    nowIso: () => NOW_ISO,
    nowMs: () => NOW_MS,
    readGoalFetcher: async () => {
      reads += 1;
      return { reading: READING, scopeRefused: false };
    },
  });
  const error = (await quiet(() => events(response))).at(-1);
  assert.equal(error?.event, 'error');
  assert.equal(error?.data.stage, 'reserve');
  assert.match(String(error?.data.message), /paused/u);
  assert.equal(reads, 0);
});
