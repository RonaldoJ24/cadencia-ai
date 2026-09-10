// Phase 4 (correction 1): Workflow coordinator with settlement ownership.
// The HTTP layer records decisions; ONLY settle commits. Event payloads
// carry stable identifiers; every binding is re-read from D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Db, DbStatement } from '../lib/server/db.ts';
import { scheduleHashSync } from '../lib/trace.ts';
import {
  evidenceHashFor,
  getDecision,
  getProposal,
  scopeKeyFor,
} from '../lib/server/adaptation.ts';
import { fixtureCompile, FIXTURE_NOW_ISO } from '../lib/server/fixture.ts';
import {
  decideAdaptation,
  materializeCandidate,
  requestAdaptation,
  settleAdaptation,
  type DecisionEvent,
  type WorkflowParams,
  type WorkflowPorts,
} from '../lib/server/workflow-coord.ts';

const NOW = '2026-09-01T12:00:00.000Z';
const LATER = '2026-09-01T12:05:00.000Z';
const EXPIRES = '2026-09-01T13:00:00.000Z';
const HASH = 'sandbox-workflow-1';
const BUDGET = { day: NOW.slice(0, 10), cap: 100 };

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

function fakePorts(): {
  ports: WorkflowPorts;
  created: WorkflowParams[];
  events: Array<{ workflowId: string; type: string; payload: DecisionEvent }>;
  failNextSends: (count: number) => void;
} {
  const created: WorkflowParams[] = [];
  const events: Array<{ workflowId: string; type: string; payload: DecisionEvent }> = [];
  let failures = 0;
  return {
    ports: {
      createWorkflow: async (params) => {
        created.push(params);
      },
      sendEvent: async (envelope) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('notification lost');
        }
        events.push(envelope);
      },
      newId: () => 'local-1',
    },
    created,
    events,
    failNextSends: (count: number) => {
      failures = count;
    },
  };
}

async function sandboxDb(hash = HASH): Promise<Db & { raw: DatabaseSync }> {
  const db = await migrated();
  const { plan } = fixtureCompile('en');
  const evidenceHash = evidenceHashFor({ cutoff: FIXTURE_NOW_ISO, missed: 'none' });
  await db.prepare('INSERT INTO demo_sandboxes (capability_hash, ip_hash, created_at, expires_at, revoked, current_revision, base_schedule_hash, current_schedule_json, evidence_watermark, evidence_hash, active_workflow_id) VALUES (?, ?, ?, ?, 0, 1, ?, ?, 1, ?, NULL)')
    .bind(hash, 'ip-hash', NOW, EXPIRES, scheduleHashSync(plan, 'UTC'), JSON.stringify({ revision: 1 }), evidenceHash).run();
  await db.prepare('INSERT INTO evidence_watermarks (scope_key, watermark, evidence_hash, updated_at) VALUES (?, 1, ?, ?)')
    .bind(scopeKeyFor('sandbox', undefined, hash), evidenceHash, NOW).run();
  return db;
}

async function queuedProposal(db: Db, fakes: ReturnType<typeof fakePorts>, proposalId = 'proposal-wf-1') {
  const proposal = await requestAdaptation(db, fakes.ports, {
    scope: 'sandbox',
    sandboxHash: HASH,
    actor: 'reviewer',
    nowIso: NOW,
    expiresAt: EXPIRES,
    proposalId,
    workflowId: 'workflow-1',
    workflowBudget: BUDGET,
  });
  const materialized = await materializeCandidate(db, { proposalId: proposal.id, nowIso: NOW });
  assert.equal(materialized.status, 'awaiting_approval');
  return materialized;
}

async function approveArgs(db: Db, proposalId: string) {
  const proposal = await getProposal(db, proposalId);
  assert.ok(proposal);
  return {
    proposalId,
    decision: 'approved' as const,
    candidateHash: proposal.candidate_hash,
    baseRevision: proposal.base_revision,
    evidenceWatermark: proposal.evidence_watermark,
    actor: 'reviewer' as const,
    nowIso: LATER,
  };
}

void test('duplicate Workflow execution replays the stored candidate', async () => {
  const db = await sandboxDb();
  const fakes = fakePorts();
  const first = await queuedProposal(db, fakes);
  const second = await materializeCandidate(db, { proposalId: first.id, nowIso: NOW });
  assert.equal(second.candidate_hash, first.candidate_hash);
  assert.equal(second.status, 'awaiting_approval');
});

void test('HTTP decision records without committing; only settle commits', async () => {
  const db = await sandboxDb();
  const fakes = fakePorts();
  const proposal = await queuedProposal(db, fakes);
  const decided = await decideAdaptation(db, fakes.ports, await approveArgs(db, proposal.id));
  assert.equal(decided.persisted, 'decision_recorded');
  assert.equal(decided.notified, true);
  // Nothing committed yet: canonical R1 stands, proposal awaits.
  const sandbox = await db.prepare('SELECT current_revision AS revision FROM demo_sandboxes WHERE capability_hash = ?').bind(HASH).first<{ revision: number }>();
  assert.equal(sandbox?.revision, 1);
  assert.equal((await getProposal(db, proposal.id))?.status, 'awaiting_approval');
  // The Workflow settle step commits from the persisted decision.
  const settled = await settleAdaptation(db, { proposalId: proposal.id, nowIso: LATER });
  assert.equal(settled.status, 'committed');
  assert.equal(settled.revision, 2);
});

void test('lost notification keeps the durable decision; duplicate delivery is idempotent', async () => {
  const db = await sandboxDb();
  const fakes = fakePorts();
  const proposal = await queuedProposal(db, fakes);
  fakes.failNextSends(1);
  const decided = await decideAdaptation(db, fakes.ports, await approveArgs(db, proposal.id));
  assert.equal(decided.persisted, 'decision_recorded');
  assert.equal(decided.notified, false);
  // Retry of the same persisted decision notifies and settles once.
  const retry = await decideAdaptation(db, fakes.ports, await approveArgs(db, proposal.id));
  assert.equal(retry.persisted, 'duplicate');
  assert.equal(retry.notified, true);
  assert.equal(fakes.events.length, 1);
  const settled = await settleAdaptation(db, { proposalId: proposal.id, nowIso: LATER });
  assert.equal(settled.status, 'committed');
  const again = await settleAdaptation(db, { proposalId: proposal.id, nowIso: '2026-09-01T12:07:00.000Z' });
  assert.equal(again.status, 'committed');
  assert.equal(again.revision, 2);
  const sandbox = await db.prepare('SELECT current_revision AS revision FROM demo_sandboxes WHERE capability_hash = ?').bind(HASH).first<{ revision: number }>();
  assert.equal(sandbox?.revision, 2);
});

void test('event payloads carry only stable identifiers', async () => {
  const db = await sandboxDb();
  const fakes = fakePorts();
  const proposal = await queuedProposal(db, fakes);
  for (const blob of [JSON.stringify(fakes.created)]) {
    assert.ok(!blob.includes('Practice English'), 'no goal text in Workflow payloads');
    assert.ok(!blob.includes('interview'), 'no session content in Workflow payloads');
    assert.ok(!blob.includes('@'), 'no identifiers in Workflow payloads');
  }
  await decideAdaptation(db, fakes.ports, await approveArgs(db, proposal.id));
  assert.equal(fakes.events.length, 1);
  assert.deepEqual(Object.keys(fakes.events[0]?.payload ?? {}).sort(), ['decision', 'proposalId']);
  const paramKeys = Object.keys(fakes.created[0] ?? {}).sort();
  assert.deepEqual(paramKeys, ['proposalId', 'sandboxHash', 'scope']);
});

void test('rejection settles without touching the canonical schedule', async () => {
  const db = await sandboxDb();
  const fakes = fakePorts();
  const proposal = await queuedProposal(db, fakes);
  const stored = await getProposal(db, proposal.id);
  assert.ok(stored);
  const decided = await decideAdaptation(db, fakes.ports, {
    proposalId: proposal.id,
    decision: 'rejected',
    candidateHash: stored.candidate_hash,
    baseRevision: stored.base_revision,
    evidenceWatermark: stored.evidence_watermark,
    actor: 'reviewer',
    nowIso: LATER,
  });
  assert.equal(decided.persisted, 'decision_recorded');
  const settled = await settleAdaptation(db, { proposalId: proposal.id, nowIso: LATER });
  assert.equal(settled.status, 'rejected');
  const sandbox = await db.prepare('SELECT current_revision AS revision FROM demo_sandboxes WHERE capability_hash = ?').bind(HASH).first<{ revision: number }>();
  assert.equal(sandbox?.revision, 1);
});

void test('wait timeout without a persisted decision expires; with one it settles', async () => {
  const db = await sandboxDb();
  const fakes = fakePorts();
  const proposal = await queuedProposal(db, fakes);
  const expired = await settleAdaptation(db, { proposalId: proposal.id, nowIso: '2026-09-02T00:00:00.000Z' });
  assert.equal(expired.status, 'expired');

  const db2 = await sandboxDb();
  const fakes2 = fakePorts();
  const proposal2 = await queuedProposal(db2, fakes2, 'proposal-wf-timeout-2');
  await decideAdaptation(db2, fakes2.ports, {
    proposalId: proposal2.id,
    decision: 'cancelled',
    candidateHash: (await getProposal(db2, proposal2.id))?.candidate_hash ?? '',
    baseRevision: 1,
    evidenceWatermark: 1,
    actor: 'reviewer',
    nowIso: LATER,
  });
  const settled = await settleAdaptation(db2, { proposalId: proposal2.id, nowIso: '2026-09-02T00:00:00.000Z' });
  assert.equal(settled.status, 'cancelled');
});

void test('deletion during the wait terminates safely', async () => {
  const db = await sandboxDb();
  const fakes = fakePorts();
  const proposal = await queuedProposal(db, fakes);
  await db.prepare('DELETE FROM demo_sandboxes WHERE capability_hash = ?').bind(HASH).run();
  const settled = await settleAdaptation(db, { proposalId: proposal.id, nowIso: LATER });
  assert.ok(settled.status === 'cancelled' || settled.status === 'stale');
});

void test('stale revision and stale evidence settle without committing', async () => {
  const db = await sandboxDb();
  const fakes = fakePorts();
  const proposal = await queuedProposal(db, fakes);
  await decideAdaptation(db, fakes.ports, await approveArgs(db, proposal.id));
  await db.prepare('UPDATE demo_sandboxes SET current_revision = 2 WHERE capability_hash = ?').bind(HASH).run();
  const staleRevision = await settleAdaptation(db, { proposalId: proposal.id, nowIso: LATER });
  assert.equal(staleRevision.status, 'stale');

  const db2 = await sandboxDb();
  const fakes2 = fakePorts();
  const proposal2 = await queuedProposal(db2, fakes2, 'proposal-wf-evidence');
  await decideAdaptation(db2, fakes2.ports, {
    proposalId: proposal2.id,
    decision: 'approved',
    candidateHash: (await getProposal(db2, proposal2.id))?.candidate_hash ?? '',
    baseRevision: 1,
    evidenceWatermark: 1,
    actor: 'reviewer',
    nowIso: LATER,
  });
  const { bumpWatermark } = await import('../lib/server/adaptation.ts');
  await bumpWatermark(db2, scopeKeyFor('sandbox', undefined, HASH), evidenceHashFor({ missed: 'late-evidence' }), LATER);
  const staleEvidence = await settleAdaptation(db2, { proposalId: proposal2.id, nowIso: LATER });
  assert.equal(staleEvidence.status, 'stale');
});

void test('one active Workflow per sandbox: concurrent requests, one winner, one budget slot', async () => {
  const db = await sandboxDb();
  const fakes = fakePorts();
  const attempts = await Promise.allSettled([
    requestAdaptation(db, fakes.ports, {
      scope: 'sandbox', sandboxHash: HASH, actor: 'reviewer', nowIso: NOW, expiresAt: EXPIRES,
      proposalId: 'proposal-race-a', workflowId: 'workflow-race-a', workflowBudget: BUDGET,
    }),
    requestAdaptation(db, fakes.ports, {
      scope: 'sandbox', sandboxHash: HASH, actor: 'reviewer', nowIso: NOW, expiresAt: EXPIRES,
      proposalId: 'proposal-race-b', workflowId: 'workflow-race-b', workflowBudget: BUDGET,
    }),
  ]);
  const won = attempts.filter((result) => result.status === 'fulfilled');
  const lost = attempts.filter((result) => result.status === 'rejected');
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.match(String((lost[0] as PromiseRejectedResult).reason), /already active/iu);
  assert.equal(fakes.created.length, 1);
  const spent = await db.prepare('SELECT count FROM public_daily_usage WHERE scope = ? AND day = ?')
    .bind('reviewer_workflow', BUDGET.day).first<{ count: number }>();
  assert.equal(spent?.count, 1);
});

void test('Workflow creation failure compensates: no wedge, budget refunded, retry works', async () => {
  const db = await sandboxDb();
  const failing: WorkflowPorts = {
    createWorkflow: async () => {
      throw new Error('workflow backend down');
    },
    sendEvent: async () => undefined,
    newId: () => 'local-1',
  };
  await assert.rejects(
    requestAdaptation(db, failing, {
      scope: 'sandbox', sandboxHash: HASH, actor: 'reviewer', nowIso: NOW, expiresAt: EXPIRES,
      proposalId: 'proposal-comp-1', workflowId: 'workflow-comp-1', workflowBudget: BUDGET,
    }),
    /workflow start failed/iu,
  );
  assert.equal((await getProposal(db, 'proposal-comp-1'))?.status, 'cancelled');
  const refunded = await db.prepare('SELECT count FROM public_daily_usage WHERE scope = ? AND day = ?')
    .bind('reviewer_workflow', BUDGET.day).first<{ count: number }>();
  assert.equal(refunded?.count ?? 0, 0);
  // The sandbox is not wedged: a retry starts cleanly.
  const fakes = fakePorts();
  const retry = await requestAdaptation(db, fakes.ports, {
    scope: 'sandbox', sandboxHash: HASH, actor: 'reviewer', nowIso: NOW, expiresAt: EXPIRES,
    proposalId: 'proposal-comp-2', workflowId: 'workflow-comp-2', workflowBudget: BUDGET,
  });
  assert.equal(retry.status, 'queued');
  assert.equal(fakes.created.length, 1);
});

void test('binding ports await the async instance handle before sending', async () => {
  const { bindingWorkflowPorts } = await import('../lib/server/workflow-binding.ts');
  const sent: Array<{ type: string; payload: unknown }> = [];
  const source = {
    create: async (opts: { id: string; params: unknown }) => ({ id: opts.id, params: opts.params }),
    // Mirrors the real runtime: get() resolves with the handle, it is not sync.
    get: async (id: string) => ({
      id,
      sendEvent: async (event: { type: string; payload: unknown }) => {
        sent.push(event);
      },
    }),
  };
  const ports = await bindingWorkflowPorts(source);
  assert.ok(ports, 'binding source must yield ports');
  await ports?.createWorkflow({ proposalId: 'proposal-bind-1', scope: 'sandbox', sandboxHash: 'sandbox-bind-1' });
  await ports?.sendEvent({
    workflowId: 'workflow-proposal-bind-1',
    type: 'adaptation-decision',
    payload: { proposalId: 'proposal-bind-1', decision: 'approved' },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.type, 'adaptation-decision');
  assert.deepEqual(Object.keys((sent[0]?.payload ?? {}) as Record<string, unknown>).sort(), ['decision', 'proposalId']);
});

void test('late settle never clobbers a newer workflow reference', async () => {
  const db = await sandboxDb();
  const fakes = fakePorts();
  const proposal = await queuedProposal(db, fakes);
  await decideAdaptation(db, fakes.ports, await approveArgs(db, proposal.id));
  const settled = await settleAdaptation(db, { proposalId: proposal.id, nowIso: LATER });
  assert.equal(settled.status, 'committed');
  // A newer run claims the reference afterwards; a duplicate late settle of
  // the old proposal must leave it alone.
  await db.prepare('UPDATE demo_sandboxes SET active_workflow_id = ? WHERE capability_hash = ?')
    .bind('workflow-newer', HASH).run();
  const again = await settleAdaptation(db, { proposalId: proposal.id, nowIso: '2026-09-01T12:08:00.000Z' });
  assert.equal(again.status, 'committed');
  const sandbox = await db.prepare('SELECT active_workflow_id AS workflow FROM demo_sandboxes WHERE capability_hash = ?')
    .bind(HASH).first<{ workflow: string | null }>();
  assert.equal(sandbox?.workflow, 'workflow-newer');
});

void test('first decision wins; conflicting later decisions replay as conflict', async () => {
  const db = await sandboxDb();
  const fakes = fakePorts();
  const proposal = await queuedProposal(db, fakes);
  const stored = await getProposal(db, proposal.id);
  assert.ok(stored);
  const first = await decideAdaptation(db, fakes.ports, {
    proposalId: proposal.id,
    decision: 'approved',
    candidateHash: stored.candidate_hash,
    baseRevision: stored.base_revision,
    evidenceWatermark: stored.evidence_watermark,
    actor: 'reviewer',
    nowIso: LATER,
  });
  assert.equal(first.persisted, 'decision_recorded');
  const second = await decideAdaptation(db, fakes.ports, {
    proposalId: proposal.id,
    decision: 'rejected',
    candidateHash: stored.candidate_hash,
    baseRevision: stored.base_revision,
    evidenceWatermark: stored.evidence_watermark,
    actor: 'reviewer',
    nowIso: '2026-09-01T12:06:00.000Z',
  });
  assert.equal(second.persisted, 'stale');
  assert.equal((await getDecision(db, proposal.id))?.decision, 'approved');
  const settled = await settleAdaptation(db, { proposalId: proposal.id, nowIso: '2026-09-01T12:07:00.000Z' });
  assert.equal(settled.status, 'committed');
});
