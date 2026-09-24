// The planning pipeline, run stage by stage. Each stage reports `started`
// right before its work and `completed` or `failed` right after, with the
// measured duration and a detail computed from that stage's own output.
// The same code runs in the Worker (streamed to the browser) and in the
// browser (the demo), so both show the same stages.

import { copyFor, languageFrom } from './i18n.ts';
import {
  buildPlan,
  demoIntent,
  demoScopeRefused,
  validateInput,
  validateIntent,
  type Intent,
  type IntentRequirements,
  type PlannerEvent,
  type RoutineInput,
  type RoutinePlan,
} from './routine.ts';
import { stepsCopyFor, type StageActor, type StageId, type StepsCopy } from './steps-copy.ts';

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

export type ResultEvent = {
  type: 'result';
  outcome: 'ready' | 'cannot_plan';
  plan: RoutinePlan;
  requestId?: string;
};

export type ErrorEvent = {
  type: 'error';
  stage: StageId;
  message: string;
  reference?: string;
  retryAfterSec?: number;
};

export type PlanStreamEvent = StageEvent | ResultEvent | ErrorEvent;

export type DraftResult = { intent: unknown; scopeRefused: boolean; requestId?: string };

export type ReserveResult =
  | { allowed: true; release: () => Promise<void>; detail?: string }
  | { allowed: false; status: number; reason: string; message: string; retryAfterSec?: number };

export type PipelineDeps = {
  mode: 'demo' | 'deepseek';
  /** Milliseconds from any monotonic-enough clock; durations are differences. */
  now: () => number;
  emit: (event: StageEvent) => void;
  /** Live mode: reserves the visitor's slot before the model is called. */
  reserve?: () => Promise<ReserveResult>;
  /** Live mode: asks the model for a draft of exactly `requirements` sessions. */
  draft?: (input: RoutineInput, requirements: IntentRequirements) => Promise<DraftResult>;
};

export type PipelineOutcome = {
  outcome: 'ready' | 'cannot_plan';
  plan: RoutinePlan;
  requestId?: string;
};

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

function inputLanguage(raw: unknown) {
  const language = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).language
    : undefined;
  return languageFrom(language);
}

function shortDay(names: readonly string[], dayIndex: number): string {
  return names[dayIndex]?.slice(0, 3) ?? String(dayIndex);
}

function stepCount(intent: unknown): number {
  const steps = typeof intent === 'object' && intent !== null
    ? (intent as { steps?: unknown }).steps
    : undefined;
  return Array.isArray(steps) ? steps.length : 0;
}

function fitDetail(copy: StepsCopy, dayNames: readonly string[], input: RoutineInput, events: PlannerEvent[]): string {
  const placed = events
    .filter((event): event is Extract<PlannerEvent, { type: 'session_placed' }> => event.type === 'session_placed')
    .map((event) => `${shortDay(dayNames, event.dayIndex)} ${Number(event.date.slice(8, 10))}`);
  return placed.length === 0 ? copy.detail.fitNone : copy.detail.fit(placed, input.time);
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

/**
 * Runs the stages in order and returns the plan. A failed stage throws a
 * StageFailure after its `failed` event; later stages never start.
 */
export async function runPlanPipeline(rawInput: unknown, deps: PipelineDeps): Promise<PipelineOutcome> {
  const language = inputLanguage(rawInput);
  const copy = stepsCopyFor(language);
  const baseCopy = copyFor(language);

  const input = await runStage(
    deps,
    'check_request',
    'code',
    () => {
      const value = validateInput(rawInput);
      return {
        value,
        detail: copy.detail.request(value.days.length, value.sessionMinutes, value.weeklyMinutes),
      };
    },
    () => new StageFailure('check_request', 'invalid_input', baseCopy.api.invalidInput, { status: 400 }),
  );

  const requirements = await runStage(
    deps,
    'check_availability',
    'code',
    () => {
      const days = [...input.days].sort((a, b) => a - b);
      const sessionCount = Math.min(days.length, Math.floor(input.weeklyMinutes / input.sessionMinutes));
      const value: IntentRequirements = { sessionCount, sessionMinutes: input.sessionMinutes };
      return {
        value,
        detail: copy.detail.availability(
          sessionCount,
          days.length,
          days.slice(0, sessionCount).map((day) => shortDay(baseCopy.dayNames, day)),
          input.weeklyMinutes,
        ),
      };
    },
    () => new StageFailure('check_availability', 'availability_failed', baseCopy.api.invalidInput, { status: 400 }),
  );

  let draft: DraftResult;
  if (deps.mode === 'deepseek') {
    const { reserve, draft: requestDraft } = deps;
    if (!reserve || !requestDraft) throw new Error('live pipeline requires reserve and draft');
    const slot = await runStage(
      deps,
      'reserve',
      'code',
      async () => {
        const result = await reserve();
        if (!result.allowed) {
          throw new StageFailure('reserve', result.reason, result.message, {
            status: result.status,
            retryAfterSec: result.retryAfterSec,
          });
        }
        return { value: result, detail: result.detail ?? copy.detail.reserve };
      },
      () => new StageFailure('reserve', 'limits_unavailable', baseCopy.api.limitsNotConfigured, { status: 503 }),
    );
    try {
      draft = await runStage(
        deps,
        'draft',
        'model',
        async () => {
          const result = await requestDraft(input, requirements);
          return {
            value: result,
            detail: result.scopeRefused ? copy.detail.draftDeclined : copy.detail.draftModel(stepCount(result.intent)),
          };
        },
        (error) => new StageFailure('draft', reasonOf(error), baseCopy.api.providerError, {
          status: 502,
          requestId: requestIdOf(error),
          diagnostic: diagnosticOf(error),
        }),
      );
    } finally {
      await slot.release();
    }
  } else {
    draft = await runStage(
      deps,
      'draft',
      'sample',
      () => {
        const scopeRefused = demoScopeRefused(input.request);
        const intent: Intent = demoIntent(
          input.request,
          input.sessionMinutes,
          requirements.sessionCount,
          input.language,
        );
        return {
          value: { intent, scopeRefused },
          detail: scopeRefused ? copy.detail.draftSampleDeclined : copy.detail.draftSample(intent.steps.length),
        };
      },
      () => new StageFailure('draft', 'sample_failed', copy.failure.checkDraft, { status: 500 }),
    );
  }

  const intent = await runStage(
    deps,
    'check_draft',
    'code',
    () => {
      const value = validateIntent(draft.intent, draft.scopeRefused ? undefined : requirements);
      return {
        value,
        detail: draft.scopeRefused ? copy.detail.checkDeclined : copy.detail.checkDraft(value.steps.length),
      };
    },
    () => new StageFailure(
      'check_draft',
      deps.mode === 'deepseek' ? 'upstream_invalid_response' : 'invalid_draft',
      deps.mode === 'deepseek' ? baseCopy.api.providerError : copy.failure.checkDraft,
      { status: 502, requestId: draft.requestId },
    ),
  );

  const plan = await runStage(
    deps,
    'fit',
    'code',
    () => {
      const events: PlannerEvent[] = [];
      const value = buildPlan(
        input,
        intent,
        deps.mode,
        deps.mode === 'deepseek' ? draft.scopeRefused : undefined,
        (event) => events.push(event),
      );
      return { value, detail: fitDetail(copy, baseCopy.dayNames, input, events) };
    },
    () => new StageFailure('fit', 'plan_failed', copy.failure.fit, { status: 500, requestId: draft.requestId }),
  );

  return {
    outcome: draft.scopeRefused ? 'cannot_plan' : 'ready',
    plan,
    requestId: draft.requestId,
  };
}

export type StepView = {
  stage: StageId;
  actor: StageActor;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  attempt?: number;
  durationMs?: number;
  detail?: string;
};

/** The stages a run will go through, before any of them starts. */
export function plannedSteps(mode: 'demo' | 'deepseek'): StepView[] {
  const stages: Array<[StageId, StageActor]> = mode === 'deepseek'
    ? [
      ['check_request', 'code'],
      ['check_availability', 'code'],
      ['reserve', 'code'],
      ['draft', 'model'],
      ['check_draft', 'code'],
      ['fit', 'code'],
    ]
    : [
      ['check_request', 'code'],
      ['check_availability', 'code'],
      ['draft', 'sample'],
      ['check_draft', 'code'],
      ['fit', 'code'],
    ];
  return stages.map(([stage, actor]) => ({ stage, actor, status: 'pending' }));
}

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
