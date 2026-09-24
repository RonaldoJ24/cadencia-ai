// The goal demo: the same pipeline as a live run, with the model's two steps
// replaced by outputs recorded from the real model for fixed example texts.
// Code still does everything else on the visitor's own settings: it shifts
// recorded dates to today and fits the recorded draft to this calendar.

import type { GoalPipelineDeps } from './goal-stream.ts';
import type { Language } from './i18n.ts';
import { addDays, daysBetween } from './planner/time.ts';

export const SAMPLE_IDS = ['ten_k', 'guitar', 'interview', 'vague', 'marathon'] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];

type RecordedDraft = {
  phases: Array<{ title: string; fromWeek: number; toWeek: number; focus: string }>;
  sessionTypes: unknown[];
  weeks: Array<{ week: number; sessions: string[] }>;
  templateId: string | null;
};

type CallRecord = { model: string; promptVersion: string; requestId: string };

export type GoalSample = {
  id: SampleId;
  language: Language;
  text: string;
  recordedOn: string;
  reading: Record<string, unknown>;
  scopeRefused: boolean;
  readMeta: CallRecord;
  draft?: RecordedDraft;
  draftMeta?: CallRecord & { attempt: number };
  recordedWeeks?: number;
};

export async function loadSamples(): Promise<GoalSample[]> {
  const { GOAL_SAMPLES } = await import('./samples/goal-samples.ts');
  return GOAL_SAMPLES as unknown as GoalSample[];
}

export function findSample(samples: GoalSample[], id: SampleId, language: Language): GoalSample | undefined {
  return samples.find((sample) => sample.id === id && sample.language === language);
}

/** Moves a recorded deadline forward by the days since it was recorded. */
export function shiftReading(sample: GoalSample, today: string): Record<string, unknown> {
  const deadline = sample.reading.deadline;
  if (typeof deadline !== 'string') return sample.reading;
  return { ...sample.reading, deadline: addDays(deadline, daysBetween(sample.recordedOn, today)) };
}

/**
 * Fits a recorded draft to a calendar with another number of weeks. Each
 * week takes the recorded week at the same point of the plan, and phases
 * are stretched or squeezed to match. Code then checks and trims the result
 * like any draft.
 */
export function fitDraft(draft: RecordedDraft, weeks: number): RecordedDraft {
  const recorded = draft.weeks.length;
  if (recorded === weeks) return draft;
  const scale = (week: number) => Math.min(weeks, Math.max(1, Math.round((week * weeks) / recorded)));
  return {
    ...draft,
    phases: draft.phases.map((phase) => {
      const fromWeek = Math.min(weeks, Math.max(1, Math.round(((phase.fromWeek - 1) * weeks) / recorded) + 1));
      return { ...phase, fromWeek, toWeek: Math.max(fromWeek, scale(phase.toWeek)) };
    }),
    weeks: Array.from({ length: weeks }, (_, index) => {
      const source = Math.min(recorded, Math.max(1, Math.round(((index + 0.5) * recorded) / weeks + 0.5)));
      return { week: index + 1, sessions: [...draft.weeks[source - 1].sessions] };
    }),
  };
}

/** The pipeline's model steps for a demo run, answered from a sample. */
export function sampleDeps(sample: GoalSample, today: string): Pick<GoalPipelineDeps, 'readGoal' | 'draft'> {
  return {
    readGoal: async () => ({
      reading: shiftReading(sample, today),
      scopeRefused: sample.scopeRefused,
      requestId: sample.readMeta.requestId,
    }),
    draft: async (_payload, skeleton) => {
      if (!sample.draft) throw new Error('this sample has no draft');
      return { draft: fitDraft(sample.draft, skeleton.weeks.length), requestId: sample.draftMeta?.requestId };
    },
  };
}
