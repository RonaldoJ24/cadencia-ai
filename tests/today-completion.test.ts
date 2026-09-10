import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Db, DbStatement } from '../lib/server/db.ts';
import { handleCreateRoutine } from '../lib/server/routines.ts';
import { handleCompleteSession, handleSkipSession } from '../lib/server/sessions.ts';

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
        const info = raw.prepare(sql).run(...(params as unknown as []));
        return { success: true, meta: { changes: Number(info.changes) } };
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

function sessionRequest(user: string | null, sessionId: string, action: 'complete' | 'skip', note?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user) Object.assign(headers, authHeaders(user));
  return new Request(`http://localhost/api/sessions/${sessionId}/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(note === undefined ? {} : { note }),
  });
}

async function seededRoutine(db: Db & { raw: DatabaseSync }, user = 'alice', key = 'seed-key') {
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds(`seed-${user}`) };
  const created = await handleCreateRoutine(
    new Request('http://localhost/api/routines', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(user), 'idempotency-key': key },
      body: JSON.stringify({ input: baseInput, mode: 'demo' }),
    }),
    deps,
  );
  assert.equal(created.status, 201);
  return (await created.json()) as {
    routine: { id: string };
    sessions: Array<{ id: string; status: string }>;
  };
}

void test('completion persists and survives a refresh read', async () => {
  const db = await (async () => {
    const inner = sqliteDb();
    inner.raw.exec('PRAGMA foreign_keys = ON');
    for (const file of ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0004_schedule_proof.sql', '0005_schedule_proof_invariants.sql']) {
    inner.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
    return inner;
  })();
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds() };
  const seeded = await seededRoutine(db);
  const target = seeded.sessions[0]?.id;
  assert.ok(target);

  const done = await handleCompleteSession(sessionRequest('alice', target, 'complete', 'finished early'), deps);
  assert.equal(done.status, 200);
  const payload = await done.json() as { session: { id: string; status: string; note: string; completedAt: string } };
  assert.equal(payload.session.status, 'done');
  assert.equal(payload.session.note, 'finished early');
  assert.equal(payload.session.completedAt, NOW);

  // Refresh path: routine detail reflects the persisted transition.
  const { handleGetRoutine } = await import('../lib/server/routines.ts');
  const detail = await handleGetRoutine(
    new Request('http://localhost/api/routines/x', { headers: authHeaders('alice') }),
    seeded.routine.id,
    deps,
  );
  const detailPayload = await detail.json() as { sessions: Array<{ id: string; status: string }> };
  assert.equal(detailPayload.sessions.find((s) => s.id === target)?.status, 'done');

  // Idempotent repeat returns the same state.
  const repeat = await handleCompleteSession(sessionRequest('alice', target, 'complete'), deps);
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json() as { session: { status: string } }).session.status, 'done');
});

void test('skip works and cross-user transitions fail closed', async () => {
  const db = await (async () => {
    const inner = sqliteDb();
    inner.raw.exec('PRAGMA foreign_keys = ON');
    for (const file of ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0004_schedule_proof.sql', '0005_schedule_proof_invariants.sql']) {
    inner.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
    return inner;
  })();
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds() };
  const seeded = await seededRoutine(db);
  const target = seeded.sessions[1]?.id;
  assert.ok(target);

  const skipped = await handleSkipSession(sessionRequest('alice', target, 'skip'), deps);
  assert.equal(skipped.status, 200);
  assert.equal((await skipped.json() as { session: { status: string } }).session.status, 'skipped');

  // Bob cannot touch Alice's session: same 404 as a missing id, state unchanged.
  const foreign = await handleCompleteSession(sessionRequest('bob', target, 'complete'), deps);
  assert.equal(foreign.status, 404);
  const missing = await handleCompleteSession(sessionRequest('alice', 'test-id-nope', 'complete'), deps);
  assert.equal(missing.status, 404);
  const row = db.raw.prepare('SELECT status FROM sessions WHERE id = ?').get(target) as { status: string };
  assert.equal(row.status, 'skipped');
});

void test('completion path never touches the provider', async () => {
  const source = readFileSync(new URL('../lib/server/sessions.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]\.\/live/u);
  assert.doesNotMatch(source, /requestIntent\s*\(/u);
  assert.doesNotMatch(source, /[^.]fetch\s*\(/u);
  const db = await (async () => {
    const inner = sqliteDb();
    inner.raw.exec('PRAGMA foreign_keys = ON');
    for (const file of ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0004_schedule_proof.sql', '0005_schedule_proof_invariants.sql']) {
    inner.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
    return inner;
  })();
  // No live vars at all: completion still succeeds, proving no provider dependency.
  const deps = { db, env: { CADENCIA_ALLOW_TEST_IDENTITY: 'true' }, nowIso: () => NOW, newId: counterIds() };
  const seeded = await seededRoutine(db);
  const target = seeded.sessions[0]?.id;
  assert.ok(target);
  const done = await handleCompleteSession(sessionRequest('alice', target, 'complete'), deps);
  assert.equal(done.status, 200);
});

void test('bounded notes, auth, storage, and route params behave', async () => {
  const db = await (async () => {
    const inner = sqliteDb();
    inner.raw.exec('PRAGMA foreign_keys = ON');
    for (const file of ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0004_schedule_proof.sql', '0005_schedule_proof_invariants.sql']) {
    inner.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
    return inner;
  })();
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds() };
  const seeded = await seededRoutine(db);
  const target = seeded.sessions[0]?.id;
  assert.ok(target);

  assert.equal((await handleCompleteSession(sessionRequest('alice', target, 'complete', 'x'.repeat(501)), deps)).status, 400);
  assert.equal((await handleCompleteSession(sessionRequest(null, target, 'complete'), deps)).status, 401);
  assert.equal(
    (await handleCompleteSession(sessionRequest('alice', target, 'complete'), { ...deps, db: null })).status,
    503,
  );

  // Handler resolves the id from injected params or the REST-shaped URL.
  const viaParams = await handleCompleteSession(sessionRequest('alice', target, 'complete'), target, deps);
  assert.equal(viaParams.status, 200);
  const viaUrl = await handleCompleteSession(sessionRequest('alice', target, 'complete'), '', deps);
  assert.equal(viaUrl.status, 200);
});
