// Packet 05: quota visibility, compact feedback, and account deletion.
// Feedback takes no free-form text: score plus an allowlisted category.
// Deletion cascades through D1 and emits a content-free audit event.

import { deleteAccount, submitFeedback, type Db } from './db.ts';
import { bodyJson, dict, errorResponse, json, rateLimited, sameOrigin } from './http.ts';
import { checkRateLimit, ipScopeKey, userScopeKey } from './ratelimit.ts';
import { resolveRouteDeps, verifiedUserId, type RoutinesDeps } from './routines.ts';

const EVENT = 'cadencia_account_failure';
const FEEDBACK_CATEGORIES = new Set(['useful', 'too_generic', 'too_hard', 'too_easy', 'unsafe', 'other']);

function quotaOf(env: RoutinesDeps['env']): number {
  const raw = env?.CADENCIA_DAILY_LIVE_QUOTA;
  const parsed = typeof raw === 'string' ? Number(raw) : 10;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return 10;
  return parsed;
}

export async function handleGetQuota(request: Request, deps?: RoutinesDeps): Promise<Response> {
  const resolved = deps ?? await resolveRouteDeps();
  const db: Db | null = resolved.db;
  const now = (resolved.nowIso ?? (() => new Date().toISOString()))();
  const newId = resolved.newId ?? (() => crypto.randomUUID());
  if (!db) {
    return errorResponse('Routine storage is not configured.', 503, 'persistence_not_configured', undefined, undefined, EVENT);
  }
  const auth = await verifiedUserId(request, resolved.env, db, now, newId, EVENT);
  if (auth instanceof Response) return auth;
  const nowMs = Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now);
  const decision = await checkRateLimit(db, { key: userScopeKey(auth.userId, 'read'), scope: 'read', nowMs });
  if (!decision.allowed) return rateLimited(decision.retryAfterSec, EVENT);
  // Counts only: never routine content, prompts, or identifiers beyond today.
  const windowStart = now.slice(0, 10);
  const row = await db
    .prepare('SELECT live_generations FROM usage_windows WHERE user_id = ? AND window_start = ? LIMIT 1')
    .bind(auth.userId, windowStart)
    .first<{ live_generations: number }>();
  return json({
    windowStart,
    liveGenerations: typeof row?.live_generations === 'number' ? row.live_generations : 0,
    dailyQuota: quotaOf(resolved.env),
  });
}

export async function handleSubmitFeedback(request: Request, deps?: RoutinesDeps): Promise<Response> {
  const resolved = deps ?? await resolveRouteDeps();
  const db: Db | null = resolved.db;
  const now = (resolved.nowIso ?? (() => new Date().toISOString()))();
  const newId = resolved.newId ?? (() => crypto.randomUUID());
  if (!sameOrigin(request)) return errorResponse('Origin not allowed.', 403, 'invalid_origin', undefined, undefined, EVENT);
  if (!db) {
    return errorResponse('Routine storage is not configured.', 503, 'persistence_not_configured', undefined, undefined, EVENT);
  }
  const auth = await verifiedUserId(request, resolved.env, db, now, newId, EVENT);
  if (auth instanceof Response) return auth;
  const nowMs = Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now);
  const decision = await checkRateLimit(db, { key: userScopeKey(auth.userId, 'write'), scope: 'write', nowMs });
  if (!decision.allowed) return rateLimited(decision.retryAfterSec, EVENT);

  let score: unknown;
  let category: string | undefined;
  let routineVersionId: string | undefined;
  try {
    const body = dict(await bodyJson(request)) ?? {};
    score = body.score;
    if (body.category !== undefined) {
      if (typeof body.category !== 'string' || !FEEDBACK_CATEGORIES.has(body.category)) {
        return errorResponse('Invalid feedback category.', 400, 'invalid_category', undefined, undefined, EVENT);
      }
      category = body.category;
    }
    if (body.routineVersionId !== undefined) {
      if (typeof body.routineVersionId !== 'string' || !/^[A-Za-z0-9:_-]{1,64}$/u.test(body.routineVersionId)) {
        return errorResponse('Invalid routine version.', 400, 'invalid_version', undefined, undefined, EVENT);
      }
      routineVersionId = body.routineVersionId;
    }
  } catch {
    return errorResponse('The JSON body is invalid or exceeds the limit.', 400, 'invalid_body', undefined, undefined, EVENT);
  }
  if (score !== 1 && score !== -1) {
    return errorResponse('Score must be 1 or -1.', 400, 'invalid_score', undefined, undefined, EVENT);
  }
  await submitFeedback(db, { id: newId(), userId: auth.userId, routineVersionId, score, category, nowIso: now });
  return json({ submitted: true }, 201);
}

export async function handleDeleteAccount(request: Request, deps?: RoutinesDeps): Promise<Response> {
  const resolved = deps ?? await resolveRouteDeps();
  const db: Db | null = resolved.db;
  const now = (resolved.nowIso ?? (() => new Date().toISOString()))();
  const newId = resolved.newId ?? (() => crypto.randomUUID());
  if (!sameOrigin(request)) return errorResponse('Origin not allowed.', 403, 'invalid_origin', undefined, undefined, EVENT);
  if (!db) {
    return errorResponse('Routine storage is not configured.', 503, 'persistence_not_configured', undefined, undefined, EVENT);
  }
  const auth = await verifiedUserId(request, resolved.env, db, now, newId, EVENT);
  if (auth instanceof Response) return auth;
  const nowMs = Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now);
  const decision = await checkRateLimit(db, { key: userScopeKey(auth.userId, 'danger'), scope: 'danger', nowMs });
  if (!decision.allowed) return rateLimited(decision.retryAfterSec, EVENT);

  let confirmed = false;
  try {
    const body = dict(await bodyJson(request)) ?? {};
    confirmed = body.confirm === 'delete';
  } catch {
    return errorResponse('The JSON body is invalid or exceeds the limit.', 400, 'invalid_body', undefined, undefined, EVENT);
  }
  if (!confirmed) {
    return errorResponse('Deletion requires explicit confirmation.', 400, 'confirmation_required', undefined, undefined, EVENT);
  }
  await deleteAccount(db, auth.userId);
  // Operational rate rows are keyed by internal id only, but they belong to
  // the account: remove the exact keys (four scopes, no pattern matching).
  // The caller's pre-auth IP-hash bucket is unattributable, yet clearing it
  // keeps deletion complete for single-user egress addresses.
  await db
    .prepare('DELETE FROM rate_hits WHERE key IN (?, ?, ?, ?, ?)')
    .bind(
      `u:${auth.userId}:read`,
      `u:${auth.userId}:write`,
      `u:${auth.userId}:strict`,
      `u:${auth.userId}:danger`,
      ipScopeKey(request, 'strict'),
    )
    .run();
  return json({ deleted: true });
}
