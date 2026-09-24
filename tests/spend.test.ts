import test from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../app/api/routine/route.ts';
import {
  cancelSpend,
  costMicroUsd,
  formatUsd,
  liveStatusOf,
  loadSpendState,
  reserveSpend,
  settleSpend,
  WORST_CASE_ATTEMPT_MICROUSD,
  WORST_CASE_MICROUSD,
} from '../lib/server/spend.ts';
import { SseParser, type SseMessage } from '../lib/sse.ts';
import { migratedDb } from './helpers/sqlite-d1.ts';

const MIGRATIONS = ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql'];
const NOW_ISO = '2026-09-24T12:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

function db() {
  return migratedDb(MIGRATIONS);
}

function setSetting(database: ReturnType<typeof db>, key: string, value: string) {
  database.raw.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(value, key);
}

void test('worst case follows the rate card and the provider bounds', () => {
  // 3,000 input tokens at $0.30/M plus 4,000 output tokens at $1.20/M, twice.
  assert.equal(WORST_CASE_ATTEMPT_MICROUSD, 900 + 4_800);
  assert.equal(WORST_CASE_MICROUSD, 11_400);
  assert.equal(costMicroUsd(300, 700), 930);
  assert.equal(formatUsd(930), '$0.0009');
  assert.equal(formatUsd(500_000), '$0.50');
});

void test('reservations stop at the daily cap and report the reset time', async () => {
  const database = db();
  setSetting(database, 'daily_cap_microusd', String(WORST_CASE_MICROUSD * 2));
  const first = await reserveSpend(database, { id: 'a', nowIso: NOW_ISO, nowMs: NOW_MS });
  const second = await reserveSpend(database, { id: 'b', nowIso: NOW_ISO, nowMs: NOW_MS });
  const third = await reserveSpend(database, { id: 'c', nowIso: NOW_ISO, nowMs: NOW_MS });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.allowed ? '' : third.reason, 'daily_cap');
  assert.equal(third.allowed ? 0 : third.retryAfterSec, 12 * 3600);
  const rows = database.raw.prepare('SELECT COUNT(*) AS n FROM spend_ledger').get() as { n: number };
  assert.equal(rows.n, 2);
});

void test('the monthly cap and the kill switch are enforced the same way', async () => {
  const monthly = db();
  setSetting(monthly, 'monthly_cap_microusd', String(WORST_CASE_MICROUSD));
  assert.equal((await reserveSpend(monthly, { id: 'a', nowIso: NOW_ISO, nowMs: NOW_MS })).allowed, true);
  const denied = await reserveSpend(monthly, { id: 'b', nowIso: NOW_ISO, nowMs: NOW_MS });
  assert.equal(denied.allowed ? '' : denied.reason, 'monthly_cap');

  const paused = db();
  setSetting(paused, 'live_enabled', '0');
  const off = await reserveSpend(paused, { id: 'a', nowIso: NOW_ISO, nowMs: NOW_MS });
  assert.equal(off.allowed ? '' : off.reason, 'disabled');
  assert.equal(off.allowed ? 1 : off.retryAfterSec, undefined);
});

void test('missing settings fail closed', async () => {
  const database = db();
  database.raw.exec('DELETE FROM app_settings');
  const decision = await reserveSpend(database, { id: 'a', nowIso: NOW_ISO, nowMs: NOW_MS });
  assert.equal(decision.allowed, false);
  assert.equal(liveStatusOf(await loadSpendState(database, NOW_ISO)), 'disabled');
});

void test('settling replaces the worst case with the reported cost', async () => {
  const database = db();
  setSetting(database, 'daily_cap_microusd', String(WORST_CASE_MICROUSD + 1_000));
  assert.equal((await reserveSpend(database, { id: 'a', nowIso: NOW_ISO, nowMs: NOW_MS })).allowed, true);
  // No room for a second worst case until the first is settled.
  assert.equal((await reserveSpend(database, { id: 'b', nowIso: NOW_ISO, nowMs: NOW_MS })).allowed, false);
  const actual = await settleSpend(database, {
    id: 'a',
    nowIso: NOW_ISO,
    usage: { promptTokens: 300, completionTokens: 700, attempts: 1, model: 'deepseek-v4-flash', requestId: 'r-1' },
  });
  assert.equal(actual, 930);
  assert.equal((await loadSpendState(database, NOW_ISO)).dayUsedMicroUsd, 930);
  assert.equal((await reserveSpend(database, { id: 'b', nowIso: NOW_ISO, nowMs: NOW_MS })).allowed, true);
});

void test('a retried call is charged its worst case for each earlier attempt', async () => {
  const database = db();
  await reserveSpend(database, { id: 'a', nowIso: NOW_ISO, nowMs: NOW_MS });
  const actual = await settleSpend(database, {
    id: 'a',
    nowIso: NOW_ISO,
    usage: { promptTokens: 300, completionTokens: 700, attempts: 2 },
  });
  assert.equal(actual, 930 + WORST_CASE_ATTEMPT_MICROUSD);
});

void test('a cancelled reservation frees its room and concurrent reservations never overshoot', async () => {
  const database = db();
  setSetting(database, 'daily_cap_microusd', String(WORST_CASE_MICROUSD * 3));
  const decisions = await Promise.all(
    Array.from({ length: 10 }, (_, index) => reserveSpend(database, { id: `r${index}`, nowIso: NOW_ISO, nowMs: NOW_MS })),
  );
  assert.equal(decisions.filter((decision) => decision.allowed).length, 3);
  await cancelSpend(database, 'r0');
  assert.equal((await reserveSpend(database, { id: 'late', nowIso: NOW_ISO, nowMs: NOW_MS })).allowed, true);
});

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
  steps: [0, 1].map((index) => ({
    title: `Session ${index + 1}`,
    instructions: 'Write and check one typed function.',
    blocks: [{ minutes: 30, activity: 'Write one typed function.' }],
    deliverable: 'One typed function.',
    doneWhen: 'It compiles with an example.',
  })),
};

const liveEnv = {
  CADENCIA_ENABLE_LIVE: 'true',
  CADENCIA_INTENT_SERVICE_URL: 'https://intents.example',
  CADENCIA_SERVICE_TOKEN: 'spend-test-token',
};

function streamRequest(ip: string): Request {
  return new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'cf-connecting-ip': ip },
    body: JSON.stringify({ input, mode: 'deepseek' }),
  });
}

async function streamEvents(response: Response) {
  const messages: SseMessage[] = [];
  const parser = new SseParser((message) => messages.push(message));
  parser.push(await response.text());
  parser.end();
  return messages.map((message) => ({ event: message.event, data: JSON.parse(message.data) as Record<string, unknown> }));
}

void test('a live run settles its spend from the reported usage', async () => {
  const database = db();
  const response = await POST(streamRequest('203.0.113.20'), {
    db: database,
    env: liveEnv,
    intentFetcher: async () => ({
      intent,
      scopeRefused: false,
      requestId: '9f1c1a4e-2b7d-4c3a-8e6f-1a2b3c4d5e6f',
      usage: { promptTokens: 300, completionTokens: 700, attempts: 1, model: 'deepseek-v4-flash' },
    }),
  });
  const list = await streamEvents(response);
  const reserve = list.find((item) => item.data.stage === 'reserve' && item.data.status === 'completed');
  assert.match(String(reserve?.data.detail), /\$0\.0114 of today’s \$0\.50 cap committed/u);
  const row = database.raw.prepare('SELECT status, actual_microusd, prompt_tokens, request_id FROM spend_ledger').get() as Record<string, unknown>;
  assert.deepEqual({ ...row }, {
    status: 'settled',
    actual_microusd: 930,
    prompt_tokens: 300,
    request_id: '9f1c1a4e-2b7d-4c3a-8e6f-1a2b3c4d5e6f',
  });
});

void test('the kill switch stops live runs before the model and GET reports a pause', async () => {
  const database = db();
  setSetting(database, 'live_enabled', '0');
  let calls = 0;
  const response = await POST(streamRequest('203.0.113.21'), {
    db: database,
    env: liveEnv,
    intentFetcher: async () => {
      calls += 1;
      return { intent, scopeRefused: false };
    },
  });
  const original = console.error;
  console.error = () => undefined;
  try {
    const list = await streamEvents(response);
    const error = list.at(-1);
    assert.equal(error?.event, 'error');
    assert.equal(error?.data.stage, 'reserve');
    assert.match(String(error?.data.message), /paused/u);
  } finally {
    console.error = original;
  }
  assert.equal(calls, 0);
  const status = await (await GET(undefined, { db: database, env: liveEnv })).json();
  assert.deepEqual(status, { liveAvailable: false, liveStatus: 'paused' });
});

void test('GET reports a reached daily cap without exposing amounts', async () => {
  const database = db();
  setSetting(database, 'daily_cap_microusd', '1000');
  const status = await (await GET(undefined, { db: database, env: liveEnv, nowIso: () => NOW_ISO })).json();
  assert.deepEqual(status, { liveAvailable: false, liveStatus: 'daily_cap' });
});
