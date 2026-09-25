// The public planning route. GET reports whether live AI is available; POST
// runs a live goal plan, or a pick after missed sessions, streamed as
// server-sent events or answered as JSON. The demo runs the same pipelines in
// the browser and never calls this route.

import { runGoalPipeline } from '../../../lib/goal-stream.ts';
import { runReplanPipeline } from '../../../lib/replan-stream.ts';
import { copyFor, languageFrom } from '../../../lib/i18n.ts';
import { StageFailure, type ReserveResult, type StageEvent } from '../../../lib/plan-stream.ts';
import { formatSse, SSE_HEARTBEAT } from '../../../lib/sse.ts';
import { dict, errorResponse, json, rateLimited, readBoundedText, sameOrigin, type Dict } from '../../../lib/server/http.ts';
import { liveGoalRun, liveReplanRun } from '../../../lib/server/goal-run.ts';
import { liveConfig, requestDraft, requestReadGoal, requestReplan, runtimeEnv } from '../../../lib/server/live.ts';
import { envDb, type Db } from '../../../lib/server/db.ts';
import { checkRateLimit, ipScopeKey } from '../../../lib/server/ratelimit.ts';
import type { SlotReservationResult } from '../../../lib/server/public_limits.ts';
import { GOAL_WORST_CASE_MICROUSD, liveStatusOf, loadSpendState, type LiveStatus } from '../../../lib/server/spend.ts';

const EVENT = 'cadencia_routine_failure';
const HEARTBEAT_MS = 10_000;

export type PublicRoutineDeps = {
  db?: Db | null;
  env?: Record<string, unknown>;
  readGoalFetcher?: typeof requestReadGoal;
  draftFetcher?: typeof requestDraft;
  replanFetcher?: typeof requestReplan;
  nowIso?: () => string;
  nowMs?: () => number;
  /** Keeps work running after the response; defaults to the Workers request context. */
  waitUntil?: (promise: Promise<unknown>) => void;
};

type KeepAlive = (promise: Promise<unknown>) => void;

/**
 * The request's waitUntil, so a run whose visitor disconnects still settles
 * its spend and releases its slot. Workers cancel unregistered work when the
 * client goes away, and give registered work up to 30 more seconds.
 */
async function keepAliveFor(deps?: PublicRoutineDeps): Promise<KeepAlive> {
  if (deps?.waitUntil) return deps.waitUntil;
  try {
    const worker = await import('cloudflare:workers');
    if (typeof worker.waitUntil === 'function') return (promise) => worker.waitUntil(promise);
  } catch {
    // Outside Workers (tests, local scripts) nothing cancels pending work.
  }
  return () => undefined;
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

  // Only a coarse reason leaves the server: configuration problems and the
  // kill switch all read as 'paused'.
  const config = await liveConfig(env);
  let status: LiveStatus = config ? 'available' : 'disabled';
  if (config && db) {
    try {
      // The page runs goals, so live AI is available only when a whole goal
      // run's worst case still fits under both caps.
      status = liveStatusOf(await loadSpendState(db, nowIso), GOAL_WORST_CASE_MICROUSD);
    } catch {
      status = 'disabled';
    }
  }
  const liveStatus = status === 'disabled' ? 'paused' : status;
  return json({ liveAvailable: liveStatus === 'available', liveStatus });
}

type ApiCopy = ReturnType<typeof copyFor>['api'];

function slotResult(slot: SlotReservationResult, apiCopy: ApiCopy): ReserveResult {
  if (slot.allowed) return { allowed: true, release: slot.release };
  if (slot.status === 400) {
    return { allowed: false, status: 400, reason: 'missing_client_ip', message: 'Valid client IP is required.' };
  }
  const message = (() => {
    switch (slot.reason) {
      case 'rate_limited':
        return apiCopy.rateLimited;
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
  return { allowed: false, status: slot.status, reason: slot.reason, message, retryAfterSec: slot.retryAfterSec };
}

/** Logs a failed stage with a fresh reference, the same way errorResponse does. */
function logFailure(failure: StageFailure): string {
  const reference = crypto.randomUUID();
  console.error(
    JSON.stringify({
      event: EVENT,
      reference,
      reason: failure.code,
      stage: failure.stage,
      status: failure.options.status ?? 500,
      ...(failure.options.requestId ? { request_id: failure.options.requestId } : {}),
      ...(failure.options.diagnostic ? { diagnostic: failure.options.diagnostic } : {}),
    }),
  );
  return reference;
}

/** What a finished run sends: the stream's result event and the JSON body. */
type RunResult = { result: Record<string, unknown>; json: Record<string, unknown>; requestId?: string };
type Run = (emit: (event: StageEvent) => void) => Promise<RunResult>;

function goalRun(rawInput: unknown, live: ReturnType<typeof liveGoalRun>, startedMs: number): Run {
  return async (emit) => {
    try {
      const outcome = await runGoalPipeline(rawInput, { ...live.deps, emit });
      const body = { ...outcome, meta: { timingsMs: { total: Date.now() - startedMs } } };
      return { result: body, json: body, requestId: outcome.requestIds.at(-1) };
    } finally {
      await live.settle();
    }
  };
}

function replanRun(rawInput: unknown, live: ReturnType<typeof liveReplanRun>, startedMs: number): Run {
  return async (emit) => {
    try {
      const outcome = await runReplanPipeline(rawInput, { ...live.deps, emit });
      const body = { ...outcome, meta: { timingsMs: { total: Date.now() - startedMs } } };
      return { result: body, json: body, requestId: outcome.requestIds.at(-1) };
    } finally {
      await live.settle();
    }
  };
}

async function jsonResponse(run: Run, keepAlive: KeepAlive): Promise<Response> {
  try {
    const pending = run(() => undefined);
    keepAlive(pending.catch(() => undefined));
    const { json: body, requestId } = await pending;
    return json(body, 200, requestId);
  } catch (error) {
    if (!(error instanceof StageFailure)) throw error;
    // Logged like a streamed failure, with the stage that failed.
    const reference = logFailure(error);
    const { status = 500, retryAfterSec, requestId } = error.options;
    return json(
      { error: error.publicMessage, reference },
      status,
      requestId,
      retryAfterSec ? { 'retry-after': String(retryAfterSec) } : undefined,
    );
  }
}

function streamResponse(run: Run, keepAlive: KeepAlive): Response {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let open = true;
  const write = (text: string) => {
    if (!open) return;
    writer.write(encoder.encode(text)).catch(() => {
      open = false;
    });
  };
  // Keeps the connection alive while a slow stage (the model call) runs.
  const heartbeat = setInterval(() => write(SSE_HEARTBEAT), HEARTBEAT_MS);

  keepAlive((async () => {
    try {
      const { result } = await run((event: StageEvent) => write(formatSse('stage', event)));
      write(formatSse('result', { type: 'result', ...result }));
    } catch (error) {
      const failure = error instanceof StageFailure
        ? error
        : new StageFailure('fit', 'internal_error', copyFor('en').api.providerError, { status: 500 });
      const reference = logFailure(failure);
      write(formatSse('error', {
        type: 'error',
        stage: failure.stage,
        message: failure.publicMessage,
        reference,
        ...(failure.options.retryAfterSec ? { retryAfterSec: failure.options.retryAfterSec } : {}),
      }));
    } finally {
      clearInterval(heartbeat);
      if (open) await writer.close().catch(() => undefined);
    }
  })());

  return new Response(readable, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}

export async function POST(request: Request, deps?: PublicRoutineDeps): Promise<Response> {
  const startedMs = Date.now();
  let rawText: string;
  try {
    rawText = await readBoundedText(request);
  } catch {
    return errorResponse(copyFor('en').api.invalidBody, 400, 'invalid_body', undefined, undefined, EVENT);
  }
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
  // Every run here is live; the demo runs in the browser. 'deepseek' is the name
  // pages loaded before 2026-09-25 still send.
  if (value.mode !== 'live' && value.mode !== 'deepseek') {
    return errorResponse(apiCopy.invalidMode, 400, 'invalid_mode', undefined, undefined, EVENT);
  }
  if (value.kind !== undefined && value.kind !== 'goal' && value.kind !== 'replan') {
    return errorResponse(apiCopy.invalidMode, 400, 'invalid_kind', undefined, undefined, EVENT);
  }

  const env = { ...(await runtimeEnv()), ...deps?.env };
  const db = deps?.db !== undefined ? deps.db : await resolvePublicRouteDb();
  const nowIso = deps?.nowIso ? deps.nowIso() : new Date().toISOString();
  const nowMs = deps?.nowMs ? deps.nowMs() : (Number.isNaN(Date.parse(nowIso)) ? Date.now() : Date.parse(nowIso));
  const wantsStream = (request.headers.get('accept') ?? '').includes('text/event-stream');

  const config = await liveConfig(env);
  if (!config) return errorResponse(apiCopy.notConfigured, 503, 'live_not_configured', undefined, undefined, EVENT);
  // Fail closed: live provider calls strictly require atomic D1 rate/quota limits.
  if (!db) return errorResponse(apiCopy.limitsNotConfigured, 503, 'limits_not_configured', undefined, undefined, EVENT);
  const base = { db, config, request, env, language, nowIso, nowMs, slotResult: (slot: SlotReservationResult) => slotResult(slot, apiCopy) };
  const run = value.kind === 'replan'
    ? replanRun(value.input, liveReplanRun({ ...base, replan: deps?.replanFetcher }), startedMs)
    : goalRun(value.input, liveGoalRun({ ...base, readGoal: deps?.readGoalFetcher, draft: deps?.draftFetcher }), startedMs);
  const keepAlive = await keepAliveFor(deps);
  return wantsStream ? streamResponse(run, keepAlive) : jsonResponse(run, keepAlive);
}
