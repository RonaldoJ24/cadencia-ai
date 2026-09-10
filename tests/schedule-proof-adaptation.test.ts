// Phase 3 (correction 1): adaptation consistency over event-built traces,
// full-predicate guarded approval, atomic watermarks, stable identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Db, DbStatement } from '../lib/server/db.ts';
import type { RoutineInput, Session } from '../lib/routine.ts';
import {
  approveProposal,
  bumpWatermark,
  cancelProposal,
  commitClaimedProposal,
  createProposal,
  evidenceHashFor,
  expireProposals,
  getProposal,
  rejectProposal,
  scopeKeyFor,
} from '../lib/server/adaptation.ts';
import { candidateHashSync, scheduleHashSync } from '../lib/trace.ts';
import {
  deriveFixtureAdaptation,
  fixtureCompile,
  FIXTURE_TIMEZONE,
} from '../lib/server/fixture.ts';
import { baseLogicalIds, buildPlanTraceForCandidate } from '../lib/server/workflow-plan.ts';
import { createSandbox } from '../lib/server/sandbox.ts';
import type { PlannerEvent } from '../lib/routine.ts';

const NOW = '2026-09-01T12:00:00.000Z';
const LATER = '2026-09-01T12:05:00.000Z';
const EXPIRES = '2026-09-01T13:00:00.000Z';
const IP_HASH = 'evidence-ip';

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

/** Candidate built the production way: engine events + stable identity. */
function builtCandidate() {
  const { plan } = fixtureCompile('en');
  const events: PlannerEvent[] = [];
  const derived = deriveFixtureAdaptation(plan, (event) => {
    events.push(event);
  });
  assert.equal(derived.feasible, true);
  const confirmation = [...events].reverse().find((event) => event.type === 'adaptation_candidate_confirmed');
  assert.ok(confirmation && confirmation.type === 'adaptation_candidate_confirmed');
  const built = buildPlanTraceForCandidate({
    candidate: derived.candidate ?? plan,
    confirmation,
    baseSessions: plan.sessions.map((session) => ({ id: session.id, date: session.date })),
    logicalById: baseLogicalIds(plan.sessions.map((session) => ({ id: session.id }))),
    missedSessionId: derived.missedId ?? '',
    timezone: FIXTURE_TIMEZONE,
  });
  return { plan, derived, built };
}

async function sandboxWithProposal(db: Db, proposalId = 'proposal-1', sandboxHash?: string) {
  const created = await createSandbox(db, { ipHash: IP_HASH, nowIso: NOW, nowMs: Date.parse(NOW) });
  const hash = sandboxHash ?? created.hash;
  const { built } = builtCandidate();
  const sandbox = await db.prepare('SELECT current_revision AS revision, base_schedule_hash AS scheduleHash, evidence_watermark AS watermark, evidence_hash AS evidenceHash FROM demo_sandboxes WHERE capability_hash = ?')
    .bind(hash).first<{ revision: number; scheduleHash: string; watermark: number; evidenceHash: string }>();
  assert.ok(sandbox);
  const row = await createProposal(db, {
    id: proposalId,
    scope: 'sandbox',
    sandboxHash: hash,
    baseRevision: sandbox.revision,
    baseScheduleHash: sandbox.scheduleHash,
    evidenceWatermark: sandbox.watermark,
    evidenceHash: sandbox.evidenceHash,
    plannerVersion: 'cadencia-planner/1',
    policyVersion: 'cadencia-adapt-policy/1',
    candidate: built.candidate as unknown as Record<string, unknown>,
    diff: built.diff,
    traceJson: JSON.stringify(built.trace),
    actor: 'reviewer',
    nowIso: NOW,
    expiresAt: EXPIRES,
  });
  return { hash, sandbox, proposal: row, built };
}

void test('no canonical mutation occurs before approval', async () => {
  const db = await migrated();
  const { hash, proposal } = await sandboxWithProposal(db);
  const sandbox = await db.prepare('SELECT current_revision AS revision FROM demo_sandboxes WHERE capability_hash = ?').bind(hash).first<{ revision: number }>();
  assert.equal(sandbox?.revision, 1);
  assert.equal(proposal.status, 'awaiting_approval');
});

void test('approval commits R2 with full sessions, real hash, and stored trace', async () => {
  const db = await migrated();
  const { hash, built } = await sandboxWithProposal(db);
  const candidateHash = candidateHashSync(built.candidate as unknown as Record<string, unknown>);
  const result = await approveProposal(db, {
    proposalId: 'proposal-1',
    candidateHash,
    baseRevision: 1,
    evidenceWatermark: 1,
    actor: 'reviewer',
    nowIso: LATER,
  });
  assert.equal(result.status, 'committed');
  const sandbox = await db.prepare('SELECT current_revision AS revision, current_schedule_json AS schedule, base_schedule_hash AS hash, current_trace_json AS trace FROM demo_sandboxes WHERE capability_hash = ?').bind(hash)
    .first<{ revision: number; schedule: string; hash: string; trace: string }>();
  assert.equal(sandbox?.revision, 2);
  const persisted = JSON.parse(sandbox?.schedule ?? '{}') as {
    revision: number;
    input: { startDate: string; time: string; sessionMinutes: number; weeklyMinutes: number; days: number[] };
    sessions: Array<{ id: string; logicalId: string; date: string; dayIndex: number; minutes: number; title: string; status: string }>;
  };
  // Complete input/constraints preserved in R2.
  assert.deepEqual(persisted.input.days, [0, 1, 2, 3, 4]);
  assert.equal(persisted.input.time, '18:00');
  assert.equal(persisted.sessions.length, 4);
  // The trace served for R2 is the engine-captured one, stored at commit.
  const storedTrace = JSON.parse(sandbox?.trace ?? '{}') as { sessions: Array<{ sessionId: string; logicalId: string }> };
  assert.equal(storedTrace.sessions.length, 4);
  const proposal = await getProposal(db, 'proposal-1');
  assert.equal(proposal?.status, 'committed');
  const audits = await db.prepare("SELECT action FROM adaptation_audit WHERE proposal_id = ? AND action = 'committed'").bind('proposal-1').all<{ action: string }>();
  assert.equal(audits.results.length, 1);
});

void test('R2 schedule hash is content-derived and separate from the candidate hash', async () => {
  const db = await migrated();
  const { hash, built } = await sandboxWithProposal(db);
  const candidateHash = candidateHashSync(built.candidate as unknown as Record<string, unknown>);
  await approveProposal(db, {
    proposalId: 'proposal-1', candidateHash, baseRevision: 1, evidenceWatermark: 1, actor: 'reviewer', nowIso: LATER,
  });
  const sandbox = await db.prepare('SELECT current_schedule_json AS schedule, base_schedule_hash AS hash FROM demo_sandboxes WHERE capability_hash = ?').bind(hash)
    .first<{ schedule: string; hash: string }>();
  const persisted = JSON.parse(sandbox?.schedule ?? '{}') as {
    input: { startDate: string; time: string; sessionMinutes: number; weeklyMinutes: number; days: number[]; request: string; language: string };
    sessions: Array<{
      id: string; date: string; dayIndex: number; title: string; minutes: number;
      instructions: string; blocks: Array<{ minutes: number; activity: string }>;
      deliverable: string; doneWhen: string; status: 'planned' | 'done' | 'missed';
    }>;
  };
  const recomputed = scheduleHashSync(
    {
      input: persisted.input as unknown as RoutineInput,
      sessions: persisted.sessions as unknown as Session[],
    },
    FIXTURE_TIMEZONE,
  );
  assert.equal(sandbox?.hash, recomputed);
  assert.notEqual(sandbox?.hash, candidateHash);
});

void test('stable logical identity: missed occurrence kept, new occurrence shares it, diff is factual', async () => {
  const db = await migrated();
  const { hash, built } = await sandboxWithProposal(db);
  const candidateHash = candidateHashSync(built.candidate as unknown as Record<string, unknown>);
  await approveProposal(db, {
    proposalId: 'proposal-1', candidateHash, baseRevision: 1, evidenceWatermark: 1, actor: 'reviewer', nowIso: LATER,
  });
  const sandbox = await db.prepare('SELECT current_schedule_json AS schedule FROM demo_sandboxes WHERE capability_hash = ?').bind(hash)
    .first<{ schedule: string }>();
  const persisted = JSON.parse(sandbox?.schedule ?? '{}') as {
    sessions: Array<{ id: string; logicalId: string; date: string; status: string }>;
  };
  const byId = new Map(persisted.sessions.map((session) => [session.id, session]));
  // Tuesday occurrence retained as evidence with its own row id...
  assert.equal(byId.get('session-2026-09-01')?.status, 'missed');
  assert.equal(byId.get('session-2026-09-01')?.logicalId, 'intent-step-2');
  // ...while Thursday is a DIFFERENT row sharing the stable logical identity.
  const thursday = persisted.sessions.find((session) => session.date === '2026-09-03');
  assert.ok(thursday && thursday.id !== 'session-2026-09-01');
  assert.equal(thursday.logicalId, 'intent-step-2');
  // Survivors kept theirs.
  assert.equal(byId.get('session-2026-08-31')?.logicalId, 'intent-step-1');
  assert.equal(byId.get('session-2026-09-02')?.logicalId, 'intent-step-3');
  // The diff never claims the Tuesday row id moved.
  const proposal = await getProposal(db, 'proposal-1');
  const diff = JSON.parse(proposal?.diff_json ?? '{}') as {
    moved: Array<{ logicalId: string; from: { sessionId: string; date: string }; to: { sessionId: string; date: string } }>;
  };
  assert.equal(diff.moved.length, 1);
  assert.equal(diff.moved[0]?.logicalId, 'intent-step-2');
  assert.equal(diff.moved[0]?.from.sessionId, 'session-2026-09-01');
  assert.equal(diff.moved[0]?.to.sessionId, thursday.id);
  assert.notEqual(diff.moved[0]?.from.sessionId, diff.moved[0]?.to.sessionId);
});

void test('double approval is idempotent with no second write', async () => {
  const db = await migrated();
  const { hash, built } = await sandboxWithProposal(db);
  const candidateHash = candidateHashSync(built.candidate as unknown as Record<string, unknown>);
  const args = { proposalId: 'proposal-1', candidateHash, baseRevision: 1, evidenceWatermark: 1, actor: 'reviewer' as const, nowIso: LATER };
  const first = await approveProposal(db, args);
  assert.equal(first.status, 'committed');
  const second = await approveProposal(db, { ...args, nowIso: '2026-09-01T12:06:00.000Z' });
  assert.equal(second.status, 'committed');
  assert.equal((second as { idempotent: boolean }).idempotent, true);
  const sandbox = await db.prepare('SELECT current_revision AS revision FROM demo_sandboxes WHERE capability_hash = ?').bind(hash).first<{ revision: number }>();
  assert.equal(sandbox?.revision, 2);
});

void test('sequential stale base cannot create a divergent revision', async () => {
  const db = await migrated();
  const { hash, built } = await sandboxWithProposal(db, 'proposal-a');
  const candidateHash = candidateHashSync(built.candidate as unknown as Record<string, unknown>);
  const first = await approveProposal(db, {
    proposalId: 'proposal-a', candidateHash, baseRevision: 1, evidenceWatermark: 1, actor: 'reviewer', nowIso: LATER,
  });
  assert.equal(first.status, 'committed');
  // A second proposal snapshotted at the old base goes stale at commit.
  const sandbox = await db.prepare('SELECT evidence_hash AS evidenceHash FROM demo_sandboxes WHERE capability_hash = ?').bind(hash).first<{ evidenceHash: string }>();
  await createProposal(db, {
    id: 'proposal-b',
    scope: 'sandbox',
    sandboxHash: hash,
    baseRevision: 1,
    baseScheduleHash: 'old-base',
    evidenceWatermark: 1,
    evidenceHash: sandbox?.evidenceHash ?? '',
    plannerVersion: 'cadencia-planner/1',
    policyVersion: 'cadencia-adapt-policy/1',
    candidate: built.candidate as unknown as Record<string, unknown>,
    diff: {},
    traceJson: JSON.stringify(built.trace),
    actor: 'reviewer',
    nowIso: LATER,
    expiresAt: EXPIRES,
  });
  const second = await approveProposal(db, {
    proposalId: 'proposal-b', candidateHash, baseRevision: 1, evidenceWatermark: 1, actor: 'reviewer', nowIso: '2026-09-01T12:06:00.000Z',
  });
  assert.equal(second.status, 'stale');
  const current = await db.prepare('SELECT current_revision AS revision FROM demo_sandboxes WHERE capability_hash = ?').bind(hash).first<{ revision: number }>();
  assert.equal(current?.revision, 2);
});

void test('zero-row canonical guard leaves no version, audit, or commit behind (audit repro)', async () => {
  const db = await migrated();
  const { hash } = await sandboxWithProposal(db);
  const before = await db.prepare('SELECT current_schedule_json AS schedule FROM demo_sandboxes WHERE capability_hash = ?').bind(hash).first<{ schedule: string }>();
  const proposal = await getProposal(db, 'proposal-1');
  assert.ok(proposal);
  // Simulate a won claim, then move canonical state before the committing
  // operation runs: the batch guards must affect zero rows everywhere.
  await db.prepare("UPDATE adaptation_proposals SET status = 'committing' WHERE id = ?").bind('proposal-1').run();
  await db.prepare('UPDATE demo_sandboxes SET evidence_watermark = ? WHERE capability_hash = ?').bind(99, hash).run();
  const result = await commitClaimedProposal(db, { ...proposal, status: 'committing' }, { actor: 'reviewer', nowIso: LATER });
  assert.equal(result.status, 'stale');
  const sandbox = await db.prepare('SELECT current_revision AS revision, current_schedule_json AS schedule FROM demo_sandboxes WHERE capability_hash = ?').bind(hash)
    .first<{ revision: number; schedule: string }>();
  assert.equal(sandbox?.revision, 1);
  assert.equal(sandbox?.schedule, before?.schedule);
  const committedAudits = await db.prepare("SELECT id FROM adaptation_audit WHERE proposal_id = ? AND action = 'committed'").bind('proposal-1').all<{ id: string }>();
  assert.equal(committedAudits.results.length, 0);
  assert.equal((await getProposal(db, 'proposal-1'))?.status, 'stale');
});

void test('stale base revision blocks commit', async () => {
  const db = await migrated();
  const { hash, built } = await sandboxWithProposal(db);
  await db.prepare('UPDATE demo_sandboxes SET current_revision = 2 WHERE capability_hash = ?').bind(hash).run();
  const result = await approveProposal(db, {
    proposalId: 'proposal-1',
    candidateHash: candidateHashSync(built.candidate as unknown as Record<string, unknown>),
    baseRevision: 1,
    evidenceWatermark: 1,
    actor: 'reviewer',
    nowIso: LATER,
  });
  assert.equal(result.status, 'stale');
});

void test('stale evidence watermark blocks commit', async () => {
  const db = await migrated();
  await sandboxWithProposal(db);
  await bumpWatermark(db, scopeKeyFor('sandbox', undefined, (await sandboxHashOf(db)) as string), evidenceHashFor({ cutoff: NOW, missed: 'session-x' }), LATER);
  const proposal = await getProposal(db, 'proposal-1');
  const result = await approveProposal(db, {
    proposalId: 'proposal-1',
    candidateHash: proposal?.candidate_hash ?? '',
    baseRevision: 1,
    evidenceWatermark: 1,
    actor: 'reviewer',
    nowIso: LATER,
  });
  assert.equal(result.status, 'stale');
});

async function sandboxHashOf(db: Db): Promise<string> {
  const row = await db.prepare('SELECT capability_hash AS hash FROM demo_sandboxes LIMIT 1').first<{ hash: string }>();
  assert.ok(row);
  return row.hash;
}

void test('changed base schedule content blocks commit even at the same revision', async () => {
  const db = await migrated();
  const { hash, built } = await sandboxWithProposal(db);
  await db.prepare('UPDATE demo_sandboxes SET base_schedule_hash = ? WHERE capability_hash = ?')
    .bind('f'.repeat(64), hash).run();
  const result = await approveProposal(db, {
    proposalId: 'proposal-1',
    candidateHash: candidateHashSync(built.candidate as unknown as Record<string, unknown>),
    baseRevision: 1,
    evidenceWatermark: 1,
    actor: 'reviewer',
    nowIso: LATER,
  });
  assert.equal(result.status, 'stale');
  assert.equal((await getProposal(db, 'proposal-1'))?.status, 'stale');
});

void test('exact candidate binding rejects unreviewed hashes', async () => {
  const db = await migrated();
  await sandboxWithProposal(db);
  const result = await approveProposal(db, {
    proposalId: 'proposal-1',
    candidateHash: '0'.repeat(64),
    baseRevision: 1,
    evidenceWatermark: 1,
    actor: 'reviewer',
    nowIso: LATER,
  });
  assert.equal(result.status, 'stale');
  const proposal = await getProposal(db, 'proposal-1');
  assert.equal(proposal?.status, 'awaiting_approval');
});

void test('corrupt candidate payload fails closed without a dangling claim', async () => {
  const db = await migrated();
  await sandboxWithProposal(db);
  await db.prepare('UPDATE adaptation_proposals SET candidate_json = ? WHERE id = ?').bind('not-json{{{', 'proposal-1').run();
  const proposal = await getProposal(db, 'proposal-1');
  const result = await approveProposal(db, {
    proposalId: 'proposal-1',
    candidateHash: proposal?.candidate_hash ?? '',
    baseRevision: 1,
    evidenceWatermark: 1,
    actor: 'reviewer',
    nowIso: LATER,
  });
  assert.equal(result.status, 'failed');
  const sandbox = await db.prepare('SELECT current_revision AS revision FROM demo_sandboxes WHERE capability_hash = ?').bind((await sandboxHashOf(db))).first<{ revision: number }>();
  assert.equal(sandbox?.revision, 1);
});

void test('rejection and cancellation leave the schedule unchanged', async () => {
  const db = await migrated();
  const { hash } = await sandboxWithProposal(db, 'proposal-r');
  await rejectProposal(db, { proposalId: 'proposal-r', actor: 'reviewer', nowIso: LATER });
  const sandbox = await db.prepare('SELECT current_revision AS revision FROM demo_sandboxes WHERE capability_hash = ?').bind(hash).first<{ revision: number }>();
  assert.equal(sandbox?.revision, 1);
  assert.equal((await getProposal(db, 'proposal-r'))?.status, 'rejected');

  const db2 = await migrated();
  await sandboxWithProposal(db2, 'proposal-c');
  await cancelProposal(db2, { proposalId: 'proposal-c', actor: 'reviewer', nowIso: LATER });
  assert.equal((await getProposal(db2, 'proposal-c'))?.status, 'cancelled');
});

void test('expiry leaves the schedule unchanged', async () => {
  const db = await migrated();
  await sandboxWithProposal(db);
  const expired = await expireProposals(db, '2026-09-02T00:00:00.000Z');
  assert.equal(expired, 1);
  assert.equal((await getProposal(db, 'proposal-1'))?.status, 'expired');
});

void test('deleted sandbox terminates approval safely', async () => {
  const db = await migrated();
  const { built } = await sandboxWithProposal(db);
  const hash = await sandboxHashOf(db);
  await db.prepare('DELETE FROM demo_sandboxes WHERE capability_hash = ?').bind(hash).run();
  // ON DELETE CASCADE removes the proposal with its sandbox: nothing left
  // to commit, and approval fails safe with no schedule write.
  assert.equal(await getProposal(db, 'proposal-1'), null);
  const result = await approveProposal(db, {
    proposalId: 'proposal-1',
    candidateHash: candidateHashSync(built.candidate as unknown as Record<string, unknown>),
    baseRevision: 1,
    evidenceWatermark: 1,
    actor: 'reviewer',
    nowIso: LATER,
  });
  assert.equal(result.status, 'stale');
});

void test('saturated week returns an explicit infeasible result', async () => {
  const { plan } = fixtureCompile('en');
  assert.equal(deriveFixtureAdaptation(plan).feasible, true);
  const noDays = { ...plan, input: { ...plan.input, days: [1] }, sessions: plan.sessions.filter((s) => s.date === '2026-09-01') };
  const infeasible = deriveFixtureAdaptation(noDays);
  assert.equal(infeasible.feasible, false);
  assert.ok(infeasible.reason);
});

void test('concurrent evidence events advance the watermark exactly once each', async () => {
  const db = await migrated();
  await createSandbox(db, { ipHash: IP_HASH, nowIso: NOW, nowMs: Date.parse(NOW) });
  const hash = await sandboxHashOf(db);
  const key = scopeKeyFor('sandbox', undefined, hash);
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      bumpWatermark(db, key, evidenceHashFor({ event: index }), NOW)),
  );
  const row = await db.prepare('SELECT watermark FROM evidence_watermarks WHERE scope_key = ?').bind(key).first<{ watermark: number }>();
  assert.equal(row?.watermark, 11);
});

void test('injected watermark failure fails the transition without moving the session', async () => {
  const { transitionSessionWithWatermark } = await import('../lib/server/db.ts');
  const db = await migrated();
  await db.prepare("INSERT INTO beta_users (id, access_subject, email_hash, created_at, last_seen_at, status) VALUES (?, ?, ?, ?, ?, 'active')")
    .bind('user-1', 'access:sub-1', 'a'.repeat(64), NOW, NOW).run();
  await db.prepare("INSERT INTO routines (id, user_id, title, language, source_mode, status, created_at, updated_at, archived_at) VALUES (?, ?, ?, 'en', 'demo', 'active', ?, ?, NULL)")
    .bind('routine-1', 'user-1', 'demo', NOW, NOW).run();
  await db.prepare('INSERT INTO routine_versions (id, routine_id, version_number, parent_version_id, week_start, timezone, input_json, plan_json, generated_by, created_at) VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?)')
    .bind('version-1', 'routine-1', '2026-08-31', 'UTC', '{}', '{}', 'demo', NOW).run();
  await db.prepare("INSERT INTO sessions (id, routine_version_id, ordinal, starts_at, scheduled_minutes, title, status, completed_at, note) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', NULL, NULL)")
    .bind('session-1', 'version-1', 0, '2026-09-01T18:00:00', 30, 'Session 1').run();
  const failing = {
    ...db,
    prepare: (sql: string) => {
      if (sql.includes('evidence_watermarks')) {
        throw new Error('injected watermark failure');
      }
      return db.prepare(sql);
    },
  } as Db;
  await assert.rejects(
    transitionSessionWithWatermark(failing, {
      userId: 'user-1',
      sessionId: 'session-1',
      status: 'done',
      nowIso: NOW,
      evidenceHash: evidenceHashFor({ session: 'session-1' }),
    }),
    /injected watermark failure/iu,
  );
  const session = await db.prepare('SELECT status FROM sessions WHERE id = ?').bind('session-1').first<{ status: string }>();
  assert.equal(session?.status, 'scheduled');
});

void test('owner scope commits an immutable new version and preserves history', async () => {
  const db = await migrated();
  const { plan, built } = builtCandidate();
  await db.prepare("INSERT INTO beta_users (id, access_subject, email_hash, created_at, last_seen_at, status) VALUES (?, ?, ?, ?, ?, 'active')")
    .bind('user-1', 'access:sub-1', 'a'.repeat(64), NOW, NOW).run();
  await db.prepare("INSERT INTO routines (id, user_id, title, language, source_mode, status, created_at, updated_at, archived_at) VALUES (?, ?, ?, 'en', 'demo', 'active', ?, ?, NULL)")
    .bind('routine-1', 'user-1', 'demo', NOW, NOW).run();
  await db.prepare('INSERT INTO routine_versions (id, routine_id, version_number, parent_version_id, week_start, timezone, input_json, plan_json, generated_by, created_at) VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?)')
    .bind('version-1', 'routine-1', plan.input.startDate, 'UTC', JSON.stringify(plan.input), JSON.stringify(plan), 'demo', NOW).run();
  for (const [ordinal, session] of plan.sessions.entries()) {
    await db.prepare("INSERT INTO sessions (id, routine_version_id, ordinal, starts_at, scheduled_minutes, title, status, completed_at, note) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', NULL, NULL)")
      .bind(`version-1-s${ordinal}`, 'version-1', ordinal, `${session.date}T${plan.input.time}:00`, session.minutes, session.title).run();
  }
  const scheduleHash = scheduleHashSync(plan, 'UTC');
  const evidenceHash = evidenceHashFor({ routine: 'routine-1', cutoff: NOW });
  await db.prepare('INSERT INTO evidence_watermarks (scope_key, watermark, evidence_hash, updated_at) VALUES (?, 1, ?, ?)')
    .bind(scopeKeyFor('owner', 'routine-1'), evidenceHash, NOW).run();
  const candidateHash = candidateHashSync(built.candidate as unknown as Record<string, unknown>);
  await createProposal(db, {
    id: 'proposal-owner-1',
    scope: 'owner',
    routineId: 'routine-1',
    baseRevision: 1,
    baseScheduleHash: scheduleHash,
    evidenceWatermark: 1,
    evidenceHash,
    plannerVersion: 'cadencia-planner/1',
    policyVersion: 'cadencia-adapt-policy/1',
    candidate: built.candidate as unknown as Record<string, unknown>,
    diff: { moved: [] },
    traceJson: JSON.stringify(built.trace),
    actor: 'owner',
    nowIso: NOW,
    expiresAt: EXPIRES,
  });
  const before = await db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE routine_version_id = ?').bind('version-1').first<{ n: number }>();
  const result = await approveProposal(db, {
    proposalId: 'proposal-owner-1',
    candidateHash,
    baseRevision: 1,
    evidenceWatermark: 1,
    actor: 'owner',
    nowIso: LATER,
  });
  assert.equal(result.status, 'committed');
  const after = await db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE routine_version_id = ?').bind('version-1').first<{ n: number }>();
  assert.equal(before?.n, after?.n);
  const versions = await db.prepare('SELECT version_number AS n FROM routine_versions WHERE routine_id = ? ORDER BY version_number ASC').bind('routine-1').all<{ n: number }>();
  assert.deepEqual(versions.results.map((row) => row.n), [1, 2]);
  const traceRow = await db.prepare('SELECT trace_json AS traceJson FROM routine_versions WHERE routine_id = ? AND version_number = 2').bind('routine-1').first<{ traceJson: string }>();
  assert.ok(traceRow?.traceJson && JSON.parse(traceRow.traceJson).sessions.length === 4);
  // Account deletion cascades; approval afterwards terminates safely.
  await createProposal(db, {
    id: 'proposal-owner-2',
    scope: 'owner',
    routineId: 'routine-1',
    baseRevision: 2,
    baseScheduleHash: scheduleHash,
    evidenceWatermark: 1,
    evidenceHash,
    plannerVersion: 'cadencia-planner/1',
    policyVersion: 'cadencia-adapt-policy/1',
    candidate: built.candidate as unknown as Record<string, unknown>,
    diff: { moved: [] },
    traceJson: JSON.stringify(built.trace),
    actor: 'owner',
    nowIso: LATER,
    expiresAt: EXPIRES,
  });
  await db.prepare('DELETE FROM beta_users WHERE id = ?').bind('user-1').run();
  // Cascades remove routines, versions, sessions, and proposals with the
  // account: nothing left to commit, and approval fails safe.
  assert.equal(await getProposal(db, 'proposal-owner-2'), null);
  const deleted = await approveProposal(db, {
    proposalId: 'proposal-owner-2',
    candidateHash,
    baseRevision: 2,
    evidenceWatermark: 1,
    actor: 'owner',
    nowIso: '2026-09-01T12:10:00.000Z',
  });
  assert.equal(deleted.status, 'stale');
});

void test('owner race: evidence change after precheck creates no version', async () => {
  const db = await migrated();
  const { plan, built } = builtCandidate();
  await db.prepare("INSERT INTO beta_users (id, access_subject, email_hash, created_at, last_seen_at, status) VALUES (?, ?, ?, ?, ?, 'active')")
    .bind('user-1', 'access:sub-1', 'a'.repeat(64), NOW, NOW).run();
  await db.prepare("INSERT INTO routines (id, user_id, title, language, source_mode, status, created_at, updated_at, archived_at) VALUES (?, ?, ?, 'en', 'demo', 'active', ?, ?, NULL)")
    .bind('routine-1', 'user-1', 'demo', NOW, NOW).run();
  await db.prepare('INSERT INTO routine_versions (id, routine_id, version_number, parent_version_id, week_start, timezone, input_json, plan_json, generated_by, created_at) VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?)')
    .bind('version-1', 'routine-1', plan.input.startDate, 'UTC', JSON.stringify(plan.input), JSON.stringify(plan), 'demo', NOW).run();
  const scheduleHash = scheduleHashSync(plan, 'UTC');
  const evidenceHash = evidenceHashFor({ routine: 'routine-1', cutoff: NOW });
  await db.prepare('INSERT INTO evidence_watermarks (scope_key, watermark, evidence_hash, updated_at) VALUES (?, 1, ?, ?)')
    .bind(scopeKeyFor('owner', 'routine-1'), evidenceHash, NOW).run();
  await createProposal(db, {
    id: 'proposal-owner-race',
    scope: 'owner',
    routineId: 'routine-1',
    baseRevision: 1,
    baseScheduleHash: scheduleHash,
    evidenceWatermark: 1,
    evidenceHash,
    plannerVersion: 'cadencia-planner/1',
    policyVersion: 'cadencia-adapt-policy/1',
    candidate: built.candidate as unknown as Record<string, unknown>,
    diff: { moved: [] },
    traceJson: JSON.stringify(built.trace),
    actor: 'owner',
    nowIso: NOW,
    expiresAt: EXPIRES,
  });
  const proposal = await getProposal(db, 'proposal-owner-race');
  assert.ok(proposal);
  // A concurrent completion wins the claim first, then evidence moves before
  // the committing operation runs.
  await db.prepare("UPDATE adaptation_proposals SET status = 'committing' WHERE id = ?").bind('proposal-owner-race').run();
  await bumpWatermark(db, scopeKeyFor('owner', 'routine-1'), evidenceHashFor({ session: 'late' }), LATER);
  const result = await commitClaimedProposal(db, { ...proposal, status: 'committing' }, { actor: 'owner', nowIso: LATER });
  assert.equal(result.status, 'stale');
  const versions = await db.prepare('SELECT version_number AS n FROM routine_versions WHERE routine_id = ? ORDER BY version_number ASC').bind('routine-1').all<{ n: number }>();
  assert.deepEqual(versions.results.map((row) => row.n), [1]);
  const committedAudits = await db.prepare("SELECT id FROM adaptation_audit WHERE proposal_id = ? AND action = 'committed'").bind('proposal-owner-race').all<{ id: string }>();
  assert.equal(committedAudits.results.length, 0);
  assert.equal((await getProposal(db, 'proposal-owner-race'))?.status, 'stale');
});

void test('completing a session invalidates a pending owner proposal via the real handler', async () => {
  const db = await migrated();
  const { handleCreateRoutine } = await import('../lib/server/routines.ts');
  const { handleCompleteSession } = await import('../lib/server/sessions.ts');
  const { requestAdaptation, materializeCandidate } = await import('../lib/server/workflow-coord.ts');
  const ports = {
    createWorkflow: async () => undefined,
    sendEvent: async () => undefined,
    newId: () => 'w-evidence-1',
  };
  const testEnv = { CADENCIA_ALLOW_TEST_IDENTITY: 'true' };
  let n = 0;
  const newId = () => `evidence-${(n += 1)}`;
  const headers = { 'x-test-user-sub': 'alice', 'x-test-user-email': 'alice@example.com' };
  const created = await handleCreateRoutine(
    new Request('http://localhost/api/routines', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'evidence-key-1', ...headers },
      body: JSON.stringify({
        input: {
          request: 'aprender TypeScript',
          days: [0, 1, 2],
          sessionMinutes: 30,
          weeklyMinutes: 90,
          startDate: '2026-08-31',
          time: '18:00',
          language: 'es',
        },
        mode: 'demo',
      }),
    }),
    { db, env: testEnv, nowIso: () => NOW, newId },
  );
  assert.equal(created.status, 201);
  const createdPayload = (await created.json()) as { routine: { id: string } };
  const routineId = createdPayload.routine.id;

  const queued = await requestAdaptation(db, ports, {
    scope: 'owner',
    routineId,
    actor: 'owner',
    nowIso: NOW,
    expiresAt: EXPIRES,
    proposalId: 'proposal-evidence-1',
    workflowId: 'workflow-evidence-1',
  });
  assert.equal(queued.status, 'queued');
  const storedPlan = JSON.parse(
    (await db.prepare('SELECT plan_json AS planJson FROM routine_versions WHERE routine_id = ? ORDER BY version_number DESC LIMIT 1')
      .bind(routineId).first<{ planJson: string }>() as { planJson: string }).planJson,
  ) as { sessions: Array<{ id: string }> };
  const materialized = await materializeCandidate(db, {
    proposalId: queued.id,
    nowIso: NOW,
    missedSessionId: storedPlan.sessions[1]?.id ?? storedPlan.sessions[0]?.id,
  });
  assert.equal(materialized.status, 'awaiting_approval');

  // Completing a session through the real handler succeeds AND moves evidence.
  const currentVersion = await db.prepare('SELECT id FROM routine_versions WHERE routine_id = ? ORDER BY version_number DESC LIMIT 1')
    .bind(routineId).first<{ id: string }>();
  const firstSession = await db.prepare('SELECT id FROM sessions WHERE routine_version_id = ? ORDER BY ordinal ASC LIMIT 1')
    .bind(currentVersion?.id).first<{ id: string }>();
  const completed = await handleCompleteSession(
    new Request(`http://localhost/api/sessions/${firstSession?.id}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({}),
    }),
    firstSession?.id ?? '',
    { db, env: testEnv, nowIso: () => LATER, newId },
  );
  assert.equal(completed.status, 200);

  const result = await approveProposal(db, {
    proposalId: queued.id,
    candidateHash: materialized.candidate_hash,
    baseRevision: materialized.base_revision,
    evidenceWatermark: materialized.evidence_watermark,
    actor: 'owner',
    nowIso: '2026-09-01T12:10:00.000Z',
  });
  assert.equal(result.status, 'stale');
});
