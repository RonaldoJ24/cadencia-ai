// Candidate envelope builder shared by the coordinator and tests.
// Provenance comes from replan's recorded events (the confirmation walk
// that executed inside the engine), never reconstructed afterwards.
// Stable logical identity: every occurrence of one activity shares the
// missed occurrence's logicalId across revisions; trace, diff, and stored
// sessions all use it, so no row id is ever reported as "moved" while it
// still exists on its original date.

import type { PlannerEvent, RoutinePlan, Session } from '../routine.ts';
import {
  ADAPT_POLICY_VERSION,
  candidateHashSync,
  canonicalHashSync,
  canonicalPlannerInput,
  PLANNER_RULE_IDS,
  PLANNER_VERSION,
  scheduleHashSync,
  type CompileTrace,
  type SessionTrace,
} from '../trace.ts';
import { buildDiff } from './adaptation.ts';

export type CandidateSession = Session & { logicalId: string; startsAt: string };

export type CandidateEnvelope = {
  weekStart: string;
  timezone: string;
  time: string;
  sessionMinutes: number;
  weeklyMinutes: number;
  weekdays: number[];
  plannerVersion: string;
  policyVersion: string;
  sessions: CandidateSession[];
  planJson: string;
  inputJson: string;
};

/**
 * Logical identity map for a base schedule. When a base trace exists, its
 * activityIds are authoritative; otherwise positional `intent-step-N`
 * assignment applies (exactly the convention compileWithTrace uses, so the
 * two agree on any plan that came out of buildPlan).
 */
export function baseLogicalIds(
  sessions: Array<{ id: string }>,
  traceActivityById?: Map<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  sessions.forEach((session, index) => {
    map.set(session.id, traceActivityById?.get(session.id) ?? `intent-step-${index + 1}`);
  });
  return map;
}

function fail(message: string): never {
  throw new Error(`cadencia_candidate_invalid: ${message}`);
}

export function buildPlanTraceForCandidate(args: {
  candidate: RoutinePlan;
  confirmation: Extract<PlannerEvent, { type: 'adaptation_candidate_confirmed' }>;
  baseSessions: Array<{ id: string; date: string }>;
  logicalById: Map<string, string>;
  missedSessionId: string;
  timezone?: string;
}): {
  candidate: CandidateEnvelope;
  candidateHash: string;
  diff: Record<string, unknown>;
  trace: CompileTrace;
} {
  const { candidate, confirmation, baseSessions, logicalById, missedSessionId } = args;
  const timezone = args.timezone ?? 'UTC';
  if (confirmation.sessions.length !== candidate.sessions.length) {
    fail('confirmation diverges from candidate');
  }
  const missedLogical = logicalById.get(missedSessionId);
  if (!missedLogical) fail('missed session has no logical identity');

  let weeklyUsed = 0;
  const traceSessions: SessionTrace[] = confirmation.sessions.map((confirmed, index) => {
    const session = candidate.sessions[index];
    if (!session || session.id !== confirmed.sessionId || session.date !== confirmed.date) {
      fail('confirmation diverges from candidate');
    }
    const logicalId = confirmed.disposition === 'replacement'
      ? missedLogical
      : logicalById.get(confirmed.sessionId) ?? fail('survivor lost logical identity');
    if (session.status !== 'missed') weeklyUsed += session.minutes;
    return {
      sessionId: confirmed.sessionId,
      activityId: logicalId,
      logicalId,
      date: confirmed.date,
      time: candidate.input.time,
      durationMinutes: confirmed.minutes,
      budgetBefore: confirmed.budgetBefore,
      budgetAfter: confirmed.budgetAfter,
      ruleIds: [...PLANNER_RULE_IDS],
      ruleInputs: {
        dayIndex: confirmed.dayIndex,
        date: confirmed.date,
        time: candidate.input.time,
        durationMinutes: confirmed.minutes,
        weekdays: [...candidate.input.days].sort((a, b) => a - b),
        weeklyMinutes: candidate.input.weeklyMinutes,
        expectedOffset: confirmed.dayIndex,
      },
      outcome: 'placed',
      plannerVersion: PLANNER_VERSION,
      policyVersion: ADAPT_POLICY_VERSION,
    };
  });

  const replacement = confirmation.sessions.find((entry) => entry.disposition === 'replacement');
  const missedEntry = confirmation.sessions.find((entry) => entry.sessionId === missedSessionId);
  const envelope: CandidateEnvelope = {
    weekStart: candidate.input.startDate,
    timezone,
    time: candidate.input.time,
    sessionMinutes: candidate.input.sessionMinutes,
    weeklyMinutes: candidate.input.weeklyMinutes,
    weekdays: [...candidate.input.days].sort((a, b) => a - b),
    plannerVersion: PLANNER_VERSION,
    policyVersion: ADAPT_POLICY_VERSION,
    sessions: candidate.sessions.map((session, index) => ({
      ...session,
      blocks: session.blocks.map((block) => ({ ...block })),
      logicalId: traceSessions[index]?.logicalId ?? fail('trace diverges from candidate'),
      startsAt: `${session.date}T${candidate.input.time}:00`,
    })),
    planJson: JSON.stringify(candidate),
    inputJson: JSON.stringify(candidate.input),
  };
  const candidateHash = candidateHashSync(envelope);
  const diff = buildDiff(
    baseSessions,
    candidate.sessions.map((session) => ({ id: session.id, date: session.date })),
    replacement && missedEntry
      ? {
        logicalId: missedLogical,
        fromSessionId: missedEntry.sessionId,
        fromDate: missedEntry.date,
        toSessionId: replacement.sessionId,
        toDate: replacement.date,
      }
      : null,
    {
      weekdays: envelope.weekdays,
      time: envelope.time,
      weeklyMinutes: envelope.weeklyMinutes,
      sessionMinutes: envelope.sessionMinutes,
    },
  );
  return {
    candidate: envelope,
    candidateHash,
    diff,
    trace: {
      stages: [
        'request_accepted',
        'provider_skipped',
        'intent_validated',
        'constraints_normalized',
        'weekly_cap_applied',
        'session_placed',
        'schedule_completed',
      ],
      sessions: traceSessions,
      inputHash: canonicalHashSync(canonicalPlannerInput(candidate.input, candidate.intent, { timezone })),
      scheduleHash: scheduleHashSync(candidate, timezone),
      plannerVersion: PLANNER_VERSION,
      policyVersion: ADAPT_POLICY_VERSION,
      weekStart: candidate.input.startDate,
      timezone,
      sessionCount: traceSessions.length,
      weeklyMinutes: candidate.input.weeklyMinutes,
      weeklyUsed,
    },
  };
}
