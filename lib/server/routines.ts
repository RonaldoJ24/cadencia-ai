// Packet 02: persisted routine APIs over the packet-01 repository.
// Protection order: same-origin -> idempotency key -> validate input ->
// verified user -> reserve quota slot -> Cloud Run -> persist validated
// plan only -> complete idempotency record. Duplicate keys replay the
// original result without a second provider call.

import { buildPlan, validateInput, validateIntent, type PlannerEvent } from '../routine.ts';
import { traceFromCompileEvents } from '../trace.ts';
import { copyFor, languageFrom } from '../i18n.ts';
import {
  completeGenerationRequest,
  createRoutineWithVersion,
  ensureUser,
  envDb,
  getRoutineDetail,
  listRoutines,
  reserveGenerationSlot,
  type Db,
} from './db.ts';
import { bodyJson, dict, errorResponse, json, rateLimited, sameOrigin, type Dict } from './http.ts';
import { liveConfig, normalizeServiceUrl, requestIntent, runtimeEnv, ServiceFailure } from './live.ts';
import { checkRateLimit, ipScopeKey, userScopeKey, type RateScope } from './ratelimit.ts';
import { resolveIdentity } from './identity.ts';

const EVENT = 'cadencia_routines_failure';
const MAX_KEY = 128;
const MAX_TIMEZONE = 64;

export type RoutinesEnv = Record<string, unknown>;

export type IntentFetchResult = { intent: unknown; scopeRefused: boolean; requestId?: string };

export type RoutinesDeps = {
  db: Db | null;
  env?: RoutinesEnv;
  intentFetcher?: (input: Parameters<typeof requestIntent>[0], config: Parameters<typeof requestIntent>[1]) => Promise<IntentFetchResult>;
  nowIso?: () => string;
  newId?: () => string;
};

async function limited(
  db: Db,
  key: string,
  scope: RateScope,
  nowMs: number,
  event: string,
): Promise<Response | null> {
  const decision = await checkRateLimit(db, { key, scope, nowMs });
  if (decision.allowed) return null;
  return rateLimited(decision.retryAfterSec, event);
}

function quotaOf(env?: RoutinesEnv): number {
  const raw = env?.CADENCIA_DAILY_LIVE_QUOTA;
  const parsed = typeof raw === 'string' ? Number(raw) : 10;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return 10;
  return parsed;
}

function validKey(value: string): boolean {
  return value.length > 0 && value.length <= MAX_KEY && /^[ -~]+$/u.test(value);
}

function validTimezone(value: unknown): string | null {
  if (value === undefined) return 'UTC';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TIMEZONE) return null;
  if (/[\p{C}]/u.test(trimmed)) return null;
  return trimmed;
}

function sessionStartsAt(date: string, time: string): string {
  return `${date}T${time}:00`;
}

async function routeLiveConfig(env?: RoutinesEnv) {
  // Prefer injected env when present so handlers stay hermetic in tests;
  // production resolveRouteDeps supplies the same strings. Falls back to
  // the shared runtime lookup otherwise.
  if (env && 'CADENCIA_ENABLE_LIVE' in env) {
    const enable = typeof env.CADENCIA_ENABLE_LIVE === 'string' ? env.CADENCIA_ENABLE_LIVE.trim() : '';
    const rawUrl = typeof env.CADENCIA_INTENT_SERVICE_URL === 'string' ? env.CADENCIA_INTENT_SERVICE_URL.trim() : '';
    const token = typeof env.CADENCIA_SERVICE_TOKEN === 'string' ? env.CADENCIA_SERVICE_TOKEN.trim() : '';
    if (enable !== 'true') return null;
    const serviceUrl = normalizeServiceUrl(rawUrl);
    if (!serviceUrl || token.length === 0 || token.length > 4_096) return null;
    return { serviceUrl, token };
  }
  return liveConfig();
}

export async function resolveRouteDeps(): Promise<RoutinesDeps> {
  const strings = await runtimeEnv();
  let binding: unknown;
  try {
    const worker = await import('cloudflare:workers');
    binding = (worker.env as unknown as Record<string, unknown>)?.DB;
  } catch {
    binding = undefined;
  }
  const env: RoutinesEnv = { ...strings, DB: binding };
  return { db: envDb(env), env };
}

export async function verifiedUserId(
  request: Request,
  env: RoutinesEnv | undefined,
  db: Db,
  now: string,
  newId: () => string,
  event = EVENT,
): Promise<{ userId: string } | Response> {
  const identity = await resolveIdentity(request, env);
  if (!identity.ok) {
    const reason = identity.reason === 'missing_credentials'
      ? 'unauthorized'
      : identity.reason === 'needs_verification'
        ? 'identity_unverified'
        : identity.reason;
    return errorResponse('Authentication required.', 401, reason, undefined, undefined, event);
  }
  const user = await ensureUser(db, {
    id: newId(),
    accessSubject: identity.user.accessSubject,
    emailHash: identity.user.emailHash,
    nowIso: now,
  });
  if (user.status === 'disabled') {
    return errorResponse('Authentication required.', 401, 'account_disabled', undefined, undefined, event);
  }
  return { userId: user.id };
}

export function publicDetail(detail: NonNullable<Awaited<ReturnType<typeof getRoutineDetail>>>) {
  let plan: unknown = null;
  try {
    plan = JSON.parse(detail.version.plan_json) as unknown;
  } catch {
    plan = null;
  }
  return {
    routine: {
      id: detail.routine.id,
      title: detail.routine.title,
      language: detail.routine.language,
      sourceMode: detail.routine.source_mode,
      status: detail.routine.status,
      createdAt: detail.routine.created_at,
      updatedAt: detail.routine.updated_at,
    },
    version: {
      id: detail.version.id,
      versionNumber: detail.version.version_number,
      weekStart: detail.version.week_start,
      timezone: detail.version.timezone,
      generatedBy: detail.version.generated_by,
      createdAt: detail.version.created_at,
    },
    sessions: detail.sessions.map((session) => ({
      id: session.id,
      ordinal: session.ordinal,
      startsAt: session.starts_at,
      minutes: session.scheduled_minutes,
      title: session.title,
      status: session.status,
      completedAt: session.completed_at,
      note: session.note,
    })),
    plan,
  };
}

export async function handleCreateRoutine(request: Request, deps?: RoutinesDeps): Promise<Response> {
  const resolved = deps ?? await resolveRouteDeps();
  const { env } = resolved;
  const db = resolved.db;
  const now = (resolved.nowIso ?? (() => new Date().toISOString()))();
  const newId = resolved.newId ?? (() => crypto.randomUUID());
  if (!sameOrigin(request)) return errorResponse(copyFor('en').api.invalidOrigin, 403, 'invalid_origin', undefined, undefined, EVENT);

  const key = (request.headers.get('idempotency-key') ?? '').trim();
  if (!validKey(key)) {
    return errorResponse('Idempotency-Key header is required.', 400, 'missing_idempotency_key', undefined, undefined, EVENT);
  }
  if (!db) {
    return errorResponse('Routine storage is not configured.', 503, 'persistence_not_configured', undefined, undefined, EVENT);
  }
  // Pre-auth guard on the costly path: hashed-IP scope, no identity needed.
  const nowMs = Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now);
  const preAuth = await limited(db, ipScopeKey(request, 'strict'), 'strict', nowMs, EVENT);
  if (preAuth) return preAuth;

  let value: Dict | null;
  try {
    value = dict(await bodyJson(request));
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
  const timezone = validTimezone(value.timezone);
  if (!timezone) {
    return errorResponse(apiCopy.invalidInput, 400, 'invalid_input', undefined, undefined, EVENT);
  }

  const auth = await verifiedUserId(request, env, db, now, newId);
  if (auth instanceof Response) return auth;
  const userLimit = await limited(db, userScopeKey(auth.userId, 'strict'), 'strict', nowMs, EVENT);
  if (userLimit) return userLimit;

  const requestId = newId();
  try {
    const reservation = await reserveGenerationSlot(db, {
      requestId,
      userId: auth.userId,
      idempotencyKey: key,
      mode,
      nowIso: now,
      dailyQuota: quotaOf(env),
    });
    if (reservation.duplicate) {
      if (!reservation.existingRoutineId) {
        return errorResponse('Duplicate request is still processing.', 409, 'idempotent_pending', undefined, undefined, EVENT);
      }
      const original = await getRoutineDetail(db, auth.userId, reservation.existingRoutineId);
      if (!original) {
        return errorResponse('Duplicate request is still processing.', 409, 'idempotent_pending', undefined, undefined, EVENT);
      }
      return json({ deduplicated: true, ...publicDetail(original) }, 200);
    }

    let plan;
    let serviceRequestId: string | undefined;
    // Events recorded while the planner executes below; the persisted
    // revision trace is built from them (never reconstructed afterwards).
    const plannerEvents: PlannerEvent[] = [];
    const collect = (event: PlannerEvent): void => {
      plannerEvents.push(event);
    };
    try {
      if (mode === 'demo') {
        plan = buildPlan(input, undefined, 'demo', undefined, collect);
      } else {
        const config = await routeLiveConfig(env);
        if (!config) {
          await completeGenerationRequest(db, { userId: auth.userId, idempotencyKey: key, outcome: 'failed', completedAt: now });
          return errorResponse(apiCopy.notConfigured, 503, 'live_not_configured', undefined, undefined, EVENT);
        }
        const fetcher = resolved.intentFetcher
          ?? ((inputArg: Parameters<typeof requestIntent>[0], configArg: Parameters<typeof requestIntent>[1]) => requestIntent(inputArg, configArg));
        const serviceResult = await fetcher(input, config);
        serviceRequestId = serviceResult.requestId;
        const sessionCount = Math.min(
          input.days.length,
          Math.floor(input.weeklyMinutes / input.sessionMinutes),
        );
        const intent = validateIntent(
          serviceResult.intent,
          serviceResult.scopeRefused ? undefined : { sessionCount, sessionMinutes: input.sessionMinutes },
        );
        plan = buildPlan(input, intent, 'deepseek', serviceResult.scopeRefused, collect);
      }
    } catch (error) {
      const failure = error instanceof ServiceFailure ? error : null;
      const outcome = failure?.backendRejected ? 'refused' : 'failed';
      await completeGenerationRequest(db, {
        userId: auth.userId,
        idempotencyKey: key,
        outcome,
        completedAt: now,
        providerAttempts: failure || mode === 'deepseek' ? 1 : 0,
      }).catch(() => undefined);
      if (mode === 'deepseek' && (failure || error instanceof Error)) {
        const reason = failure?.reason ?? 'upstream_invalid_response';
        const reqId = failure?.requestId ?? serviceRequestId;
        return errorResponse(apiCopy.providerError, 502, reason, reqId, failure?.diagnostic, EVENT);
      }
      return errorResponse(apiCopy.providerError, 502, 'plan_build_failed', serviceRequestId, undefined, EVENT);
    }

    const routineId = newId();
    const versionId = newId();
    const revisionTrace = traceFromCompileEvents(plan, plannerEvents, { timezone });
    await createRoutineWithVersion(db, {
      routineId,
      userId: auth.userId,
      title: plan.intent.title.slice(0, 160),
      language: plan.input.language,
      sourceMode: mode,
      nowIso: now,
      versionId,
      weekStart: plan.input.startDate,
      timezone,
      inputJson: JSON.stringify(plan.input),
      planJson: JSON.stringify(plan),
      generatedBy: mode,
      traceJson: JSON.stringify(revisionTrace),
      sessions: plan.sessions.map((session, ordinal) => ({
        id: `${versionId}-s${ordinal}`,
        ordinal,
        startsAt: sessionStartsAt(session.date, plan.input.time),
        minutes: session.minutes,
        title: session.title.slice(0, 160),
      })),
    });
    await completeGenerationRequest(db, {
      userId: auth.userId,
      idempotencyKey: key,
      outcome: 'completed',
      routineId,
      completedAt: now,
      providerAttempts: mode === 'deepseek' ? 1 : 0,
    });
    const detail = await getRoutineDetail(db, auth.userId, routineId);
    if (!detail) return errorResponse(apiCopy.providerError, 502, 'persist_not_visible', undefined, undefined, EVENT);
    return json({ deduplicated: false, ...publicDetail(detail) }, 201, serviceRequestId);
  } catch (error) {
    if (error instanceof Error && error.message.includes('quota_exceeded')) {
      return errorResponse('Daily Connected AI quota reached.', 429, 'quota_exceeded', undefined, undefined, EVENT);
    }
    throw error;
  }
}

export async function handleListRoutines(request: Request, deps?: RoutinesDeps): Promise<Response> {
  const resolved = deps ?? await resolveRouteDeps();
  const db = resolved.db;
  const now = (resolved.nowIso ?? (() => new Date().toISOString()))();
  const newId = resolved.newId ?? (() => crypto.randomUUID());
  if (!db) {
    return errorResponse('Routine storage is not configured.', 503, 'persistence_not_configured', undefined, undefined, EVENT);
  }
  const auth = await verifiedUserId(request, resolved.env, db, now, newId);
  if (auth instanceof Response) return auth;
  const readLimit = await limited(
    db,
    userScopeKey(auth.userId, 'read'),
    'read',
    Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now),
    EVENT,
  );
  if (readLimit) return readLimit;
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit') ?? '20');
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 && rawLimit <= 50 ? rawLimit : 20;
  const cursor = url.searchParams.get('cursor');
  let cursorUpdatedAt: string | undefined;
  let cursorId: string | undefined;
  if (cursor) {
    const decoded = (() => {
      try {
        return Buffer.from(cursor, 'base64url').toString('utf8');
      } catch {
        return null;
      }
    })();
    const separator = decoded?.lastIndexOf('|') ?? -1;
    if (!decoded || separator < 0) {
      return errorResponse('Invalid cursor.', 400, 'invalid_cursor', undefined, undefined, EVENT);
    }
    cursorUpdatedAt = decoded.slice(0, separator);
    cursorId = decoded.slice(separator + 1);
    if (!cursorUpdatedAt || !cursorId || Number.isNaN(Date.parse(cursorUpdatedAt))) {
      return errorResponse('Invalid cursor.', 400, 'invalid_cursor', undefined, undefined, EVENT);
    }
  }
  const rows = await listRoutines(db, auth.userId, limit + 1, cursorUpdatedAt, cursorId);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last
    ? Buffer.from(`${last.updated_at}|${last.id}`, 'utf8').toString('base64url')
    : null;
  return json({
    routines: page.map((row) => ({
      id: row.id,
      title: row.title,
      language: row.language,
      sourceMode: row.source_mode,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    nextCursor,
  });
}

export async function handleGetRoutine(request: Request, routineId: string, deps?: RoutinesDeps): Promise<Response> {
  const resolved = deps ?? await resolveRouteDeps();
  const db = resolved.db;
  const now = (resolved.nowIso ?? (() => new Date().toISOString()))();
  const newId = resolved.newId ?? (() => crypto.randomUUID());
  if (!db) {
    return errorResponse('Routine storage is not configured.', 503, 'persistence_not_configured', undefined, undefined, EVENT);
  }
  const auth = await verifiedUserId(request, resolved.env, db, now, newId);
  if (auth instanceof Response) return auth;
  const detailLimit = await limited(
    db,
    userScopeKey(auth.userId, 'read'),
    'read',
    Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now),
    EVENT,
  );
  if (detailLimit) return detailLimit;
  // Same 404 for missing and foreign routines: no cross-user oracle.
  if (!routineId || !/^[A-Za-z0-9:_-]{1,64}$/u.test(routineId)) {
    return errorResponse('Routine not found.', 404, 'routine_not_found', undefined, undefined, EVENT);
  }
  const detail = await getRoutineDetail(db, auth.userId, routineId);
  if (!detail) {
    return errorResponse('Routine not found.', 404, 'routine_not_found', undefined, undefined, EVENT);
  }
  return json(publicDetail(detail));
}
