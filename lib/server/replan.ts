// Packet 04: deterministic weekly replan, local-first.
// Reuses the tested lib/routine.ts engine: overlay persisted completion
// states onto the stored plan by ordinal, apply one missed transition per
// requested session, and map the result back to exact row states.
// Completed sessions are never altered; replacements start scheduled.

import { replan, type RoutinePlan, type Session } from '../routine.ts';
import type { SessionRow } from './db.ts';

export type ReplanRowState = {
  planSession: Session;
  status: SessionRow['status'];
  completedAt: string | null;
  note: string | null;
  startsAt: string;
};

export type ReplanResult = {
  plan: RoutinePlan;
  sessions: ReplanRowState[];
  missedDbIds: string[];
  replacementPlanIds: string[];
};

export class ReplanError extends Error {
  readonly code: 'corrupt' | 'session_not_found' | 'not_plannable';
  constructor(code: ReplanError['code'], message: string) {
    super(message);
    this.name = 'ReplanError';
    this.code = code;
  }
}

function toPlanStatus(status: SessionRow['status']): Session['status'] {
  if (status === 'done') return 'done';
  if (status === 'scheduled') return 'planned';
  return 'missed';
}

export function applyReplan(
  storedPlan: RoutinePlan,
  currentRows: SessionRow[],
  markMissedDbIds: string[],
): ReplanResult {
  const rows = [...currentRows].sort((a, b) => a.ordinal - b.ordinal);
  if (rows.length !== storedPlan.sessions.length) {
    throw new ReplanError('corrupt', 'stored plan and session rows diverge');
  }
  if (markMissedDbIds.length === 0) {
    throw new ReplanError('not_plannable', 'nothing to replan');
  }
  const seen = new Set<string>();
  for (const id of markMissedDbIds) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) {
      throw new ReplanError('session_not_found', 'unknown session');
    }
    seen.add(id);
  }

  // Work on a deep copy through the engine: replan() already clones, but the
  // overlay below must not mutate the caller's parsed plan either.
  let plan: RoutinePlan = {
    ...storedPlan,
    input: { ...storedPlan.input, days: [...storedPlan.input.days] },
    intent: storedPlan.intent,
    sessions: storedPlan.sessions.map((session) => ({
      ...session,
      blocks: session.blocks.map((block) => ({ ...block })),
    })),
    checks: storedPlan.checks.map((check) => ({ ...check })),
    warnings: [...storedPlan.warnings],
  };

  const rowsByOrdinal = new Map(plan.sessions.map((session, index) => {
    const row = rows[index];
    if (!row) throw new ReplanError('corrupt', 'stored plan and session rows diverge');
    // Overlay the persisted truth; skipped reads as missed in plan domain
    // (exact row status is restored when mapping back below).
    return [index, { planId: session.id, row }] as const;
  }));
  const rowByDbId = new Map(rows.map((row) => [row.id, row] as const));
  const preStatus = new Map<string, SessionRow>();

  plan.sessions.forEach((session, index) => {
    const entry = rowsByOrdinal.get(index);
    if (!entry) throw new ReplanError('corrupt', 'stored plan and session rows diverge');
    session.status = toPlanStatus(entry.row.status);
    preStatus.set(session.id, entry.row);
  });

  const missedDbIds: string[] = [];
  // Capture plan ids upfront: each engine replan replaces the session array,
  // so ordinal positions must resolve against the pre-replan layout.
  const planIdByOrdinal = plan.sessions.map((session) => session.id);
  for (const dbId of markMissedDbIds) {
    const row = rowByDbId.get(dbId);
    if (!row) throw new ReplanError('session_not_found', 'unknown session');
    if (row.status !== 'scheduled') {
      throw new ReplanError('not_plannable', 'only scheduled sessions can be replanned');
    }
    const ordinal = rows.indexOf(row);
    const planId = planIdByOrdinal[ordinal];
    if (!planId) throw new ReplanError('corrupt', 'stored plan and session rows diverge');
    try {
      plan = replan(plan, planId);
    } catch {
      throw new ReplanError('not_plannable', 'session cannot be replanned');
    }
    missedDbIds.push(dbId);
  }

  const survivorIds = new Set(preStatus.keys());
  const replacementPlanIds = plan.sessions.filter((s) => !survivorIds.has(s.id)).map((s) => s.id);
  // Survivors transitioned by this replan read missed in the new version;
  // everything else carries its exact persisted state (done stays done).
  const missedPlanIds = new Set(
    missedDbIds.flatMap((dbId) => {
      const row = rowByDbId.get(dbId);
      if (!row) return [];
      const ordinal = rows.indexOf(row);
      const planId = planIdByOrdinal[ordinal];
      return planId ? [planId] : [];
    }),
  );
  const sessions: ReplanRowState[] = plan.sessions.map((planSession) => {
    const previous = preStatus.get(planSession.id);
    if (previous) {
      if (missedPlanIds.has(planSession.id)) {
        return {
          planSession,
          status: 'missed' as const,
          completedAt: null,
          note: previous.note,
          startsAt: previous.starts_at,
        };
      }
      return {
        planSession,
        status: previous.status,
        completedAt: previous.completed_at,
        note: previous.note,
        startsAt: previous.starts_at,
      };
    }
    return {
      planSession,
      status: 'scheduled',
      completedAt: null,
      note: null,
      startsAt: `${planSession.date}T${plan.input.time}:00`,
    };
  });

  return { plan, sessions, missedDbIds, replacementPlanIds };
}
