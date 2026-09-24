// Live runs on the public route: a goal plan, or a pick after missed
// sessions. Spend for the whole run is reserved before any model call, the
// visitor's slot is held for the run, and every service call's usage is
// settled once when the run ends.

import type { GoalPipelineDeps } from '../goal-stream.ts';
import type { Language } from '../i18n.ts';
import type { ReserveResult } from '../plan-stream.ts';
import type { ReplanPipelineDeps } from '../replan-stream.ts';
import { stepsCopyFor } from '../steps-copy.ts';
import type { Db } from './db.ts';
import { requestDraft, requestReadGoal, requestReplan, ServiceFailure, type LiveConfig, type ServiceUsage } from './live.ts';
import { checkAndReservePublicLiveSlot, type SlotReservationResult } from './public_limits.ts';
import {
  cancelSpend,
  formatUsd,
  GOAL_DRAFT_ATTEMPT_MICROUSD,
  GOAL_READ_ATTEMPT_MICROUSD,
  GOAL_WORST_CASE_MICROUSD,
  REPLAN_ATTEMPT_MICROUSD,
  REPLAN_WORST_CASE_MICROUSD,
  reserveSpend,
  settleSpendCalls,
  type CallSpend,
  type SpendDecision,
} from './spend.ts';

/** A goal run can take a reading and two drafts: about 150 s at worst. */
export const GOAL_LEASE_SEC = 180;
/** A replan makes one small call: 35 s at worst. */
export const REPLAN_LEASE_SEC = 60;

export type LiveRunArgs = {
  db: Db;
  config: LiveConfig;
  request: Request;
  env: Record<string, unknown>;
  language: Language;
  nowIso: string;
  nowMs: number;
  slotResult: (slot: SlotReservationResult) => ReserveResult;
};

export type GoalRunArgs = LiveRunArgs & {
  readGoal?: typeof requestReadGoal;
  draft?: typeof requestDraft;
};

export type ReplanRunArgs = LiveRunArgs & { replan?: typeof requestReplan };

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
 * Spend and the visitor's slot for one live run: `reserve` holds the run's
 * worst case and a slot, `call` records each service call's usage, and
 * `settle` charges what was used once the run ends, however it ended.
 */
function liveSpend(args: LiveRunArgs, amountMicroUsd: number, leaseSec: number) {
  const { db } = args;
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

  const reserve = async (): Promise<ReserveResult> => {
    const spend = await reserveSpend(db, {
      id: spendId,
      nowIso: args.nowIso,
      nowMs: args.nowMs,
      amountMicroUsd,
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
        leaseSec,
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

  return { reserve, call, settle };
}

/**
 * Pipeline dependencies for one live goal run, plus `settle`, which the
 * caller runs once the pipeline has finished, however it finished.
 */
export function liveGoalRun(args: GoalRunArgs): { deps: Omit<GoalPipelineDeps, 'emit'>; settle: () => Promise<void> } {
  const readGoal = args.readGoal ?? requestReadGoal;
  const draft = args.draft ?? requestDraft;
  const { reserve, call, settle } = liveSpend(args, GOAL_WORST_CASE_MICROUSD, GOAL_LEASE_SEC);
  return {
    deps: {
      mode: 'live',
      now: Date.now,
      serverToday: args.nowIso.slice(0, 10),
      reserve,
      readGoal: (payload) => call(GOAL_READ_ATTEMPT_MICROUSD, () => readGoal(payload, args.config)),
      draft: (payload) => call(GOAL_DRAFT_ATTEMPT_MICROUSD, () => draft(payload, args.config)),
    },
    settle,
  };
}

/** The same for a replan: one pick call, a smaller reservation and lease. */
export function liveReplanRun(args: ReplanRunArgs): { deps: Omit<ReplanPipelineDeps, 'emit'>; settle: () => Promise<void> } {
  const replan = args.replan ?? requestReplan;
  const { reserve, call, settle } = liveSpend(args, REPLAN_WORST_CASE_MICROUSD, REPLAN_LEASE_SEC);
  return {
    deps: {
      mode: 'live',
      now: Date.now,
      serverToday: args.nowIso.slice(0, 10),
      reserve,
      pickOption: (payload) => call(REPLAN_ATTEMPT_MICROUSD, () => replan(payload, args.config)),
    },
    settle,
  };
}
