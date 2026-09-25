// Public API abuse and cost controls: keyed HMAC client identity,
// atomic in-flight concurrency reservations via SQL triggers, visitor daily quota,
// and global hard usage cap before invoking upstream Cloud Run and the model provider.

import { createHmac } from 'node:crypto';
import type { Db } from './db.ts';
import { checkRateLimit, trustedIp } from './ratelimit.ts';

export type PublicLimitsConfig = {
  /** Max live generation requests per minute per visitor (default: 2). */
  minuteLimit: number;
  /** Max live generations per visitor per UTC day (default: 25). */
  visitorDailyQuota: number;
  /** Max live generations globally per UTC day (default: 150). */
  globalDailyCap: number;
  /** Max concurrent in-flight requests per visitor (default: 1). */
  visitorConcurrency: number;
  /** Max concurrent in-flight requests globally (default: 10). */
  globalConcurrency: number;
  /** Concurrency lease timeout in seconds before auto-reclaiming (default: 40s > 25s timeout). */
  concurrencyLeaseSec: number;
};

export const DEFAULT_PUBLIC_LIMITS: PublicLimitsConfig = {
  minuteLimit: 2,
  visitorDailyQuota: 25,
  globalDailyCap: 150,
  visitorConcurrency: 1,
  globalConcurrency: 10,
  concurrencyLeaseSec: 40,
};

/**
 * The count limits live in D1 (public_limits_config, seeded by migration
 * 0003 and raised by 0006) so they can change without a deploy. The atomic reservation below
 * reads the same rows; missing rows fall back to the defaults.
 */
export async function loadPublicLimits(db: Db): Promise<PublicLimitsConfig> {
  const rows = await db
    .prepare('SELECT key, value FROM public_limits_config')
    .all<{ key: string; value: number }>();
  const values = new Map(rows.results.map((row) => [row.key, Number(row.value)]));
  const read = (key: string, fallback: number): number => {
    const value = values.get(key);
    return value !== undefined && Number.isInteger(value) && value >= 0 ? value : fallback;
  };
  return {
    minuteLimit: read('minute_limit', DEFAULT_PUBLIC_LIMITS.minuteLimit),
    visitorDailyQuota: read('visitor_daily_quota', DEFAULT_PUBLIC_LIMITS.visitorDailyQuota),
    globalDailyCap: read('global_daily_cap', DEFAULT_PUBLIC_LIMITS.globalDailyCap),
    visitorConcurrency: read('visitor_concurrency', DEFAULT_PUBLIC_LIMITS.visitorConcurrency),
    globalConcurrency: read('global_concurrency', DEFAULT_PUBLIC_LIMITS.globalConcurrency),
    concurrencyLeaseSec: DEFAULT_PUBLIC_LIMITS.concurrencyLeaseSec,
  };
}

/** Compute synchronous cryptographic keyed HMAC-SHA256 for client IP identity minimization. */
export function hmacIpHash(
  ip: string,
  secret: string,
  day: string,
): string {
  if (!secret || secret.trim().length === 0) {
    throw new Error('HMAC secret is required');
  }
  return createHmac('sha256', secret.trim())
    .update(`cadencia_identity:${day}:${ip}`)
    .digest('hex');
}

/** Calculate seconds remaining until next 00:00:00 UTC for Retry-After header. */
export function secondsUntilUtcMidnight(nowMs: number): number {
  const date = new Date(nowMs);
  const nextMidnightMs = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
    0, 0, 0, 0,
  );
  return Math.max(1, Math.ceil((nextMidnightMs - nowMs) / 1000));
}

/** Extract client IP strictly from Cloudflare edge header. Never trusts x-real-ip. */
export function clientIpFromRequest(request: Request, allowFallback = false): string | null {
  const cfIp = trustedIp(request);
  if (cfIp) return cfIp;
  return allowFallback ? 'non_bypassable_fallback_ip' : null;
}

export type SlotReservationResult =
  | {
      allowed: true;
      reservationId: string;
      ipHash: string;
      day: string;
      release: () => Promise<void>;
    }
  | {
      allowed: false;
      status: 400 | 429 | 503;
      reason:
        | 'missing_client_ip'
        | 'rate_limited'
        | 'visitor_concurrent_limit'
        | 'global_concurrency_limit'
        | 'visitor_quota_exceeded'
        | 'global_quota_exceeded';
      retryAfterSec?: number;
    };

export async function checkAndReservePublicLiveSlot(
  db: Db,
  args: {
    request: Request;
    nowMs: number;
    nowIso: string;
    secret?: string;
    limits?: Partial<PublicLimitsConfig>;
    allowIpFallback?: boolean;
    reservationId?: string;
    /** How long this run may hold its slot; goal runs make several model calls. */
    leaseSec?: number;
  },
): Promise<SlotReservationResult> {
  if (!args.secret || args.secret.trim().length === 0) {
    return {
      allowed: false,
      status: 503,
      reason: 'missing_client_ip', // fail closed if secret absent
    };
  }

  const clientIp = clientIpFromRequest(args.request, args.allowIpFallback);
  if (!clientIp) {
    return {
      allowed: false,
      status: 400,
      reason: 'missing_client_ip',
    };
  }

  const limits: PublicLimitsConfig = args.limits
    ? { ...DEFAULT_PUBLIC_LIMITS, ...args.limits }
    : await loadPublicLimits(db);
  const day = args.nowIso.slice(0, 10);
  const ipHash = hmacIpHash(clientIp, args.secret ?? '', day);

  // 1. Sliding window minute rate limit (atomic conditional admission in rate_hits)
  const minuteDecision = await checkRateLimit(db, {
    key: `ip:${ipHash}:public_live`,
    scope: 'public_live',
    nowMs: args.nowMs,
    limitOverride: limits.minuteLimit,
  });
  if (!minuteDecision.allowed) {
    return {
      allowed: false,
      status: 429,
      reason: 'rate_limited',
      retryAfterSec: minuteDecision.retryAfterSec,
    };
  }

  // 2. Clear expired concurrency leases (self-healing)
  await db
    .prepare('DELETE FROM public_concurrency WHERE expires_at <= ?')
    .bind(args.nowMs)
    .run();

  // 3. Single atomic D1 batch write transaction:
  // Statement 1: atomically reserves slot ONLY IF global concurrency, global daily,
  // and visitor daily limits are strictly below caps.
  // Statements 2 & 3: atomically upsert daily counters ONLY IF the reservation row
  // was actually inserted in statement 1 (WHERE EXISTS public_concurrency WHERE id = reservationId).
  // If statement 1 condition is false (0 rows), statements 2 & 3 insert 0 rows.
  const reservationId = args.reservationId ?? crypto.randomUUID();
  const expiresAt = args.nowMs + (args.leaseSec ?? limits.concurrencyLeaseSec) * 1000;

  let batchResults: unknown[];
  try {
    batchResults = await db.batch([
      db
        .prepare(
          `INSERT INTO public_concurrency (id, ip_hash, created_at, expires_at)
           SELECT ?, ?, ?, ?
           WHERE
             (SELECT COUNT(*) FROM public_concurrency WHERE expires_at > ?) < (SELECT COALESCE((SELECT value FROM public_limits_config WHERE key = 'global_concurrency'), 10))
             AND
             (SELECT COALESCE((SELECT count FROM public_daily_usage WHERE scope = 'global' AND day = ?), 0)) < (SELECT COALESCE((SELECT value FROM public_limits_config WHERE key = 'global_daily_cap'), 150))
             AND
             (SELECT COALESCE((SELECT count FROM public_daily_usage WHERE scope = ? AND day = ?), 0)) < (SELECT COALESCE((SELECT value FROM public_limits_config WHERE key = 'visitor_daily_quota'), 25))`,
        )
        .bind(
          reservationId,
          ipHash,
          Math.floor(args.nowMs),
          Math.floor(expiresAt),
          args.nowMs,
          day,
          `ip:${ipHash}`,
          day,
        ),
      db
        .prepare(
          `INSERT INTO public_daily_usage (scope, day, count)
           SELECT ?, ?, 1
           WHERE EXISTS (SELECT 1 FROM public_concurrency WHERE id = ?)
           ON CONFLICT (scope, day)
           DO UPDATE SET count = count + 1`,
        )
        .bind(`ip:${ipHash}`, day, reservationId),
      db
        .prepare(
          `INSERT INTO public_daily_usage (scope, day, count)
           SELECT 'global', ?, 1
           WHERE EXISTS (SELECT 1 FROM public_concurrency WHERE id = ?)
           ON CONFLICT (scope, day)
           DO UPDATE SET count = count + 1`,
        )
        .bind(day, reservationId),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('visitor_concurrent_limit') || message.includes('public_concurrency.ip_hash')) {
      return {
        allowed: false,
        status: 429,
        reason: 'visitor_concurrent_limit',
        retryAfterSec: 5,
      };
    }
    throw error;
  }

  const reservationChanges = (batchResults[0] as { meta?: { changes?: number } })?.meta?.changes;
  if (reservationChanges !== 1) {
    // Slot was not reserved. Determine which limit was reached.
    const visitorUsage = await db
      .prepare('SELECT count FROM public_daily_usage WHERE scope = ? AND day = ?')
      .bind(`ip:${ipHash}`, day)
      .first<{ count: number }>();
    if ((visitorUsage?.count ?? 0) >= limits.visitorDailyQuota) {
      return {
        allowed: false,
        status: 429,
        reason: 'visitor_quota_exceeded',
        retryAfterSec: secondsUntilUtcMidnight(args.nowMs),
      };
    }

    const globalUsage = await db
      .prepare('SELECT count FROM public_daily_usage WHERE scope = ? AND day = ?')
      .bind('global', day)
      .first<{ count: number }>();
    if ((globalUsage?.count ?? 0) >= limits.globalDailyCap) {
      return {
        allowed: false,
        status: 429,
        reason: 'global_quota_exceeded',
        retryAfterSec: secondsUntilUtcMidnight(args.nowMs),
      };
    }

    return {
      allowed: false,
      status: 429,
      reason: 'global_concurrency_limit',
      retryAfterSec: 10,
    };
  }

  return {
    allowed: true,
    reservationId,
    ipHash,
    day,
    release: async () => {
      await db
        .prepare('DELETE FROM public_concurrency WHERE id = ?')
        .bind(reservationId)
        .run()
        .catch(() => undefined);
    },
  };
}
