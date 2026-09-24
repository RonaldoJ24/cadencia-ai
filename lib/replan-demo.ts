// The replan demo. A demo plan starts tomorrow, so nothing is behind the
// visitor yet: the demo pretends two weeks have passed, the first done and
// the second missed, and answers the model's step with picks recorded from
// the real model for four fixed reasons. Code builds and checks the options
// on the visitor's own plan, exactly as in a live run.

import type { Language } from './i18n.ts';
import type { PickResult } from './replan-stream.ts';
import type { GoalPlan, LocalDate } from './planner/types.ts';

export const REPLAN_REASONS = ['trip', 'swamped', 'forgot', 'pain'] as const;
export type ReplanReasonId = (typeof REPLAN_REASONS)[number];

/** The reasons the demo offers, as the person would have written them. */
export const REPLAN_REASON_TEXT: Readonly<Record<Language, Readonly<Record<ReplanReasonId, string>>>> = {
  en: {
    trip: 'I was away on a work trip all week, and I’m back now.',
    swamped: 'Work has been overwhelming for weeks and I’m worn out.',
    forgot: 'I just forgot. I’m ready to get back to it.',
    pain: 'My knee hurts when I run.',
  },
  es: {
    trip: 'Estuve de viaje de trabajo toda la semana y ya regresé.',
    swamped: 'El trabajo me ha rebasado desde hace semanas y ando sin energía.',
    forgot: 'Simplemente se me olvidó. Ya quiero retomarlo.',
    pain: 'Me duele la rodilla cuando corro.',
  },
};

export type ReplanSample = {
  reason: ReplanReasonId;
  language: Language;
  text: string;
  recordedOn: string;
  pick: Record<string, unknown>;
  meta: { model: string; promptVersion: string; requestId: string };
};

export async function loadReplanSamples(): Promise<ReplanSample[]> {
  const { REPLAN_SAMPLES } = await import('./samples/replan-samples.ts');
  return REPLAN_SAMPLES as unknown as ReplanSample[];
}

export function findReplanSample(samples: ReplanSample[], reason: ReplanReasonId, language: Language): ReplanSample | undefined {
  return samples.find((sample) => sample.reason === reason && sample.language === language);
}

/** The demo's model step: the recorded pick. */
export function replanSampleDeps(sample: ReplanSample): { pickOption: () => Promise<PickResult> } {
  return { pickOption: async () => ({ pick: sample.pick }) };
}

/**
 * Pretends two weeks with sessions have passed: sessions before the second
 * one are done, the second one's are missed, and today is its Sunday. Null
 * when the plan is too short to show anything after that.
 */
export function simulateMissedWeek(plan: GoalPlan): { plan: GoalPlan; today: LocalDate } | null {
  const withSessions = plan.weeks.filter((week) => week.sessions.length > 0);
  const missed = withSessions[1];
  if (!missed || !withSessions[2]) return null;
  return {
    today: missed.end,
    plan: {
      ...plan,
      weeks: plan.weeks.map((week) => ({
        ...week,
        sessions: week.sessions.map((session) => ({
          ...session,
          status: session.date < missed.start ? 'done' : week.week === missed.week ? 'missed' : session.status,
        })),
      })),
    },
  };
}
