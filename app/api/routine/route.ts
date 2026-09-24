import { copyFor, languageFrom } from '../../../lib/i18n.ts';
import {
  runPlanPipeline,
  StageFailure,
  type PipelineDeps,
  type PipelineOutcome,
  type ReserveResult,
  type StageEvent,
} from '../../../lib/plan-stream.ts';
import { formatSse, SSE_HEARTBEAT } from '../../../lib/sse.ts';
import { dict, errorResponse, json, rateLimited, readBoundedText, sameOrigin, type Dict } from '../../../lib/server/http.ts';
import { liveConfig, requestIntent, runtimeEnv } from '../../../lib/server/live.ts';
import { envDb, type Db } from '../../../lib/server/db.ts';
import { checkRateLimit, ipScopeKey } from '../../../lib/server/ratelimit.ts';
import { checkAndReservePublicLiveSlot, limitsFromEnv, type SlotReservationResult } from '../../../lib/server/public_limits.ts';

const EVENT = 'cadencia_routine_failure';
const HEARTBEAT_MS = 10_000;

export type PublicRoutineDeps = {
  db?: Db | null;
  env?: Record<string, unknown>;
  intentFetcher?: typeof requestIntent;
  nowIso?: () => string;
  nowMs?: () => number;
};

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

  return json({ liveAvailable: (await liveConfig(env)) !== null });
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

function meta(outcome: PipelineOutcome, mode: PipelineDeps['mode'], startedMs: number) {
  return {
    modelUsed: mode === 'deepseek',
    provider: mode === 'deepseek' ? 'succeeded' : 'skipped',
    outcome: outcome.outcome,
    timingsMs: { total: Date.now() - startedMs },
  };
}

async function jsonResponse(rawInput: unknown, deps: Omit<PipelineDeps, 'emit'>, startedMs: number): Promise<Response> {
  try {
    const outcome = await runPlanPipeline(rawInput, { ...deps, emit: () => undefined });
    return json({ plan: outcome.plan, meta: meta(outcome, deps.mode, startedMs) }, 200, outcome.requestId);
  } catch (error) {
    if (!(error instanceof StageFailure)) throw error;
    const { status = 500, retryAfterSec, requestId, diagnostic } = error.options;
    return errorResponse(
      error.publicMessage,
      status,
      error.code,
      requestId,
      diagnostic,
      EVENT,
      retryAfterSec ? { 'retry-after': String(retryAfterSec) } : undefined,
    );
  }
}

function streamResponse(rawInput: unknown, deps: Omit<PipelineDeps, 'emit'>, startedMs: number): Response {
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

  void (async () => {
    try {
      const outcome = await runPlanPipeline(rawInput, {
        ...deps,
        emit: (event: StageEvent) => write(formatSse('stage', event)),
      });
      write(formatSse('result', {
        type: 'result',
        outcome: outcome.outcome,
        plan: outcome.plan,
        requestId: outcome.requestId,
        meta: meta(outcome, deps.mode, startedMs),
      }));
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
  })();

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
  const mode = value.mode === undefined ? 'demo' : value.mode;
  if (mode !== 'demo' && mode !== 'deepseek') {
    return errorResponse(apiCopy.invalidMode, 400, 'invalid_mode', undefined, undefined, EVENT);
  }

  const env = { ...(await runtimeEnv()), ...deps?.env };
  const db = deps?.db !== undefined ? deps.db : await resolvePublicRouteDb();
  const nowIso = deps?.nowIso ? deps.nowIso() : new Date().toISOString();
  const nowMs = deps?.nowMs ? deps.nowMs() : (Number.isNaN(Date.parse(nowIso)) ? Date.now() : Date.parse(nowIso));
  const fetcher = deps?.intentFetcher ?? requestIntent;
  const wantsStream = (request.headers.get('accept') ?? '').includes('text/event-stream');

  let pipelineDeps: Omit<PipelineDeps, 'emit'>;
  if (mode === 'demo') {
    if (db) {
      const demoLimit = await checkRateLimit(db, {
        key: ipScopeKey(request, 'public_demo'),
        scope: 'public_demo',
        nowMs,
      });
      if (!demoLimit.allowed) {
        return rateLimited(demoLimit.retryAfterSec, EVENT, apiCopy.rateLimited(demoLimit.retryAfterSec));
      }
    }
    pipelineDeps = { mode: 'demo', now: Date.now };
  } else {
    const config = await liveConfig(env);
    if (!config) return errorResponse(apiCopy.notConfigured, 503, 'live_not_configured', undefined, undefined, EVENT);
    // Fail closed: live provider calls strictly require atomic D1 rate/quota limits.
    if (!db) {
      return errorResponse(apiCopy.limitsNotConfigured, 503, 'limits_not_configured', undefined, undefined, EVENT);
    }
    pipelineDeps = {
      mode: 'deepseek',
      now: Date.now,
      reserve: async () => slotResult(
        await checkAndReservePublicLiveSlot(db, {
          request,
          nowMs,
          nowIso,
          secret: typeof env.CADENCIA_SERVICE_TOKEN === 'string' ? env.CADENCIA_SERVICE_TOKEN : undefined,
          limits: limitsFromEnv(env),
          allowIpFallback: (env as Record<string, unknown>)?.CADENCIA_ALLOW_IP_FALLBACK === 'true',
        }),
        apiCopy,
      ),
      draft: (input) => fetcher(input, config),
    };
  }

  return wantsStream
    ? streamResponse(value.input, pipelineDeps, startedMs)
    : jsonResponse(value.input, pipelineDeps, startedMs);
}
