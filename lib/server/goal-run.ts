// A live goal run on the public route. Spend for the whole run is reserved
// before the model reads the goal, the visitor's slot is held for the run,
// and every service call's usage is settled once when the run ends.

import type { GoalPipelineDeps } from '../goal-stream.ts';
import type { Language } from '../i18n.ts';
import type { ReserveResult } from '../plan-stream.ts';
import { stepsCopyFor } from '../steps-copy.ts';
import type { Db } from './db.ts';
import { requestDraft, requestReadGoal, ServiceFailure, type LiveConfig, type ServiceUsage } from './live.ts';
import { checkAndReservePublicLiveSlot, type SlotReservationResult } from './public_limits.ts';
import {
  cancelSpend,
  formatUsd,
  GOAL_DRAFT_ATTEMPT_MICROUSD,
  GOAL_READ_ATTEMPT_MICROUSD,
  GOAL_WORST_CASE_MICROUSD,
  reserveSpend,
  settleSpendCalls,
  type CallSpend,
  type SpendDecision,
} from './spend.ts';

/** A goal run can take a reading and two drafts: about 150 s at worst. */
export const GOAL_LEASE_SEC = 180;

export type GoalRunArgs = {
  db: Db;
  config: LiveConfig;
  request: Request;
  env: Record<string, unknown>;
  language: Language;
  nowIso: string;
  nowMs: number;
  slotResult: (slot: SlotReservationResult) => ReserveResult;
  readGoal?: typeof requestReadGoal;
  draft?: typeof requestDraft;
};

/** The refusal shown when a spend cap or the kill switch stops a run. */
function spendRefusal(
  spend: Extract<SpendDecision, { allowed: false }>,
  language: Language,
): Extract<ReserveResult, { allowed: false }> {
  const copy = stepsCopyFor(language).spend;
  return {
    allowed: false,
    status: spend.reason === 'disabled' ? 503 : 429,
    reason: spend.reason === 'disabled' ? 'live_disabled' : `spend_${spend.reason}`,
    message: spend.reason === 'disabled'
      ? copy.disabled
      : spend.reason === 'daily_cap' ? copy.dailyCap : copy.monthlyCap,
    retryAfterSec: spend.retryAfterSec,
  };
}

/**
 * Pipeline dependencies for one live goal run, plus `settle`, which the
 * caller runs once the pipeline has finished, however it finished.
 */
export function liveGoalRun(args: GoalRunArgs): { deps: Omit<GoalPipelineDeps, 'emit'>; settle: () => Promise<void> } {
  const { db, config } = args;
  const readGoal = args.readGoal ?? requestReadGoal;
  const draft = args.draft ?? requestDraft;
  const spendId = crypto.randomUUID();
  const calls: CallSpend[] = [];
  let reserved = false;

  const record = (worstAttemptMicroUsd: number, usage: ServiceUsage | undefined, requestId: string | undefined) => {
    calls.push({ worstAttemptMicroUsd, usage: usage ? { ...usage, requestId } : undefined });
  };

  async function call<T extends { usage?: ServiceUsage; requestId?: string }>(
    worstAttemptMicroUsd: number,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await work();
      record(worstAttemptMicroUsd, result.usage, result.requestId);
      return result;
    } catch (error) {
      if (error instanceof ServiceFailure) record(worstAttemptMicroUsd, error.usage, error.requestId);
      else record(worstAttemptMicroUsd, undefined, undefined);
      throw error;
    }
  }

  const deps: Omit<GoalPipelineDeps, 'emit'> = {
    mode: 'live',
    now: Date.now,
    serverToday: args.nowIso.slice(0, 10),
    reserve: async (): Promise<ReserveResult> => {
      const spend = await reserveSpend(db, {
        id: spendId,
        nowIso: args.nowIso,
        nowMs: args.nowMs,
        amountMicroUsd: GOAL_WORST_CASE_MICROUSD,
      });
      if (!spend.allowed) return spendRefusal(spend, args.language);
      reserved = true;
      const slot = args.slotResult(
        await checkAndReservePublicLiveSlot(db, {
          request: args.request,
          nowMs: args.nowMs,
          nowIso: args.nowIso,
          secret: typeof args.env.CADENCIA_SERVICE_TOKEN === 'string' ? args.env.CADENCIA_SERVICE_TOKEN : undefined,
          allowIpFallback: args.env.CADENCIA_ALLOW_IP_FALLBACK === 'true',
          leaseSec: GOAL_LEASE_SEC,
        }),
      );
      if (!slot.allowed) {
        await cancelSpend(db, spendId);
        reserved = false;
        return slot;
      }
      return {
        ...slot,
        detail: stepsCopyFor(args.language).detail.reserveBudget(
          formatUsd(spend.state.dayUsedMicroUsd),
          formatUsd(spend.state.dailyCapMicroUsd),
        ),
      };
    },
    readGoal: (payload) => call(GOAL_READ_ATTEMPT_MICROUSD, () => readGoal(payload, config)),
    draft: (payload) => call(GOAL_DRAFT_ATTEMPT_MICROUSD, () => draft(payload, config)),
  };

  const settle = async () => {
    if (!reserved) return;
    try {
      await settleSpendCalls(db, { id: spendId, nowIso: new Date().toISOString(), calls });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'cadencia_routine_failure',
        reason: 'spend_settle_failed',
        error_name: (error as Error)?.name,
      }));
    }
  };

  return { deps, settle };
}
