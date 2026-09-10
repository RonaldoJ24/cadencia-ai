import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildPlan, toICS, toMarkdown } from '../lib/routine.ts';
import type { Db, DbStatement } from '../lib/server/db.ts';
import { applyReplan } from '../lib/server/replan.ts';
import { handleCreateRoutine, handleGetRoutine } from '../lib/server/routines.ts';
import { handleCompleteSession } from '../lib/server/sessions.ts';
import { handleGetVersion, handleListVersions, handleReplan } from '../lib/server/versions.ts';
import { reviewMetrics } from '../lib/review.ts';

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

const roomyInput = {
  request: 'aprender TypeScript',
  days: [0, 1, 2, 3, 4],
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

function getJson(url: string, user: string | null): Request {
  const headers: Record<string, string> = {};
  if (user) Object.assign(headers, authHeaders(user));
  return new Request(url, { headers });
}

type DetailPayload = {
  routine: { id: string };
  version: { id: string; versionNumber: number };
  sessions: Array<{ id: string; status: string; title: string; startsAt: string; minutes: number }>;
  plan: { sessions: Array<{ id: string }> };
};

async function seedRoomy(db: Db & { raw: DatabaseSync }, user = 'alice', key = 'seed-replan'): Promise<DetailPayload> {
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds(`seed-${user}`) };
  const created = await handleCreateRoutine(
    postJson('http://localhost/api/routines', user, { input: roomyInput, mode: 'demo' }, key),
    deps,
  );
  assert.equal(created.status, 201);
  return (await created.json()) as DetailPayload;
}

void test('replan preserves completed work and adapts the missed session', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds() };
  const seeded = await seedRoomy(db);
  assert.equal(seeded.sessions.length, 3);

  // Complete the second session, then replan the first as missed.
  const doneId = seeded.sessions[1]?.id ?? '';
  const missedId = seeded.sessions[0]?.id ?? '';
  const done = await handleCompleteSession(
    postJson(`http://localhost/api/sessions/${doneId}/complete`, 'alice', {}),
    doneId,
    deps,
  );
  assert.equal(done.status, 200);

  const replanned = await handleReplan(
    postJson(`http://localhost/api/routines/${seeded.routine.id}/replan`, 'alice', { markMissed: [missedId] }),
    seeded.routine.id,
    deps,
  );
  assert.equal(replanned.status, 201);
  const payload = await replanned.json() as DetailPayload & {
    applied: { missedSessionIds: string[]; replacementPlanIds: string[] };
  };
  assert.equal(payload.version.versionNumber, 2);
  assert.deepEqual(payload.applied.missedSessionIds, [missedId]);
  assert.equal(payload.applied.replacementPlanIds.length, 1);

  const doneRow = payload.sessions.find((s) => s.minutes === 30 && s.status === 'done');
  assert.ok(doneRow, 'completed session stays completed');
  // Note: the replacement clones the missed session title, so match by status.
  const missedRow = payload.sessions.find((s) => s.status === 'missed');
  assert.ok(missedRow, 'missed session recorded');
  const replacement = payload.sessions.find((s) => s.status === 'scheduled' && s.startsAt.startsWith('2026-09-03'));
  assert.ok(replacement, 'replacement lands on the next free allowed day');

  // Parent linkage stored; old version untouched.
  const parent = db.raw.prepare('SELECT parent_version_id AS p FROM routine_versions WHERE id = ?').get(payload.version.id) as { p: string };
  assert.equal(parent.p, seeded.version.id);
});

void test('old versions stay read-only and old exports still render', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds() };
  const seeded = await seedRoomy(db);
  const before = await handleGetVersion(
    getJson('http://localhost/api/routines/x/versions/1', 'alice'),
    seeded.routine.id,
    1,
    deps,
  );
  const beforePayload = await before.json() as { plan: unknown; sessions: unknown[] };
  const beforeBytes = JSON.stringify(beforePayload.plan);

  await handleReplan(
    postJson(`http://localhost/api/routines/${seeded.routine.id}/replan`, 'alice', { markMissed: [seeded.sessions[0]?.id ?? ''] }),
    seeded.routine.id,
    deps,
  );

  // Version 1 bytes are identical after the replan; exports still build.
  const after = await handleGetVersion(
    getJson('http://localhost/api/routines/x/versions/1', 'alice'),
    seeded.routine.id,
    1,
    deps,
  );
  assert.equal(after.status, 200);
  const afterPayload = await after.json() as { plan: { input: Parameters<typeof buildPlan>[0] } & Record<string, unknown>; sessions: unknown[] };
  assert.equal(JSON.stringify(afterPayload.plan), beforeBytes);
  assert.doesNotThrow(() => toMarkdown(afterPayload.plan as never));
  assert.doesNotThrow(() => toICS(afterPayload.plan as never));

  // History lists both versions; latest detail moved to v2.
  const history = await handleListVersions(getJson('http://localhost/x', 'alice'), seeded.routine.id, deps);
  assert.deepEqual((await history.json() as { versions: Array<{ versionNumber: number }> }).versions.map((v) => v.versionNumber), [1, 2]);
  const latest = await handleGetRoutine(getJson('http://localhost/x', 'alice'), seeded.routine.id, deps);
  assert.equal((await latest.json() as DetailPayload).version.versionNumber, 2);

  // Superseded sessions reject transitions: history is read-only.
  const frozen = await handleCompleteSession(
    postJson(`http://localhost/api/sessions/${seeded.sessions[1]?.id ?? ''}/complete`, 'alice', {}),
    seeded.sessions[1]?.id ?? '',
    deps,
  );
  assert.equal(frozen.status, 404);
});

void test('shortfalls warn honestly: no free day, and budget exhaustion', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds() };
  // Tight week: every allowed day occupied, so the missed session has nowhere to go.
  const tight = await handleCreateRoutine(
    postJson('http://localhost/api/routines', 'alice', {
      input: { ...roomyInput, days: [0, 1], weeklyMinutes: 60 },
      mode: 'demo',
    }, 'tight-key'),
    deps,
  );
  const tightPayload = await tight.json() as DetailPayload;
  assert.equal(tightPayload.sessions.length, 2);
  const short = await handleReplan(
    postJson(`http://localhost/api/routines/${tightPayload.routine.id}/replan`, 'alice', { markMissed: [tightPayload.sessions[0]?.id ?? ''] }),
    tightPayload.routine.id,
    { ...deps, newId: counterIds('short') },
  );
  assert.equal(short.status, 201);
  const shortPayload = await short.json() as DetailPayload & {
    plan: { warnings: string[] };
    applied: { replacementPlanIds: string[] };
  };
  assert.deepEqual(shortPayload.applied.replacementPlanIds, []);
  assert.ok(shortPayload.plan.warnings.length > 0);

  // Budget exhaustion at the engine level: over-cap stored plan blocks replacement.
  const over = buildPlan({ ...roomyInput, days: [0, 1], weeklyMinutes: 60, language: 'es' });
  const extra = { ...over.sessions[0]!, id: 'session-2026-09-02', date: '2026-09-02', dayIndex: 2, status: 'planned' as const };
  const overPlan = { ...over, sessions: [...over.sessions, extra] };
  const rows = overPlan.sessions.map((s, ordinal) => ({
    id: `row-${ordinal}`,
    routine_version_id: 'v1',
    ordinal,
    starts_at: `${s.date}T18:00:00`,
    scheduled_minutes: 30,
    title: s.title,
    status: 'scheduled' as const,
    completed_at: null,
    note: null,
  }));
  const result = applyReplan(overPlan, rows, ['row-0']);
  assert.equal(result.replacementPlanIds.length, 0);
  assert.ok(result.plan.warnings.some((w) => /tope semanal|weekly cap/iu.test(w)));
});

void test('replan guards: auth, ownership, and plannability fail closed', async () => {
  const db = await migrated();
  const deps = { db, env: testEnv, nowIso: () => NOW, newId: counterIds() };
  const seeded = await seedRoomy(db);
  const url = `http://localhost/api/routines/${seeded.routine.id}/replan`;

  assert.equal((await handleReplan(postJson(url, null, { markMissed: [seeded.sessions[0]?.id ?? ''] }), seeded.routine.id, deps)).status, 401);
  assert.equal((await handleReplan(postJson(url, 'bob', { markMissed: [seeded.sessions[0]?.id ?? ''] }), seeded.routine.id, deps)).status, 404);
  assert.equal((await handleReplan(postJson(url, 'alice', { markMissed: [] }), seeded.routine.id, deps)).status, 400);
  assert.equal((await handleReplan(postJson(url, 'alice', { markMissed: ['test-id-nope'] }), seeded.routine.id, deps)).status, 404);
  assert.equal(
    (await handleReplan(postJson(url, 'alice', { markMissed: [seeded.sessions[0]?.id ?? ''] }), seeded.routine.id, { ...deps, db: null })).status,
    503,
  );

  // A completed session cannot be replanned.
  await handleCompleteSession(
    postJson(`http://localhost/api/sessions/${seeded.sessions[1]?.id ?? ''}/complete`, 'alice', {}),
    seeded.sessions[1]?.id ?? '',
    deps,
  );
  const doneReplan = await handleReplan(
    postJson(url, 'alice', { markMissed: [seeded.sessions[1]?.id ?? ''] }),
    seeded.routine.id,
    { ...deps, newId: counterIds('guard') },
  );
  assert.equal(doneReplan.status, 400);

  // After a replan, the old version's ids no longer resolve.
  await handleReplan(
    postJson(url, 'alice', { markMissed: [seeded.sessions[0]?.id ?? ''] }),
    seeded.routine.id,
    { ...deps, newId: counterIds('second') },
  );
  const stale = await handleReplan(
    postJson(url, 'alice', { markMissed: [seeded.sessions[0]?.id ?? ''] }),
    seeded.routine.id,
    { ...deps, newId: counterIds('stale') },
  );
  assert.equal(stale.status, 404);
});

void test('review metrics are deterministic and model-free', () => {
  const sessions = [
    { status: 'done', minutes: 30 },
    { status: 'done', minutes: 30 },
    { status: 'skipped', minutes: 30 },
    { status: 'missed', minutes: 30 },
    { status: 'scheduled', minutes: 30 },
  ] as never;
  assert.deepEqual(reviewMetrics(sessions), {
    plannedSessions: 4,
    plannedMinutes: 120,
    completedSessions: 2,
    completedMinutes: 60,
    skippedSessions: 1,
    missedSessions: 1,
    completionRatio: 0.5,
  });
  const source = readFileSync(new URL('../lib/review.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch|DeepSeek|model call/iu);
});
