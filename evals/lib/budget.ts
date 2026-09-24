// Money for an evaluation run, per arm. The worst case uses the same bounds the
// Worker reserves live (GOAL_BOUNDS), priced at the arm's own rates, so the
// runner can refuse a case before it could overspend.

import { GOAL_BOUNDS } from '../../lib/server/spend.ts';
import type { ServiceUsage } from '../../lib/server/live.ts';

/** USD per million tokens, with where and when the prices were read. */
export type Prices = { inputPerMillion: number; outputPerMillion: number; source: string; read: string };

export function costMicroUsd(prices: Prices, promptTokens: number, completionTokens: number): number {
  return Math.ceil(promptTokens * prices.inputPerMillion + completionTokens * prices.outputPerMillion);
}

export function worstAttemptMicroUsd(prices: Prices, call: 'read' | 'draft'): number {
  const bound = GOAL_BOUNDS[call];
  return costMicroUsd(prices, bound.promptBytes + GOAL_BOUNDS.templateTokens, bound.outputTokens);
}

/** One reading and two drafts, each with every provider attempt at its worst. */
export function worstRunMicroUsd(prices: Prices): number {
  return GOAL_BOUNDS.attempts *
    (worstAttemptMicroUsd(prices, 'read') + GOAL_BOUNDS.draftCalls * worstAttemptMicroUsd(prices, 'draft'));
}

/**
 * A call's cost: its usage plus earlier attempts at their worst case; a call
 * whose usage never arrived is charged in full.
 */
export function chargeMicroUsd(prices: Prices, call: 'read' | 'draft', usage: ServiceUsage | undefined): number {
  const worst = worstAttemptMicroUsd(prices, call);
  if (!usage) return GOAL_BOUNDS.attempts * worst;
  return costMicroUsd(prices, usage.promptTokens, usage.completionTokens) + Math.max(0, usage.attempts - 1) * worst;
}

export function validPrices(value: unknown): value is Prices {
  const prices = value as Partial<Prices> | null;
  return typeof prices === 'object' && prices !== null &&
    typeof prices.inputPerMillion === 'number' && prices.inputPerMillion > 0 &&
    typeof prices.outputPerMillion === 'number' && prices.outputPerMillion > 0 &&
    typeof prices.source === 'string' && prices.source.length > 0 &&
    typeof prices.read === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(prices.read);
}
