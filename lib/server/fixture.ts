// Reviewer Replay frozen fixture policy. Deterministic by construction:
// fixed now/timezone/versions/cutoff/session state, fixed "Tuesday was
// missed" event, earliest-feasible-future-slot replacement through the real
// deterministic planner engine (replan). AI never authors schedule moves.

import { replan, type PlannerEventSink, type RoutinePlan } from '../routine.ts';
import { compileWithTrace } from '../trace.ts';

export const FIXTURE_TIMEZONE = 'UTC';
export const FIXTURE_WEEK_START = '2026-08-31';
export const FIXTURE_NOW_ISO = '2026-09-01T12:00:00.000Z';
export const FIXTURE_EVIDENCE_CUTOFF = '2026-09-01T12:00:00.000Z';
export const FIXTURE_MISSED_DATE = '2026-09-01';
export const FIXTURE_MISSED_SESSION_ID = 'session-2026-09-01';

export const FIXTURE_INPUT = {
  request: 'Practice English for job interviews with steady daily sessions.',
  days: [0, 1, 2, 3, 4],
  sessionMinutes: 30,
  weeklyMinutes: 90,
  startDate: FIXTURE_WEEK_START,
  time: '18:00',
  language: 'en',
} as const;

export type FixtureSessionState = 'planned' | 'done' | 'missed';

/** Frozen R1 canonical plan: fixed routine, constraints, revision R1. */
export function fixturePlan(language: 'en' | 'es' = 'en'): RoutinePlan {
  return fixtureCompile(language).plan;
}

/**
 * Single source of truth for the frozen R1 compile: fixed input, frozen
 * now, fixed timezone and versions. Every consumer (replay state, Workflow
 * derive, evidence) shares these exact bytes, so input/schedule hashes
 * agree everywhere by construction.
 */
export function fixtureCompile(language: 'en' | 'es' = 'en') {
  return compileWithTrace(
    { ...FIXTURE_INPUT, days: [...FIXTURE_INPUT.days], language },
    undefined,
    'demo',
    { timezone: FIXTURE_TIMEZONE, nowIso: FIXTURE_NOW_ISO },
  );
}

/**
 * "Tuesday was missed": the Tuesday session (2026-09-01) is marked missed as
 * simulated fixture evidence. Completed sessions are preserved, nothing
 * moves into the past, weekdays/time/cap/duration stay locked, stable
 * session identity is preserved, earliest feasible future slot wins.
 * Returns an explicit infeasible result when no valid schedule exists.
 */
export function deriveFixtureAdaptation(plan: RoutinePlan, sink?: PlannerEventSink): {
  feasible: boolean;
  reason?: string;
  candidate?: RoutinePlan;
  missedId?: string;
  movedFrom?: string;
  movedTo?: string;
} {
  const missed = plan.sessions.find((session) => session.date === FIXTURE_MISSED_DATE);
  if (!missed) return { feasible: false, reason: 'missed_session_absent' };
  if (missed.status === 'done') return { feasible: false, reason: 'completed_session_preserved' };
  if (missed.status === 'missed') return { feasible: false, reason: 'already_missed' };
  try {
    const candidate = replan(plan, missed.id, sink);
    const replacement = candidate.sessions.find(
      (session) => !plan.sessions.some((existing) => existing.id === session.id),
    );
    if (!replacement) return { feasible: false, reason: 'no_feasible_slot' };
    // Enforced invariant, not just construction luck: the replacement must
    // never land in the past relative to the frozen fixture now.
    if (replacement.date < FIXTURE_NOW_ISO.slice(0, 10)) {
      return { feasible: false, reason: 'replacement_in_past' };
    }
    return {
      feasible: true,
      candidate,
      missedId: missed.id,
      movedFrom: missed.date,
      movedTo: replacement.date,
    };
  } catch {
    return { feasible: false, reason: 'no_feasible_slot' };
  }
}
