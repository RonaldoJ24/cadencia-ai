import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/routine/route.ts';
import {
  callCostMicroUsd,
  cancelSpend,
  costMicroUsd,
  formatUsd,
  GOAL_DRAFT_ATTEMPT_MICROUSD,
  GOAL_READ_ATTEMPT_MICROUSD,
  GOAL_WORST_CASE_MICROUSD,
  liveStatusOf,
  loadSpendState,
  reserveSpend,
  settleSpendCalls,
} from '../lib/server/spend.ts';
import { migratedDb } from './helpers/sqlite-d1.ts';

const MIGRATIONS = ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql'];
const NOW_ISO = '2026-09-24T12:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const liveEnv = {
  CADENCIA_ENABLE_LIVE: 'true',
  CADENCIA_INTENT_SERVICE_URL: 'https://intents.example',
  CADENCIA_SERVICE_TOKEN: 'spend-test-token',
};

function db() {
  return migratedDb(MIGRATIONS);
}

function setSetting(database: ReturnType<typeof db>, key: string, value: string) {
  database.raw.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(value, key);
}

void test('a goal run’s worst case follows the rate card and the service bounds', () => {
  // 24,576 prompt bytes plus 64 template tokens at GPT-6 Luna's $0.10/M, and the output cap at $0.50/M.
  assert.equal(GOAL_READ_ATTEMPT_MICROUSD, 2_464 + 400);
  assert.equal(GOAL_DRAFT_ATTEMPT_MICROUSD, 2_464 + 2_000);
  // Two attempts each for one reading and two drafts.
  assert.equal(GOAL_WORST_CASE_MICROUSD, 2 * (2_864 + 2 * 4_464));
  assert.equal(costMicroUsd(300, 700), 380);
  assert.equal(formatUsd(380), '$0.0004');
  assert.equal(formatUsd(500_000), '$0.50');
});

void test('reservations stop at the daily cap and report the reset time', async () => {
  const database = db();
  setSetting(database, 'daily_cap_microusd', String(GOAL_WORST_CASE_MICROUSD * 2));
  const decisions = [];
  for (const id of ['a', 'b', 'c']) decisions.push(await reserveSpend(database, { id, nowIso: NOW_ISO, nowMs: NOW_MS }));
  assert.deepEqual(decisions.map((decision) => decision.allowed), [true, true, false]);
  const third = decisions[2];
  assert.equal(third.allowed ? '' : third.reason, 'daily_cap');
  assert.equal(third.allowed ? 0 : third.retryAfterSec, 12 * 3600);
  const rows = database.raw.prepare('SELECT COUNT(*) AS n FROM spend_ledger').get() as { n: number };
  assert.equal(rows.n, 2);
});

void test('the monthly cap and the kill switch are enforced the same way', async () => {
  const monthly = db();
  setSetting(monthly, 'monthly_cap_microusd', String(GOAL_WORST_CASE_MICROUSD));
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

void test('each call costs its usage plus earlier attempts at their worst, or its worst when usage is missing', () => {
  const read = GOAL_READ_ATTEMPT_MICROUSD;
  assert.equal(callCostMicroUsd({ worstAttemptMicroUsd: read, usage: { promptTokens: 300, completionTokens: 700, attempts: 1 } }), 380);
  assert.equal(callCostMicroUsd({ worstAttemptMicroUsd: read, usage: { promptTokens: 300, completionTokens: 700, attempts: 2 } }), 380 + read);
  assert.equal(callCostMicroUsd({ worstAttemptMicroUsd: read }), 2 * read);
  // The scope guard answers without an attempt, so it costs nothing.
  assert.equal(callCostMicroUsd({ worstAttemptMicroUsd: read, usage: { promptTokens: 0, completionTokens: 0, attempts: 0 } }), 0);
});

void test('settling a run replaces its worst case with the cost of its calls', async () => {
  const database = db();
  setSetting(database, 'daily_cap_microusd', String(GOAL_WORST_CASE_MICROUSD + 3_000));
  assert.equal((await reserveSpend(database, { id: 'a', nowIso: NOW_ISO, nowMs: NOW_MS })).allowed, true);
  // No room for a second worst case until the first is settled.
  assert.equal((await reserveSpend(database, { id: 'b', nowIso: NOW_ISO, nowMs: NOW_MS })).allowed, false);
  const actual = await settleSpendCalls(database, {
    id: 'a',
    nowIso: NOW_ISO,
    calls: [
      { worstAttemptMicroUsd: GOAL_READ_ATTEMPT_MICROUSD, usage: { promptTokens: 300, completionTokens: 100, attempts: 1, model: 'gpt-6-luna', requestId: 'r-1' } },
      { worstAttemptMicroUsd: GOAL_DRAFT_ATTEMPT_MICROUSD, usage: { promptTokens: 900, completionTokens: 2_000, attempts: 1, requestId: 'r-2' } },
    ],
  });
  assert.equal(actual, 80 + 1_090);
  const row = database.raw.prepare("SELECT status, actual_microusd, prompt_tokens, completion_tokens, attempts, model, request_id FROM spend_ledger WHERE id = 'a'").get();
  assert.deepEqual({ ...(row as object) }, {
    status: 'settled',
    actual_microusd: 1_170,
    prompt_tokens: 1_200,
    completion_tokens: 2_100,
    attempts: 2,
    model: 'gpt-6-luna',
    request_id: 'r-2',
  });
  assert.equal((await reserveSpend(database, { id: 'b', nowIso: NOW_ISO, nowMs: NOW_MS })).allowed, true);
});

void test('a cancelled reservation frees its room and concurrent reservations never overshoot', async () => {
  const database = db();
  setSetting(database, 'daily_cap_microusd', String(GOAL_WORST_CASE_MICROUSD * 3));
  const decisions = await Promise.all(
    Array.from({ length: 10 }, (_, index) => reserveSpend(database, { id: `r${index}`, nowIso: NOW_ISO, nowMs: NOW_MS })),
  );
  assert.equal(decisions.filter((decision) => decision.allowed).length, 3);
  await cancelSpend(database, 'r0');
  assert.equal((await reserveSpend(database, { id: 'late', nowIso: NOW_ISO, nowMs: NOW_MS })).allowed, true);
});

void test('GET reports the kill switch and a reached cap without exposing amounts', async () => {
  const paused = db();
  setSetting(paused, 'live_enabled', '0');
  assert.deepEqual(await (await GET(undefined, { db: paused, env: liveEnv })).json(), { liveAvailable: false, liveStatus: 'paused' });
  // Room for one routine-sized call is not room for a goal run.
  const capped = db();
  setSetting(capped, 'daily_cap_microusd', String(GOAL_WORST_CASE_MICROUSD - 1));
  const status = await (await GET(undefined, { db: capped, env: liveEnv, nowIso: () => NOW_ISO })).json();
  assert.deepEqual(status, { liveAvailable: false, liveStatus: 'daily_cap' });
});
