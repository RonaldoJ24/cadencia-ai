// Schedule Proof — typed compiler trace over the deterministic planner.
// The planner (lib/routine.ts) stays the only scheduling authority. This
// module instruments actual executed decisions: it runs buildPlan, then
// derives per-session provenance from the real output. Rule descriptions
// live in bilingual UI copy; only stable machine IDs are stored here.

import { createHash } from 'node:crypto';
import {
  buildPlan,
  validateInput,
  validateIntent,
  type Intent,
  type PlannerEvent,
  type RoutineInput,
  type RoutinePlan,
  type Session,
} from './routine.ts';

export const PLANNER_VERSION = 'cadencia-planner/1';
export const ADAPT_POLICY_VERSION = 'cadencia-adapt-policy/1';

/** Stable compile-stage machine IDs (stored, never translated). */
export const COMPILE_STAGE_IDS = [
  'request_accepted',
  'provider_skipped',
  'provider_pending',
  'provider_succeeded',
  'provider_failed',
  'intent_validated',
  'constraints_normalized',
  'weekly_cap_applied',
  'session_placed',
  'schedule_completed',
  'revision_persisting',
  'revision_persisted',
] as const;

export type CompileStageId = (typeof COMPILE_STAGE_IDS)[number];

/** Stable per-session planner rule IDs (stored, never translated). */
export const PLANNER_RULE_IDS = [
  'intent_validated',
  'constraints_normalized',
  'weekly_cap_applied',
  'session_placed',
] as const;

export type PlannerRuleId = (typeof PLANNER_RULE_IDS)[number];

export type SessionTrace = {
  sessionId: string;
  activityId: string;
  /**
   * Stable logical identity of the activity across revisions. For a fresh
   * compile it equals the source activityId; when a session is adapted to a
   * new date, the new occurrence keeps the missed occurrence's logicalId
   * (the diff and the R2 trace use this field, never the row id, to claim
   * movement).
   */
  logicalId: string;
  date: string;
  time: string;
  durationMinutes: number;
  budgetBefore: number;
  budgetAfter: number;
  ruleIds: PlannerRuleId[];
  ruleInputs: Record<string, string | number | number[]>;
  outcome: 'placed';
  plannerVersion: string;
  policyVersion: string;
};

export type CompileTrace = {
  stages: CompileStageId[];
  sessions: SessionTrace[];
  inputHash: string;
  scheduleHash: string;
  plannerVersion: string;
  policyVersion: string;
  weekStart: string;
  timezone: string;
  sessionCount: number;
  weeklyMinutes: number;
  weeklyUsed: number;
};

/**
 * Deterministic canonical JSON.
 * - Object keys sorted by code point.
 * - Arrays keep order (scheduling order is significant).
 * - `undefined` object values omitted; `undefined` array items -> null.
 * - Numbers must be finite; -0 normalized to 0.
 * - No locale, date, or key-order dependence.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('trace_non_finite_number');
    const normalized = Object.is(value, -0) ? 0 : value;
    return JSON.stringify(normalized);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry === undefined ? null : entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  throw new Error('trace_unserializable');
}

/** Synchronous SHA-256 hex over canonical JSON (Node + Workers via node:crypto). */
export function canonicalHashSync(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** WebCrypto SHA-256 hex over canonical JSON (platform cryptography path). */
export async function canonicalHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type CanonicalInputOptions = {
  /**
   * Frozen current date/time when relevant (fixture or server now). Null —
   * the reproducible default for plain compiles — means wall-clock is not a
   * scheduling input, so identical schedules hash identically across runs.
   */
  nowIso?: string;
  timezone?: string;
};

/**
 * Canonical normalized planner input. Includes only schedule-affecting
 * fields: frozen now, timezone, Monday week start, weekdays, local time,
 * duration, weekly cap, versions, validated proposal. Excludes request IDs,
 * timings, translations, UI state.
 */
export function canonicalPlannerInput(
  input: RoutineInput,
  intent: Intent,
  options: CanonicalInputOptions = {},
): Record<string, unknown> {
  const validatedInput = validateInput(input);
  const validatedIntent = validateIntent(intent);
  return {
    nowIso: options.nowIso ?? null,
    timezone: options.timezone ?? 'UTC',
    weekStart: validatedInput.startDate,
    weekdays: [...validatedInput.days].sort((a, b) => a - b),
    time: validatedInput.time,
    sessionMinutes: validatedInput.sessionMinutes,
    weeklyMinutes: validatedInput.weeklyMinutes,
    plannerVersion: PLANNER_VERSION,
    policyVersion: ADAPT_POLICY_VERSION,
    proposal: {
      title: validatedIntent.title,
      goal: validatedIntent.goal,
      domain: validatedIntent.domain,
      steps: validatedIntent.steps.map((step) => ({
        title: step.title,
        instructions: step.instructions,
        blocks: (step.blocks ?? []).map((block) => ({
          activity: block.activity,
          minutes: block.minutes,
        })),
        deliverable: step.deliverable ?? null,
        doneWhen: step.doneWhen ?? null,
      })),
    },
  };
}

export function inputHashSync(input: RoutineInput, intent: Intent, options?: CanonicalInputOptions): string {
  return canonicalHashSync(canonicalPlannerInput(input, intent, options));
}

/** Canonical schedule output: only persisted schedule facts. */
export function canonicalSchedule(plan: RoutinePlan, timezone = 'UTC'): Record<string, unknown> {
  return {
    weekStart: plan.input.startDate,
    timezone,
    time: plan.input.time,
    sessionMinutes: plan.input.sessionMinutes,
    weeklyMinutes: plan.input.weeklyMinutes,
    plannerVersion: PLANNER_VERSION,
    policyVersion: ADAPT_POLICY_VERSION,
    sessions: [...plan.sessions]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((session) => ({
        id: session.id,
        date: session.date,
        dayIndex: session.dayIndex,
        minutes: session.minutes,
        status: session.status,
      })),
  };
}

/**
 * Schedule hash over a plan-like value: any { input, sessions } whose input
 * is a full RoutineInput and whose sessions carry id/date/dayIndex/minutes/
 * status. RoutinePlan satisfies this, and so does a persisted schedule row
 * that preserves full session content — which is exactly how the R2 hash
 * equation `scheduleHashR2 === scheduleHashSync(persistedR2)` holds.
 */
export function scheduleHashSync(
  plan: Pick<RoutinePlan, 'input' | 'sessions'>,
  timezone = 'UTC',
): string {
  return canonicalHashSync(canonicalSchedule(plan as RoutinePlan, timezone));
}

/**
 * Hash of the exact persisted schedule bytes (revision wrapper excluded):
 * complete input/constraints plus full session content, in canonical form.
 */
export function persistedScheduleHashSync(stored: {
  input: RoutineInput;
  sessions: Session[];
}, timezone: string): string {
  return scheduleHashSync({ input: stored.input, sessions: stored.sessions }, timezone);
}

/**
 * Build a compile trace from already-recorded planner events. Exported so
 * persisted-routine creation reuses the exact same construction the
 * compiler uses — no second derivation path exists.
 */
export function traceFromCompileEvents(
  plan: RoutinePlan,
  recorded: PlannerEvent[],
  options: CanonicalInputOptions & { provider?: 'skipped' | 'pending' | 'succeeded' | 'failed' } = {},
): CompileTrace {
  const timezone = options.timezone ?? 'UTC';
  const canonicalInput = canonicalPlannerInput(plan.input, plan.intent, {
    nowIso: options.nowIso,
    timezone,
  });
  const inputHash = canonicalHashSync(canonicalInput);
  const scheduleHash = canonicalHashSync(canonicalSchedule(plan, timezone));

  const providerStage: CompileStageId = options.provider === 'pending'
    ? 'provider_pending'
    : options.provider === 'succeeded'
      ? 'provider_succeeded'
      : options.provider === 'failed'
        ? 'provider_failed'
        : 'provider_skipped';

  const placements = recorded.filter((event) => event.type === 'session_placed');
  if (placements.length !== plan.sessions.length) {
    throw new Error('trace_events_diverge_from_plan');
  }
  let used = 0;
  const sessions: SessionTrace[] = placements.map((event, index) => {
    if (event.type !== 'session_placed') throw new Error('trace_events_diverge_from_plan');
    const session = plan.sessions[index];
    if (!session || session.id !== event.sessionId || session.date !== event.date) {
      throw new Error('trace_events_diverge_from_plan');
    }
    if (!plan.input.days.includes(event.dayIndex)) {
      throw new Error('trace_session_outside_selected_days');
    }
    if (event.minutes !== plan.input.sessionMinutes) {
      throw new Error('trace_session_duration_mismatch');
    }
    if (event.budgetBefore !== plan.input.weeklyMinutes - used) {
      throw new Error('trace_events_diverge_from_plan');
    }
    const countsAgainstCap = session.status !== 'missed';
    if (countsAgainstCap) used += session.minutes;
    if (event.budgetAfter !== event.budgetBefore - (countsAgainstCap ? session.minutes : 0)) {
      throw new Error('trace_events_diverge_from_plan');
    }
    if (event.budgetAfter < 0) throw new Error('trace_weekly_cap_exceeded');
    return {
      sessionId: event.sessionId,
      activityId: event.activityId,
      logicalId: event.activityId,
      date: event.date,
      time: plan.input.time,
      durationMinutes: event.minutes,
      budgetBefore: event.budgetBefore,
      budgetAfter: event.budgetAfter,
      ruleIds: [...PLANNER_RULE_IDS],
      ruleInputs: {
        dayIndex: event.dayIndex,
        date: event.date,
        time: plan.input.time,
        durationMinutes: event.minutes,
        weekdays: [...plan.input.days].sort((a, b) => a - b),
        weeklyMinutes: plan.input.weeklyMinutes,
        expectedOffset: event.dayIndex,
      },
      outcome: 'placed',
      plannerVersion: PLANNER_VERSION,
      policyVersion: ADAPT_POLICY_VERSION,
    };
  });

  return {
    stages: [
      'request_accepted',
      providerStage,
      'intent_validated',
      'constraints_normalized',
      'weekly_cap_applied',
      'session_placed',
      'schedule_completed',
    ],
    sessions,
    inputHash,
    scheduleHash,
    plannerVersion: PLANNER_VERSION,
    policyVersion: ADAPT_POLICY_VERSION,
    weekStart: plan.input.startDate,
    timezone,
    sessionCount: plan.sessions.length,
    weeklyMinutes: plan.input.weeklyMinutes,
    weeklyUsed: used,
  };
}

/**
 * Compile with trace. Runs the real deterministic planner with an event
 * sink and builds provenance FROM THE RECORDED EVENTS — the session_placed
 * events emitted by the placement branch as it executed. The finished plan
 * is used only to cross-check (same sessions, same order, same facts);
 * any divergence throws instead of producing a trace.
 */
export function compileWithTrace(
  rawInput: RoutineInput,
  rawIntent?: Intent,
  mode: RoutinePlan['mode'] = 'demo',
  options: CanonicalInputOptions & { scopeRefused?: boolean; provider?: 'skipped' | 'pending' | 'succeeded' | 'failed' } = {},
): { plan: RoutinePlan; trace: CompileTrace } {
  const recorded: PlannerEvent[] = [];
  const plan = buildPlan(rawInput, rawIntent, mode, options.scopeRefused, (event) => {
    recorded.push(event);
  });
  return { plan, trace: traceFromCompileEvents(plan, recorded, options) };
}

/** Adaptation-candidate hash: candidate schedule + base binding. */
export function candidateHashSync(candidate: Record<string, unknown>): string {
  return canonicalHashSync({ kind: 'adaptation-candidate', ...candidate });
}
