// Stages of a planning run: how each one reports that it started and ended,
// how a failure carries what is safe to show, and how the page folds the
// events into its step list. The goal pipeline (goal-stream.ts) runs on it.

import type { StageActor, StageId } from './steps-copy.ts';

export type { StageActor, StageId } from './steps-copy.ts';

/** `attempt` appears from the second run of a stage on, such as a draft retry. */
export type StageEvent =
  | { type: 'stage'; stage: StageId; status: 'started'; actor: StageActor; attempt?: number }
  | {
    type: 'stage';
    stage: StageId;
    status: 'completed' | 'failed';
    actor: StageActor;
    durationMs: number;
    detail: string;
    attempt?: number;
  };

export type ReserveResult =
  | { allowed: true; release: () => Promise<void>; detail?: string }
  | { allowed: false; status: number; reason: string; message: string; retryAfterSec?: number };

export type FailureOptions = {
  status?: number;
  retryAfterSec?: number;
  requestId?: string;
  diagnostic?: Record<string, unknown>;
};

/** A stage that failed, with a message safe to show and a code for logs. */
export class StageFailure extends Error {
  readonly stage: StageId;
  readonly code: string;
  readonly publicMessage: string;
  readonly options: FailureOptions;

  constructor(stage: StageId, code: string, publicMessage: string, options: FailureOptions = {}) {
    super(code);
    this.name = 'StageFailure';
    this.stage = stage;
    this.code = code;
    this.publicMessage = publicMessage;
    this.options = options;
  }
}

/** What a stage produced; `actor` corrects who did the work when it differs from the plan. */
export type StageOutput<T> = { value: T; detail: string; actor?: StageActor };
export type StageWork<T> = () => Promise<StageOutput<T>> | StageOutput<T>;
export type StageRunner = { now: () => number; emit: (event: StageEvent) => void };

/**
 * Runs one stage: `started` right before the work, then `completed` or
 * `failed` with the measured duration and a detail from the work itself.
 */
export async function runStage<T>(
  deps: StageRunner,
  stage: StageId,
  actor: StageActor,
  work: StageWork<T>,
  toFailure: (error: unknown) => StageFailure,
  attempt = 1,
): Promise<T> {
  const retry = attempt > 1 ? { attempt } : {};
  deps.emit({ type: 'stage', stage, status: 'started', actor, ...retry });
  const started = deps.now();
  try {
    const { value, detail, actor: doneBy } = await work();
    deps.emit({
      type: 'stage',
      stage,
      status: 'completed',
      actor: doneBy ?? actor,
      durationMs: Math.max(0, deps.now() - started),
      detail,
      ...retry,
    });
    return value;
  } catch (error) {
    const failure = error instanceof StageFailure ? error : toFailure(error);
    deps.emit({
      type: 'stage',
      stage,
      status: 'failed',
      actor,
      durationMs: Math.max(0, deps.now() - started),
      detail: failure.publicMessage,
      ...retry,
    });
    throw failure;
  }
}

export function requestIdOf(error: unknown): string | undefined {
  const value = (error as { requestId?: unknown } | null)?.requestId;
  return typeof value === 'string' ? value : undefined;
}

export function reasonOf(error: unknown): string {
  const value = (error as { reason?: unknown } | null)?.reason;
  return typeof value === 'string' ? value : 'upstream_invalid_response';
}

export function diagnosticOf(error: unknown): Record<string, unknown> | undefined {
  const value = (error as { diagnostic?: unknown } | null)?.diagnostic;
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

export type StepView = {
  stage: StageId;
  actor: StageActor;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  attempt?: number;
  durationMs?: number;
  detail?: string;
};

/**
 * Folds one stage event into the step list shown to the person. A retry the
 * list did not plan for is inserted before the first step not yet started.
 */
export function applyStageEvent(steps: StepView[], event: StageEvent): StepView[] {
  const attempt = event.attempt ?? 1;
  const matches = (step: StepView) => step.stage === event.stage && (step.attempt ?? 1) === attempt;
  if (!steps.some(matches)) {
    const added: StepView = { stage: event.stage, actor: event.actor, status: 'pending', attempt };
    const at = steps.findIndex((step) => step.status === 'pending');
    const next = at === -1 ? [...steps, added] : [...steps.slice(0, at), added, ...steps.slice(at)];
    return applyStageEvent(next, event);
  }
  return steps.map((step) => {
    if (!matches(step)) return step;
    if (event.status === 'started') return { ...step, actor: event.actor, status: 'running' };
    return {
      ...step,
      actor: event.actor,
      status: event.status === 'completed' ? 'done' : 'failed',
      durationMs: event.durationMs,
      detail: event.detail,
    };
  });
}

/** Once a run has its answer, steps it never needed show as skipped. */
export function skipRemainingSteps(steps: StepView[]): StepView[] {
  return steps.map((step) => (step.status === 'pending' ? { ...step, status: 'skipped' } : step));
}

const STAGE_IDS: readonly StageId[] = [
  'check_request',
  'check_availability',
  'reserve',
  'read_goal',
  'draft',
  'check_draft',
  'fit',
];

function attemptOf(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= 5 ? value : null;
}
const ACTORS: readonly StageActor[] = ['code', 'model', 'sample'];

/** Accepts only well-formed stage events from the wire. */
export function parseStageEvent(value: unknown): StageEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const event = value as Record<string, unknown>;
  if (event.type !== 'stage') return null;
  if (!STAGE_IDS.includes(event.stage as StageId) || !ACTORS.includes(event.actor as StageActor)) return null;
  const attempt = attemptOf(event.attempt);
  if (attempt === null) return null;
  const retry = attempt ? { attempt } : {};
  if (event.status === 'started') {
    return { type: 'stage', stage: event.stage as StageId, status: 'started', actor: event.actor as StageActor, ...retry };
  }
  if (
    (event.status === 'completed' || event.status === 'failed') &&
    typeof event.durationMs === 'number' &&
    Number.isFinite(event.durationMs) &&
    typeof event.detail === 'string'
  ) {
    return {
      type: 'stage',
      stage: event.stage as StageId,
      status: event.status,
      actor: event.actor as StageActor,
      durationMs: event.durationMs,
      detail: event.detail.slice(0, 300),
      ...retry,
    };
  }
  return null;
}
