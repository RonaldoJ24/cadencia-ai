// Adaptation Workflow coordinator. D1 stays authoritative; Workflow state
// is diagnostics only.
//
// Settlement ownership: the HTTP layer only RECORDS a human decision
// (adaptation_decisions) and notifies. It never commits a schedule. After
// waking, the Workflow rereads the persisted decision plus authoritative
// proposal/schedule/evidence state and commits or marks stale through the
// same guarded path. Event payloads carry only stable identifiers; all
// binding fields live in D1.

import { validateIntent } from '../routine.ts';
import {
  ACTIVE_PROPOSAL_STATUSES,
  approveProposal,
  cancelProposal,
  createProposal,
  getDecision,
  getProposal,
  persistDecision,
  recordSettlement,
  rejectProposal,
  clearActiveWorkflowRef,
  evidenceHashFor,
  scopeKeyFor,
  type ProposalRow,
} from './adaptation.ts';
import {
  deriveFixtureAdaptation,
  fixtureCompile,
  FIXTURE_NOW_ISO,
  FIXTURE_TIMEZONE,
} from './fixture.ts';
import { ADAPT_POLICY_VERSION, PLANNER_VERSION, scheduleHashSync } from '../trace.ts';
import { baseLogicalIds, buildPlanTraceForCandidate } from './workflow-plan.ts';
import { releaseDailyBudget, reserveDailyBudget } from './sandbox.ts';
import type { PlannerEvent } from '../routine.ts';

export type WorkflowParams = {
  proposalId: string;
  scope: 'owner' | 'sandbox';
  routineId?: string;
  sandboxHash?: string;
};

/** Minimal wake payload: stable identifiers only. Bindings live in D1. */
export type DecisionEvent = {
  proposalId: string;
  decision: 'approved' | 'rejected' | 'cancelled';
};

export type WorkflowPorts = {
  /** Start one Workflow instance. Params must be IDs only (asserted in tests). */
  createWorkflow: (params: WorkflowParams) => Promise<void>;
  /** Notify the waiting Workflow. May throw (lost notification is retryable). */
  sendEvent: (envelope: { workflowId: string; type: string; payload: DecisionEvent }) => Promise<void>;
  newId?: () => string;
};

export const DECISION_EVENT_TYPE = 'adaptation-decision';

function fail(message: string): never {
  throw new Error(`cadencia_workflow_invalid: ${message}`);
}

function checkId(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) fail(`${label} id`);
  if (!/^[A-Za-z0-9:_-]+$/u.test(value)) fail(`${label} id charset`);
  return value;
}

export async function activeProposalForSandbox(db: import('./db.ts').Db, sandboxHash: string): Promise<ProposalRow | null> {
  checkId(sandboxHash, 'sandbox');
  return db
    .prepare('SELECT id, scope, routine_id, sandbox_hash, base_revision, base_schedule_hash, evidence_watermark, evidence_hash, planner_version, policy_version, candidate_json, candidate_hash, diff_json, trace_json, status, workflow_id, actor, created_at, expires_at, resolved_at FROM adaptation_proposals WHERE sandbox_hash = ? AND status IN (\'queued\', \'computing\', \'awaiting_approval\', \'committing\') ORDER BY created_at DESC LIMIT 1')
    .bind(sandboxHash)
    .first<ProposalRow>();
}

export type WorkflowBudget = { day: string; cap: number };

export type AdaptationRequest = {
  scope: 'owner' | 'sandbox';
  routineId?: string;
  sandboxHash?: string;
  actor: 'reviewer' | 'owner' | 'system';
  nowIso: string;
  expiresAt: string;
  proposalId?: string;
  workflowId?: string;
  /** Sandbox Workflow budget, reserved only after winning the insert. */
  workflowBudget?: WorkflowBudget;
};

/**
 * Queue one adaptation proposal and start one Workflow instance.
 * One-active-per-sandbox is enforced by D1 (partial unique index); a lost
 * race surfaces as a constraint error mapped to 'workflow already active'.
 * The Workflow budget is reserved only after the insert wins, so losers
 * consume nothing. A Workflow creation failure compensates: the queued
 * proposal is cancelled (never wedged) and the budget slot refunded.
 */
export async function requestAdaptation(
  db: import('./db.ts').Db,
  ports: WorkflowPorts,
  args: AdaptationRequest,
): Promise<ProposalRow> {
  if (args.scope === 'sandbox') {
    if (!args.sandboxHash) fail('sandbox hash');
    const active = await activeProposalForSandbox(db, args.sandboxHash as string);
    if (active) fail('workflow already active');
    const sandbox = await db
      .prepare('SELECT current_revision AS revision, base_schedule_hash AS scheduleHash, evidence_watermark AS watermark, evidence_hash AS evidenceHash, revoked FROM demo_sandboxes WHERE capability_hash = ? LIMIT 1')
      .bind(args.sandboxHash)
      .first<{ revision: number; scheduleHash: string; watermark: number; evidenceHash: string; revoked: number }>();
    if (!sandbox || sandbox.revoked) fail('sandbox unavailable');
    let proposal: ProposalRow;
    try {
      proposal = await createProposal(db, {
        id: args.proposalId,
        scope: 'sandbox',
        sandboxHash: args.sandboxHash,
        baseRevision: sandbox.revision,
        baseScheduleHash: sandbox.scheduleHash,
        evidenceWatermark: sandbox.watermark,
        evidenceHash: sandbox.evidenceHash,
        plannerVersion: PLANNER_VERSION,
        policyVersion: ADAPT_POLICY_VERSION,
        candidate: { pending: true },
        diff: { pending: true },
        workflowId: args.workflowId ?? `workflow-${(ports.newId ?? (() => 'local'))()}`,
        actor: args.actor,
        nowIso: args.nowIso,
        expiresAt: args.expiresAt,
        initialStatus: 'queued',
      });
    } catch (error) {
      if (error instanceof Error && /UNIQUE|unique|constraint/i.test(error.message)) {
        fail('workflow already active');
      }
      throw error;
    }
    if (args.workflowBudget) {
      const held = await reserveDailyBudget(db, 'reviewer_workflow', args.workflowBudget.day, args.workflowBudget.cap);
      if (!held) {
        await cancelProposal(db, { proposalId: proposal.id, actor: 'system', nowIso: args.nowIso }).catch(() => undefined);
        fail('workflow budget exhausted');
      }
    }
    try {
      await ports.createWorkflow({
        proposalId: proposal.id,
        scope: 'sandbox',
        sandboxHash: args.sandboxHash,
      });
    } catch (error) {
      // Compensate: never leave a queued proposal wedged behind a Workflow
      // that will never run. Budget slot refunded best-effort.
      await cancelProposal(db, { proposalId: proposal.id, actor: 'system', nowIso: args.nowIso }).catch(() => undefined);
      if (args.workflowBudget) {
        await releaseDailyBudget(db, 'reviewer_workflow', args.workflowBudget.day).catch(() => undefined);
      }
      const wrapped = new Error('cadencia_workflow_invalid: workflow start failed');
      (wrapped as { cause?: unknown }).cause = error;
      throw wrapped;
    }
    return proposal;
  }
  if (!args.routineId) fail('routine id');
  const current = await db
    .prepare('SELECT MAX(version_number) AS revision FROM routine_versions WHERE routine_id = ?')
    .bind(args.routineId)
    .first<{ revision: number | null }>();
  if (typeof current?.revision !== 'number') fail('routine unavailable');
  const base = await db
    .prepare('SELECT plan_json AS planJson, timezone FROM routine_versions WHERE routine_id = ? ORDER BY version_number DESC LIMIT 1')
    .bind(args.routineId)
    .first<{ planJson: string; timezone: string }>();
  if (!base) fail('routine unavailable');
  const baseScheduleHash = scheduleHashSync(
    JSON.parse((base as { planJson: string }).planJson) as Parameters<typeof scheduleHashSync>[0],
    (base as { timezone: string }).timezone,
  );
  const scopeKey = scopeKeyFor('owner', args.routineId);
  const watermark = await db
    .prepare('SELECT watermark, evidence_hash AS evidenceHash FROM evidence_watermarks WHERE scope_key = ? LIMIT 1')
    .bind(scopeKey)
    .first<{ watermark: number; evidenceHash: string }>();
  const evidenceHash = watermark?.evidenceHash ?? evidenceHashFor({ routine: args.routineId });
  const evidenceWatermark = watermark?.watermark ?? 0;
  if (!watermark) {
    // First adaptation for this routine: seed the monotonic watermark so a
    // later approval has a current value to bind against.
    await db
      .prepare('INSERT INTO evidence_watermarks (scope_key, watermark, evidence_hash, updated_at) VALUES (?, 0, ?, ?) ON CONFLICT (scope_key) DO NOTHING')
      .bind(scopeKey, evidenceHash, args.nowIso)
      .run();
  }
  const proposal = await createProposal(db, {
    id: args.proposalId,
    scope: 'owner',
    routineId: args.routineId,
    baseRevision: current.revision as number,
    baseScheduleHash,
    evidenceWatermark,
    evidenceHash,
    plannerVersion: PLANNER_VERSION,
    policyVersion: ADAPT_POLICY_VERSION,
    candidate: { pending: true },
    diff: { pending: true },
    workflowId: args.workflowId ?? `workflow-${(ports.newId ?? (() => 'local'))()}`,
    actor: args.actor,
    nowIso: args.nowIso,
    expiresAt: args.expiresAt,
    initialStatus: 'queued',
  });
  await ports.createWorkflow({
    proposalId: proposal.id,
    scope: 'owner',
    routineId: args.routineId,
  });
  return proposal;
}

export type MaterializeArgs = {
  proposalId: string;
  nowIso: string;
  /** Private connected mode only: validated AI content proposal (never dates). */
  aiIntent?: unknown;
  missedSessionId?: string;
};

/**
 * Derive the candidate through the deterministic planner and persist
 * awaiting_approval with the trace captured from the engine's own events.
 * Duplicate execution replays the stored candidate.
 */
export async function materializeCandidate(
  db: import('./db.ts').Db,
  args: MaterializeArgs,
): Promise<ProposalRow> {
  checkId(args.proposalId, 'proposal');
  const proposal = await getProposal(db, args.proposalId);
  if (!proposal) fail('unknown proposal');
  const current = proposal as ProposalRow;
  if (current.status === 'awaiting_approval' && !(JSON.parse(current.candidate_json) as { pending?: boolean }).pending) {
    return current;
  }
  if (current.status !== 'queued' && current.status !== 'computing') return current;

  await db
    .prepare("UPDATE adaptation_proposals SET status = 'computing' WHERE id = ? AND status = 'queued'")
    .bind(args.proposalId)
    .run();

  if (current.scope === 'sandbox') {
    const { plan } = fixtureCompile('en');
    const events: PlannerEvent[] = [];
    const derived = deriveFixtureAdaptation(plan, (event) => {
      events.push(event);
    });
    if (!derived.feasible || !derived.candidate || !derived.missedId || !derived.movedFrom || !derived.movedTo) {
      await db.prepare("UPDATE adaptation_proposals SET status = 'failed', resolved_at = ? WHERE id = ?").bind(args.nowIso, args.proposalId).run();
      const failed = await getProposal(db, args.proposalId);
      if (!failed) fail('proposal lost');
      return failed as ProposalRow;
    }
    const confirmation = [...events].reverse().find((event) => event.type === 'adaptation_candidate_confirmed');
    if (!confirmation || confirmation.type !== 'adaptation_candidate_confirmed') fail('planner emitted no confirmation');
    const built = buildPlanTraceForCandidate({
      candidate: derived.candidate,
      confirmation,
      baseSessions: plan.sessions.map((session) => ({ id: session.id, date: session.date })),
      logicalById: baseLogicalIds(plan.sessions.map((session) => ({ id: session.id }))),
      missedSessionId: derived.missedId,
      timezone: FIXTURE_TIMEZONE,
    });
    await db.prepare("UPDATE adaptation_proposals SET candidate_json = ?, candidate_hash = ?, diff_json = ?, trace_json = ?, base_schedule_hash = ?, status = 'awaiting_approval' WHERE id = ? AND status = 'computing'")
      .bind(JSON.stringify(built.candidate), built.candidateHash, JSON.stringify(built.diff), JSON.stringify(built.trace), current.base_schedule_hash, args.proposalId)
      .run();
    const stored = await getProposal(db, args.proposalId);
    if (!stored) fail('proposal lost');
    return stored;
  }

  // Owner scope: deterministic planner over validated content only.
  const detail = await db
    .prepare('SELECT plan_json AS planJson, timezone, trace_json AS traceJson FROM routine_versions WHERE routine_id = ? ORDER BY version_number DESC LIMIT 1')
    .bind(current.routine_id)
    .first<{ planJson: string; timezone: string; traceJson: string | null }>();
  if (!detail) {
    await db.prepare("UPDATE adaptation_proposals SET status = 'cancelled', resolved_at = ? WHERE id = ?").bind(args.nowIso, args.proposalId).run();
    const cancelled = await getProposal(db, args.proposalId);
    if (!cancelled) fail('proposal lost');
    return cancelled as ProposalRow;
  }
  const { replan } = await import('../routine.ts');
  const storedPlan = JSON.parse(detail.planJson) as Parameters<typeof replan>[0];
  const missedId = args.missedSessionId ?? storedPlan.sessions[0]?.id;
  if (!missedId) fail('missed session');
  const events: PlannerEvent[] = [];
  const push = (event: PlannerEvent) => {
    events.push(event);
  };
  let candidate;
  try {
    candidate = args.aiIntent !== undefined
      ? replan({ ...storedPlan, intent: validateIntent(args.aiIntent) }, missedId, push)
      : replan(storedPlan, missedId as string, push);
  } catch {
    await db.prepare("UPDATE adaptation_proposals SET status = 'failed', resolved_at = ? WHERE id = ?").bind(args.nowIso, args.proposalId).run();
    const failed = await getProposal(db, args.proposalId);
    if (!failed) fail('proposal lost');
    return failed as ProposalRow;
  }
  const confirmation = [...events].reverse().find((event) => event.type === 'adaptation_candidate_confirmed');
  if (!confirmation || confirmation.type !== 'adaptation_candidate_confirmed') fail('planner emitted no confirmation');
  let traceActivityById: Map<string, string> | undefined;
  try {
    const baseTrace = detail.traceJson ? (JSON.parse(detail.traceJson) as { sessions?: Array<{ sessionId?: string; activityId?: string }> }) : null;
    if (baseTrace?.sessions) {
      traceActivityById = new Map(
        baseTrace.sessions
          .filter((entry) => typeof entry.sessionId === 'string' && typeof entry.activityId === 'string')
          .map((entry) => [entry.sessionId as string, entry.activityId as string]),
      );
    }
  } catch {
    traceActivityById = undefined;
  }
  const built = buildPlanTraceForCandidate({
    candidate,
    confirmation,
    baseSessions: storedPlan.sessions.map((session) => ({ id: session.id, date: session.date })),
    logicalById: baseLogicalIds(storedPlan.sessions.map((session) => ({ id: session.id })), traceActivityById),
    missedSessionId: missedId as string,
    timezone: detail.timezone,
  });
  await db.prepare("UPDATE adaptation_proposals SET candidate_json = ?, candidate_hash = ?, diff_json = ?, trace_json = ?, status = 'awaiting_approval' WHERE id = ? AND status = 'computing'")
    .bind(JSON.stringify(built.candidate), built.candidateHash, JSON.stringify(built.diff), JSON.stringify(built.trace), args.proposalId)
    .run();
  const stored = await getProposal(db, args.proposalId);
  if (!stored) fail('proposal lost');
  return stored;
}

export type DecideArgs = {
  proposalId: string;
  decision: 'approved' | 'rejected' | 'cancelled';
  candidateHash: string;
  baseRevision: number;
  evidenceWatermark: number;
  actor: 'reviewer' | 'owner' | 'system';
  nowIso: string;
};

/**
 * Record the human decision first, then notify the Workflow. The HTTP layer
 * never commits a schedule: committing belongs to settleAdaptation (the
 * Workflow's settle step, or the labeled local-fallback inline settle).
 * Notification failures are retryable; duplicates settle idempotently.
 */
export async function decideAdaptation(
  db: import('./db.ts').Db,
  ports: WorkflowPorts,
  args: DecideArgs,
): Promise<{ persisted: 'decision_recorded' | 'duplicate' | 'stale' | 'expired'; notified: boolean; reason?: string }> {
  checkId(args.proposalId, 'proposal');
  const persisted = await persistDecision(db, {
    proposalId: args.proposalId,
    decision: args.decision,
    candidateHash: args.candidateHash,
    baseRevision: args.baseRevision,
    evidenceWatermark: args.evidenceWatermark,
    actor: args.actor,
    nowIso: args.nowIso,
  });
  if (persisted.status !== 'recorded' && persisted.status !== 'duplicate') {
    return { persisted: persisted.status, notified: false, reason: persisted.reason };
  }
  const proposal = await getProposal(db, args.proposalId);
  try {
    await ports.sendEvent({
      workflowId: proposal?.workflow_id ?? 'unknown-workflow',
      type: DECISION_EVENT_TYPE,
      payload: { proposalId: args.proposalId, decision: args.decision },
    });
    return { persisted: persisted.status === 'recorded' ? 'decision_recorded' : 'duplicate', notified: true };
  } catch {
    return { persisted: persisted.status === 'recorded' ? 'decision_recorded' : 'duplicate', notified: false };
  }
}

export type SettleArgs = {
  proposalId: string;
  nowIso: string;
  newId?: () => string;
};

/**
 * Workflow settle step: reload authoritative D1 state and settle from the
 * PERSISTED decision (never from event payload contents). Commit is
 * idempotent: a retry after a successful commit discovers the committed
 * candidate and finishes. With no persisted decision the pending proposal
 * expires (the wait-timeout path); already-terminal proposals replay.
 */
export async function settleAdaptation(
  db: import('./db.ts').Db,
  args: SettleArgs,
): Promise<{ status: string; revision: number | null }> {
  checkId(args.proposalId, 'proposal');
  const proposal = await getProposal(db, args.proposalId);
  if (!proposal) return { status: 'cancelled', revision: null };
  if (proposal.status === 'committed') return { status: 'committed', revision: proposal.base_revision + 1 };
  const clearRefs = async () => {
    if (proposal.scope === 'sandbox' && proposal.sandbox_hash) {
      await clearActiveWorkflowRef(db, proposal.sandbox_hash, proposal.workflow_id).catch(() => undefined);
    }
  };
  const decision = await getDecision(db, args.proposalId);
  if (!decision) {
    if (!(ACTIVE_PROPOSAL_STATUSES as readonly string[]).includes(proposal.status)) {
      return { status: proposal.status, revision: null };
    }
    await recordSettlement(db, {
      proposalId: proposal.id,
      status: 'expired',
      actor: 'system',
      nowIso: args.nowIso,
      action: 'settled_expired',
    });
    await clearRefs();
    return { status: 'expired', revision: null };
  }
  if (decision.decision === 'approved') {
    const result = await approveProposal(db, {
      proposalId: args.proposalId,
      candidateHash: decision.candidate_hash,
      baseRevision: decision.base_revision,
      evidenceWatermark: decision.evidence_watermark,
      actor: decision.actor as 'reviewer' | 'owner' | 'system',
      nowIso: args.nowIso,
      newId: args.newId,
    });
    await recordSettlement(db, {
      proposalId: proposal.id,
      status: result.status === 'committed' ? 'committed' : result.status,
      actor: decision.actor,
      nowIso: args.nowIso,
      action: result.status === 'committed' ? 'settled_committed' : `settled_${result.status}`,
    }).catch(() => undefined);
    await clearRefs();
    return { status: result.status, revision: result.status === 'committed' ? result.revision : null };
  }
  if (decision.decision === 'rejected') {
    const row = await rejectProposal(db, { proposalId: args.proposalId, actor: decision.actor, nowIso: args.nowIso });
    await clearRefs();
    return { status: row?.status ?? 'rejected', revision: null };
  }
  const row = await cancelProposal(db, { proposalId: args.proposalId, actor: decision.actor, nowIso: args.nowIso });
  await clearRefs();
  return { status: row?.status ?? 'cancelled', revision: null };
}

export { FIXTURE_NOW_ISO, FIXTURE_TIMEZONE };
