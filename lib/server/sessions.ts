// Packet 03: session completion actions. Local state transitions only;
// this path performs no provider calls by construction.

import {
  getSessionContext,
  transitionSessionWithWatermark,
  type Db,
  type SessionRow,
} from './db.ts';
import { bodyJson, dict, errorResponse, json, rateLimited, sameOrigin } from './http.ts';
import { checkRateLimit, userScopeKey } from './ratelimit.ts';
import { evidenceHashFor } from './adaptation.ts';
import { resolveRouteDeps, verifiedUserId, type RoutinesDeps } from './routines.ts';

const EVENT = 'cadencia_sessions_failure';
const MAX_NOTE = 500;

function publicSession(session: SessionRow, context: { routineId: string; versionId: string }) {
  return {
    id: session.id,
    routineId: context.routineId,
    versionId: context.versionId,
    ordinal: session.ordinal,
    startsAt: session.starts_at,
    minutes: session.scheduled_minutes,
    title: session.title,
    status: session.status,
    completedAt: session.completed_at,
    note: session.note,
  };
}

function idFromUrl(request: Request): string {
  try {
    const segments = new URL(request.url).pathname.split('/').filter(Boolean);
    // .../api/sessions/<id>/complete|skip -> id is second-to-last segment.
    return segments[segments.length - 2] ?? '';
  } catch {
    return '';
  }
}

async function handleTransition(
  request: Request,
  sessionId: string,
  status: 'done' | 'skipped',
  deps?: RoutinesDeps,
): Promise<Response> {
  // Routes inject the id from path params; fall back to the URL so direct
  // handler calls with a REST-shaped URL resolve the same way.
  const id = sessionId || idFromUrl(request);
  const resolved = deps ?? await resolveRouteDeps();
  const db: Db | null = resolved.db;
  const now = (resolved.nowIso ?? (() => new Date().toISOString()))();
  const newId = resolved.newId ?? (() => crypto.randomUUID());
  if (!sameOrigin(request)) return errorResponse('Origin not allowed.', 403, 'invalid_origin', undefined, undefined, EVENT);
  if (!db) {
    return errorResponse('Routine storage is not configured.', 503, 'persistence_not_configured', undefined, undefined, EVENT);
  }
  if (!id || !/^[A-Za-z0-9:_-]{1,64}$/u.test(id)) {
    return errorResponse('Session not found.', 404, 'session_not_found', undefined, undefined, EVENT);
  }

  let note: string | undefined;
  if (request.method !== 'GET' && request.headers.get('content-type')?.includes('application/json')) {
    try {
      const body = dict(await bodyJson(request));
      if (body && body.note !== undefined) {
        if (typeof body.note !== 'string' || body.note.length > MAX_NOTE) {
          return errorResponse('Note is too long.', 400, 'invalid_note', undefined, undefined, EVENT);
        }
        note = body.note;
      }
    } catch {
      return errorResponse('The JSON body is invalid or exceeds the limit.', 400, 'invalid_body', undefined, undefined, EVENT);
    }
  }

  const auth = await verifiedUserId(request, resolved.env, db, now, newId, EVENT);
  if (auth instanceof Response) return auth;
  const nowMs = Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now);
  const decision = await checkRateLimit(db, { key: userScopeKey(auth.userId, 'write'), scope: 'write', nowMs });
  if (!decision.allowed) return rateLimited(decision.retryAfterSec, EVENT);
  // Same 404 for missing and foreign sessions: no cross-user oracle.
  // latestOnly keeps superseded versions read-only after a replan.
  // The transition and its evidence-watermark advancement commit together
  // (transitionSessionWithWatermark): a watermark failure fails this request
  // instead of reporting success while evidence stands still.
  const updated = await transitionSessionWithWatermark(db, {
    userId: auth.userId,
    sessionId: id,
    status,
    nowIso: now,
    note,
    latestOnly: true,
    evidenceHash: evidenceHashFor({ session: id, status, now }),
  });
  if (!updated) {
    return errorResponse('Session not found.', 404, 'session_not_found', undefined, undefined, EVENT);
  }
  const context = await getSessionContext(db, auth.userId, id);
  if (!context) {
    return errorResponse('Session not found.', 404, 'session_not_found', undefined, undefined, EVENT);
  }
  return json({ session: publicSession(updated, context) });
}

function splitSessionArgs(
  sessionIdOrDeps: string | RoutinesDeps | undefined,
  deps: RoutinesDeps | undefined,
): { sessionId: string; deps: RoutinesDeps | undefined } {
  if (typeof sessionIdOrDeps !== 'string') {
    return { sessionId: '', deps: sessionIdOrDeps ?? deps };
  }
  return { sessionId: sessionIdOrDeps, deps };
}

export async function handleCompleteSession(
  request: Request,
  sessionIdOrDeps: string | RoutinesDeps,
  deps?: RoutinesDeps,
): Promise<Response> {
  const split = splitSessionArgs(sessionIdOrDeps, deps);
  return handleTransition(request, split.sessionId, 'done', split.deps);
}

export async function handleSkipSession(
  request: Request,
  sessionIdOrDeps: string | RoutinesDeps,
  deps?: RoutinesDeps,
): Promise<Response> {
  const split = splitSessionArgs(sessionIdOrDeps, deps);
  return handleTransition(request, split.sessionId, 'skipped', split.deps);
}
