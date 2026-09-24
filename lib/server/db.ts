// Packet 01 foundation: typed D1 persistence layer.
// Rule: every value crosses via bound `?` params. No string interpolation
// of user content into SQL. exec() is migration-only, never user input.

export interface DbStatement {
  bind(...params: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
  runSync?(): { success: boolean; meta?: { changes?: number } };
}

export interface Db {
  prepare(query: string): DbStatement;
  batch(statements: DbStatement[]): Promise<unknown[]>;
  exec?(query: string): Promise<unknown>;
}

export type BetaUserRow = {
  id: string;
  access_subject: string;
  email_hash: string;
  created_at: string;
  last_seen_at: string;
  status: 'invited' | 'active' | 'disabled';
};

export type RoutineRow = {
  id: string;
  user_id: string;
  title: string;
  language: 'en' | 'es';
  source_mode: 'demo' | 'deepseek';
  status: 'active' | 'archived' | 'deleted';
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type RoutineVersionRow = {
  id: string;
  routine_id: string;
  version_number: number;
  parent_version_id: string | null;
  week_start: string;
  timezone: string;
  input_json: string;
  plan_json: string;
  generated_by: 'demo' | 'deepseek' | 'replan';
  created_at: string;
};

export type SessionRow = {
  id: string;
  routine_version_id: string;
  ordinal: number;
  starts_at: string;
  scheduled_minutes: number;
  title: string;
  status: 'scheduled' | 'done' | 'skipped' | 'missed';
  completed_at: string | null;
  note: string | null;
};

export type GenerationRequestRow = {
  id: string;
  user_id: string;
  idempotency_key: string;
  mode: 'demo' | 'deepseek';
  outcome: 'pending' | 'completed' | 'refused' | 'failed';
  routine_id: string | null;
  provider_attempts: number;
  created_at: string;
  completed_at: string | null;
};

const MAX_TITLE = 160;
const MAX_NOTE = 500;
const MAX_TIMEZONE = 64;
const MAX_JSON_BYTES = 32_768;

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function fail(message: string): never {
  throw new Error(`cadencia_db_invalid: ${message}`);
}

function checkId(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) fail(`${label} id`);
  if (!/^[A-Za-z0-9:_-]+$/u.test(value)) fail(`${label} id charset`);
  return value;
}

function checkIsoDateTime(value: string, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(label);
  return value;
}

export function envDb(env: Record<string, unknown> | undefined): Db | null {
  if (!env) return null;
  const candidate = env.DB as Db | undefined;
  if (candidate && typeof candidate.prepare === 'function' && typeof candidate.batch === 'function') {
    return candidate;
  }
  return null;
}

export async function ensureUser(
  db: Db,
  args: { id: string; accessSubject: string; emailHash: string; nowIso: string },
): Promise<BetaUserRow> {
  checkId(args.id, 'user');
  if (!args.accessSubject || args.accessSubject.length > 320) fail('access_subject');
  if (!/^[0-9a-f]{64}$/u.test(args.emailHash)) fail('email_hash');
  checkIsoDateTime(args.nowIso, 'now');
  const existing = await db
    .prepare('SELECT id, access_subject, email_hash, created_at, last_seen_at, status FROM beta_users WHERE access_subject = ? LIMIT 1')
    .bind(args.accessSubject)
    .first<BetaUserRow>();
  if (existing) {
    await db
      .prepare('UPDATE beta_users SET last_seen_at = ? WHERE id = ?')
      .bind(args.nowIso, existing.id)
      .run();
    return { ...existing, last_seen_at: args.nowIso };
  }
  await db
    .prepare("INSERT INTO beta_users (id, access_subject, email_hash, created_at, last_seen_at, status) VALUES (?, ?, ?, ?, ?, 'active')")
    .bind(args.id, args.accessSubject, args.emailHash, args.nowIso, args.nowIso)
    .run();
  const created = await db
    .prepare('SELECT id, access_subject, email_hash, created_at, last_seen_at, status FROM beta_users WHERE id = ? LIMIT 1')
    .bind(args.id)
    .first<BetaUserRow>();
  if (!created) fail('user insert not visible');
  return created;
}

export type CreateRoutineArgs = {
  routineId: string;
  userId: string;
  title: string;
  language: 'en' | 'es';
  sourceMode: 'demo' | 'deepseek';
  nowIso: string;
  versionId: string;
  weekStart: string;
  timezone: string;
  inputJson: string;
  planJson: string;
  generatedBy: 'demo' | 'deepseek' | 'replan';
  /** Trace captured while the planner executed (0005 column). */
  traceJson?: string;
  sessions: Array<{ id: string; ordinal: number; startsAt: string; minutes: number; title: string }>;
};

export async function createRoutineWithVersion(db: Db, args: CreateRoutineArgs): Promise<void> {
  checkId(args.routineId, 'routine');
  checkId(args.userId, 'user');
  checkId(args.versionId, 'version');
  if (!args.title || args.title.length > MAX_TITLE) fail('title');
  if (args.language !== 'en' && args.language !== 'es') fail('language');
  if (args.sourceMode !== 'demo' && args.sourceMode !== 'deepseek') fail('source_mode');
  if (args.generatedBy !== 'demo' && args.generatedBy !== 'deepseek' && args.generatedBy !== 'replan') fail('generated_by');
  if (!args.timezone || args.timezone.length > MAX_TIMEZONE) fail('timezone');
  if (bytes(args.inputJson) > MAX_JSON_BYTES || bytes(args.planJson) > MAX_JSON_BYTES) fail('json too large');
  checkIsoDateTime(args.nowIso, 'now');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(args.weekStart)) fail('week_start');
  if (args.sessions.length > 7) fail('sessions count');
  const seen = new Set<string>();
  for (const session of args.sessions) {
    checkId(session.id, 'session');
    if (seen.has(session.id)) fail('duplicate session id');
    seen.add(session.id);
    if (!Number.isInteger(session.ordinal) || session.ordinal < 0 || session.ordinal > 6) fail('ordinal');
    checkIsoDateTime(session.startsAt, 'starts_at');
    if (!Number.isInteger(session.minutes) || session.minutes < 1 || session.minutes > 1440) fail('minutes');
    if (!session.title || session.title.length > MAX_TITLE) fail('session title');
  }
  await db.batch([
    db
      .prepare("INSERT INTO routines (id, user_id, title, language, source_mode, status, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL)")
      .bind(args.routineId, args.userId, args.title, args.language, args.sourceMode, args.nowIso, args.nowIso),
    db
      .prepare('INSERT INTO routine_versions (id, routine_id, version_number, parent_version_id, week_start, timezone, input_json, plan_json, generated_by, created_at, trace_json) VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?)')
      .bind(args.versionId, args.routineId, args.weekStart, args.timezone, args.inputJson, args.planJson, args.generatedBy, args.nowIso, args.traceJson ?? null),
    ...args.sessions.map((session) =>
      db
        .prepare("INSERT INTO sessions (id, routine_version_id, ordinal, starts_at, scheduled_minutes, title, status, completed_at, note) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', NULL, NULL)")
        .bind(session.id, args.versionId, session.ordinal, session.startsAt, session.minutes, session.title),
    ),
  ]);
}

export async function listRoutines(
  db: Db,
  userId: string,
  limit = 20,
  cursorUpdatedAt?: string,
  cursorId?: string,
): Promise<RoutineRow[]> {
  checkId(userId, 'user');
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 50 ? limit : 20;
  if (cursorUpdatedAt !== undefined || cursorId !== undefined) {
    if (!cursorUpdatedAt || !cursorId) fail('cursor');
    checkIsoDateTime(cursorUpdatedAt, 'cursor');
    checkId(cursorId, 'cursor');
    const { results } = await db
      .prepare("SELECT id, user_id, title, language, source_mode, status, created_at, updated_at, archived_at FROM routines WHERE user_id = ? AND status = 'active' AND (updated_at < ? OR (updated_at = ? AND id < ?)) ORDER BY updated_at DESC, id DESC LIMIT ?")
      .bind(userId, cursorUpdatedAt, cursorUpdatedAt, cursorId, safeLimit)
      .all<RoutineRow>();
    return results;
  }
  const { results } = await db
    .prepare("SELECT id, user_id, title, language, source_mode, status, created_at, updated_at, archived_at FROM routines WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC, id DESC LIMIT ?")
    .bind(userId, safeLimit)
    .all<RoutineRow>();
  return results;
}

export type RoutineDetail = { routine: RoutineRow; version: RoutineVersionRow; sessions: SessionRow[] };

export async function getRoutineDetail(db: Db, userId: string, routineId: string): Promise<RoutineDetail | null> {
  checkId(userId, 'user');
  checkId(routineId, 'routine');
  // Ownership check first: never return rows for another user.
  const routine = await db
    .prepare("SELECT id, user_id, title, language, source_mode, status, created_at, updated_at, archived_at FROM routines WHERE id = ? AND user_id = ? AND status != 'deleted' LIMIT 1")
    .bind(routineId, userId)
    .first<RoutineRow>();
  if (!routine) return null;
  const version = await db
    .prepare('SELECT id, routine_id, version_number, parent_version_id, week_start, timezone, input_json, plan_json, generated_by, created_at FROM routine_versions WHERE routine_id = ? ORDER BY version_number DESC LIMIT 1')
    .bind(routineId)
    .first<RoutineVersionRow>();
  if (!version) return null;
  const { results } = await db
    .prepare('SELECT id, routine_version_id, ordinal, starts_at, scheduled_minutes, title, status, completed_at, note FROM sessions WHERE routine_version_id = ? ORDER BY ordinal ASC')
    .bind(version.id)
    .all<SessionRow>();
  return { routine, version, sessions: results };
}

export async function setSessionStatus(
  db: Db,
  userId: string,
  sessionId: string,
  status: 'scheduled' | 'done' | 'skipped' | 'missed',
  args: { nowIso: string; note?: string; latestOnly?: boolean } = { nowIso: new Date().toISOString() },
): Promise<SessionRow | null> {
  checkId(userId, 'user');
  checkId(sessionId, 'session');
  if (status !== 'scheduled' && status !== 'done' && status !== 'skipped' && status !== 'missed') fail('status');
  checkIsoDateTime(args.nowIso, 'now');
  if (args.note !== undefined && (typeof args.note !== 'string' || args.note.length > MAX_NOTE)) fail('note');
  // Ownership enforced via join to routines; cross-user ids return null.
  // latestOnly freezes superseded versions: only the current version accepts
  // transitions, so history stays read-only after a replan.
  const current = await db
    .prepare(
      args.latestOnly
        ? 'SELECT s.id, s.routine_version_id, s.ordinal, s.starts_at, s.scheduled_minutes, s.title, s.status, s.completed_at, s.note FROM sessions s JOIN routine_versions v ON v.id = s.routine_version_id JOIN routines r ON r.id = v.routine_id WHERE s.id = ? AND r.user_id = ? AND v.version_number = (SELECT MAX(version_number) FROM routine_versions WHERE routine_id = v.routine_id) LIMIT 1'
        : 'SELECT s.id, s.routine_version_id, s.ordinal, s.starts_at, s.scheduled_minutes, s.title, s.status, s.completed_at, s.note FROM sessions s JOIN routine_versions v ON v.id = s.routine_version_id JOIN routines r ON r.id = v.routine_id WHERE s.id = ? AND r.user_id = ? LIMIT 1',
    )
    .bind(sessionId, userId)
    .first<SessionRow>();
  if (!current) return null;
  if (current.status === status) return current;
  const completedAt = status === 'done' ? args.nowIso : null;
  await db
    .prepare('UPDATE sessions SET status = ?, completed_at = ?, note = ? WHERE id = ?')
    .bind(status, completedAt, args.note ?? current.note, sessionId)
    .run();
  return { ...current, status, completed_at: completedAt, note: args.note ?? current.note };
}

export type SessionTransition = {
  userId: string;
  sessionId: string;
  status: 'done' | 'skipped' | 'missed';
  nowIso: string;
  note?: string;
  latestOnly?: boolean;
  evidenceHash: string;
};

/**
 * Session transition plus evidence-watermark advancement as ONE consistent
 * operation. The ownership-checked current row is read first; then a single
 * D1 batch applies the guarded status UPDATE and the atomic watermark
 * upsert together. Either both commit or neither does: a watermark failure
 * can never hide behind a reported success, and every successful transition
 * moves evidence (invalidating older adaptation proposals through their
 * watermark binding). Zero affected rows (lost race, foreign id) reads as
 * null, exactly like a missing session.
 */
export async function transitionSessionWithWatermark(
  db: Db,
  args: SessionTransition,
): Promise<SessionRow | null> {
  checkId(args.userId, 'user');
  checkId(args.sessionId, 'session');
  if (args.status !== 'done' && args.status !== 'skipped' && args.status !== 'missed') fail('status');
  checkIsoDateTime(args.nowIso, 'now');
  if (args.note !== undefined && (typeof args.note !== 'string' || args.note.length > MAX_NOTE)) fail('note');
  if (!args.evidenceHash || !/^[0-9a-f]{64}$/u.test(args.evidenceHash)) fail('evidence_hash');
  const latestOnly = args.latestOnly ?? true;
  const current = await db
    .prepare(
      latestOnly
        ? 'SELECT s.id, s.routine_version_id, s.ordinal, s.starts_at, s.scheduled_minutes, s.title, s.status, s.completed_at, s.note FROM sessions s JOIN routine_versions v ON v.id = s.routine_version_id JOIN routines r ON r.id = v.routine_id WHERE s.id = ? AND r.user_id = ? AND v.version_number = (SELECT MAX(version_number) FROM routine_versions WHERE routine_id = v.routine_id) LIMIT 1'
        : 'SELECT s.id, s.routine_version_id, s.ordinal, s.starts_at, s.scheduled_minutes, s.title, s.status, s.completed_at, s.note FROM sessions s JOIN routine_versions v ON v.id = s.routine_version_id JOIN routines r ON r.id = v.routine_id WHERE s.id = ? AND r.user_id = ? LIMIT 1',
    )
    .bind(args.sessionId, args.userId)
    .first<SessionRow>();
  if (!current) return null;
  if (current.status === args.status) return current;
  const completedAt = args.status === 'done' ? args.nowIso : null;
  const note = args.note ?? current.note;
  const results = await db.batch([
    db
      .prepare(
        latestOnly
          ? 'UPDATE sessions SET status = ?, completed_at = ?, note = ? WHERE id = ? AND EXISTS (SELECT 1 FROM sessions AS s JOIN routine_versions AS v ON v.id = s.routine_version_id JOIN routines AS r ON r.id = v.routine_id WHERE s.id = sessions.id AND r.user_id = ? AND v.version_number = (SELECT MAX(version_number) FROM routine_versions WHERE routine_id = v.routine_id))'
          : 'UPDATE sessions SET status = ?, completed_at = ?, note = ? WHERE id = ? AND EXISTS (SELECT 1 FROM sessions AS s JOIN routine_versions AS v ON v.id = s.routine_version_id JOIN routines AS r ON r.id = v.routine_id WHERE s.id = sessions.id AND r.user_id = ?)',
      )
      .bind(args.status, completedAt, note, args.sessionId, args.userId),
    db
      .prepare('INSERT INTO evidence_watermarks (scope_key, watermark, evidence_hash, updated_at) VALUES ((SELECT ? || r.id FROM routines AS r JOIN routine_versions AS v ON v.routine_id = r.id JOIN sessions AS s ON s.routine_version_id = v.id WHERE s.id = ? LIMIT 1), 1, ?, ?) ON CONFLICT (scope_key) DO UPDATE SET watermark = watermark + 1, evidence_hash = excluded.evidence_hash, updated_at = excluded.updated_at')
      .bind('routine:', args.sessionId, args.evidenceHash, args.nowIso),
  ]);
  const changes = (results[0] as { meta?: { changes?: number } } | null)?.meta?.changes;
  if (changes !== 1) return null;
  return { ...current, status: args.status, completed_at: completedAt, note };
}

export type SessionContext = { routineId: string; versionId: string };

export async function getSessionContext(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<SessionContext | null> {
  checkId(userId, 'user');
  checkId(sessionId, 'session');
  const row = await db
    .prepare('SELECT v.routine_id AS routineId, s.routine_version_id AS versionId FROM sessions s JOIN routine_versions v ON v.id = s.routine_version_id JOIN routines r ON r.id = v.routine_id WHERE s.id = ? AND r.user_id = ? LIMIT 1')
    .bind(sessionId, userId)
    .first<SessionContext>();
  return row;
}

export async function reserveGenerationSlot(
  db: Db,
  args: { requestId: string; userId: string; idempotencyKey: string; mode: 'demo' | 'deepseek'; nowIso: string; dailyQuota: number },
): Promise<{ duplicate: boolean; existingRoutineId: string | null }> {
  checkId(args.requestId, 'request');
  checkId(args.userId, 'user');
  if (!args.idempotencyKey || args.idempotencyKey.length > 128) fail('idempotency_key');
  if (args.mode !== 'demo' && args.mode !== 'deepseek') fail('mode');
  checkIsoDateTime(args.nowIso, 'now');
  const existing = await db
    .prepare('SELECT id, user_id, idempotency_key, mode, outcome, routine_id, provider_attempts, created_at, completed_at FROM generation_requests WHERE user_id = ? AND idempotency_key = ? LIMIT 1')
    .bind(args.userId, args.idempotencyKey)
    .first<GenerationRequestRow>();
  if (existing) return { duplicate: true, existingRoutineId: existing.routine_id };
  if (args.mode === 'deepseek') {
    const windowStart = args.nowIso.slice(0, 10);
    const window = await db
      .prepare('SELECT user_id, window_start, live_generations FROM usage_windows WHERE user_id = ? AND window_start = ? LIMIT 1')
      .bind(args.userId, windowStart)
      .first<{ live_generations: number }>();
    if (window && window.live_generations >= args.dailyQuota) fail('quota_exceeded');
  }
  await db.batch([
    db
      .prepare("INSERT INTO generation_requests (id, user_id, idempotency_key, mode, outcome, routine_id, provider_attempts, created_at, completed_at) VALUES (?, ?, ?, ?, 'pending', NULL, 0, ?, NULL)")
      .bind(args.requestId, args.userId, args.idempotencyKey, args.mode, args.nowIso),
    ...(args.mode === 'deepseek'
      ? [
          db
            .prepare('INSERT INTO usage_windows (user_id, window_start, live_generations) VALUES (?, ?, 1) ON CONFLICT (user_id, window_start) DO UPDATE SET live_generations = live_generations + 1')
            .bind(args.userId, args.nowIso.slice(0, 10)),
        ]
      : []),
  ]);
  return { duplicate: false, existingRoutineId: null };
}

export async function completeGenerationRequest(
  db: Db,
  args: {
    userId: string;
    idempotencyKey: string;
    outcome: 'completed' | 'refused' | 'failed';
    routineId?: string;
    completedAt: string;
    providerAttempts?: number;
  },
): Promise<void> {
  if (!args.idempotencyKey || args.idempotencyKey.length > 128) fail('idempotency_key');
  if (args.outcome !== 'completed' && args.outcome !== 'refused' && args.outcome !== 'failed') fail('outcome');
  if (args.routineId !== undefined) checkId(args.routineId, 'routine');
  if (args.providerAttempts !== undefined && (!Number.isInteger(args.providerAttempts) || args.providerAttempts < 0)) fail('provider_attempts');
  checkIsoDateTime(args.completedAt, 'completed_at');
  const existing = await db
    .prepare('SELECT id, user_id, idempotency_key, mode, outcome, routine_id, provider_attempts, created_at, completed_at FROM generation_requests WHERE user_id = ? AND idempotency_key = ? LIMIT 1')
    .bind(args.userId, args.idempotencyKey)
    .first<GenerationRequestRow>();
  if (!existing) fail('unknown idempotency key');
  if (existing.outcome !== 'pending') return;
  await db
    .prepare('UPDATE generation_requests SET outcome = ?, routine_id = ?, completed_at = ?, provider_attempts = ? WHERE user_id = ? AND idempotency_key = ?')
    .bind(args.outcome, args.routineId ?? existing.routine_id, args.completedAt, args.providerAttempts ?? existing.provider_attempts, args.userId, args.idempotencyKey)
    .run();
}

export async function submitFeedback(
  db: Db,
  args: { id: string; userId: string; routineVersionId?: string; score: 1 | -1; category?: string; nowIso: string },
): Promise<void> {
  checkId(args.id, 'feedback');
  checkId(args.userId, 'user');
  if (args.routineVersionId !== undefined) checkId(args.routineVersionId, 'version');
  if (args.score !== 1 && args.score !== -1) fail('score');
  const allowed = new Set(['useful', 'too_generic', 'too_hard', 'too_easy', 'unsafe', 'other']);
  if (args.category !== undefined && !allowed.has(args.category)) fail('category');
  checkIsoDateTime(args.nowIso, 'now');
  await db
    .prepare('INSERT INTO feedback (id, user_id, routine_version_id, score, category, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(args.id, args.userId, args.routineVersionId ?? null, args.score, args.category ?? null, args.nowIso)
    .run();
}

export async function deleteAccount(db: Db, userId: string): Promise<void> {
  checkId(userId, 'user');
  // Cascades remove routines, versions, sessions, requests, feedback, windows.
  await db.prepare('DELETE FROM beta_users WHERE id = ?').bind(userId).run();
}

/**
 * Retention sweep for terminal generation records (failed/refused) older
 * than the cutoff. Completed records stay: they back idempotent replays.
 * Wire to a scheduled trigger; safe to run repeatedly.
 */
export async function purgeExpiredGenerations(db: Db, olderThanIso: string): Promise<number> {
  checkIsoDateTime(olderThanIso, 'cutoff');
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM generation_requests WHERE outcome IN ('failed', 'refused') AND completed_at IS NOT NULL AND completed_at < ?")
    .bind(olderThanIso)
    .first<{ n: number }>();
  const count = typeof row?.n === 'number' ? row.n : 0;
  if (count === 0) return 0;
  await db
    .prepare("DELETE FROM generation_requests WHERE outcome IN ('failed', 'refused') AND completed_at IS NOT NULL AND completed_at < ?")
    .bind(olderThanIso)
    .run();
  return count;
}

export type VersionSummary = {
  id: string;
  version_number: number;
  week_start: string;
  timezone: string;
  generated_by: RoutineVersionRow['generated_by'];
  created_at: string;
};

async function ownedRoutine(db: Db, userId: string, routineId: string): Promise<RoutineRow | null> {
  checkId(userId, 'user');
  checkId(routineId, 'routine');
  return db
    .prepare("SELECT id, user_id, title, language, source_mode, status, created_at, updated_at, archived_at FROM routines WHERE id = ? AND user_id = ? AND status != 'deleted' LIMIT 1")
    .bind(routineId, userId)
    .first<RoutineRow>();
}

export async function listVersions(db: Db, userId: string, routineId: string): Promise<VersionSummary[] | null> {
  const routine = await ownedRoutine(db, userId, routineId);
  if (!routine) return null;
  const { results } = await db
    .prepare('SELECT id, version_number, week_start, timezone, generated_by, created_at FROM routine_versions WHERE routine_id = ? ORDER BY version_number ASC')
    .bind(routineId)
    .all<VersionSummary>();
  return results;
}

export type VersionDetail = { routine: RoutineRow; version: RoutineVersionRow; sessions: SessionRow[] };

export async function getVersionDetail(
  db: Db,
  userId: string,
  routineId: string,
  versionNumber: number,
): Promise<VersionDetail | null> {
  const routine = await ownedRoutine(db, userId, routineId);
  if (!routine) return null;
  if (!Number.isInteger(versionNumber) || versionNumber < 1) fail('version_number');
  const version = await db
    .prepare('SELECT id, routine_id, version_number, parent_version_id, week_start, timezone, input_json, plan_json, generated_by, created_at FROM routine_versions WHERE routine_id = ? AND version_number = ? LIMIT 1')
    .bind(routineId, versionNumber)
    .first<RoutineVersionRow>();
  if (!version) return null;
  const { results } = await db
    .prepare('SELECT id, routine_version_id, ordinal, starts_at, scheduled_minutes, title, status, completed_at, note FROM sessions WHERE routine_version_id = ? ORDER BY ordinal ASC')
    .bind(version.id)
    .all<SessionRow>();
  return { routine, version, sessions: results };
}

export type CreateVersionSession = {
  id: string;
  ordinal: number;
  startsAt: string;
  minutes: number;
  title: string;
  status: SessionRow['status'];
  completedAt: string | null;
  note: string | null;
};

export async function createRoutineVersion(
  db: Db,
  args: {
    routineId: string;
    userId: string;
    versionId: string;
    weekStart: string;
    timezone: string;
    inputJson: string;
    planJson: string;
    nowIso: string;
    sessions: CreateVersionSession[];
  },
): Promise<RoutineVersionRow> {
  const routine = await ownedRoutine(db, args.userId, args.routineId);
  if (!routine) fail('routine not owned');
  checkId(args.versionId, 'version');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(args.weekStart)) fail('week_start');
  if (!args.timezone || args.timezone.length > MAX_TIMEZONE) fail('timezone');
  if (bytes(args.inputJson) > MAX_JSON_BYTES || bytes(args.planJson) > MAX_JSON_BYTES) fail('json too large');
  checkIsoDateTime(args.nowIso, 'now');
  if (args.sessions.length > 14) fail('sessions count');
  const seen = new Set<string>();
  const ordinals = new Set<number>();
  for (const session of args.sessions) {
    checkId(session.id, 'session');
    if (seen.has(session.id)) fail('duplicate session id');
    seen.add(session.id);
    if (!Number.isInteger(session.ordinal) || session.ordinal < 0) fail('ordinal');
    if (ordinals.has(session.ordinal)) fail('duplicate ordinal');
    ordinals.add(session.ordinal);
    checkIsoDateTime(session.startsAt, 'starts_at');
    if (!Number.isInteger(session.minutes) || session.minutes < 1 || session.minutes > 1440) fail('minutes');
    if (!session.title || session.title.length > MAX_TITLE) fail('session title');
    if (session.status !== 'scheduled' && session.status !== 'done' && session.status !== 'skipped' && session.status !== 'missed') fail('status');
    if (session.note !== null && (typeof session.note !== 'string' || session.note.length > MAX_NOTE)) fail('note');
    if (session.completedAt !== null) checkIsoDateTime(session.completedAt, 'completed_at');
  }
  const current = await db
    .prepare('SELECT id, routine_id, version_number, parent_version_id, week_start, timezone, input_json, plan_json, generated_by, created_at FROM routine_versions WHERE routine_id = ? ORDER BY version_number DESC LIMIT 1')
    .bind(args.routineId)
    .first<RoutineVersionRow>();
  if (!current) fail('no current version');
  const nextNumber = current.version_number + 1;
  await db.batch([
    db
      .prepare('INSERT INTO routine_versions (id, routine_id, version_number, parent_version_id, week_start, timezone, input_json, plan_json, generated_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(args.versionId, args.routineId, nextNumber, current.id, args.weekStart, args.timezone, args.inputJson, args.planJson, 'replan', args.nowIso),
    ...args.sessions.map((session) =>
      db
        .prepare('INSERT INTO sessions (id, routine_version_id, ordinal, starts_at, scheduled_minutes, title, status, completed_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(session.id, args.versionId, session.ordinal, session.startsAt, session.minutes, session.title, session.status, session.completedAt, session.note),
    ),
    db
      .prepare('UPDATE routines SET updated_at = ? WHERE id = ?')
      .bind(args.nowIso, args.routineId),
  ]);
  const created = await db
    .prepare('SELECT id, routine_id, version_number, parent_version_id, week_start, timezone, input_json, plan_json, generated_by, created_at FROM routine_versions WHERE id = ? LIMIT 1')
    .bind(args.versionId)
    .first<RoutineVersionRow>();
  if (!created) fail('version insert not visible');
  return created;
}
