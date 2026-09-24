// Dollar caps and the kill switch for live AI. Every live generation
// reserves its worst-case cost before the model is called, and only when the
// day's and month's committed spend plus that reservation stay within the
// caps in app_settings. The reservation is settled afterwards at the cost of
// the reported token usage. Amounts are integers in millionths of a dollar.

import type { Db } from './db.ts';
import { secondsUntilUtcMidnight } from './public_limits.ts';

/**
 * DeepSeek's peak-hour list prices, the highest rates on the page, so every
 * settled cost is an upper bound. USD per million tokens equals micro-USD
 * per token.
 */
export const RATE_CARD = {
  inputUsdPerMillion: 0.3,
  outputUsdPerMillion: 1.2,
  source: 'https://api-docs.deepseek.com/quick_start/pricing (read 2026-09-24)',
} as const;

/** Bounds of one live generation, from service/provider.py. */
export const WORST_CASE = { attempts: 2, inputTokens: 3_000, outputTokens: 4_000 } as const;

export function costMicroUsd(promptTokens: number, completionTokens: number): number {
  return Math.ceil(
    promptTokens * RATE_CARD.inputUsdPerMillion + completionTokens * RATE_CARD.outputUsdPerMillion,
  );
}

export const WORST_CASE_ATTEMPT_MICROUSD = costMicroUsd(WORST_CASE.inputTokens, WORST_CASE.outputTokens);
export const WORST_CASE_MICROUSD = WORST_CASE.attempts * WORST_CASE_ATTEMPT_MICROUSD;

export type SpendState = {
  liveEnabled: boolean;
  dailyCapMicroUsd: number;
  monthlyCapMicroUsd: number;
  dayUsedMicroUsd: number;
  monthUsedMicroUsd: number;
};

export type LiveStatus = 'available' | 'disabled' | 'daily_cap' | 'monthly_cap';

export type SpendDecision =
  | { allowed: true; id: string; state: SpendState }
  | { allowed: false; reason: Exclude<LiveStatus, 'available'>; retryAfterSec?: number; state: SpendState };

// A settled row counts its actual cost; a reservation counts its worst case.
const COMMITTED = "CASE status WHEN 'settled' THEN actual_microusd ELSE reserved_microusd END";

function setting(values: Map<string, string>, key: string): number {
  const parsed = Number.parseInt(values.get(key) ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Missing settings read as paused with zero caps, so live AI fails closed. */
export async function loadSpendState(db: Db, nowIso: string): Promise<SpendState> {
  const settings = await db.prepare('SELECT key, value FROM app_settings').all<{ key: string; value: string }>();
  const values = new Map(settings.results.map((row) => [row.key, row.value]));
  const sums = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN day = ? THEN ${COMMITTED} ELSE 0 END), 0) AS day_used,
         COALESCE(SUM(${COMMITTED}), 0) AS month_used
       FROM spend_ledger WHERE month = ?`,
    )
    .bind(nowIso.slice(0, 10), nowIso.slice(0, 7))
    .first<{ day_used: number; month_used: number }>();
  return {
    liveEnabled: values.get('live_enabled') === '1',
    dailyCapMicroUsd: setting(values, 'daily_cap_microusd'),
    monthlyCapMicroUsd: setting(values, 'monthly_cap_microusd'),
    dayUsedMicroUsd: Number(sums?.day_used ?? 0),
    monthUsedMicroUsd: Number(sums?.month_used ?? 0),
  };
}

export function liveStatusOf(state: SpendState, amount = WORST_CASE_MICROUSD): LiveStatus {
  if (!state.liveEnabled) return 'disabled';
  if (state.monthUsedMicroUsd + amount > state.monthlyCapMicroUsd) return 'monthly_cap';
  if (state.dayUsedMicroUsd + amount > state.dailyCapMicroUsd) return 'daily_cap';
  return 'available';
}

function secondsUntilNextUtcMonth(nowMs: number): number {
  const date = new Date(nowMs);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((next - nowMs) / 1000));
}

/**
 * Inserts a reservation only if live AI is enabled and both caps still have
 * room for it. The check and the insert are one statement, so concurrent
 * requests cannot overshoot a cap.
 */
export async function reserveSpend(
  db: Db,
  args: { id: string; nowIso: string; nowMs: number; amountMicroUsd?: number },
): Promise<SpendDecision> {
  const amount = args.amountMicroUsd ?? WORST_CASE_MICROUSD;
  const day = args.nowIso.slice(0, 10);
  const month = args.nowIso.slice(0, 7);
  const inserted = await db
    .prepare(
      `INSERT INTO spend_ledger (id, day, month, status, reserved_microusd, created_at)
       SELECT ?, ?, ?, 'reserved', ?, ?
       WHERE (SELECT value FROM app_settings WHERE key = 'live_enabled') = '1'
         AND (SELECT COALESCE(SUM(${COMMITTED}), 0) FROM spend_ledger WHERE day = ?) + ?
             <= (SELECT CAST(value AS INTEGER) FROM app_settings WHERE key = 'daily_cap_microusd')
         AND (SELECT COALESCE(SUM(${COMMITTED}), 0) FROM spend_ledger WHERE month = ?) + ?
             <= (SELECT CAST(value AS INTEGER) FROM app_settings WHERE key = 'monthly_cap_microusd')`,
    )
    .bind(args.id, day, month, amount, args.nowIso, day, amount, month, amount)
    .run();
  const state = await loadSpendState(db, args.nowIso);
  if (inserted.meta?.changes === 1) return { allowed: true, id: args.id, state };
  const status = liveStatusOf(state, amount);
  const reason = status === 'available' ? 'daily_cap' : status;
  return {
    allowed: false,
    reason,
    retryAfterSec: reason === 'daily_cap'
      ? secondsUntilUtcMidnight(args.nowMs)
      : reason === 'monthly_cap'
        ? secondsUntilNextUtcMonth(args.nowMs)
        : undefined,
    state,
  };
}

export type SpendUsage = {
  promptTokens: number;
  completionTokens: number;
  attempts: number;
  model?: string;
  requestId?: string;
};

/**
 * Settles a reservation from reported usage. Usage covers the successful
 * attempt only, so each earlier attempt is charged at its worst case.
 */
export async function settleSpend(db: Db, args: { id: string; nowIso: string; usage: SpendUsage }): Promise<number> {
  const { promptTokens, completionTokens, attempts, model, requestId } = args.usage;
  const actual = costMicroUsd(promptTokens, completionTokens) +
    Math.max(0, attempts - 1) * WORST_CASE_ATTEMPT_MICROUSD;
  await db
    .prepare(
      `UPDATE spend_ledger
       SET status = 'settled', actual_microusd = ?, prompt_tokens = ?, completion_tokens = ?,
           attempts = ?, model = ?, request_id = ?, settled_at = ?
       WHERE id = ? AND status = 'reserved'`,
    )
    .bind(actual, promptTokens, completionTokens, attempts, model ?? null, requestId ?? null, args.nowIso, args.id)
    .run();
  return actual;
}

/** Removes a reservation for a call that was never made. */
export async function cancelSpend(db: Db, id: string): Promise<void> {
  await db.prepare("DELETE FROM spend_ledger WHERE id = ? AND status = 'reserved'").bind(id).run();
}

export function formatUsd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(microUsd < 100_000 ? 4 : 2)}`;
}
