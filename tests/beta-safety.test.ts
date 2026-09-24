import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Db, DbStatement } from '../lib/server/db.ts';
import { purgeExpiredGenerations } from '../lib/server/db.ts';
import { handleDeleteAccount, handleGetQuota, handleSubmitFeedback } from '../lib/server/account.ts';
import { handleCreateRoutine } from '../lib/server/routines.ts';

const NOW = '2026-09-04T00:00:00.000Z';
const LATER = '2026-09-04T00:02:00.000Z';

function sqliteDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const wrap = (sql: string): DbStatement => {
    let params: unknown[] = [];
    const api: DbStatement = {
      bind(...values: unknown[]) {
        params = values;
        return api;
      },
      async first<T>() {
        const row = raw.prepare(sql).get(...(params as unknown as [])) as T | undefined;
        return (row ?? null) as T | null;
      },
      async all<T>() {
        const rows = raw.prepare(sql).all(...(params as unknown as [])) as T[];
        return { results: rows };
      },
      async run() {
        raw.prepare(sql).run(...(params as unknown as []));
        return { success: true };
      },
    };
    return api;
  };
  return {
    raw,
    prepare: (sql: string) => wrap(sql),
    batch: async (statements: DbStatement[]) => {
      raw.exec('BEGIN');
      try {
        const out: unknown[] = [];
        for (const statement of statements) out.push(await statement.run());
        raw.exec('COMMIT');
        return out;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    exec: async (sql: string) => {
      raw.exec(sql);
      return null;
    },
  };
}

async function migrated(): Promise<Db & { raw: DatabaseSync }> {
  const db = sqliteDb();
  db.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0004_schedule_proof.sql', '0005_schedule_proof_invariants.sql']) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  return db;
}

const testEnv = { CADENCIA_ALLOW_TEST_IDENTITY: 'true' };

function authHeaders(user: string): Record<string, string> {
  return { 'x-test-user-sub': user, 'x-test-user-email': `${user}@example.com` };
}

function counterIds(prefix = 'test-id') {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

const baseInput = {
  request: 'aprender TypeScript',
  days: [0, 2],
  sessionMinutes: 30,
  weeklyMinutes: 90,
  startDate: '2026-08-31',
  time: '18:00',
  language: 'es',
};

function postJson(url: string, user: string | null, body: unknown, key?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user) Object.assign(headers, authHeaders(user));
  if (key !== undefined) headers['idempotency-key'] = key;
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

void test('strict rate limit trips with a generic retryable 429 and resets next window', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds() };
  let last: Response | null = null;
  for (let index = 0; index < 11; index += 1) {
    last = await handleCreateRoutine(
      postJson('http://localhost/api/routines', 'limited', { input: baseInput, mode: 'demo' }, `rate-key-${index}`),
      { ...deps, newId: counterIds(`rate-${index}`) },
    );
  }
  assert.equal(last?.status, 429);
  assert.ok(Number(last?.headers.get('retry-after') ?? '0') >= 1);
  const payload = await last?.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ['error', 'reference']);
  assert.match(String(payload.reference), /^[0-9a-f-]{36}$/iu);
  assert.equal(JSON.stringify(payload).includes('rate-key'), false);

  // Another egress address on the same instance is unaffected.
  const otherHeaders: Record<string, string> = { ...authHeaders('other'), 'cf-connecting-ip': '203.0.113.7' };
  const other = await handleCreateRoutine(
    new Request('http://localhost/api/routines', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...otherHeaders, 'idempotency-key': 'other-key' },
      body: JSON.stringify({ input: baseInput, mode: 'demo' }),
    }),
    { ...deps, newId: counterIds('other') },
  );
  assert.equal(other.status, 201);

  // Next window admits the limited user again.
  const nextWindow = await handleCreateRoutine(
    postJson('http://localhost/api/routines', 'limited', { input: baseInput, mode: 'demo' }, 'rate-key-next'),
    { ...deps, nowIso: () => LATER, newId: counterIds('next') },
  );
  assert.equal(nextWindow.status, 201);
});

void test('routine creation exposes no analytics surface', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds() };
  const created = await handleCreateRoutine(
    postJson('http://localhost/api/routines', 'alice', { input: baseInput, mode: 'demo' }, 'no-analytics-key'),
    deps,
  );
  assert.equal(created.status, 201);
  const payload = await created.json() as Record<string, unknown>;
  assert.ok(!('analytics' in payload));
  assert.equal(JSON.stringify(payload).includes('analytics'), false);
});

void test('quota endpoint reports counts only; failures stay generic', async () => {
  const db = await migrated();
  const liveEnv = {
    ...testEnv,
    CADENCIA_ENABLE_LIVE: 'true',
    CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
    CADENCIA_SERVICE_TOKEN: 'server-secret',
    CADENCIA_DAILY_LIVE_QUOTA: '1',
  };
  const refusingFetcher = async () => {
    throw Object.assign(new Error('service-failure'), { name: 'ServiceFailure' });
  };
  const { ServiceFailure } = await import('../lib/server/live.ts');
  const backendRefused = async () => {
    throw new ServiceFailure(undefined, true, 'backend_rejected');
  };
  const failDeps = { db, env: liveEnv, nowIso: () => NOW, newId: counterIds('q'), intentFetcher: backendRefused };
  const refused = await handleCreateRoutine(
    postJson('http://localhost/api/routines', 'quinn', { input: baseInput, mode: 'deepseek' }, 'quota-live-1'),
    failDeps,
  );
  assert.equal(refused.status, 502);
  void refusingFetcher;

  const quota = await handleGetQuota(
    new Request('http://localhost/api/quota', { headers: authHeaders('quinn') }),
    { db, env: liveEnv, nowIso: () => NOW, newId: counterIds('quota') },
  );
  assert.equal(quota.status, 200);
  assert.deepEqual(await quota.json(), { windowStart: '2026-09-04', liveGenerations: 1, dailyQuota: 1 });

  const unauth = await handleGetQuota(new Request('http://localhost/api/quota'), { db, env: liveEnv, nowIso: () => NOW, newId: counterIds('q2') });
  assert.equal(unauth.status, 401);
});

void test('feedback accepts compact signals and rejects free-form shapes', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds() };
  const ok = await handleSubmitFeedback(postJson('http://localhost/api/feedback', 'alice', { score: 1, category: 'useful' }), deps);
  assert.equal(ok.status, 201);
  // Extra free-form fields are ignored, never stored.
  const noisy = await handleSubmitFeedback(
    postJson('http://localhost/api/feedback', 'alice', { score: -1, category: 'too_hard', comment: 'raw text here' }),
    { ...deps, newId: counterIds('noisy') },
  );
  assert.equal(noisy.status, 201);
  assert.equal((await handleSubmitFeedback(postJson('http://localhost/api/feedback', 'alice', { score: 0 }), deps)).status, 400);
  assert.equal((await handleSubmitFeedback(postJson('http://localhost/api/feedback', 'alice', { score: 1, category: 'essay' }), deps)).status, 400);
  assert.equal((await handleSubmitFeedback(postJson('http://localhost/api/feedback', null, { score: 1 }), deps)).status, 401);
  const stored = db.raw.prepare('SELECT category FROM feedback ORDER BY created_at').all() as Array<{ category: string }>;
  assert.deepEqual(stored.map((row) => row.category), ['useful', 'too_hard']);
});

void test('account deletion requires confirmation and removes every owned row', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds() };
  const created = await handleCreateRoutine(
    postJson('http://localhost/api/routines', 'leaving', { input: baseInput, mode: 'demo' }, 'leave-key'),
    deps,
  );
  assert.equal(created.status, 201);
  await handleSubmitFeedback(postJson('http://localhost/api/feedback', 'leaving', { score: 1 }), { ...deps, newId: counterIds('fb') });

  const unconfirmed = await handleDeleteAccount(
    postJson('http://localhost/api/account', 'leaving', { confirm: 'maybe' }),
    { ...deps, newId: counterIds('u') },
  );
  assert.equal(unconfirmed.status, 400);

  const deleted = await handleDeleteAccount(
    new Request('http://localhost/api/account', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', ...authHeaders('leaving') },
      body: JSON.stringify({ confirm: 'delete' }),
    }),
    { ...deps, newId: counterIds('d') },
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true });

  for (const table of ['beta_users', 'routines', 'routine_versions', 'sessions', 'generation_requests', 'feedback', 'usage_windows', 'rate_hits']) {
    const row = db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    assert.equal(row.n, 0, `${table} not empty after deletion`);
  }
});

void test('retention sweep removes only expired terminal generation records', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds() };
  const { handleCreateRoutine: create } = await import('../lib/server/routines.ts');
  const liveEnv = {
    ...testEnv,
    CADENCIA_ENABLE_LIVE: 'true',
    CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
    CADENCIA_SERVICE_TOKEN: 'server-secret',
  };
  const { ServiceFailure } = await import('../lib/server/live.ts');
  await create(
    postJson('http://localhost/api/routines', 'sweep', { input: baseInput, mode: 'deepseek' }, 'sweep-fail'),
    { ...deps, env: liveEnv, newId: counterIds('sf'), intentFetcher: async () => { throw new ServiceFailure(undefined, true, 'backend_rejected'); } },
  );
  await create(
    postJson('http://localhost/api/routines', 'sweep', { input: baseInput, mode: 'demo' }, 'sweep-ok'),
    { ...deps, newId: counterIds('so') },
  );
  // Recent terminal records are retained; old ones purge.
  assert.equal(await purgeExpiredGenerations(db, '2026-09-04T00:00:00.000Z'), 0);
  assert.equal(await purgeExpiredGenerations(db, '2026-10-04T00:00:00.000Z'), 1);
  const remaining = db.raw.prepare('SELECT outcome FROM generation_requests').all() as Array<{ outcome: string }>;
  assert.deepEqual(remaining.map((row) => row.outcome).sort(), ['completed']);
});
