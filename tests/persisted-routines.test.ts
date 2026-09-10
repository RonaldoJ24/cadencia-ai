import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Db, DbStatement } from '../lib/server/db.ts';
import {
  handleCreateRoutine,
  handleGetRoutine,
  handleListRoutines,
} from '../lib/server/routines.ts';
import { POST as legacyPost } from '../app/api/routine/route.ts';

const NOW = '2026-09-04T00:00:00.000Z';

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

function testEnv(extra: Record<string, unknown> = {}) {
  return {
    CADENCIA_ALLOW_TEST_IDENTITY: 'true',
    CADENCIA_ENABLE_LIVE: 'true',
    CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
    CADENCIA_SERVICE_TOKEN: 'server-secret',
    ...extra,
  };
}

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

function createRequest(body: unknown, user: string | null, key?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user) Object.assign(headers, authHeaders(user));
  if (key !== undefined) headers['idempotency-key'] = key;
  return new Request('http://localhost/api/routines', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function getRequest(user: string | null, url = 'http://localhost/api/routines'): Request {
  const headers: Record<string, string> = {};
  if (user) Object.assign(headers, authHeaders(user));
  return new Request(url, { headers });
}

const stubIntent = {
  title: 'Aprender TypeScript',
  goal: 'Construir una pequeña función tipada.',
  domain: 'learning',
  steps: [1, 2].map((n) => ({
    title: `Paso ${n}`,
    instructions: 'Escribe y revisa una función.',
    blocks: [
      { minutes: 5, activity: 'Define el caso.' },
      { minutes: 20, activity: 'Implementa la función.' },
      { minutes: 5, activity: 'Comprueba el tipo.' },
    ],
    deliverable: `Evidencia ${n}.`,
    doneWhen: 'La función compila.',
  })),
};

const scopeIntent = {
  title: 'Solicitud fuera de alcance',
  goal: 'Cadencia organiza aprendizaje; no ofrece orientación especializada.',
  domain: 'general',
  steps: [{
    title: 'Reformula el objetivo',
    instructions: 'Pide una rutina de aprendizaje sin asesoría especializada.',
  }],
};

void test('demo create persists an immutable version and detail matches', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv(), nowIso: () => NOW, newId: counterIds() };
  const created = await handleCreateRoutine(
    createRequest({ input: baseInput, mode: 'demo' }, 'alice', 'key-demo-1'),
    deps,
  );
  assert.equal(created.status, 201);
  const payload = await created.json() as {
    deduplicated: boolean;
    routine: { id: string; sourceMode: string };
    version: { id: string; versionNumber: number };
    sessions: Array<{ id: string }>;
    plan: { mode: string; intent: { title: string } };
  };
  assert.equal(payload.deduplicated, false);
  assert.equal(payload.routine.sourceMode, 'demo');
  assert.equal(payload.version.versionNumber, 1);
  assert.equal(payload.sessions.length, 2);
  assert.equal(payload.plan.mode, 'demo');
  assert.equal(JSON.stringify(payload).includes('scope_refused'), false);

  const detail = await handleGetRoutine(
    getRequest('alice'), payload.routine.id, { ...deps, newId: counterIds('other') },
  );
  assert.equal(detail.status, 200);
  const detailPayload = await detail.json() as { routine: { id: string }; plan: { intent: { title: string } } };
  assert.equal(detailPayload.routine.id, payload.routine.id);
  assert.deepEqual(detailPayload.plan, payload.plan);

  const list = await handleListRoutines(getRequest('alice'), deps);
  const listPayload = await list.json() as { routines: unknown[]; nextCursor: null };
  assert.equal(listPayload.routines.length, 1);
  assert.equal(listPayload.nextCursor, null);
});

void test('duplicate idempotency key replays the original without a second routine', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv(), nowIso: () => NOW, newId: counterIds() };
  const first = await handleCreateRoutine(
    createRequest({ input: baseInput, mode: 'demo' }, 'alice', 'same-key'),
    deps,
  );
  const firstPayload = await first.json() as { routine: { id: string } };
  const second = await handleCreateRoutine(
    createRequest({ input: { ...baseInput, request: 'changed text, same key' }, mode: 'demo' }, 'alice', 'same-key'),
    { ...deps, newId: counterIds('second') },
  );
  assert.equal(second.status, 200);
  const secondPayload = await second.json() as { deduplicated: boolean; routine: { id: string } };
  assert.equal(secondPayload.deduplicated, true);
  assert.equal(secondPayload.routine.id, firstPayload.routine.id);
  const count = db.raw.prepare('SELECT COUNT(*) AS n FROM routines').get() as { n: number };
  assert.equal(count.n, 1);
});

void test('cross-user access fails closed and idempotency keys are per-user', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv(), nowIso: () => NOW, newId: counterIds() };
  const created = await handleCreateRoutine(
    createRequest({ input: baseInput, mode: 'demo' }, 'alice', 'alice-key'),
    deps,
  );
  const { routine } = await created.json() as { routine: { id: string } };

  const foreign = await handleGetRoutine(getRequest('bob'), routine.id, deps);
  assert.equal(foreign.status, 404);
  const bobList = await handleListRoutines(getRequest('bob'), deps) as Response;
  assert.deepEqual((await bobList.json() as { routines: unknown[] }).routines, []);

  // Same key string under another user creates an independent routine.
  const bobCreate = await handleCreateRoutine(
    createRequest({ input: baseInput, mode: 'demo' }, 'bob', 'alice-key'),
    { ...deps, newId: counterIds('bob') },
  );
  assert.equal(bobCreate.status, 201);
  const bobPayload = await bobCreate.json() as { routine: { id: string } };
  assert.notEqual(bobPayload.routine.id, routine.id);
});

void test('missing key, bad auth, and invalid input are rejected before quota use', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv(), nowIso: () => NOW, newId: counterIds() };
  assert.equal((await handleCreateRoutine(createRequest({ input: baseInput, mode: 'demo' }, 'alice'), deps)).status, 400);
  assert.equal((await handleCreateRoutine(createRequest({ input: baseInput, mode: 'demo' }, null, 'k'), deps)).status, 401);
  const invalid = await handleCreateRoutine(
    createRequest({ input: { ...baseInput, days: [0, 0] }, mode: 'demo' }, 'alice', 'bad-input'),
    deps,
  );
  assert.equal(invalid.status, 400);
  const requests = db.raw.prepare('SELECT COUNT(*) AS n FROM generation_requests').get() as { n: number };
  assert.equal(requests.n, 0);
});

void test('legacy demo flow works with persistence disabled', async () => {
  const disabled = await handleCreateRoutine(
    createRequest({ input: baseInput, mode: 'demo' }, 'alice', 'any-key'),
    { db: null, env: testEnv(), nowIso: () => NOW, newId: counterIds() },
  );
  assert.equal(disabled.status, 503);
  // Existing single-shot demo route is untouched by persistence config.
  const legacy = await legacyPost(
    new Request('http://localhost/api/routine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: baseInput, mode: 'demo' }),
    }),
  );
  assert.equal(legacy.status, 200);
  const payload = await legacy.json() as { plan: { mode: string } };
  assert.equal(payload.plan.mode, 'demo');
});

void test('deepseek persists validated output, rejects bad provider data, enforces quota first', async () => {
  const db = await migrated();
  let calls = 0;
  const goodFetcher = async () => {
    calls += 1;
    return { intent: stubIntent, scopeRefused: false };
  };
  const env = testEnv({ CADENCIA_DAILY_LIVE_QUOTA: '1' });
  const first = await handleCreateRoutine(
    createRequest({ input: baseInput, mode: 'deepseek' }, 'alice', 'live-1'),
    { db, env, nowIso: () => NOW, newId: counterIds(), intentFetcher: goodFetcher },
  );
  assert.equal(first.status, 201);
  const firstPayload = await first.json() as { routine: { id: string }; plan: { mode: string } };
  assert.equal(firstPayload.plan.mode, 'deepseek');
  assert.equal(calls, 1);

  // Second distinct key exceeds the daily quota: rejected before any provider call.
  const limited = await handleCreateRoutine(
    createRequest({ input: baseInput, mode: 'deepseek' }, 'alice', 'live-2'),
    { db, env, nowIso: () => NOW, newId: counterIds('q'), intentFetcher: goodFetcher },
  );
  assert.equal(limited.status, 429);
  assert.equal(calls, 1);

  // Malformed provider output is a safe 502 with no routine persisted.
  const badFetcher = async () => ({ intent: { ...stubIntent, domain: 'medical' }, scopeRefused: false });
  const bad = await handleCreateRoutine(
    createRequest({ input: baseInput, mode: 'deepseek' }, 'carol', 'live-bad'),
    { db, env: testEnv(), nowIso: () => NOW, newId: counterIds('bad'), intentFetcher: badFetcher },
  );
  assert.equal(bad.status, 502);
  const carolList = await handleListRoutines(getRequest('carol'), { db, env: testEnv(), nowIso: () => NOW, newId: counterIds('c') });
  assert.deepEqual((await carolList.json() as { routines: unknown[] }).routines, []);
});

void test('scope-refused deepseek persists an honest zero-session routine', async () => {
  const db = await migrated();
  const refusedFetcher = async () => ({ intent: scopeIntent, scopeRefused: true });
  const response = await handleCreateRoutine(
    createRequest({ input: baseInput, mode: 'deepseek' }, 'alice', 'live-refused'),
    { db, env: testEnv(), nowIso: () => NOW, newId: counterIds(), intentFetcher: refusedFetcher },
  );
  assert.equal(response.status, 201);
  const payload = await response.json() as { sessions: unknown[]; plan: { warnings: string[] } };
  assert.deepEqual(payload.sessions, []);
  assert.ok(payload.plan.warnings.length > 0);
});
