// Adaptation proposals, decisions, and guarded approval.
// D1 is canonical product state.
//
// Persistence semantics (per current Cloudflare D1 docs): batch() is a SQL
// transaction, but ONLY a failed statement aborts/rolls back — a zero-row
// conditional success is NOT a failure. Therefore every dependent write in
// the commit batch repeats the FULL canonical predicate (revision, schedule
// hash, watermark, claim status) evaluated against pre-batch state, in an
// order where no earlier statement in the batch can satisfy a later
// statement's guard spuriously:
//   sandbox: [audit INSERT (pre-state guards), sandbox UPDATE (guards),
//             proposal terminal (guards)] — audit runs BEFORE the sandbox row
//             changes, so a failed canonical guard writes zero rows anywhere.
//   owner:   [sessions..., routines, audit, version INSERT, proposal
//             terminal] — the version INSERT (which would flip the
//             latest-is-base guard) runs AFTER all guards that read it, and
//             the proposal terminal runs last.
// A failed guard therefore leaves no version, session, audit, or committed
// proposal row behind; the proposal is marked truthfully stale.
//
// Human decisions live in adaptation_decisions, recorded BEFORE any Workflow
// notification. The Workflow settles purely from that row plus authoritative
// D1 state; event payloads carry only stable identifiers.

import { createHash, randomUUID } from 'node:crypto';
import type { Db } from './db.ts';
import {
  candidateHashSync,
  canonicalHashSync,
  persistedScheduleHashSync,
  scheduleHashSync,
} from '../trace.ts';
import type { RoutineInput, Session } from '../routine.ts';

export const PROPOSAL_STATUSES = [
  'queued',
  'computing',
  'awaiting_approval',
  'committing',
  'committed',
  'rejected',
  'stale',
  'expired',
  'cancelled',
  'failed',
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Active = a Workflow may still settle this proposal. Enforced in D1 by
 *  adaptation_active_per_sandbox (0005) plus application prechecks. */
export const ACTIVE_PROPOSAL_STATUSES = [
  'queued',
  'computing',
  'awaiting_approval',
  'committing',
] as const;

export type ProposalScope = 'owner' | 'sandbox';

export type ProposalRow = {
  id: string;
  scope: ProposalScope;
  routine_id: string | null;
  sandbox_hash: string | null;
  base_revision: number;
  base_schedule_hash: string;
  evidence_watermark: number;
  evidence_hash: string;
  planner_version: string;
  policy_version: string;
  candidate_json: string;
  candidate_hash: string;
  diff_json: string;
  trace_json: string | null;
  status: ProposalStatus;
  workflow_id: string | null;
  actor: string;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
};

export type DecisionValue = 'approved' | 'rejected' | 'cancelled';

export type DecisionRow = {
  proposal_id: string;
  decision: DecisionValue;
  candidate_hash: string;
  base_revision: number;
  evidence_watermark: number;
  actor: string;
  created_at: string;
  notified: number;
};

export type ApprovalArgs = {
  proposalId: string;
  candidateHash: string;
  baseRevision: number;
  evidenceWatermark: number;
  actor: 'reviewer' | 'owner' | 'system';
  nowIso: string;
  newId?: () => string;
};

export type ApprovalResult =
  | { status: 'committed'; proposalId: string; revision: number; idempotent: boolean }
  | { status: 'stale' | 'expired' | 'rejected' | 'cancelled' | 'failed'; proposalId: string; reason: string };

function fail(message: string): never {
  throw new Error(`cadencia_adaptation_invalid: ${message}`);
}

function checkId(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) fail(`${label} id`);
  if (!/^[A-Za-z0-9:_-]+$/u.test(value)) fail(`${label} id charset`);
  return value;
}

/**
 * Release-order guard: the Schedule Proof code ships with migration 0005
 * and must only run after it is applied (migrate-then-deploy). Probing the
 * new columns up front turns a mixed-schema state into an explicit 503
 * instead of scattered 500s. Throws cadencia_adaptation_invalid containing
 * 'proof schema' when the schema is absent.
 */
export async function requireProofSchema(db: Db): Promise<void> {
  try {
    for (const sql of [
      'SELECT trace_json FROM adaptation_proposals LIMIT 0',
      'SELECT trace_json FROM routine_versions LIMIT 0',
      'SELECT current_trace_json FROM demo_sandboxes LIMIT 0',
      'SELECT proposal_id FROM adaptation_decisions LIMIT 0',
    ]) {
      await db.prepare(sql).first();
    }
  } catch {
    fail('proof schema not migrated (apply 0005 before deploying this code)');
  }
}

export function scopeKeyFor(scope: ProposalScope, routineId?: string, sandboxHash?: string): string {
  if (scope === 'owner') {
    if (!routineId) fail('routine scope key');
    return `routine:${routineId as string}`;
  }
  if (!sandboxHash) fail('sandbox scope key');
  return `sandbox:${sandboxHash as string}`;
}

export function evidenceHashFor(value: unknown): string {
  return canonicalHashSync({ kind: 'evidence', value });
}

export async function getWatermark(db: Db, scopeKey: string): Promise<{ watermark: number; evidenceHash: string } | null> {
  const row = await db
    .prepare('SELECT watermark, evidence_hash AS evidenceHash FROM evidence_watermarks WHERE scope_key = ? LIMIT 1')
    .bind(scopeKey)
    .first<{ watermark: number; evidenceHash: string }>();
  return row ?? null;
}

/**
 * Atomic monotonic increment in ONE statement: concurrent callers each
 * apply exactly one +1 (no read/increment/write race), then read back the
 * current value. The increment itself never fails silently — a throw means
 * no advancement happened.
 */
export async function bumpWatermark(
  db: Db,
  scopeKey: string,
  evidenceHash: string,
  nowIso: string,
): Promise<number> {
  await db
    .prepare('INSERT INTO evidence_watermarks (scope_key, watermark, evidence_hash, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT (scope_key) DO UPDATE SET watermark = watermark + 1, evidence_hash = excluded.evidence_hash, updated_at = excluded.updated_at')
    .bind(scopeKey, evidenceHash, nowIso)
    .run();
  const current = await getWatermark(db, scopeKey);
  if (!current) fail('watermark not visible after increment');
  return (current as { watermark: number }).watermark;
}

export type CreateProposalArgs = {
  id?: string;
  scope: ProposalScope;
  routineId?: string;
  sandboxHash?: string;
  baseRevision: number;
  baseScheduleHash: string;
  evidenceWatermark: number;
  evidenceHash: string;
  plannerVersion: string;
  policyVersion: string;
  candidate: Record<string, unknown>;
  diff: Record<string, unknown>;
  traceJson?: string;
  workflowId?: string;
  actor: 'reviewer' | 'owner' | 'system';
  nowIso: string;
  expiresAt: string;
  initialStatus?: ProposalStatus;
};

const PROPOSAL_COLUMNS = 'id, scope, routine_id, sandbox_hash, base_revision, base_schedule_hash, evidence_watermark, evidence_hash, planner_version, policy_version, candidate_json, candidate_hash, diff_json, trace_json, status, workflow_id, actor, created_at, expires_at, resolved_at';

export async function createProposal(db: Db, args: CreateProposalArgs): Promise<ProposalRow> {
  const id = args.id ?? `proposal-${randomUUID()}`;
  checkId(id, 'proposal');
  if (args.scope === 'sandbox') {
    if (!args.sandboxHash) fail('sandbox proposals require a sandbox hash');
    checkId(args.sandboxHash as string, 'sandbox');
  } else {
    if (!args.routineId) fail('owner proposals require a routine id');
    checkId(args.routineId as string, 'routine');
  }
  if (!Number.isInteger(args.baseRevision) || args.baseRevision < 1) fail('base_revision');
  if (!Number.isInteger(args.evidenceWatermark) || args.evidenceWatermark < 0) fail('evidence_watermark');
  const candidateJson = JSON.stringify(args.candidate);
  const candidateHash = candidateHashSync(args.candidate);
  if (new TextEncoder().encode(candidateJson).byteLength > 32_768) fail('candidate too large');
  const status = args.initialStatus ?? 'awaiting_approval';
  await db
    .prepare(`INSERT INTO adaptation_proposals (${PROPOSAL_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
    .bind(
      id,
      args.scope,
      args.routineId ?? null,
      args.sandboxHash ?? null,
      args.baseRevision,
      args.baseScheduleHash,
      args.evidenceWatermark,
      args.evidenceHash,
      args.plannerVersion,
      args.policyVersion,
      candidateJson,
      candidateHash,
      JSON.stringify(args.diff),
      args.traceJson ?? null,
      status,
      args.workflowId ?? null,
      args.actor,
      args.nowIso,
      args.expiresAt,
    )
    .run();
  const created = await getProposal(db, id);
  if (!created) fail('proposal insert not visible');
  return created;
}

export async function getProposal(db: Db, id: string): Promise<ProposalRow | null> {
  checkId(id, 'proposal');
  return db
    .prepare(`SELECT ${PROPOSAL_COLUMNS} FROM adaptation_proposals WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<ProposalRow>();
}

export async function getDecision(db: Db, proposalId: string): Promise<DecisionRow | null> {
  checkId(proposalId, 'proposal');
  return db
    .prepare('SELECT proposal_id, decision, candidate_hash, base_revision, evidence_watermark, actor, created_at, notified FROM adaptation_decisions WHERE proposal_id = ? LIMIT 1')
    .bind(proposalId)
    .first<DecisionRow>();
}

export type PersistDecisionArgs = {
  proposalId: string;
  decision: DecisionValue;
  candidateHash: string;
  baseRevision: number;
  evidenceWatermark: number;
  actor: 'reviewer' | 'owner' | 'system';
  nowIso: string;
};

/**
 * Record a human decision BEFORE any Workflow notification. The exact
 * candidate binding is verified against the proposal; mismatches record
 * nothing. First decision wins (later ones replay idempotently).
 */
export async function persistDecision(
  db: Db,
  args: PersistDecisionArgs,
): Promise<{ status: 'recorded' | 'duplicate' | 'stale'; reason?: string }> {
  checkId(args.proposalId, 'proposal');
  if (args.decision !== 'approved' && args.decision !== 'rejected' && args.decision !== 'cancelled') {
    fail('decision value');
  }
  const proposal = await getProposal(db, args.proposalId);
  if (!proposal) return { status: 'stale', reason: 'unknown_proposal' };
  if (proposal.status === 'committed') {
    const existing = await getDecision(db, args.proposalId);
    const matches = existing?.decision === 'approved'
      && proposal.candidate_hash === args.candidateHash
      && proposal.base_revision === args.baseRevision
      && proposal.evidence_watermark === args.evidenceWatermark;
    return matches ? { status: 'duplicate' } : { status: 'stale', reason: 'candidate_mismatch' };
  }
  if (!(ACTIVE_PROPOSAL_STATUSES as readonly string[]).includes(proposal.status)) {
    return { status: 'stale', reason: `terminal_${proposal.status}` };
  }
  if (Date.parse(args.nowIso) > Date.parse(proposal.expires_at)) {
    await markTerminal(db, proposal.id, 'expired', args.nowIso);
    return { status: 'stale', reason: 'proposal_expired' };
  }
  if (proposal.candidate_hash !== args.candidateHash
    || proposal.base_revision !== args.baseRevision
    || proposal.evidence_watermark !== args.evidenceWatermark) {
    return { status: 'stale', reason: 'binding_mismatch' };
  }
  const inserted = await db
    .prepare('INSERT INTO adaptation_decisions (proposal_id, decision, candidate_hash, base_revision, evidence_watermark, actor, created_at, notified) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT (proposal_id) DO NOTHING')
    .bind(args.proposalId, args.decision, args.candidateHash, args.baseRevision, args.evidenceWatermark, args.actor, args.nowIso)
    .run();
  if (changesOf(inserted) === 1) {
    // The decision row is ours; the audit write rides along. If it throws,
    // the decision stays recorded and a retry replays idempotently below.
    await db
      .prepare("INSERT INTO adaptation_audit (id, proposal_id, action, actor, created_at, detail_json) VALUES (?, ?, 'decision_recorded', ?, ?, ?)")
      .bind(`audit-${randomUUID()}`, args.proposalId, args.actor, args.nowIso, JSON.stringify({ decision: args.decision }))
      .run();
    return { status: 'recorded' };
  }
  const existing = await getDecision(db, args.proposalId);
  if (!existing) return { status: 'stale', reason: 'decision_not_visible' };
  const same = existing.decision === args.decision
    && existing.candidate_hash === args.candidateHash
    && existing.base_revision === args.baseRevision
    && existing.evidence_watermark === args.evidenceWatermark;
  // First decision wins; anything else replays only when identical.
  return same ? { status: 'duplicate' } : { status: 'stale', reason: 'decision_conflict' };
}

export async function currentRevisionOf(db: Db, scope: ProposalScope, routineId?: string, sandboxHash?: string): Promise<number | null> {
  if (scope === 'sandbox') {
    if (!sandboxHash) fail('sandbox hash');
    const row = await db
      .prepare('SELECT current_revision AS revision FROM demo_sandboxes WHERE capability_hash = ? LIMIT 1')
      .bind(sandboxHash)
      .first<{ revision: number }>();
    return row ? row.revision : null;
  }
  if (!routineId) fail('routine id');
  const row = await db
    .prepare('SELECT MAX(version_number) AS revision FROM routine_versions WHERE routine_id = ?')
    .bind(routineId)
    .first<{ revision: number | null }>();
  return typeof row?.revision === 'number' ? row.revision : null;
}

/** Current canonical schedule hash: null when the scope row is gone. */
export async function currentScheduleHash(db: Db, scope: ProposalScope, routineId?: string, sandboxHash?: string): Promise<string | null> {
  if (scope === 'sandbox') {
    if (!sandboxHash) fail('sandbox hash');
    const row = await db
      .prepare('SELECT base_schedule_hash AS hash FROM demo_sandboxes WHERE capability_hash = ? LIMIT 1')
      .bind(sandboxHash)
      .first<{ hash: string }>();
    return row ? row.hash : null;
  }
  if (!routineId) fail('routine id');
  const row = await db
    .prepare('SELECT plan_json AS planJson, timezone FROM routine_versions WHERE routine_id = ? ORDER BY version_number DESC LIMIT 1')
    .bind(routineId)
    .first<{ planJson: string; timezone: string }>();
  if (!row) return null;
  try {
    return scheduleHashSync(JSON.parse(row.planJson) as Parameters<typeof scheduleHashSync>[0], row.timezone);
  } catch {
    return null;
  }
}

function changesOf(result: unknown): number | null {
  const changes = (result as { meta?: { changes?: number } } | null)?.meta?.changes;
  return typeof changes === 'number' ? changes : null;
}

async function markTerminal(
  db: Db,
  id: string,
  status: ProposalStatus,
  nowIso: string,
): Promise<void> {
  await db
    .prepare('UPDATE adaptation_proposals SET status = ?, resolved_at = ? WHERE id = ?')
    .bind(status, nowIso, id)
    .run();
}

/** Full canonical predicate over the sandbox row, evaluated pre-batch-state. */
function sandboxPredicateSql(): string {
  return '((SELECT current_revision FROM demo_sandboxes WHERE capability_hash = ?) = ?'
    + ' AND (SELECT evidence_watermark FROM demo_sandboxes WHERE capability_hash = ?) = ?'
    + ' AND (SELECT base_schedule_hash FROM demo_sandboxes WHERE capability_hash = ?) = ?'
    + " AND EXISTS (SELECT 1 FROM adaptation_proposals WHERE id = ? AND status = 'committing'))";
}

function sandboxPredicateBinds(proposal: ProposalRow): unknown[] {
  return [
    proposal.sandbox_hash, proposal.base_revision,
    proposal.sandbox_hash, proposal.evidence_watermark,
    proposal.sandbox_hash, proposal.base_schedule_hash,
    proposal.id,
  ];
}

/** Full canonical predicate over the owner rows. Latest-is-base plus
 *  watermark match, plus the committing claim. The schedule hash itself was
 *  rechecked against the immutable version row just before the claim; plan
 *  rows are insert-only so no concurrent writer can alter the hashed bytes
 *  without also flipping latest-is-base. */
function ownerPredicateSql(): string {
  return '((SELECT MAX(version_number) FROM routine_versions WHERE routine_id = ?) = ?'
    + ' AND EXISTS (SELECT 1 FROM evidence_watermarks WHERE scope_key = ? AND watermark = ? AND evidence_hash = ?)'
    + " AND EXISTS (SELECT 1 FROM adaptation_proposals WHERE id = ? AND status = 'committing'))";
}

function ownerPredicateBinds(proposal: ProposalRow): unknown[] {
  return [
    proposal.routine_id, proposal.base_revision,
    scopeKeyFor('owner', proposal.routine_id ?? undefined),
    proposal.evidence_watermark, proposal.evidence_hash,
    proposal.id,
  ];
}

export type StoredScheduleSession = Session & { logicalId: string; startsAt: string };

function parseCandidateEnvelope(proposal: ProposalRow): {
  input: RoutineInput;
  sessions: StoredScheduleSession[];
  timezone: string;
  planJson: string;
} {
  const envelope = JSON.parse(proposal.candidate_json) as {
    inputJson?: string;
    planJson?: string;
    timezone?: string;
    sessions?: StoredScheduleSession[];
  };
  if (typeof envelope.inputJson !== 'string' || typeof envelope.planJson !== 'string'
    || !Array.isArray(envelope.sessions)) {
    fail('candidate envelope shape');
  }
  const input = JSON.parse(envelope.inputJson) as RoutineInput;
  if (!Array.isArray(input.days) || typeof input.startDate !== 'string' || typeof input.time !== 'string') {
    fail('candidate input shape');
  }
  for (const session of envelope.sessions) {
    if (!session || typeof session.id !== 'string' || typeof session.date !== 'string'
      || !Number.isInteger(session.dayIndex) || !Number.isInteger(session.minutes)
      || typeof session.title !== 'string' || typeof session.status !== 'string'
      || typeof session.logicalId !== 'string' || typeof session.startsAt !== 'string') {
      fail('candidate session shape');
    }
  }
  return { input, sessions: envelope.sessions, timezone: envelope.timezone ?? 'UTC', planJson: envelope.planJson as string };
}

/**
 * Guarded approval entry point (used by the Workflow settle path and by
 * direct tests). Prechecks run first for cheap truthful terminals, then the
 * claim is taken, then commitClaimedProposal performs the all-or-nothing
 * commit batch.
 */
export async function approveProposal(db: Db, args: ApprovalArgs): Promise<ApprovalResult> {
  checkId(args.proposalId, 'proposal');
  if (!Number.isInteger(args.baseRevision) || args.baseRevision < 1) fail('base_revision');
  if (!Number.isInteger(args.evidenceWatermark) || args.evidenceWatermark < 0) {
    fail('evidence_watermark');
  }
  const proposal = await getProposal(db, args.proposalId);
  if (!proposal) return { status: 'stale', proposalId: args.proposalId, reason: 'unknown_proposal' };

  // Double approval is harmless: same binding on a committed proposal replays.
  if (proposal.status === 'committed') {
    const matches = proposal.candidate_hash === args.candidateHash &&
      proposal.base_revision === args.baseRevision &&
      proposal.evidence_watermark === args.evidenceWatermark;
    if (matches) {
      return { status: 'committed', proposalId: proposal.id, revision: proposal.base_revision + 1, idempotent: true };
    }
    return { status: 'stale', proposalId: proposal.id, reason: 'candidate_mismatch' };
  }
  if (proposal.status !== 'awaiting_approval') {
    if (proposal.status === 'committing') {
      return { status: 'stale', proposalId: proposal.id, reason: 'commit_in_progress' };
    }
    const terminal = proposal.status as 'rejected' | 'stale' | 'expired' | 'cancelled' | 'failed';
    return { status: terminal, proposalId: proposal.id, reason: `terminal_${proposal.status}` };
  }
  if (Date.parse(args.nowIso) > Date.parse(proposal.expires_at)) {
    await markTerminal(db, proposal.id, 'expired', args.nowIso);
    return { status: 'expired', proposalId: proposal.id, reason: 'proposal_expired' };
  }
  // Exact candidate binding first: never commit an unreviewed candidate.
  if (proposal.candidate_hash !== args.candidateHash) {
    return { status: 'stale', proposalId: proposal.id, reason: 'candidate_mismatch' };
  }
  if (proposal.base_revision !== args.baseRevision || proposal.evidence_watermark !== args.evidenceWatermark) {
    return { status: 'stale', proposalId: proposal.id, reason: 'binding_mismatch' };
  }

  const scopeKey = scopeKeyFor(proposal.scope, proposal.routine_id ?? undefined, proposal.sandbox_hash ?? undefined);
  const watermark = await getWatermark(db, scopeKey);
  const currentRevision = await currentRevisionOf(db, proposal.scope, proposal.routine_id ?? undefined, proposal.sandbox_hash ?? undefined);
  if (currentRevision === null) {
    // Routine or sandbox was deleted: terminate safely, schedule untouched.
    await markTerminal(db, proposal.id, 'cancelled', args.nowIso);
    return { status: 'cancelled', proposalId: proposal.id, reason: 'scope_deleted' };
  }
  if (currentRevision !== proposal.base_revision) {
    await markTerminal(db, proposal.id, 'stale', args.nowIso);
    return { status: 'stale', proposalId: proposal.id, reason: 'base_revision_changed' };
  }
  if (!watermark || watermark.watermark !== proposal.evidence_watermark || watermark.evidenceHash !== proposal.evidence_hash) {
    await markTerminal(db, proposal.id, 'stale', args.nowIso);
    return { status: 'stale', proposalId: proposal.id, reason: 'evidence_changed' };
  }
  const currentHash = await currentScheduleHash(db, proposal.scope, proposal.routine_id ?? undefined, proposal.sandbox_hash ?? undefined);
  if (currentHash === null || currentHash !== proposal.base_schedule_hash) {
    await markTerminal(db, proposal.id, 'stale', args.nowIso);
    return { status: 'stale', proposalId: proposal.id, reason: 'base_schedule_changed' };
  }

  // Claim the commit slot. Zero rows means a competing approval won.
  const claim = await db
    .prepare("UPDATE adaptation_proposals SET status = 'committing' WHERE id = ? AND status = 'awaiting_approval' AND base_revision = ? AND evidence_watermark = ? AND candidate_hash = ?")
    .bind(proposal.id, proposal.base_revision, proposal.evidence_watermark, proposal.candidate_hash)
    .run();
  if (changesOf(claim) === 0) {
    const latest = await getProposal(db, proposal.id);
    if (latest?.status === 'committed') {
      return { status: 'committed', proposalId: proposal.id, revision: latest.base_revision + 1, idempotent: true };
    }
    return { status: 'stale', proposalId: proposal.id, reason: 'competing_approval' };
  }

  // Post-claim failures must never leave a dangling 'committing' claim that
  // would wedge the scope: any throw below lands the proposal in 'failed'
  // with the canonical schedule untouched.
  try {
    return await commitClaimedProposal(db, proposal, { actor: args.actor, nowIso: args.nowIso, newId: args.newId });
  } catch {
    await markTerminal(db, proposal.id, 'failed', args.nowIso).catch(() => undefined);
    return { status: 'failed', proposalId: proposal.id, reason: 'commit_error' };
  }
}

/**
 * All-or-nothing commit for an already-claimed ('committing') proposal.
 * Every statement repeats the full canonical predicate against pre-batch
 * state (ordered so no earlier write can satisfy a later guard
 * spuriously), so a failed predicate writes zero rows everywhere: no
 * version, no sessions, no audit, no committed marker. Exported for the
 * audit regression that forces the guard to zero rows AFTER the claim.
 */
export async function commitClaimedProposal(
  db: Db,
  proposal: ProposalRow,
  opts: { actor: 'reviewer' | 'owner' | 'system'; nowIso: string; newId?: () => string },
): Promise<ApprovalResult> {
  const newId = opts.newId ?? (() => randomUUID());
  const auditId = `audit-${newId()}`;
  if (!proposal.trace_json) fail('proposal trace missing');
  const candidate = parseCandidateEnvelope(proposal);
  const nextRevision = proposal.base_revision + 1;

  if (proposal.scope === 'sandbox') {
    if (!proposal.sandbox_hash) fail('sandbox scope key');
    const stored = { revision: nextRevision, input: candidate.input, sessions: candidate.sessions };
    const scheduleHash = persistedScheduleHashSync(stored, candidate.timezone);
    const nextScheduleJson = JSON.stringify(stored);
    const sandboxPred = sandboxPredicateSql();
    const sandboxBinds = sandboxPredicateBinds(proposal);
    // The canonical write and the terminal flip also require the proposal to
    // still be unexpired at commit time (closes the precheck-to-batch window).
    const unexpired = 'AND (SELECT expires_at FROM adaptation_proposals WHERE id = ?) > ?';
    const results = await db.batch([
      db
        .prepare(`INSERT INTO adaptation_audit (id, proposal_id, action, actor, created_at, detail_json) SELECT ?, ?, 'committed', ?, ?, ? WHERE ${sandboxPred}`)
        .bind(auditId, proposal.id, opts.actor, opts.nowIso, JSON.stringify({ revision: nextRevision }), ...sandboxBinds),
      db
        .prepare(`UPDATE demo_sandboxes SET current_revision = ?, current_schedule_json = ?, base_schedule_hash = ?, current_trace_json = ? WHERE capability_hash = ? AND ${sandboxPred} ${unexpired}`)
        .bind(nextRevision, nextScheduleJson, scheduleHash, proposal.trace_json, proposal.sandbox_hash, ...sandboxBinds, proposal.id, opts.nowIso),
      // The terminal flip is conditioned on the NEW canonical state (the row
      // this batch just wrote), not the pre-state the earlier guards read:
      // it flips if and only if the canonical write applied.
      db
        .prepare("UPDATE adaptation_proposals SET status = 'committed', resolved_at = ? WHERE id = ? AND status = 'committing' AND base_revision = ? AND evidence_watermark = ? AND candidate_hash = ? AND EXISTS (SELECT 1 FROM demo_sandboxes WHERE capability_hash = ? AND current_revision = ? AND base_schedule_hash = ?) AND (SELECT expires_at FROM adaptation_proposals WHERE id = ?) > ?")
        .bind(opts.nowIso, proposal.id, proposal.base_revision, proposal.evidence_watermark, proposal.candidate_hash, proposal.sandbox_hash, nextRevision, scheduleHash, proposal.id, opts.nowIso),
    ]);
    if (changesOf(results[0]) !== 1 || changesOf(results[1]) !== 1 || changesOf(results[2]) !== 1) {
      await markTerminal(db, proposal.id, 'stale', opts.nowIso);
      return { status: 'stale', proposalId: proposal.id, reason: 'commit_guard_failed' };
    }
    return { status: 'committed', proposalId: proposal.id, revision: nextRevision, idempotent: false };
  }

  // Owner scope. Ordering is load-bearing twice over: the version INSERT
  // carries the pre-state guards (latest-is-base, watermark, claim), while
  // every later statement is conditioned on the NEW version row existing —
  // so a lost race writes zero rows anywhere, and sessions can never
  // reference a version that was not inserted (which would FK-fail and
  // mislabel a clean stale as failed).
  if (!proposal.routine_id) fail('routine scope key');
  if (!proposal.trace_json) fail('proposal trace missing');
  const ownerPred = ownerPredicateSql();
  const ownerBinds = ownerPredicateBinds(proposal);
  const versionId = `version-${newId()}`;
  const versionExists = 'EXISTS (SELECT 1 FROM routine_versions WHERE id = ?)';
  const claimHeld = "EXISTS (SELECT 1 FROM adaptation_proposals WHERE id = ? AND status = 'committing')";
  const unexpired = '(SELECT expires_at FROM adaptation_proposals WHERE id = ?) > ?';
  const statements = [
    db
      .prepare(`UPDATE routines SET updated_at = ? WHERE id = ? AND ${ownerPred}`)
      .bind(opts.nowIso, proposal.routine_id, ...ownerBinds),
    db
      .prepare(`INSERT INTO routine_versions (id, routine_id, version_number, parent_version_id, week_start, timezone, input_json, plan_json, generated_by, created_at, trace_json) SELECT ?, ?, ?, (SELECT id FROM routine_versions WHERE routine_id = ? AND version_number = ?), ?, ?, ?, ?, ?, ?, ? WHERE ${ownerPred} AND ${unexpired}`)
      .bind(
        versionId,
        proposal.routine_id,
        nextRevision,
        proposal.routine_id,
        proposal.base_revision,
        candidate.input.startDate,
        candidate.timezone,
        JSON.stringify(candidate.input),
        candidate.planJson,
        'replan',
        opts.nowIso,
        proposal.trace_json,
        ...ownerBinds,
        proposal.id,
        opts.nowIso,
      ),
    ...candidate.sessions.map((session, ordinal) =>
      db
        .prepare(`INSERT INTO sessions (id, routine_version_id, ordinal, starts_at, scheduled_minutes, title, status, completed_at, note) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${versionExists} AND ${claimHeld}`)
        .bind(
          `${versionId}-s${ordinal}`,
          versionId,
          ordinal,
          session.startsAt,
          session.minutes,
          (session.title ?? '').slice(0, 160),
          session.status === 'planned' ? 'scheduled' : session.status === 'done' ? 'done' : 'missed',
          null,
          null,
          versionId,
          proposal.id,
        ),
    ),
    db
      .prepare(`INSERT INTO adaptation_audit (id, proposal_id, action, actor, created_at, detail_json) SELECT ?, ?, 'committed', ?, ?, ? WHERE ${versionExists} AND ${claimHeld}`)
      .bind(auditId, proposal.id, opts.actor, opts.nowIso, JSON.stringify({ revision: nextRevision, versionId }), versionId, proposal.id),
    db
      .prepare(`UPDATE adaptation_proposals SET status = 'committed', resolved_at = ? WHERE id = ? AND status = 'committing' AND base_revision = ? AND evidence_watermark = ? AND candidate_hash = ? AND ${versionExists} AND ${unexpired}`)
      .bind(opts.nowIso, proposal.id, proposal.base_revision, proposal.evidence_watermark, proposal.candidate_hash, versionId, proposal.id, opts.nowIso),
  ];
  const results = await db.batch(statements);
  if (results.some((result) => changesOf(result) !== 1)) {
    await markTerminal(db, proposal.id, 'stale', opts.nowIso);
    return { status: 'stale', proposalId: proposal.id, reason: 'commit_guard_failed' };
  }
  return { status: 'committed', proposalId: proposal.id, revision: nextRevision, idempotent: false };
}

export async function rejectProposal(
  db: Db,
  args: { proposalId: string; actor: string; nowIso: string },
): Promise<ProposalRow | null> {
  checkId(args.proposalId, 'proposal');
  const proposal = await getProposal(db, args.proposalId);
  if (!proposal || (proposal.status !== 'awaiting_approval' && proposal.status !== 'computing' && proposal.status !== 'queued')) {
    return proposal;
  }
  await db.batch([
    db.prepare("UPDATE adaptation_proposals SET status = 'rejected', resolved_at = ? WHERE id = ? AND status = ?").bind(args.nowIso, args.proposalId, proposal.status),
    db.prepare("INSERT INTO adaptation_audit (id, proposal_id, action, actor, created_at, detail_json) VALUES (?, ?, 'rejected', ?, ?, ?)").bind(`audit-${randomUUID()}`, args.proposalId, args.actor, args.nowIso, '{}'),
  ]);
  return getProposal(db, args.proposalId);
}

export async function cancelProposal(
  db: Db,
  args: { proposalId: string; actor: string; nowIso: string },
): Promise<ProposalRow | null> {
  checkId(args.proposalId, 'proposal');
  const proposal = await getProposal(db, args.proposalId);
  if (!proposal || (proposal.status !== 'awaiting_approval' && proposal.status !== 'computing' && proposal.status !== 'queued')) {
    return proposal;
  }
  await db.batch([
    db.prepare("UPDATE adaptation_proposals SET status = 'cancelled', resolved_at = ? WHERE id = ? AND status = ?").bind(args.nowIso, args.proposalId, proposal.status),
    db.prepare("INSERT INTO adaptation_audit (id, proposal_id, action, actor, created_at, detail_json) VALUES (?, ?, 'cancelled', ?, ?, ?)").bind(`audit-${randomUUID()}`, args.proposalId, args.actor, args.nowIso, '{}'),
  ]);
  return getProposal(db, args.proposalId);
}

/**
 * Settle bookkeeping for the Workflow settle step: move the proposal to a
 * truthful terminal state with an audit row. Never touches canonical
 * schedule rows — committing stays inside commitClaimedProposal.
 */
export async function recordSettlement(
  db: Db,
  args: { proposalId: string; status: ProposalStatus; actor: string; nowIso: string; action: string },
): Promise<void> {
  checkId(args.proposalId, 'proposal');
  await db.batch([
    db
      .prepare('UPDATE adaptation_proposals SET status = ?, resolved_at = ? WHERE id = ?')
      .bind(args.status, args.nowIso, args.proposalId),
    db
      .prepare('INSERT INTO adaptation_audit (id, proposal_id, action, actor, created_at, detail_json) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(`audit-${randomUUID()}`, args.proposalId, args.action, args.actor, args.nowIso, '{}'),
  ]);
}

/** Clear a sandbox's running-workflow reference (terminal states only).
 *  When the expected workflow id is given, only clears if it still matches,
 *  so a late settle can never clobber a newer proposal's reference. */
export async function clearActiveWorkflowRef(db: Db, sandboxHash: string, expectedWorkflowId?: string | null): Promise<void> {
  if (!/^[0-9a-f]{64}$/u.test(sandboxHash)) return;
  if (expectedWorkflowId === undefined) {
    await db
      .prepare('UPDATE demo_sandboxes SET active_workflow_id = NULL WHERE capability_hash = ?')
      .bind(sandboxHash)
      .run()
      .catch(() => undefined);
    return;
  }
  if (!expectedWorkflowId) return;
  await db
    .prepare('UPDATE demo_sandboxes SET active_workflow_id = NULL WHERE capability_hash = ? AND active_workflow_id = ?')
    .bind(sandboxHash, expectedWorkflowId)
    .run()
    .catch(() => undefined);
}

export async function expireProposals(db: Db, nowIso: string): Promise<number> {  const { results } = await db
    .prepare("SELECT id FROM adaptation_proposals WHERE status IN ('queued', 'computing', 'awaiting_approval') AND expires_at < ?")
    .bind(nowIso)
    .all<{ id: string }>();
  for (const row of results) {
    await markTerminal(db, row.id, 'expired', nowIso);
  }
  return results.length;
}

/**
 * Factual before/after diff. Movement is reported as a logical-identity
 * occurrence pair — never as a row id that "moved" while that same id still
 * exists on its original date. `move` is null when no replacement exists.
 */
export function buildDiff(
  baseSessions: Array<{ id: string; date: string }>,
  candidateSessions: Array<{ id: string; date: string }>,
  move: {
    logicalId: string;
    fromSessionId: string;
    fromDate: string;
    toSessionId: string;
    toDate: string;
  } | null,
  locked: Record<string, unknown>,
): Record<string, unknown> {
  const baseIds = new Set(baseSessions.map((session) => session.id));
  const candidateIds = new Set(candidateSessions.map((session) => session.id));
  return {
    moved: move
      ? [{
        logicalId: move.logicalId,
        from: { sessionId: move.fromSessionId, date: move.fromDate },
        to: { sessionId: move.toSessionId, date: move.toDate },
      }]
      : [],
    added: candidateSessions.filter((session) => !baseIds.has(session.id)),
    removed: [],
    preserved: baseSessions.filter((session) => candidateIds.has(session.id)).map((session) => session.id),
    locked,
  };
}

export function sha256HexSync(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
