import { validateInput, validateIntent } from '../../../lib/routine.ts';
import { ADAPT_POLICY_VERSION, compileWithTrace, PLANNER_VERSION } from '../../../lib/trace.ts';
import { copyFor, languageFrom } from '../../../lib/i18n.ts';
import { dict, errorResponse, json, rateLimited, readBoundedText, sameOrigin, type Dict } from '../../../lib/server/http.ts';
import { liveConfig, requestIntent, runtimeEnv, ServiceFailure } from '../../../lib/server/live.ts';
import { envDb, type Db } from '../../../lib/server/db.ts';
import { checkRateLimit, ipScopeKey } from '../../../lib/server/ratelimit.ts';
import { checkAndReservePublicLiveSlot, limitsFromEnv } from '../../../lib/server/public_limits.ts';
import { handleReplayGet, handleReplayPatch, handleReplayStart, type ReplayDeps } from '../../../lib/server/replay.ts';
import { bindingWorkflowPorts } from '../../../lib/server/workflow-binding.ts';
import type { WorkflowPorts } from '../../../lib/server/workflow-coord.ts';

const EVENT = 'cadencia_routine_failure';
const REPLAY_NO_STORE: Record<string, string> = { 'cache-control': 'private, no-store' };

export type PublicRoutineDeps = {
  db?: Db | null;
  env?: Record<string, unknown>;
  intentFetcher?: typeof requestIntent;
  nowIso?: () => string;
  nowMs?: () => number;
  /** Injected Workflow ports for Reviewer Replay (tests). Undefined resolves the real binding, null forces local fallback. */
  workflowPorts?: WorkflowPorts | null;
  workflowBackend?: 'cloudflare' | 'local-fallback';
};

export function replayMethodNotAllowed(): Response {
  return errorResponse('Method not allowed.', 405, 'method_not_allowed', undefined, undefined, EVENT, { ...REPLAY_NO_STORE });
}

export async function resolvePublicRouteDb(): Promise<Db | null> {
  const scope = globalThis as Record<string, unknown>;
  if (scope.__cadencia_db && typeof (scope.__cadencia_db as Db).prepare === 'function') {
    return scope.__cadencia_db as Db;
  }
  try {
    const worker = await import('cloudflare:workers');
    const binding = (worker.env as unknown as Record<string, unknown>)?.DB;
    return envDb({ DB: binding });
  } catch {
    return null;
  }
}

export async function GET(request?: Request, deps?: PublicRoutineDeps): Promise<Response> {
  const env = deps?.env;
  const db = deps?.db !== undefined ? deps.db : await resolvePublicRouteDb();
  const nowIso = deps?.nowIso ? deps.nowIso() : new Date().toISOString();
  const nowMs = deps?.nowMs ? deps.nowMs() : (Number.isNaN(Date.parse(nowIso)) ? Date.now() : Date.parse(nowIso));

  // Reviewer Replay sandbox state on the exact path. Ordinary callers
  // without a replay cookie see the unchanged availability response below.
  if (request && db) {
    const replayDeps: ReplayDeps = { db, env, nowIso, nowMs, workflowPorts: deps?.workflowPorts };
    const replay = await handleReplayGet(request, replayDeps);
    if (replay) return replay;
  }

  if (request && db) {
    const readLimit = await checkRateLimit(db, {
      key: ipScopeKey(request, 'read'),
      scope: 'read',
      nowMs,
    });
    if (!readLimit.allowed) {
      return rateLimited(readLimit.retryAfterSec, EVENT);
    }
  }

  return json({ liveAvailable: (await liveConfig(env)) !== null });
}

export async function POST(request: Request, deps?: PublicRoutineDeps): Promise<Response> {
  const startedMs = Date.now();
  // Single bounded body read shared by the replay probe and the compile
  // path (never clone the request: cancelling a cloned tee branch can
  // stall and wedge the handler).
  let rawText: string;
  try {
    rawText = await readBoundedText(request);
  } catch {
    return errorResponse(copyFor('en').api.invalidBody, 400, 'invalid_body', undefined, undefined, EVENT);
  }
  const replayProbe = deps?.db === null
    ? null
    : await (async () => {
      const db = deps?.db !== undefined ? deps.db : await resolvePublicRouteDb();
      if (!db) return null;
      const nowIso = deps?.nowIso ? deps.nowIso() : new Date().toISOString();
      const nowMs = deps?.nowMs ? deps.nowMs() : (Number.isNaN(Date.parse(nowIso)) ? Date.now() : Date.parse(nowIso));
      const env = { ...(await runtimeEnv()), ...deps?.env };
      return handleReplayStart(request, { db, env, nowIso, nowMs, workflowPorts: deps?.workflowPorts }, rawText);
    })().catch(() => null);
  if (replayProbe) return replayProbe;
  if (!sameOrigin(request)) return errorResponse(copyFor('en').api.invalidOrigin, 403, 'invalid_origin', undefined, undefined, EVENT);

  let value: Dict | null;
  try {
    value = dict(JSON.parse(rawText));
  } catch {
    return errorResponse(copyFor('en').api.invalidBody, 400, 'invalid_body', undefined, undefined, EVENT);
  }
  if (!value) return errorResponse(copyFor('en').api.bodyObject, 400, 'invalid_body', undefined, undefined, EVENT);

  const language = languageFrom(dict(value.input)?.language);
  const apiCopy = copyFor(language).api;

  let input;
  try {
    input = validateInput(value.input);
  } catch {
    return errorResponse(apiCopy.invalidInput, 400, 'invalid_input', undefined, undefined, EVENT);
  }
  const mode = value.mode === undefined ? 'demo' : value.mode;
  if (mode !== 'demo' && mode !== 'deepseek') {
    return errorResponse(apiCopy.invalidMode, 400, 'invalid_mode', undefined, undefined, EVENT);
  }

  const env = { ...(await runtimeEnv()), ...deps?.env };
  const db = deps?.db !== undefined ? deps.db : await resolvePublicRouteDb();
  const nowIso = deps?.nowIso ? deps.nowIso() : new Date().toISOString();
  const nowMs = deps?.nowMs ? deps.nowMs() : (Number.isNaN(Date.parse(nowIso)) ? Date.now() : Date.parse(nowIso));
  const fetcher = deps?.intentFetcher ?? requestIntent;

  if (mode === 'demo') {
    if (db) {
      const demoLimit = await checkRateLimit(db, {
        key: ipScopeKey(request, 'public_demo'),
        scope: 'public_demo',
        nowMs,
      });
      if (!demoLimit.allowed) {
        return rateLimited(
          demoLimit.retryAfterSec,
          EVENT,
          apiCopy.rateLimited(demoLimit.retryAfterSec),
        );
      }
    }
    const planStartedMs = Date.now();
    const compiled = compileWithTrace(input, undefined, 'demo', { timezone: 'UTC' });
    const doneMs = Date.now();
    return json({
      plan: compiled.plan,
      trace: compiled.trace,
      hashes: { inputHash: compiled.trace.inputHash, scheduleHash: compiled.trace.scheduleHash },
      meta: {
        plannerVersion: PLANNER_VERSION,
        policyVersion: ADAPT_POLICY_VERSION,
        modelUsed: false,
        provider: 'skipped',
        timingsMs: { total: doneMs - startedMs, plan: doneMs - planStartedMs },
      },
    });
  }

  const config = await liveConfig(env);
  if (!config) return errorResponse(apiCopy.notConfigured, 503, 'live_not_configured', undefined, undefined, EVENT);

  // Fail closed: live provider calls strictly require atomic D1 rate/quota limits.
  if (!db) {
    return errorResponse(apiCopy.limitsNotConfigured, 503, 'limits_not_configured', undefined, undefined, EVENT);
  }

  const slot = await checkAndReservePublicLiveSlot(db, {
    request,
    nowMs,
    nowIso,
    secret: typeof env.CADENCIA_SERVICE_TOKEN === 'string' ? env.CADENCIA_SERVICE_TOKEN : undefined,
    limits: limitsFromEnv(env),
    allowIpFallback: (env as Record<string, unknown>)?.CADENCIA_ALLOW_IP_FALLBACK === 'true',
  });
  if (!slot.allowed) {
    if (slot.status === 400) {
      return errorResponse('Valid client IP is required.', 400, 'missing_client_ip', undefined, undefined, EVENT);
    }
    const message = (() => {
      switch (slot.reason) {
        case 'rate_limited':
          return apiCopy.rateLimited(slot.retryAfterSec);
        case 'visitor_quota_exceeded':
          return apiCopy.visitorQuotaExceeded;
        case 'global_quota_exceeded':
          return apiCopy.globalQuotaExceeded;
        case 'visitor_concurrent_limit':
          return apiCopy.visitorConcurrentLimit;
        case 'global_concurrency_limit':
          return apiCopy.globalConcurrentLimit;
        default:
          return 'Too many requests.';
      }
    })();
    return errorResponse(
      message,
      slot.status,
      slot.reason,
      undefined,
      undefined,
      EVENT,
      slot.retryAfterSec ? { 'retry-after': String(slot.retryAfterSec) } : undefined,
    );
  }

  let serviceRequestId: string | undefined;
  const providerStartedMs = Date.now();
  try {
    const serviceResult = await fetcher(input, config);
    serviceRequestId = serviceResult.requestId;
    const sessionCount = Math.min(
      input.days.length,
      Math.floor(input.weeklyMinutes / input.sessionMinutes),
    );
    const intent = validateIntent(
      serviceResult.intent,
      serviceResult.scopeRefused
        ? undefined
        : { sessionCount, sessionMinutes: input.sessionMinutes },
    );
    const planStartedMs = Date.now();
    const compiled = compileWithTrace(input, intent, 'deepseek', {
      timezone: 'UTC',
      scopeRefused: serviceResult.scopeRefused,
      provider: 'succeeded',
    });
    const doneMs = Date.now();
    return json(
      {
        plan: compiled.plan,
        trace: compiled.trace,
        hashes: { inputHash: compiled.trace.inputHash, scheduleHash: compiled.trace.scheduleHash },
        meta: {
          plannerVersion: PLANNER_VERSION,
          policyVersion: ADAPT_POLICY_VERSION,
          modelUsed: true,
          provider: 'succeeded',
          timingsMs: { total: doneMs - startedMs, provider: planStartedMs - providerStartedMs, plan: doneMs - planStartedMs },
        },
      },
      200,
      serviceRequestId,
    );
  } catch (error) {
    const failure = error instanceof ServiceFailure ? error : null;
    const reason = failure?.reason ?? 'upstream_invalid_response';
    const reqId = failure?.requestId ?? serviceRequestId;
    return errorResponse(
      apiCopy.providerError,
      502,
      reason,
      reqId,
      failure?.diagnostic,
      EVENT,
    );
  } finally {
    if (slot && slot.allowed) {
      await slot.release();
    }
  }
}

/**
 * Reviewer Replay decisions on the exact path. Allowlist only:
 * replay-missed-tuesday | approve | reject. Never falls through to owner
 * handlers; method-override headers are never honored.
 */
export async function PATCH(request: Request, deps?: PublicRoutineDeps): Promise<Response> {
  const db = deps?.db !== undefined ? deps.db : await resolvePublicRouteDb();
  if (!db) {
    return errorResponse('Routine storage is not configured.', 503, 'persistence_not_configured', undefined, undefined, EVENT, { ...REPLAY_NO_STORE });
  }
  const nowIso = deps?.nowIso ? deps.nowIso() : new Date().toISOString();
  const nowMs = deps?.nowMs ? deps.nowMs() : (Number.isNaN(Date.parse(nowIso)) ? Date.now() : Date.parse(nowIso));
  const env = { ...(await runtimeEnv()), ...deps?.env };
  let workflowPorts = deps?.workflowPorts;
  let workflowBackend = deps?.workflowBackend;
  if (workflowPorts === undefined) {
    workflowPorts = await bindingWorkflowPorts();
    workflowBackend = workflowPorts ? 'cloudflare' : 'local-fallback';
  }
  return handleReplayPatch(request, { db, env, nowIso, nowMs, workflowPorts, workflowBackend });
}
