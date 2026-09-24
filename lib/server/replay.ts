// Reviewer Replay handlers on the exact /api/routine path. Anonymous demo
// behavior stays on POST (explicit start flag), GET (cookie-scoped state),
// and PATCH (allowlisted fixture event + approve/reject). Owner compile
// behavior is untouched. Every replay response is private, no-store, and
// never carries the raw capability except in the Set-Cookie transport.
//
// Settlement ownership: PATCH approve/reject only RECORD the human decision
// and notify. Committing belongs to the Workflow settle step (or the
// labeled local-fallback inline settle). State-changing requests require a
// present, same-origin Origin header — absent or foreign origins fail
// closed (reads via GET keep the lenient same-origin check).

import { randomUUID } from 'node:crypto';
import { bodyJson, dict, errorResponse, json } from './http.ts';
import { checkRateLimit, fnv1aHex, trustedIp } from './ratelimit.ts';
import { fixtureCompile } from './fixture.ts';
import type { CompileTrace } from '../trace.ts';
import {
  activeProposalForSandbox,
  decideAdaptation,
  materializeCandidate,
  requestAdaptation,
  settleAdaptation,
  type WorkflowPorts,
} from './workflow-coord.ts';
import { getProposal, requireProofSchema, type ProposalRow } from './adaptation.ts';
import {
  CAPABILITY_MINUTE_LIMIT,
  GLOBAL_WORKFLOW_DAILY_CAP,
  PROPOSAL_TTL_MS,
  REPLAY_COOKIE,
  REPLAY_EVENT_ALLOWLIST,
  capabilityFromRequest,
  cleanupExpired,
  cookieHeader,
  createSandbox,
  expiredCookieHeader,
  getSandboxByCapability,
  hashCapability,
  safeReplayCurlExample,
  type SandboxRow,
} from './sandbox.ts';
import type { Db } from './db.ts';

const EVENT = 'cadencia_replay_failure';
const NO_STORE: Record<string, string> = { 'cache-control': 'private, no-store' };

export type ReplayDeps = {
  db: Db;
  env?: Record<string, unknown>;
  nowIso: string;
  nowMs: number;
  /** Injected Workflow ports (tests/fallback). Null means local synchronous fallback. */
  workflowPorts?: WorkflowPorts | null;
  workflowBackend?: 'cloudflare' | 'local-fallback';
};

function fail(message: string, status: number, reason: string): Response {
  return errorResponse(message, status, reason, undefined, undefined, EVENT, { ...NO_STORE });
}

function isSchemaError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('proof schema');
}

function schemaUnavailable(): Response {
  return errorResponse('Replay storage is not ready.', 503, 'persistence_not_ready', undefined, undefined, EVENT, { ...NO_STORE });
}

function ipHashOf(request: Request): string | null {
  const ip = trustedIp(request);
  if (!ip) return null;
  return fnv1aHex(`replay:${ip}`);
}

function originOf(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

/**
 * Strict origin for state-changing replay requests: the Origin header must
 * be present and equal the target origin. No referer fallback, no absent
 * allowance — unlike reads, writes never accept an unattributed client.
 */
function requireOrigin(request: Request): boolean {
  try {
    const target = new URL(request.url).origin;
    const origin = request.headers.get('origin');
    return !!origin && origin === target;
  } catch {
    return false;
  }
}

/** Trace of the currently persisted revision, from D1 — never rebuilt. */
function currentRevisionTrace(sandbox: SandboxRow): CompileTrace {
  try {
    if (sandbox.current_trace_json) {
      const stored = JSON.parse(sandbox.current_trace_json) as Partial<CompileTrace>;
      if (stored && Array.isArray(stored.stages) && Array.isArray(stored.sessions)) {
        return stored as CompileTrace;
      }
    }
  } catch {
    // Fall through to the R1 fixture trace below.
  }
  return fixtureCompile('en').trace;
}

export function replayStatePayload(
  sandbox: SandboxRow,
  proposal: ProposalRow | null,
  origin: string,
  opts: { serverMs?: number; responseId?: string } = {},
) {
  const schedule = JSON.parse(sandbox.current_schedule_json) as {
    revision: number;
    input: Record<string, unknown>;
    sessions: Array<Record<string, unknown>>;
  };
  const trace = currentRevisionTrace(sandbox);
  const candidate = proposal && !(JSON.parse(proposal.candidate_json) as { pending?: boolean }).pending
    ? {
      id: proposal.id,
      status: proposal.status,
      baseRevision: proposal.base_revision,
      baseScheduleHash: proposal.base_schedule_hash,
      evidenceWatermark: proposal.evidence_watermark,
      candidateHash: proposal.candidate_hash,
      diff: JSON.parse(proposal.diff_json) as unknown,
      candidate: JSON.parse(proposal.candidate_json) as unknown,
      workflowId: undefined,
      expiresAt: proposal.expires_at,
    }
    : null;
  // The displayed schedule fingerprint always tracks the persisted canonical
  // schedule: R1 hash before approval, content hash of persisted R2 after.
  const scheduleHash = sandbox.base_schedule_hash;
  return {
    replay: true,
    sandbox: {
      revision: sandbox.current_revision,
      expiresAt: sandbox.expires_at,
      hasActiveProposal: proposal !== null &&
        (proposal.status === 'queued' || proposal.status === 'computing' || proposal.status === 'awaiting_approval' || proposal.status === 'committing'),
    },
    routine: schedule,
    proposal: candidate,
    proposalStatus: proposal?.status ?? null,
    trace,
    revisionStages: revisionStagesFor(sandbox, proposal),
    hashes: {
      inputHash: trace.inputHash,
      scheduleHash,
      candidateHash: candidate?.candidateHash ?? null,
    },
    meta: {
      modelUsed: false,
      provider: 'skipped',
      plannerVersion: trace.plannerVersion,
      policyVersion: trace.policyVersion,
      simulatedEvidence: true,
      ...(opts.responseId ? { responseId: opts.responseId } : {}),
      ...(typeof opts.serverMs === 'number' ? { serverMs: opts.serverMs } : {}),
    },
    curl: safeReplayCurlExample(origin),
  };
}

export type RevisionStage = {
  stage: 'revision_persisting' | 'revision_persisted';
  revision: number;
};

/**
 * Revision lifecycle stages reached so far, derived only from persisted
 * backend state (never animated ahead): R1's persistence is evidenced by
 * reading it from D1; persisting appears while committing or committed.
 */
export function revisionStagesFor(sandbox: SandboxRow, proposal: ProposalRow | null): RevisionStage[] {
  const stages: RevisionStage[] = [{ stage: 'revision_persisted', revision: 1 }];
  if (!proposal) return stages;
  if (proposal.status === 'committing' || proposal.status === 'committed') {
    stages.push({ stage: 'revision_persisting', revision: proposal.base_revision + 1 });
  }
  if (proposal.status === 'committed') {
    stages.push({ stage: 'revision_persisted', revision: proposal.base_revision + 1 });
  }
  return stages;
}

/** POST with {replay:'start'} initializes Reviewer Replay. All else falls through.
 *  The body arrives pre-read (single bounded read in the route; never clone
 *  the request — cancelling a cloned tee branch can stall the handler). */
export async function handleReplayStart(request: Request, deps: ReplayDeps, rawText: string): Promise<Response | null> {
  const startedMs = Date.now();
  let value: Record<string, unknown> | null;
  try {
    value = dict(JSON.parse(rawText));
  } catch {
    return null;
  }
  if (!value || value.replay !== 'start') return null;
  if (!requireOrigin(request)) return fail('Origin not allowed.', 403, 'invalid_origin');
  const ipHash = ipHashOf(request);
  if (!ipHash) return fail('Valid client IP is required.', 400, 'missing_client_ip');
  const startLimit = await checkRateLimit(deps.db, {
    key: `ip:${ipHash}:replay_start`,
    scope: 'public_demo',
    nowMs: deps.nowMs,
    limitOverride: 5,
  });
  if (!startLimit.allowed) {
    return errorResponse('Too many requests.', 429, 'rate_limited', undefined, undefined, EVENT, {
      ...NO_STORE,
      'retry-after': String(startLimit.retryAfterSec),
    });
  }
  try {
    await requireProofSchema(deps.db);
    const { raw, sandbox } = await createSandbox(deps.db, { ipHash, nowIso: deps.nowIso, nowMs: deps.nowMs });
    const payload = telemetrize(replayStatePayload(sandbox, null, originOf(request)), startedMs);
    const maxAgeSec = Math.max(1, Math.floor((Date.parse(sandbox.expires_at) - deps.nowMs) / 1000));
    return json(payload, 201, undefined, {
      ...NO_STORE,
      'set-cookie': cookieHeader(raw, request.url, maxAgeSec),
    });
  } catch (error) {
    if (isSchemaError(error)) return schemaUnavailable();
    const message = error instanceof Error ? error.message : '';
    if (message.includes('budget') || message.includes('quota')) {
      return fail('Too many requests.', 429, 'replay_budget_exhausted');
    }
    throw error;
  }
}

export async function handleReplayGet(request: Request, deps: ReplayDeps): Promise<Response | null> {
  const startedMs = Date.now();
  const raw = capabilityFromRequest(request);
  if (!raw) return null;
  try {
    await requireProofSchema(deps.db);
  } catch {
    return schemaUnavailable();
  }
  const sandbox = await getSandboxByCapability(deps.db, raw, deps.nowIso);
  if (!sandbox) {
    return json(
      { replay: true, status: 'expired', message: 'Replay session expired or revoked. Start a new one.' },
      401,
      undefined,
      { ...NO_STORE, 'set-cookie': expiredCookieHeader() },
    );
  }
  await cleanupExpired(deps.db, deps.nowIso).catch(() => undefined);
  const sandboxHash = hashCapability(raw);
  const readLimit = await checkRateLimit(deps.db, {
    key: `cap:${sandboxHash}:replay_read`,
    scope: 'read',
    nowMs: deps.nowMs,
    limitOverride: 60,
  });
  if (!readLimit.allowed) {
    return errorResponse('Too many requests.', 429, 'rate_limited', undefined, undefined, EVENT, {
      ...NO_STORE,
      'retry-after': String(readLimit.retryAfterSec),
    });
  }
  const proposal = await activeProposalForSandbox(deps.db, sandboxHash).catch(() => null);
  const terminal = proposal ? null : await latestTerminalProposal(deps.db, sandboxHash);
  return json(telemetrize(replayStatePayload(sandbox, proposal ?? terminal, originOf(request)), startedMs), 200, undefined, { ...NO_STORE });
}

async function latestTerminalProposal(db: Db, sandboxHash: string): Promise<ProposalRow | null> {
  return db
    .prepare('SELECT id, scope, routine_id, sandbox_hash, base_revision, base_schedule_hash, evidence_watermark, evidence_hash, planner_version, policy_version, candidate_json, candidate_hash, diff_json, trace_json, status, workflow_id, actor, created_at, expires_at, resolved_at FROM adaptation_proposals WHERE sandbox_hash = ? ORDER BY created_at DESC LIMIT 1')
    .bind(sandboxHash)
    .first<ProposalRow>();
}

export type PatchAction = (typeof REPLAY_EVENT_ALLOWLIST)[number];

function localPorts(): WorkflowPorts {
  return {
    createWorkflow: async () => undefined,
    sendEvent: async () => undefined,
    newId: () => `local-${Date.now().toString(36)}`,
  };
}

/** Measured handler telemetry: opaque response ID + elapsed server ms. */
function telemetrize<T extends { meta: Record<string, unknown> }>(payload: T, startedMs: number): T {
  return {
    ...payload,
    meta: { ...payload.meta, responseId: randomUUID(), serverMs: Math.max(0, Date.now() - startedMs) },
  };
}

/** PATCH allowlist: fixed fixture event, approve, reject. Nothing else.
 *  Method-override headers (x-http-method-override and variants) are never
 *  read on this boundary: dispatch is by the actual HTTP method only. */
export async function handleReplayPatch(request: Request, deps: ReplayDeps): Promise<Response> {
  try {
    return await handleReplayPatchInner(request, deps);
  } catch (error) {
    if (isSchemaError(error)) return schemaUnavailable();
    throw error;
  }
}

async function handleReplayPatchInner(request: Request, deps: ReplayDeps): Promise<Response> {
  const startedMs = Date.now();
  await requireProofSchema(deps.db);
  if (!requireOrigin(request)) return fail('Origin not allowed.', 403, 'invalid_origin');
  const raw = capabilityFromRequest(request);
  if (!raw) return fail('Authentication required.', 401, 'missing_capability');
  const sandbox = await getSandboxByCapability(deps.db, raw, deps.nowIso);
  if (!sandbox) {
    return json(
      { replay: true, status: 'expired', message: 'Replay session expired or revoked. Start a new one.' },
      401,
      undefined,
      { ...NO_STORE, 'set-cookie': expiredCookieHeader() },
    );
  }
  const sandboxHash = hashCapability(raw);
  const capLimit = await checkRateLimit(deps.db, {
    key: `cap:${sandboxHash}:replay`,
    scope: 'write',
    nowMs: deps.nowMs,
    limitOverride: CAPABILITY_MINUTE_LIMIT,
  });
  if (!capLimit.allowed) {
    return errorResponse('Too many requests.', 429, 'rate_limited', undefined, undefined, EVENT, {
      ...NO_STORE,
      'retry-after': String(capLimit.retryAfterSec),
    });
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await bodyJson(request);
    const asDict = dict(parsed);
    if (!asDict) return fail('Invalid request body.', 400, 'invalid_body');
    body = asDict;
  } catch {
    return fail('Invalid request body.', 400, 'invalid_body');
  }
  const action = body.action;
  if (typeof action !== 'string' || !(REPLAY_EVENT_ALLOWLIST as readonly string[]).includes(action)) {
    return fail('Unknown replay action.', 400, 'unknown_action');
  }
  const ports = deps.workflowPorts ?? localPorts();
  const backend = deps.workflowPorts ? (deps.workflowBackend ?? 'cloudflare') : 'local-fallback';

  if (action === 'replay-missed-tuesday') {
    const existing = await activeProposalForSandbox(deps.db, sandboxHash);
    if (existing) return fail('A replay is already in progress.', 409, 'workflow_already_active');
    const day = deps.nowIso.slice(0, 10);
    const proposalId = `proposal-${sandbox.current_revision}-${deps.nowMs.toString(36)}-${randomUUID().slice(0, 8)}`;
    const workflowId = `workflow-${proposalId}`;
    let queued;
    try {
      queued = await requestAdaptation(deps.db, ports, {
        scope: 'sandbox',
        sandboxHash,
        actor: 'reviewer',
        nowIso: deps.nowIso,
        expiresAt: new Date(deps.nowMs + PROPOSAL_TTL_MS).toISOString(),
        proposalId,
        workflowId,
        workflowBudget: { day, cap: GLOBAL_WORKFLOW_DAILY_CAP },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('budget')) return fail('Too many requests.', 429, 'workflow_budget_exhausted');
      if (message.includes('already active')) return fail('A replay is already in progress.', 409, 'workflow_already_active');
      throw error;
    }
    // Local fallback runs the derive step synchronously; the real Workflow
    // binding materializes asynchronously through the same coordinator.
    if (!deps.workflowPorts) {
      await materializeCandidate(deps.db, { proposalId: queued.id, nowIso: deps.nowIso });
    }
    await deps.db
      .prepare('UPDATE demo_sandboxes SET active_workflow_id = ? WHERE capability_hash = ?')
      .bind(workflowId, sandboxHash)
      .run()
      .catch(() => undefined);
    const refreshed = await getSandboxByCapability(deps.db, raw, deps.nowIso);
    const active = await activeProposalForSandbox(deps.db, sandboxHash);
    const payload = telemetrize({
      ...replayStatePayload(refreshed ?? sandbox, active, originOf(request)),
      meta: {
        modelUsed: false,
        provider: 'skipped',
        workflow: backend,
        simulatedEvidence: true,
      },
    }, startedMs);
    return json(payload, 202, undefined, { ...NO_STORE });
  }

  const active = await activeProposalForSandbox(deps.db, sandboxHash);
  if (!active) return fail('No replay proposal is awaiting a decision.', 409, 'no_active_proposal');
  // Exact binding: both fields are REQUIRED — no silent default to the
  // stored values. An approval that did not name this exact candidate is
  // not an approval of anything.
  if (typeof body.proposalId !== 'string' || body.proposalId !== active.id) {
    return fail('Unknown proposal.', 404, 'unknown_proposal');
  }
  if (typeof body.candidateHash !== 'string' || body.candidateHash !== active.candidate_hash) {
    return fail('Candidate mismatch.', 409, 'candidate_mismatch');
  }

  const decision = action === 'approve' ? 'approved' : 'rejected';
  const decided = await decideAdaptation(deps.db, ports, {
    proposalId: active.id,
    decision,
    candidateHash: active.candidate_hash,
    baseRevision: active.base_revision,
    evidenceWatermark: active.evidence_watermark,
    actor: 'reviewer',
    nowIso: deps.nowIso,
  });
  if (decided.persisted !== 'decision_recorded' && decided.persisted !== 'duplicate') {
    const refreshed = await getSandboxByCapability(deps.db, raw, deps.nowIso);
    const latest = await getProposal(deps.db, active.id);
    const payload = telemetrize({
      ...replayStatePayload(refreshed ?? sandbox, latest, originOf(request)),
      decision: { persisted: decided.persisted, notified: decided.notified, workflow: backend },
    }, startedMs);
    const status = decided.persisted === 'expired' ? 410 : 409;
    return json(payload, status, undefined, { ...NO_STORE });
  }
  // Local fallback settles inline through the same settle function the real
  // Workflow runs; the cloud path returns here and settles asynchronously.
  if (!deps.workflowPorts) {
    await settleAdaptation(deps.db, { proposalId: active.id, nowIso: deps.nowIso });
  }
  const refreshed = await getSandboxByCapability(deps.db, raw, deps.nowIso);
  const latest = await getProposal(deps.db, active.id);
  const payload = telemetrize({
    ...replayStatePayload(refreshed ?? sandbox, latest, originOf(request)),
    decision: {
      persisted: decided.persisted,
      notified: decided.notified,
      workflow: backend,
      ...(deps.workflowPorts ? { settled: 'async' } : { settled: 'inline' }),
    },
  }, startedMs);
  const terminal = latest?.status === 'expired'
    ? 410
    : latest && (latest.status === 'committed' || latest.status === 'rejected' || latest.status === 'cancelled')
      ? 200
      : 202;
  return json(payload, terminal, undefined, { ...NO_STORE });
}

export { REPLAY_COOKIE };
