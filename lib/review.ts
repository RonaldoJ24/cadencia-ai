// Deterministic weekly-review metrics from persisted session rows.
// Pure and model-free; shared by the /review page and tests.

export type ReviewSession = {
  status: 'scheduled' | 'done' | 'skipped' | 'missed';
  minutes: number;
};

export type ReviewMetrics = {
  plannedSessions: number;
  plannedMinutes: number;
  completedSessions: number;
  completedMinutes: number;
  skippedSessions: number;
  missedSessions: number;
  completionRatio: number;
};

/** Deterministic weekly metrics from persisted rows. No model involved. */
export function reviewMetrics(sessions: ReviewSession[]): ReviewMetrics {
  const active = sessions.filter((s) => s.status !== 'missed');
  const done = sessions.filter((s) => s.status === 'done');
  const plannedMinutes = active.reduce((total, s) => total + s.minutes, 0);
  const completedMinutes = done.reduce((total, s) => total + s.minutes, 0);
  return {
    plannedSessions: active.length,
    plannedMinutes,
    completedSessions: done.length,
    completedMinutes,
    skippedSessions: sessions.filter((s) => s.status === 'skipped').length,
    missedSessions: sessions.filter((s) => s.status === 'missed').length,
    completionRatio: active.length === 0 ? 0 : done.length / active.length,
  };
}
