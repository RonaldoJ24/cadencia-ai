// Packet 05: D1-backed API rate limiting. Fixed window per caller scope.
// Keys are user ids (authed) or a non-reversible hash of the connecting IP
// (pre-auth), so no raw IP persists. Responses stay generic with Retry-After.

import type { Db } from './db.ts';

export const RATE_SCOPES = {
  /** Reads: list, detail, versions, quota. */
  read: { limit: 120, windowSec: 60 },
  /** Routine writes: complete, skip, feedback. */
  write: { limit: 30, windowSec: 60 },
  /** Costly writes: routine create, replan. */
  strict: { limit: 10, windowSec: 60 },
  /** Irreversible: account deletion. */
  danger: { limit: 5, windowSec: 60 },
  /** Public generation: live mode (conservative 2/min). */
  public_live: { limit: 2, windowSec: 60 },
  /** Public generation: Local demo mode (30/min). */
  public_demo: { limit: 30, windowSec: 60 },
} as const;

export type RateScope = keyof typeof RATE_SCOPES;

export function fnv1aHex(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Extract trusted client IP from Cloudflare header only. Never trusts x-real-ip. */
export function trustedIp(request: Request): string | null {
  const cfIp = (request.headers.get('cf-connecting-ip') ?? '').trim();
  if (cfIp.length > 0 && cfIp.length <= 128) return cfIp;
  return null;
}

export function trustedIpHash(request: Request): string {
  const ip = trustedIp(request) ?? 'missing_client_ip';
  return fnv1aHex(ip);
}

/** Caller key for pre-auth checks: hashed IP only, never raw. */
export function ipScopeKey(request: Request, scope: RateScope): string {
  return `ip:${trustedIpHash(request)}:${scope}`;
}

export function userScopeKey(userId: string, scope: RateScope): string {
  return `u:${userId}:${scope}`;
}

export type RateDecision = { allowed: boolean; retryAfterSec: number };

export async function checkRateLimit(
  db: Db,
  args: { key: string; scope: RateScope; nowMs: number; limitOverride?: number },
): Promise<RateDecision> {
  const limit = args.limitOverride ?? RATE_SCOPES[args.scope].limit;
  const { windowSec } = RATE_SCOPES[args.scope];
  if (!args.key || args.key.length > 160) {
    return { allowed: false, retryAfterSec: windowSec };
  }
  if (!Number.isFinite(args.nowMs) || args.nowMs < 0) {
    return { allowed: false, retryAfterSec: windowSec };
  }
  const windowMs = windowSec * 1000;
  const cutoff = args.nowMs - windowMs;
  await db.prepare('DELETE FROM rate_hits WHERE key = ? AND ts <= ?').bind(args.key, cutoff).run();

  const countRow = await db
    .prepare('SELECT COUNT(*) AS n, MIN(ts) AS oldest FROM rate_hits WHERE key = ? AND ts > ?')
    .bind(args.key, cutoff)
    .first<{ n: number; oldest: number | null }>();
  const count = typeof countRow?.n === 'number' ? countRow.n : 0;
  if (count >= limit) {
    const oldest = typeof countRow?.oldest === 'number' ? countRow.oldest : args.nowMs;
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - args.nowMs) / 1000)) };
  }

  // Atomic conditional admission: writes hit record only if active hits are strictly below limit.
  const res = await db
    .prepare(
      'INSERT INTO rate_hits (key, ts) SELECT ?, ? WHERE (SELECT COUNT(*) FROM rate_hits WHERE key = ? AND ts > ?) < ?',
    )
    .bind(args.key, Math.floor(args.nowMs), args.key, cutoff, limit)
    .run();

  const changes = (res as { meta?: { changes?: number } })?.meta?.changes;
  if (typeof changes === 'number') {
    if (changes < 1) {
      const oldest = typeof countRow?.oldest === 'number' ? countRow.oldest : args.nowMs;
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - args.nowMs) / 1000)) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  return { allowed: true, retryAfterSec: 0 };
}
