// Reviewer Replay capability-scoped sandbox store. Anonymous demo state on
// the exact /api/routine path: high-entropy opaque capabilities, SHA-256
// hashes at rest, Secure HttpOnly SameSite cookies, short expiry,
// revocation, quotas, and opportunistic cleanup. The raw capability never
// appears in bodies, logs, analytics, trace data, errors, or cURL examples.

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';
import { scheduleHashSync } from '../trace.ts';
import { evidenceHashFor, scopeKeyFor, sha256HexSync } from './adaptation.ts';
import { fixtureCompile, FIXTURE_EVIDENCE_CUTOFF, FIXTURE_TIMEZONE } from './fixture.ts';

export const REPLAY_COOKIE = 'cadencia_replay';
export const SANDBOX_TTL_MS = 30 * 60_000;
export const PROPOSAL_TTL_MS = 15 * 60_000;
/** Max sandboxes issued globally per UTC day (abuse budget). */
export const GLOBAL_SANDBOX_DAILY_CAP = 200;
/** Max sandboxes per IP hash per UTC day. */
export const IP_SANDBOX_DAILY_CAP = 10;
/** Max state-changing replay actions per capability per minute. */
export const CAPABILITY_MINUTE_LIMIT = 12;
/** Max Workflows started globally per UTC day. */
export const GLOBAL_WORKFLOW_DAILY_CAP = 100;

export const REPLAY_EVENT_ALLOWLIST = ['replay-missed-tuesday', 'approve', 'reject'] as const;
export type ReplayEvent = (typeof REPLAY_EVENT_ALLOWLIST)[number];

export type SandboxRow = {
  capability_hash: string;
  ip_hash: string;
  created_at: string;
  expires_at: string;
  revoked: number;
  current_revision: number;
  base_schedule_hash: string;
  current_schedule_json: string;
  current_trace_json: string | null;
  evidence_watermark: number;
  evidence_hash: string;
  active_workflow_id: string | null;
};

function fail(message: string): never {
  throw new Error(`cadencia_sandbox_invalid: ${message}`);
}

/** High-entropy opaque capability (256 bits, URL-safe). Never stored raw. */
export function issueCapability(): string {
  const bytes = randomBytes(32);
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function hashCapability(raw: string): string {
  return sha256HexSync(raw);
}

export function validCapabilityFormat(raw: string): boolean {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(raw);
}

function hashBytes(hashHex: string): Uint8Array {
  const bytes = new Uint8Array(hashHex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hashHex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function capabilityMatches(raw: string, storedHash: string): boolean {
  if (!validCapabilityFormat(raw) || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  try {
    return timingSafeEqual(hashBytes(hashCapability(raw)), hashBytes(storedHash));
  } catch {
    return false;
  }
}

export function cookieHeader(raw: string, requestUrl: string, maxAgeSec: number): string {
  const secure = requestUrl.startsWith('https://') ? '; Secure' : '';
  return `${REPLAY_COOKIE}=${raw}; Path=/; Max-Age=${maxAgeSec}; HttpOnly${secure}; SameSite=Lax`;
}

export function expiredCookieHeader(): string {
  return `${REPLAY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

export function capabilityFromRequest(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== REPLAY_COOKIE) continue;
    const value = part.slice(separator + 1).trim().replace(/^"|"$/g, '');
    return validCapabilityFormat(value) ? value : null;
  }
  return null;
}

export async function dailyCount(db: Db, scope: string, day: string): Promise<number> {
  const row = await db
    .prepare('SELECT count FROM public_daily_usage WHERE scope = ? AND day = ? LIMIT 1')
    .bind(scope, day)
    .first<{ count: number }>();
  return typeof row?.count === 'number' ? row.count : 0;
}

/**
 * Atomic daily-budget reservation. The conditional upsert admits at most
 * `cap` counts: concurrent callers cannot jointly overshoot, because the
 * increment itself is the guard. A zero-change write means the budget was
 * already exhausted, so `meta.changes === 1` is the exact admission signal.
 */
export async function reserveDailyBudget(db: Db, scope: string, day: string, cap: number): Promise<boolean> {
  const result = await db
    .prepare('INSERT INTO public_daily_usage (scope, day, count) SELECT ?, ?, 1 WHERE COALESCE((SELECT count FROM public_daily_usage WHERE scope = ? AND day = ?), 0) < ? ON CONFLICT (scope, day) DO UPDATE SET count = count + 1 WHERE count < ?')
    .bind(scope, day, scope, day, cap, cap)
    .run();
  const changes = (result as { meta?: { changes?: number } } | null)?.meta?.changes;
  return changes === 1;
}

/** Best-effort refund of one budget slot (compensation paths only). */
export async function releaseDailyBudget(db: Db, scope: string, day: string): Promise<void> {
  await db
    .prepare('UPDATE public_daily_usage SET count = count - 1 WHERE scope = ? AND day = ? AND count > 0')
    .bind(scope, day)
    .run()
    .catch(() => undefined);
}

export async function createSandbox(
  db: Db,
  args: { ipHash: string; nowIso: string; nowMs: number },
): Promise<{ raw: string; hash: string; sandbox: SandboxRow }> {
  if (!args.ipHash) fail('ip hash');
  const day = args.nowIso.slice(0, 10);
  if (!(await reserveDailyBudget(db, 'reviewer_sandbox_issuance', day, GLOBAL_SANDBOX_DAILY_CAP))) {
    fail('global sandbox budget exhausted');
  }
  if (!(await reserveDailyBudget(db, `reviewer_sandbox_ip:${args.ipHash}`, day, IP_SANDBOX_DAILY_CAP))) {
    fail('ip sandbox quota exceeded');
  }
  const compiled = fixtureCompile('en');
  const plan = compiled.plan;
  const scheduleHash = scheduleHashSync(plan, FIXTURE_TIMEZONE);
  const evidenceHash = evidenceHashFor({ cutoff: FIXTURE_EVIDENCE_CUTOFF, missed: 'none' });
  const raw = issueCapability();
  const hash = hashCapability(raw);
  const createdAt = args.nowIso;
  const expiresAt = new Date(args.nowMs + SANDBOX_TTL_MS).toISOString();
  // Stored schedule preserves complete input/constraints plus full session
  // content (plan-domain statuses, stable logicalIds). The served trace is
  // the compile captured below — never rebuilt from these rows later.
  const traceJson = JSON.stringify(compiled.trace);
  const scheduleJson = JSON.stringify({
    revision: 1,
    input: plan.input,
    sessions: plan.sessions.map((session, index) => ({
      ...session,
      blocks: session.blocks.map((block) => ({ ...block })),
      logicalId: `intent-step-${index + 1}`,
      startsAt: `${session.date}T${plan.input.time}:00`,
    })),
  });
  await db.batch([
    db.prepare('INSERT INTO demo_sandboxes (capability_hash, ip_hash, created_at, expires_at, revoked, current_revision, base_schedule_hash, current_schedule_json, current_trace_json, evidence_watermark, evidence_hash, active_workflow_id) VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, 1, ?, NULL)')
      .bind(hash, args.ipHash, createdAt, expiresAt, scheduleHash, scheduleJson, traceJson, evidenceHash),
    db.prepare('INSERT INTO evidence_watermarks (scope_key, watermark, evidence_hash, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT (scope_key) DO UPDATE SET watermark = 1, evidence_hash = ?, updated_at = ?')
      .bind(scopeKeyFor('sandbox', undefined, hash), evidenceHash, createdAt, evidenceHash, createdAt),
  ]);
  const sandbox = await getSandboxByHash(db, hash);
  if (!sandbox) fail('sandbox insert not visible');
  return { raw, hash, sandbox: sandbox as SandboxRow };
}

export async function getSandboxByHash(db: Db, hash: string): Promise<SandboxRow | null> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  return db
    .prepare('SELECT capability_hash, ip_hash, created_at, expires_at, revoked, current_revision, base_schedule_hash, current_schedule_json, current_trace_json, evidence_watermark, evidence_hash, active_workflow_id FROM demo_sandboxes WHERE capability_hash = ? LIMIT 1')
    .bind(hash)
    .first<SandboxRow>();
}

export async function getSandboxByCapability(db: Db, raw: string | null, nowIso: string): Promise<SandboxRow | null> {
  if (!raw || !validCapabilityFormat(raw)) return null;
  const sandbox = await getSandboxByHash(db, hashCapability(raw));
  if (!sandbox || sandbox.revoked) return null;
  // Defense in depth: constant-time comparison of the presented capability
  // against the stored hash, even though the indexed lookup already matched.
  if (!capabilityMatches(raw, sandbox.capability_hash)) return null;
  if (Date.parse(nowIso) > Date.parse(sandbox.expires_at)) return null;
  return sandbox;
}

export async function revokeSandbox(db: Db, hash: string, nowIso: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return;
  // Revocation terminalizes: the sandbox is revoked, its workflow reference
  // cleared, and every still-active proposal is cancelled with an audit row
  // (a revoked sandbox must never keep an awaiting proposal behind).
  const actives = await db
    .prepare("SELECT id FROM adaptation_proposals WHERE sandbox_hash = ? AND status IN ('queued', 'computing', 'awaiting_approval', 'committing')")
    .bind(hash)
    .all<{ id: string }>();
  const statements = [
    db.prepare('UPDATE demo_sandboxes SET revoked = 1, active_workflow_id = NULL WHERE capability_hash = ?').bind(hash),
    ...actives.results.flatMap((row) => [
      db.prepare("UPDATE adaptation_proposals SET status = 'cancelled', resolved_at = ? WHERE id = ?").bind(nowIso, row.id),
      db.prepare("INSERT INTO adaptation_audit (id, proposal_id, action, actor, created_at, detail_json) VALUES (?, ?, 'revoked', 'system', ?, ?)").bind(`audit-${randomUUID()}`, row.id, nowIso, '{}'),
    ]),
  ];
  await db.batch(statements);
}

/** Opportunistic deletion of expired rows (issuance, sandboxes, proposals). */
export async function cleanupExpired(db: Db, nowIso: string): Promise<{ sandboxes: number; proposals: number }> {
  const expiredSandboxes = await db
    .prepare('SELECT capability_hash AS hash FROM demo_sandboxes WHERE expires_at < ? LIMIT 100')
    .bind(nowIso)
    .all<{ hash: string }>();
  for (const row of expiredSandboxes.results) {
    await db.prepare('DELETE FROM demo_sandboxes WHERE capability_hash = ?').bind(row.hash).run();
    // Proposals and audit rows cascade with the sandbox; the watermark row
    // does not, so remove it explicitly to avoid orphan accumulation.
    await db.prepare('DELETE FROM evidence_watermarks WHERE scope_key = ?').bind(scopeKeyFor('sandbox', undefined, row.hash)).run();
  }
  const expiredProposals = await db
    .prepare("SELECT id, sandbox_hash AS sandboxHash FROM adaptation_proposals WHERE status IN ('queued', 'computing', 'awaiting_approval') AND expires_at < ? LIMIT 100")
    .bind(nowIso)
    .all<{ id: string; sandboxHash: string | null }>();
  for (const row of expiredProposals.results) {
    await db.prepare("UPDATE adaptation_proposals SET status = 'expired', resolved_at = ? WHERE id = ?").bind(nowIso, row.id).run();
    // No workflow remains running for an expired proposal: clear the
    // sandbox's workflow reference so state never claims otherwise.
    if (row.sandboxHash) {
      await db.prepare('UPDATE demo_sandboxes SET active_workflow_id = NULL WHERE capability_hash = ?').bind(row.sandboxHash).run();
    }
  }
  return { sandboxes: expiredSandboxes.results.length, proposals: expiredProposals.results.length };
}

/** Redacted cURL example: capability placeholder, never the raw secret. */
export function safeReplayCurlExample(origin: string): string {
  const base = origin.replace(/\/+$/, '');
  return [
    '# Reviewer Replay (cookie holds the capability; it never appears here)',
    `# State-changing calls require: -H "Origin: ${base}"`,
    `curl -s -b "${REPLAY_COOKIE}=<cookie-from-Set-Cookie>" ${base}/api/routine`,
    `curl -s -X PATCH -b "${REPLAY_COOKIE}=<cookie-from-Set-Cookie>" \\`,
    `  -H 'content-type: application/json' -H "Origin: ${base}" \\`,
    `  -d '{"action":"replay-missed-tuesday"}' ${base}/api/routine`,
  ].join('\n');
}
