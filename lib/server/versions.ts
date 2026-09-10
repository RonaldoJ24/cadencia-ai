// Packet 04: immutable weekly replan + version history.
// The old version is never mutated: replan parses its validated plan,
// applies the deterministic engine, and inserts a new version whose parent
// points at the previous one. Prior versions stay read-only (enforced by
// latestOnly transitions in sessions.ts) and remain retrievable so old
// calendar/export copies keep resolving to their exact version.

import type { RoutinePlan } from '../routine.ts';
import {
  createRoutineVersion,
  getRoutineDetail,
  getVersionDetail,
  listVersions,
  type Db,
  type VersionDetail,
} from './db.ts';
import { bodyJson, dict, errorResponse, json, rateLimited, sameOrigin } from './http.ts';
import { checkRateLimit, ipScopeKey, userScopeKey } from './ratelimit.ts';
import { applyReplan, ReplanError } from './replan.ts';
import { publicDetail, resolveRouteDeps, verifiedUserId, type RoutinesDeps } from './routines.ts';

const EVENT = 'cadencia_replan_failure';
const MAX_TIMEZONE = 64;
const MAX_IDS = 7;

function versionShape(detail: VersionDetail) {
  return publicDetail({ routine: detail.routine, version: detail.version, sessions: detail.sessions });
}

export async function handleListVersions(
  request: Request,
  routineId: string,
  deps?: RoutinesDeps,
): Promise<Response> {
  const resolved = deps ?? await resolveRouteDeps();
  const db: Db | null = resolved.db;
  const now = (resolved.nowIso ?? (() => new Date().toISOString()))();
  const newId = resolved.newId ?? (() => crypto.randomUUID());
  if (!db) {
    return errorResponse('Routine storage is not configured.', 503, 'persistence_not_configured', undefined, undefined, EVENT);
  }
  const auth = await verifiedUserId(request, resolved.env, db, now, newId, EVENT);
  if (auth instanceof Response) return auth;
  const readMs = Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now);
  const readDecision = await checkRateLimit(db, { key: userScopeKey(auth.userId, 'read'), scope: 'read', nowMs: readMs });
  if (!readDecision.allowed) return rateLimited(readDecision.retryAfterSec, EVENT);
  const id = routineId || '';
  if (!/^[A-Za-z0-9:_-]{1,64}$/u.test(id)) {
    return errorResponse('Routine not found.', 404, 'routine_not_found', undefined, undefined, EVENT);
  }
  const versions = await listVersions(db, auth.userId, id);
  if (!versions) {
    return errorResponse('Routine not found.', 404, 'routine_not_found', undefined, undefined, EVENT);
  }
  return json({
    versions: versions.map((version) => ({
      id: version.id,
      versionNumber: version.version_number,
      weekStart: version.week_start,
      timezone: version.timezone,
      generatedBy: version.generated_by,
      createdAt: version.created_at,
    })),
  });
}

export async function handleGetVersion(
  request: Request,
  routineId: string,
  versionNumber: number,
  deps?: RoutinesDeps,
): Promise<Response> {
  const resolved = deps ?? await resolveRouteDeps();
  const db: Db | null = resolved.db;
  const now = (resolved.nowIso ?? (() => new Date().toISOString()))();
  const newId = resolved.newId ?? (() => crypto.randomUUID());
  if (!db) {
    return errorResponse('Routine storage is not configured.', 503, 'persistence_not_configured', undefined, undefined, EVENT);
  }
  const auth = await verifiedUserId(request, resolved.env, db, now, newId, EVENT);
  if (auth instanceof Response) return auth;
  const versionMs = Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now);
  const versionDecision = await checkRateLimit(db, { key: userScopeKey(auth.userId, 'read'), scope: 'read', nowMs: versionMs });
  if (!versionDecision.allowed) return rateLimited(versionDecision.retryAfterSec, EVENT);
  const id = routineId || '';
  if (!/^[A-Za-z0-9:_-]{1,64}$/u.test(id) || !Number.isInteger(versionNumber) || versionNumber < 1) {
    return errorResponse('Version not found.', 404, 'version_not_found', undefined, undefined, EVENT);
  }
  const detail = await getVersionDetail(db, auth.userId, id, versionNumber);
  if (!detail) {
    return errorResponse('Version not found.', 404, 'version_not_found', undefined, undefined, EVENT);
  }
  return json(versionShape(detail));
}

export async function handleReplan(
  request: Request,
  routineId: string,
  deps?: RoutinesDeps,
): Promise<Response> {
  const resolved = deps ?? await resolveRouteDeps();
  const db: Db | null = resolved.db;
  const now = (resolved.nowIso ?? (() => new Date().toISOString()))();
  const newId = resolved.newId ?? (() => crypto.randomUUID());
  if (!sameOrigin(request)) return errorResponse('Origin not allowed.', 403, 'invalid_origin', undefined, undefined, EVENT);
  if (!db) {
    return errorResponse('Routine storage is not configured.', 503, 'persistence_not_configured', undefined, undefined, EVENT);
  }
  const replanMs = Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now);
  const preAuth = await checkRateLimit(db, { key: ipScopeKey(request, 'strict'), scope: 'strict', nowMs: replanMs });
  if (!preAuth.allowed) return rateLimited(preAuth.retryAfterSec, EVENT);
  const id = routineId || '';
  if (!/^[A-Za-z0-9:_-]{1,64}$/u.test(id)) {
    return errorResponse('Routine not found.', 404, 'routine_not_found', undefined, undefined, EVENT);
  }

  let markMissed: unknown;
  let timezone: string | undefined;
  try {
    const body = dict(await bodyJson(request)) ?? {};
    markMissed = body.markMissed ?? body.missedSessionIds;
    if (body.timezone !== undefined) {
      if (typeof body.timezone !== 'string') {
        return errorResponse('Invalid timezone.', 400, 'invalid_timezone', undefined, undefined, EVENT);
      }
      const trimmed = body.timezone.trim();
      if (trimmed.length === 0 || trimmed.length > MAX_TIMEZONE || /[\p{C}]/u.test(trimmed)) {
        return errorResponse('Invalid timezone.', 400, 'invalid_timezone', undefined, undefined, EVENT);
      }
      timezone = trimmed;
    }
  } catch {
    return errorResponse('The JSON body is invalid or exceeds the limit.', 400, 'invalid_body', undefined, undefined, EVENT);
  }
  if (!Array.isArray(markMissed) || markMissed.length === 0 || markMissed.length > MAX_IDS) {
    return errorResponse('Select at least one scheduled session to replan.', 400, 'nothing_to_replan', undefined, undefined, EVENT);
  }

  const auth = await verifiedUserId(request, resolved.env, db, now, newId, EVENT);
  if (auth instanceof Response) return auth;
  const userDecision = await checkRateLimit(db, { key: userScopeKey(auth.userId, 'strict'), scope: 'strict', nowMs: replanMs });
  if (!userDecision.allowed) return rateLimited(userDecision.retryAfterSec, EVENT);

  // Ownership check before touching versions: same 404 as missing.
  const current = await getRoutineDetail(db, auth.userId, id);
  if (!current) {
    return errorResponse('Routine not found.', 404, 'routine_not_found', undefined, undefined, EVENT);
  }

  let storedPlan: RoutinePlan;
  try {
    storedPlan = JSON.parse(current.version.plan_json) as RoutinePlan;
  } catch {
    return errorResponse('Stored plan is unreadable.', 502, 'persist_corrupt', undefined, undefined, EVENT);
  }

  let applied;
  try {
    applied = applyReplan(storedPlan, current.sessions, markMissed as string[]);
  } catch (error) {
    if (error instanceof ReplanError) {
      const status = error.code === 'corrupt' ? 502 : error.code === 'session_not_found' ? 404 : 400;
      const reason = error.code === 'corrupt' ? 'persist_corrupt' : error.code === 'session_not_found' ? 'session_not_found' : 'not_plannable';
      const message = error.code === 'corrupt'
        ? 'Stored plan is unreadable.'
        : error.code === 'session_not_found'
          ? 'Session not found.'
          : 'Only scheduled sessions can be replanned.';
      return errorResponse(message, status, reason, undefined, undefined, EVENT);
    }
    throw error;
  }

  const versionId = newId();
  await createRoutineVersion(db, {
    routineId: id,
    userId: auth.userId,
    versionId,
    weekStart: current.version.week_start,
    timezone: timezone ?? current.version.timezone,
    inputJson: JSON.stringify(applied.plan.input),
    planJson: JSON.stringify(applied.plan),
    nowIso: now,
    sessions: applied.sessions.map((session, ordinal) => ({
      id: `${versionId}-s${ordinal}`,
      ordinal,
      startsAt: session.startsAt,
      minutes: session.planSession.minutes,
      title: session.planSession.title.slice(0, 160),
      status: session.status,
      completedAt: session.completedAt,
      note: session.note,
    })),
  });

  const detail = await getVersionDetail(db, auth.userId, id, current.version.version_number + 1);
  if (!detail) return errorResponse('Stored plan is unreadable.', 502, 'persist_not_visible', undefined, undefined, EVENT);
  return json(
    {
      ...versionShape(detail),
      applied: {
        missedSessionIds: applied.missedDbIds,
        replacementPlanIds: applied.replacementPlanIds,
      },
    },
    201,
  );
}
