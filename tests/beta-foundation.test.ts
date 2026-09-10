import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  createRoutineWithVersion,
  deleteAccount,
  ensureUser,
  getRoutineDetail,
  listRoutines,
  reserveGenerationSlot,
  setSessionStatus,
  submitFeedback,
  type Db,
  type DbStatement,
} from '../lib/server/db.ts';
import { hashEmailHex, resolveIdentity } from '../lib/server/identity.ts';

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
        const stmt = raw.prepare(sql);
        const row = stmt.get(...(params as unknown as [])) as T | undefined;
        return (row ?? null) as T | null;
      },
      async all<T>() {
        const stmt = raw.prepare(sql);
        // node:sqlite supports positional ? binds via get/all args.
        const rows = stmt.all(...(params as unknown as [])) as T[];
        return { results: rows };
      },
      async run() {
        // Translate D1 UPSERT syntax for usage_windows to SQLite-compatible.
        // D1 and SQLite share ON CONFLICT; node:sqlite handles it natively.
        const stmt = raw.prepare(sql);
        stmt.run(...(params as unknown as []));
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

const NOW = '2026-09-04T00:00:00.000Z';

void test('migration 001 applies and enforces foreign keys', async () => {
  const db = await migrated();
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
  const names = tables.map((t) => t.name);
  for (const expected of ['beta_users', 'routines', 'routine_versions', 'sessions', 'generation_requests', 'feedback', 'usage_windows']) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  // Foreign key enforcement: routine for unknown user must fail.
  await assert.rejects(() =>
    createRoutineWithVersion(db, {
      routineId: 'routine-x',
      userId: 'user-missing',
      title: 'Title',
      language: 'en',
      sourceMode: 'demo',
      nowIso: NOW,
      versionId: 'version-x',
      weekStart: '2026-08-31',
      timezone: 'America/Mexico_City',
      inputJson: '{}',
      planJson: '{}',
      generatedBy: 'demo',
      sessions: [{ id: 'session-x', ordinal: 0, startsAt: NOW, minutes: 30, title: 'S1' }],
    }),
  );
});

void test('ownership checks fail closed across users', async () => {
  const db = await migrated();
  const alice = await ensureUser(db, { id: 'user-alice', accessSubject: 'test:alice', emailHash: await hashEmailHex('alice@example.com'), nowIso: NOW });
  const bob = await ensureUser(db, { id: 'user-bob', accessSubject: 'test:bob', emailHash: await hashEmailHex('bob@example.com'), nowIso: NOW });
  // Same subject returns existing user (idempotent identity).
  const aliceAgain = await ensureUser(db, { id: 'user-alice-2', accessSubject: 'test:alice', emailHash: await hashEmailHex('alice@example.com'), nowIso: NOW });
  assert.equal(aliceAgain.id, alice.id);

  await createRoutineWithVersion(db, {
    routineId: 'routine-1',
    userId: alice.id,
    title: 'Morning practice',
    language: 'en',
    sourceMode: 'demo',
    nowIso: NOW,
    versionId: 'version-1',
    weekStart: '2026-08-31',
    timezone: 'America/Mexico_City',
    inputJson: '{"days":[0]}',
    planJson: '{"sessions":1}',
    generatedBy: 'demo',
    sessions: [{ id: 'session-1', ordinal: 0, startsAt: NOW, minutes: 30, title: 'Session 1' }],
  });

  const owner = await getRoutineDetail(db, alice.id, 'routine-1');
  assert.ok(owner);
  assert.equal(owner.sessions.length, 1);

  // Cross-user reads return null, never throw user content.
  assert.equal(await getRoutineDetail(db, bob.id, 'routine-1'), null);
  assert.equal(await setSessionStatus(db, bob.id, 'session-1', 'done', { nowIso: NOW }), null);

  // Owner transition works and is idempotent.
  const done = await setSessionStatus(db, alice.id, 'session-1', 'done', { nowIso: NOW, note: 'ok' });
  assert.equal(done?.status, 'done');
  const doneAgain = await setSessionStatus(db, alice.id, 'session-1', 'done', { nowIso: NOW });
  assert.equal(doneAgain?.status, 'done');

  // Listing is scoped: bob sees nothing.
  assert.equal((await listRoutines(db, alice.id)).length, 1);
  assert.equal((await listRoutines(db, bob.id)).length, 0);
});

void test('idempotency returns original and quota rejects before provider', async () => {
  const db = await migrated();
  const user = await ensureUser(db, { id: 'user-u', accessSubject: 'test:u', emailHash: await hashEmailHex('u@example.com'), nowIso: NOW });
  const first = await reserveGenerationSlot(db, { requestId: 'req-1', userId: user.id, idempotencyKey: 'key-1', mode: 'deepseek', nowIso: NOW, dailyQuota: 1 });
  assert.equal(first.duplicate, false);
  const duplicate = await reserveGenerationSlot(db, { requestId: 'req-2', userId: user.id, idempotencyKey: 'key-1', mode: 'deepseek', nowIso: NOW, dailyQuota: 1 });
  assert.equal(duplicate.duplicate, true);
  // Second distinct key exceeds daily quota of 1.
  await assert.rejects(() =>
    reserveGenerationSlot(db, { requestId: 'req-3', userId: user.id, idempotencyKey: 'key-2', mode: 'deepseek', nowIso: NOW, dailyQuota: 1 }),
    /quota_exceeded/u,
  );
  // Demo mode never consumes quota.
  const demo = await reserveGenerationSlot(db, { requestId: 'req-4', userId: user.id, idempotencyKey: 'key-demo', mode: 'demo', nowIso: NOW, dailyQuota: 1 });
  assert.equal(demo.duplicate, false);
});

void test('feedback bounded and account deletion cascades', async () => {
  const db = await migrated();
  const user = await ensureUser(db, { id: 'user-d', accessSubject: 'test:d', emailHash: await hashEmailHex('d@example.com'), nowIso: NOW });
  await createRoutineWithVersion(db, {
    routineId: 'routine-d',
    userId: user.id,
    title: 'T',
    language: 'es',
    sourceMode: 'demo',
    nowIso: NOW,
    versionId: 'version-d',
    weekStart: '2026-08-31',
    timezone: 'UTC',
    inputJson: '{}',
    planJson: '{}',
    generatedBy: 'demo',
    sessions: [{ id: 'session-d', ordinal: 1, startsAt: NOW, minutes: 20, title: 'S' }],
  });
  await submitFeedback(db, { id: 'feedback-1', userId: user.id, routineVersionId: 'version-d', score: 1, category: 'useful', nowIso: NOW });
  await assert.rejects(() => submitFeedback(db, { id: 'feedback-2', userId: user.id, score: 1, category: 'freeform-text', nowIso: NOW }));
  await assert.rejects(() => setSessionStatus(db, user.id, 'session-d', 'done', { nowIso: NOW, note: 'x'.repeat(501) }));
  await deleteAccount(db, user.id);
  assert.equal(await getRoutineDetail(db, user.id, 'routine-d'), null);
  assert.equal((await listRoutines(db, user.id)).length, 0);
});

void test('repository uses bound parameters only', () => {
  const source = readFileSync(new URL('../lib/server/db.ts', import.meta.url), 'utf8');
  const prepares = [...source.matchAll(/\.prepare\(\s*(`[^`]*`|"[^"]*"|'[^']*')/gu)].map((m) => m[1]);
  assert.ok(prepares.length > 10, 'expected many prepared statements');
  for (const query of prepares) {
    // Static SQL only: no ${ interpolation inside prepare() strings.
    assert.doesNotMatch(query, /\$\{/u, `interpolated SQL: ${query.slice(0, 80)}`);
  }
  assert.match(source, /\.bind\(/u);
  // exec appears only in Db interface (migration path), never with user input.
  assert.doesNotMatch(source, /exec\(\s*`[^`]*\$\{/u);
});

void test('identity test double fails closed without explicit opt-in', async () => {
  // Test double requires both the explicit flag and a loopback request URL.
  const make = (headers: Record<string, string>) => new Request('http://localhost/api/routines', { headers });
  const disabled = await resolveIdentity(make({ 'x-test-user-sub': 'alice', 'x-test-user-email': 'alice@example.com' }), {});
  assert.equal(disabled.ok, false);
  const enabled = await resolveIdentity(
    make({ 'x-test-user-sub': 'alice', 'x-test-user-email': 'alice@example.com' }),
    { CADENCIA_ALLOW_TEST_IDENTITY: 'true' },
  );
  assert.equal(enabled.ok, true);
  if (enabled.ok) {
    assert.equal(enabled.user.accessSubject, 'test:alice');
    assert.match(enabled.user.emailHash, /^[0-9a-f]{64}$/u);
  }
  // Raw email never persisted as hash input echo: hash is one-way hex.
  const hash = await hashEmailHex('Alice@Example.COM');
  assert.equal(hash, await hashEmailHex('alice@example.com'));
  // Production assertion without verifier fails closed.
  const prod = await resolveIdentity(make({ 'cf-access-jwt-assertion': 'header.payload.sig' }), {});
  assert.deepEqual(prod, { ok: false, reason: 'needs_verification' });
  const missing = await resolveIdentity(make({}), {});
  assert.deepEqual(missing, { ok: false, reason: 'missing_credentials' });
});
