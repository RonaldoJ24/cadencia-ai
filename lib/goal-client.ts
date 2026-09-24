// The browser side of a goal run. A live run posts to the route and reads
// its stream; a demo run executes the same pipeline here with recorded
// samples. Both report stages the same way and return the same outcome.

import { findSample, loadSamples, sampleDeps, type SampleId } from './goal-demo.ts';
import { runGoalPipeline, type GoalOutcome } from './goal-stream.ts';
import type { Language } from './i18n.ts';
import { parseStageEvent, StageFailure, type StageEvent } from './plan-stream.ts';
import type { GoalControls } from './planner/goal-input.ts';
import type { BusyInterval } from './planner/types.ts';
import { readSse } from './sse.ts';
import type { StageId } from './steps-copy.ts';

export type GoalRunInput = {
  text: string;
  language: Language;
  today: string;
  controls: GoalControls;
  /** Busy times from an imported calendar: only when each starts and ends. */
  busy?: BusyInterval[];
  clarification?: { question: string; answer: string };
};

/** A run that ended without an outcome, with what the person should see. */
export class GoalRunError extends Error {
  readonly stage?: StageId;
  readonly reference?: string;
  readonly retryAfterSec?: number;
  readonly status?: number;

  constructor(message: string, details: { stage?: StageId; reference?: string; retryAfterSec?: number; status?: number } = {}) {
    super(message);
    this.name = 'GoalRunError';
    this.stage = details.stage;
    this.reference = details.reference;
    this.retryAfterSec = details.retryAfterSec;
    this.status = details.status;
  }
}

/** The server went quiet for this long (it sends a heartbeat every 10 s). */
export const IDLE_TIMEOUT_MS = 70_000;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 500) : undefined;
}

/** Accepts only outcomes with the fields the page reads. */
export function parseGoalOutcome(value: unknown): GoalOutcome | null {
  if (typeof value !== 'object' || value === null) return null;
  const outcome = value as Record<string, unknown>;
  const reading = outcome.reading as Record<string, unknown> | undefined;
  const hasReading = typeof reading?.title === 'string' && typeof reading.summary === 'string';
  if (outcome.outcome === 'ready' && hasReading && typeof outcome.plan === 'object' && outcome.plan !== null) {
    const plan = outcome.plan as Record<string, unknown>;
    if (Array.isArray(plan.weeks) && typeof plan.spec === 'object' && typeof plan.draft === 'object') {
      return value as GoalOutcome;
    }
  }
  if (outcome.outcome === 'needs_answer' && hasReading && typeof outcome.question === 'string') return value as GoalOutcome;
  if (outcome.outcome === 'cannot_plan' && typeof outcome.reason === 'string' && typeof outcome.category === 'string') {
    return value as GoalOutcome;
  }
  return null;
}

/**
 * Runs a live goal plan. `onActivity` fires on every chunk, heartbeats
 * included, so the caller's idle timer only trips when the server is silent.
 */
export async function streamGoalRun(
  input: GoalRunInput,
  options: {
    signal: AbortSignal;
    onStage: (event: StageEvent) => void;
    onActivity: () => void;
    fallbackMessage: string;
    streamEndedMessage: string;
  },
): Promise<GoalOutcome> {
  const response = await fetch('/api/routine', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ mode: 'deepseek', kind: 'goal', input }),
    signal: options.signal,
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream') || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new GoalRunError(text(payload.error) ?? options.fallbackMessage, {
      reference: text(payload.reference),
      status: response.status,
      retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    });
  }
  let outcome: GoalOutcome | null = null;
  let failure: GoalRunError | null = null;
  await readSse(response.body, (message) => {
    let data: unknown;
    try {
      data = JSON.parse(message.data);
    } catch {
      return;
    }
    if (message.event === 'stage') {
      const event = parseStageEvent(data);
      if (event) options.onStage(event);
    } else if (message.event === 'result') {
      outcome = parseGoalOutcome(data);
    } else if (message.event === 'error') {
      const payload = data as Record<string, unknown>;
      failure = new GoalRunError(text(payload.message) ?? options.fallbackMessage, {
        stage: typeof payload.stage === 'string' ? (payload.stage as StageId) : undefined,
        reference: text(payload.reference),
        retryAfterSec: typeof payload.retryAfterSec === 'number' ? payload.retryAfterSec : undefined,
      });
    }
  }, options.onActivity);
  if (failure) throw failure;
  if (!outcome) throw new GoalRunError(options.streamEndedMessage);
  return outcome;
}

/** Runs the demo in the browser: the real pipeline, with recorded samples. */
export async function runGoalDemo(
  sampleId: SampleId,
  input: GoalRunInput,
  onStage: (event: StageEvent) => void,
): Promise<GoalOutcome> {
  const sample = findSample(await loadSamples(), sampleId, input.language);
  if (!sample) throw new GoalRunError('This example has no recorded sample.');
  try {
    return await runGoalPipeline(
      { ...input, text: sample.text },
      { mode: 'demo', now: () => performance.now(), emit: onStage, ...sampleDeps(sample, input.today) },
    );
  } catch (error) {
    if (error instanceof StageFailure) throw new GoalRunError(error.publicMessage, { stage: error.stage });
    throw error;
  }
}
