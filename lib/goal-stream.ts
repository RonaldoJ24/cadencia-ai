// The goal planning pipeline, stage by stage. Code checks the request and
// reserves live spend, the model reads the goal, code sizes the calendar,
// the model drafts sessions, code checks the draft (one retry when its
// structure is broken) and code fits it into the calendar. The Worker
// streams it for live runs; the browser runs it with recorded samples for
// the demo, so both show the same stages.

import { copyFor, languageFrom, type Language } from './i18n.ts';
import { buildSkeleton, planWeeks } from './planner/availability.ts';
import { checkPlan } from './planner/check.ts';
import { validateDraft, type DraftIssue, type DraftValidation } from './planner/draft.ts';
import {
  buildGoalSpec,
  providedSettings,
  validateGoalRequest,
  validateReading,
  type AbstainCategory,
  type ControlName,
  type GoalReading,
  type GoalRequest,
  type Provenance,
} from './planner/goal-input.ts';
import { weeklyCeilings } from './planner/load.ts';
import { schedulePlan } from './planner/schedule.ts';
import { SpecError } from './planner/spec.ts';
import type { Domain, Draft, GoalPlan, GoalSpec, Level, Skeleton } from './planner/types.ts';
import {
  diagnosticOf,
  reasonOf,
  requestIdOf,
  runStage,
  StageFailure,
  type ReserveResult,
  type StageRunner,
  type StepView,
} from './plan-stream.ts';
import { stepsCopyFor, type GoalStepsCopy, type StageActor, type StageId } from './steps-copy.ts';

/** What the service's read-goal endpoint takes. */
export type ReadGoalPayload = {
  text: string;
  language: Language;
  today: string;
  provided: string[];
  clarification?: { question: string; answer: string };
};

/** A problem found in a draft, clamped to what the service accepts. */
export type RetryProblem = { code: string; path: string; message: string };

/** What the service's draft endpoint takes. */
export type DraftPayload = {
  language: Language;
  goal: { title: string; summary: string };
  domain: Domain;
  level: Level;
  calendar: {
    weeks: Array<{ week: number; room: number; maxMinutes: number }>;
    weeklyCapMinutes: number;
    sessionMinutes: { min: number; max: number };
  };
  previousProblems?: RetryProblem[];
};

export type ReadGoalResult = { reading: unknown; scopeRefused: boolean; requestId?: string };
export type DraftResult = { draft: unknown; requestId?: string };

export type GoalPipelineDeps = StageRunner & {
  mode: 'demo' | 'live';
  /** The server's UTC date, which the browser's date must be within a day of. */
  serverToday?: string;
  /** Live mode: reserves spend and the visitor's slot before any model call. */
  reserve?: () => Promise<ReserveResult>;
  readGoal: (payload: ReadGoalPayload) => Promise<ReadGoalResult>;
  /** The skeleton lets a sample drafter fit a recorded draft to this calendar. */
  draft: (payload: DraftPayload, skeleton: Skeleton) => Promise<DraftResult>;
};

export type ReadingSummary = { title: string; summary: string; domain: Domain; level: Level };

export type GoalOutcome =
  | { outcome: 'ready'; plan: GoalPlan; reading: ReadingSummary; provenance: Provenance; requestIds: string[] }
  | { outcome: 'needs_answer'; question: string; reading: ReadingSummary; requestIds: string[] }
  | {
    outcome: 'cannot_plan';
    category: AbstainCategory | 'unclear';
    reason: string;
    byGuard: boolean;
    requestIds: string[];
  };

export const MAX_DRAFT_ATTEMPTS = 2;
const PROBLEM_LIMITS = { count: 20, code: 40, path: 80, message: 200 } as const;

/** Printable ASCII without <, > or &, as the service requires of problems. */
function asciiText(value: string, max: number): string {
  return value.replace(/[^ -~]|[<>&]/gu, '?').slice(0, max);
}

export function retryProblems(issues: DraftIssue[]): RetryProblem[] {
  return issues.slice(0, PROBLEM_LIMITS.count).map((issue) => ({
    code: asciiText(issue.code, PROBLEM_LIMITS.code),
    path: asciiText(issue.path, PROBLEM_LIMITS.path),
    message: asciiText(issue.message, PROBLEM_LIMITS.message),
  }));
}

export function readGoalPayload(request: GoalRequest): ReadGoalPayload {
  return {
    text: request.text,
    language: request.language,
    today: request.today,
    provided: providedSettings(request.controls),
    ...(request.clarification ? { clarification: request.clarification } : {}),
  };
}

export function draftPayload(
  request: GoalRequest,
  reading: GoalReading,
  spec: GoalSpec,
  skeleton: Skeleton,
  problems?: RetryProblem[],
): DraftPayload {
  return {
    language: request.language,
    goal: { title: reading.title, summary: reading.summary },
    domain: spec.domain,
    level: spec.level,
    calendar: {
      weeks: skeleton.weeks.map(({ week, maxSessions, maxMinutes }) => ({ week, room: maxSessions, maxMinutes })),
      weeklyCapMinutes: skeleton.weeklyCapMinutes,
      sessionMinutes: skeleton.sessionMinutes,
    },
    ...(problems && problems.length > 0 ? { previousProblems: problems } : {}),
  };
}

function inputLanguage(raw: unknown): Language {
  const language = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).language
    : undefined;
  return languageFrom(language);
}

function lengthOf(value: unknown, key: string): number {
  const list = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  return Array.isArray(list) ? list.length : 0;
}

/** Counts a proposal's sessions without trusting its shape. */
function sessionCount(draft: unknown): number {
  const weeks = typeof draft === 'object' && draft !== null ? (draft as { weeks?: unknown }).weeks : undefined;
  if (!Array.isArray(weeks)) return 0;
  return weeks.reduce<number>((total, week) => total + lengthOf(week, 'sessions'), 0);
}

function shortDate(date: string, language: Language): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(language === 'es' ? 'es-MX' : 'en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function dayList(spec: GoalSpec, language: Language): string {
  const names = language === 'es'
    ? ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return spec.days.map((day) => names[day]).join(', ');
}

function summaryOf(reading: GoalReading): ReadingSummary {
  return { title: reading.title, summary: reading.summary, domain: reading.domain, level: reading.level };
}

function touchedSettings(request: GoalRequest): ControlName[] {
  return (['deadline', 'days', 'window', 'weeklyMinutes', 'sessionMinutes', 'level'] as const).filter(
    (name) => request.controls[name] !== undefined,
  );
}

function fitCounts(plan: GoalPlan) {
  const dropped = plan.notes.filter((note) => note.kind === 'dropped');
  return {
    placed: plan.weeks.reduce((total, week) => total + week.sessions.length, 0),
    trimmed: dropped.filter((note) => note.kind === 'dropped' && note.reason !== 'no_free_slot').length,
    moved: plan.notes.filter((note) => note.kind === 'moved').length,
    unplaced: dropped.filter((note) => note.kind === 'dropped' && note.reason === 'no_free_slot').length,
  };
}

function callFailure(stage: StageId, message: string) {
  return (error: unknown) =>
    new StageFailure(stage, reasonOf(error), message, {
      status: 502,
      requestId: requestIdOf(error),
      diagnostic: diagnosticOf(error),
    });
}

/**
 * Runs the stages in order and returns the outcome. A failed stage throws a
 * StageFailure after its `failed` event; later stages never start. A
 * clarifying question or an abstention ends the run after the reading.
 */
export async function runGoalPipeline(rawInput: unknown, deps: GoalPipelineDeps): Promise<GoalOutcome> {
  const language = inputLanguage(rawInput);
  const copy: GoalStepsCopy = stepsCopyFor(language).goal;
  const modelActor: StageActor = deps.mode === 'live' ? 'model' : 'sample';
  const requestIds: string[] = [];
  const keep = (id?: string) => {
    if (id) requestIds.push(id);
  };

  const request = await runStage(
    deps,
    'check_request',
    'code',
    () => {
      const value = validateGoalRequest(rawInput, deps.serverToday);
      return { value, detail: copy.request(value.text.length, touchedSettings(value)) };
    },
    (error) => new StageFailure(
      'check_request',
      'invalid_input',
      copy.failure.request(error instanceof SpecError ? error.field : 'input'),
      { status: 400 },
    ),
  );

  let release = async () => undefined as void;
  if (deps.reserve) {
    const reserve = deps.reserve;
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
        return { value: result, detail: result.detail ?? stepsCopyFor(language).detail.reserve };
      },
      () => new StageFailure('reserve', 'limits_unavailable', copyFor(language).api.limitsNotConfigured, { status: 503 }),
    );
    release = slot.release;
  }

  try {
    const read = await runStage(
      deps,
      'read_goal',
      modelActor,
      async () => {
        const result = await deps.readGoal(readGoalPayload(request));
        keep(result.requestId);
        let reading: GoalReading;
        try {
          reading = validateReading(result.reading);
        } catch {
          throw new StageFailure('read_goal', 'invalid_reading', copy.failure.reading, {
            status: 502,
            requestId: result.requestId,
          });
        }
        const detail = result.scopeRefused
          ? copy.readGuard
          : reading.decision === 'clarify'
            ? request.clarification ? copy.readDeclined('unclear') : copy.readClarify
            : reading.decision === 'abstain' && reading.abstain
              ? copy.readDeclined(reading.abstain.category)
              : copy.readPlan(
                reading.title,
                reading.deadline ? shortDate(reading.deadline, language) : null,
                reading.deadlineBasis,
              );
        return { value: { reading, scopeRefused: result.scopeRefused }, detail, ...(result.scopeRefused ? { actor: 'code' as const } : {}) };
      },
      callFailure('read_goal', copy.failure.reading),
    );

    const { reading } = read;
    if (reading.decision === 'abstain' && reading.abstain) {
      return {
        outcome: 'cannot_plan',
        category: reading.abstain.category,
        reason: reading.abstain.reason,
        byGuard: read.scopeRefused,
        requestIds,
      };
    }
    if (reading.decision === 'clarify' && reading.question) {
      // One question at most: a second one after an answer ends the run.
      if (request.clarification) {
        return { outcome: 'cannot_plan', category: 'unclear', reason: copy.declines.unclear, byGuard: false, requestIds };
      }
      return { outcome: 'needs_answer', question: reading.question, reading: summaryOf(reading), requestIds };
    }

    const sized = await runStage(
      deps,
      'check_availability',
      'code',
      () => {
        const { spec, provenance } = buildGoalSpec(request, reading);
        const skeleton = buildSkeleton(spec, request.busy);
        if (skeleton.weeks.every((week) => week.maxSessions === 0)) {
          throw new StageFailure('check_availability', 'no_room', copy.failure.noRoom, { status: 422 });
        }
        const weeks = planWeeks(spec);
        const start = spec.domain === 'fitness' ? weeklyCeilings(spec, 1)[0] : null;
        return {
          value: { spec, provenance, skeleton },
          detail: copy.availability(
            weeks.length,
            shortDate(spec.startDate, language),
            shortDate(spec.deadline, language),
            dayList(spec, language),
            `${spec.window.start}–${spec.window.end}`,
            spec.weeklyCapMinutes,
            start,
          ),
        };
      },
      (error) => new StageFailure(
        'check_availability',
        'invalid_spec',
        copy.failure.request(error instanceof SpecError ? error.field : 'input'),
        { status: 422 },
      ),
    );
    const { spec, provenance, skeleton } = sized;

    let problems: RetryProblem[] | undefined;
    let accepted: Draft | null = null;
    for (let attempt = 1; attempt <= MAX_DRAFT_ATTEMPTS && !accepted; attempt += 1) {
      const proposal = await runStage(
        deps,
        'draft',
        modelActor,
        async () => {
          const result = await deps.draft(draftPayload(request, reading, spec, skeleton, problems), skeleton);
          keep(result.requestId);
          return {
            value: result,
            detail: copy.draft(lengthOf(result.draft, 'phases'), lengthOf(result.draft, 'sessionTypes'), sessionCount(result.draft)),
          };
        },
        callFailure('draft', copy.failure.draftTwice),
        attempt,
      );
      const checked = await runStage<DraftValidation>(
        deps,
        'check_draft',
        'code',
        () => {
          const validation = validateDraft(proposal.draft, spec, skeleton);
          if (validation.ok) {
            const over = new Set(validation.overLimits.map((issue) => issue.path)).size;
            return { value: validation, detail: over === 0 ? copy.checkPassed : copy.checkOver(over) };
          }
          if (attempt === MAX_DRAFT_ATTEMPTS) {
            throw new StageFailure('check_draft', 'invalid_draft', copy.failure.draftTwice, {
              status: 502,
              requestId: proposal.requestId,
              diagnostic: { codes: validation.issues.slice(0, 5).map((issue) => issue.code) },
            });
          }
          return {
            value: validation,
            detail: copy.checkRetry(validation.issues.length, asciiText(validation.issues[0]?.message ?? '', 120)),
          };
        },
        () => new StageFailure('check_draft', 'invalid_draft', copy.failure.draftTwice, { status: 502 }),
        attempt,
      );
      if (checked.ok) accepted = checked.draft;
      else problems = retryProblems(checked.issues);
    }
    if (!accepted) throw new StageFailure('check_draft', 'invalid_draft', copy.failure.draftTwice, { status: 502 });
    const draft = accepted;

    const plan = await runStage(
      deps,
      'fit',
      'code',
      () => {
        const value = schedulePlan(spec, draft, request.busy);
        const violations = checkPlan(value, request.busy);
        if (violations.length > 0) {
          throw new StageFailure('fit', 'plan_violations', copy.failure.fit, {
            status: 500,
            diagnostic: { rules: [...new Set(violations.map((violation) => violation.rule))] },
          });
        }
        return { value, detail: copy.fit(fitCounts(value)) };
      },
      () => new StageFailure('fit', 'plan_failed', copy.failure.fit, { status: 500 }),
    );

    return { outcome: 'ready', plan, reading: summaryOf(reading), provenance, requestIds };
  } finally {
    await release();
  }
}

/** The stages a goal run will go through, before any of them starts. */
export function plannedGoalSteps(mode: 'demo' | 'live'): StepView[] {
  const model: StageActor = mode === 'live' ? 'model' : 'sample';
  const stages: Array<[StageId, StageActor]> = [
    ['check_request', 'code'],
    ...(mode === 'live' ? [['reserve', 'code'] as [StageId, StageActor]] : []),
    ['read_goal', model],
    ['check_availability', 'code'],
    ['draft', model],
    ['check_draft', 'code'],
    ['fit', 'code'],
  ];
  return stages.map(([stage, actor]) => ({ stage, actor, status: 'pending' }));
}
