// A replan run after missed sessions, as streamed stages. The browser builds
// the options with lib/planner/replan.ts and sends only their summaries, in
// numbers, with the person's reason. Here code checks that request, the model
// (or a recorded sample, in the demo) picks one offered option or declines,
// and code checks the pick. The person approves before anything changes.

import { copyFor, languageFrom, type Language } from './i18n.ts';
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
import { GOAL_LIMITS, plainText } from './planner/goal-input.ts';
import { REPLAN_OPTIONS, type Replan, type ReplanOptionId, type ReplanSummary } from './planner/replan.ts';
import { DOMAINS, LEVELS, SpecError } from './planner/spec.ts';
import { daysBetween, isLocalDate } from './planner/time.ts';
import type { Domain, GoalPlan, Level, LocalDate } from './planner/types.ts';
import { stepsCopyFor, type ReplanStepsCopy, type StageActor, type StageId } from './steps-copy.ts';

export type ReplanRequest = {
  language: Language;
  today: LocalDate;
  domain: Domain;
  level: Level;
  situation: { missedSessions: number; missedWeeks: number; weeksLeft: number };
  options: ReplanSummary[];
  reason: string;
};

/** What the service receives: the checked request, as is. */
export type ReplanPayload = ReplanRequest;

/** The request for a plan's options: the goal's area and level, numbers only, and the reason. */
export function replanRequestFor(plan: GoalPlan, replan: Replan, today: LocalDate, language: Language, reason: string): ReplanRequest {
  const { missedSessions, missedWeeks, weeksLeft } = replan.situation;
  return {
    language,
    today,
    domain: plan.spec.domain,
    level: plan.spec.level,
    situation: { missedSessions, missedWeeks, weeksLeft },
    options: replan.options.map((option) => option.summary),
    reason,
  };
}

export type ReplanDecline = 'medical' | 'unclear';

export type ReplanOutcome =
  | { outcome: 'suggested'; option: ReplanOptionId; why: string; requestIds: string[] }
  | { outcome: 'declined'; category: ReplanDecline; reason: string; requestIds: string[] }
  /** No suggestion: the pick named an option not offered here. The person chooses. */
  | { outcome: 'open'; requestIds: string[] };

export type PickResult = { pick: unknown; requestId?: string };

export type ReplanPipelineDeps = StageRunner & {
  mode: 'demo' | 'live';
  /** The server's UTC date, which the browser's date must be within a day of. */
  serverToday?: string;
  /** Live mode: reserves spend and the visitor's slot before the model call. */
  reserve?: () => Promise<ReserveResult>;
  pickOption: (payload: ReplanPayload) => Promise<PickResult>;
};

/** The same bounds the service's schema enforces. */
export const REPLAN_LIMITS = {
  maxReasonChars: 500,
  maxOptions: REPLAN_OPTIONS.length,
  missedSessions: [1, 200],
  missedWeeks: [1, 3],
  weeksLeft: [1, 30],
  sessionsLeft: [0, 210],
  minutesLeft: [0, 36_000],
  nextSevenDaysMinutes: [0, 1_680],
  sessionsLeftOut: [0, 400],
} as const;

type Bounded = 'missedSessions' | 'missedWeeks' | 'weeksLeft' | 'sessionsLeft' | 'minutesLeft' | 'nextSevenDaysMinutes' | 'sessionsLeftOut';

function record(value: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SpecError(field, `${field} must be an object`);
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) throw new SpecError(field, `unknown field ${unknown.slice(0, 40)}`);
  return value as Record<string, unknown>;
}

function bounded(value: unknown, field: Bounded): number {
  const [min, max] = REPLAN_LIMITS[field];
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new SpecError(field, `${field} must be a whole number from ${min} to ${max}`);
  }
  return value as number;
}

const SUMMARY_KEYS = ['id', 'deadline', 'weeksLeft', 'sessionsLeft', 'minutesLeft', 'nextSevenDaysMinutes', 'sessionsLeftOut'] as const;

/** Checks a replan request from the browser: summaries in numbers, and one reason. */
export function validateReplanRequest(raw: unknown, serverToday?: LocalDate): ReplanRequest {
  const value = record(raw, 'input', ['language', 'today', 'domain', 'level', 'situation', 'options', 'reason']);
  const language = value.language === 'es' ? 'es' : value.language === 'en' ? 'en' : null;
  if (!language) throw new SpecError('language', 'language must be en or es');
  if (!isLocalDate(value.today)) throw new SpecError('today', 'today must be a calendar date');
  if (serverToday && Math.abs(daysBetween(serverToday, value.today)) > GOAL_LIMITS.todaySkewDays) {
    throw new SpecError('today', 'today does not match the current date');
  }
  if (!DOMAINS.includes(value.domain as Domain)) throw new SpecError('domain', 'domain is not supported');
  if (!LEVELS.includes(value.level as Level)) throw new SpecError('level', 'level is not supported');
  const situation = record(value.situation, 'situation', ['missedSessions', 'missedWeeks', 'weeksLeft']);
  if (!Array.isArray(value.options) || value.options.length === 0 || value.options.length > REPLAN_LIMITS.maxOptions) {
    throw new SpecError('options', `options must list 1 to ${REPLAN_LIMITS.maxOptions} options`);
  }
  const options = value.options.map((item, index): ReplanSummary => {
    const option = record(item, `options[${index}]`, SUMMARY_KEYS);
    if (!REPLAN_OPTIONS.includes(option.id as ReplanOptionId)) throw new SpecError(`options[${index}]`, 'unknown option');
    if (!isLocalDate(option.deadline)) throw new SpecError(`options[${index}]`, 'deadline must be a calendar date');
    return {
      id: option.id as ReplanOptionId,
      deadline: option.deadline,
      weeksLeft: bounded(option.weeksLeft, 'weeksLeft'),
      sessionsLeft: bounded(option.sessionsLeft, 'sessionsLeft'),
      minutesLeft: bounded(option.minutesLeft, 'minutesLeft'),
      nextSevenDaysMinutes: bounded(option.nextSevenDaysMinutes, 'nextSevenDaysMinutes'),
      sessionsLeftOut: bounded(option.sessionsLeftOut, 'sessionsLeftOut'),
    };
  });
  if (new Set(options.map((option) => option.id)).size !== options.length) throw new SpecError('options', 'options must not repeat');
  return {
    language,
    today: value.today,
    domain: value.domain as Domain,
    level: value.level as Level,
    situation: {
      missedSessions: bounded(situation.missedSessions, 'missedSessions'),
      missedWeeks: bounded(situation.missedWeeks, 'missedWeeks'),
      weeksLeft: bounded(situation.weeksLeft, 'weeksLeft'),
    },
    options,
    reason: plainText(value.reason, 'reason', REPLAN_LIMITS.maxReasonChars),
  };
}

export type CheckedPick =
  | { decision: 'pick'; option: ReplanOptionId; why: string }
  | { decision: 'abstain'; category: ReplanDecline; reason: string }
  | { decision: 'not_offered' };

/** One sentence, no digits: numbers and dates on the page always come from code. */
function sentence(value: unknown, field: string): string {
  const text = plainText(value, field, 200);
  if (/\d/u.test(text)) throw new SpecError(field, `${field} must not contain digits`);
  return text;
}

/** Checks the model's pick again in code, against the options this request offered. */
export function checkPick(raw: unknown, offered: readonly ReplanOptionId[]): CheckedPick {
  const value = record(raw, 'pick', ['decision', 'option', 'why', 'abstain']);
  if (value.decision === 'pick') {
    if (value.abstain !== null) throw new SpecError('pick', 'a pick has no abstain');
    if (!REPLAN_OPTIONS.includes(value.option as ReplanOptionId)) throw new SpecError('pick', 'unknown option');
    const why = sentence(value.why, 'why');
    return offered.includes(value.option as ReplanOptionId)
      ? { decision: 'pick', option: value.option as ReplanOptionId, why }
      : { decision: 'not_offered' };
  }
  if (value.decision === 'abstain') {
    if (value.option !== null || value.why !== null) throw new SpecError('pick', 'an abstain names no option');
    const abstain = record(value.abstain, 'abstain', ['category', 'reason']);
    if (abstain.category !== 'medical' && abstain.category !== 'unclear') throw new SpecError('abstain', 'unknown category');
    return { decision: 'abstain', category: abstain.category, reason: sentence(abstain.reason, 'reason') };
  }
  throw new SpecError('pick', 'decision must be pick or abstain');
}

function inputLanguage(raw: unknown): Language {
  const language = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).language
    : undefined;
  return languageFrom(language);
}

/**
 * Runs the stages in order and returns the outcome. A failed stage throws a
 * StageFailure after its `failed` event; later stages never start.
 */
export async function runReplanPipeline(rawInput: unknown, deps: ReplanPipelineDeps): Promise<ReplanOutcome> {
  const language = inputLanguage(rawInput);
  const copy: ReplanStepsCopy = stepsCopyFor(language).replan;
  const modelActor: StageActor = deps.mode === 'live' ? 'model' : 'sample';
  const requestIds: string[] = [];

  const request = await runStage(
    deps,
    'check_request',
    'code',
    () => {
      const value = validateReplanRequest(rawInput, deps.serverToday);
      return { value, detail: copy.request(value.reason.length, value.options.length) };
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
    const picked = await runStage(
      deps,
      'pick_option',
      modelActor,
      async () => {
        const result = await deps.pickOption(request);
        if (result.requestId) requestIds.push(result.requestId);
        return { value: result, detail: copy.pickReceived };
      },
      (error) => new StageFailure('pick_option', reasonOf(error), copyFor(language).api.providerError, {
        status: 502,
        requestId: requestIdOf(error),
        diagnostic: diagnosticOf(error),
      }),
    );
    const offered = request.options.map((option) => option.id);
    const pick = await runStage(
      deps,
      'check_pick',
      'code',
      () => {
        const value = checkPick(picked.pick, offered);
        const detail = value.decision === 'pick'
          ? copy.suggested(value.option)
          : value.decision === 'abstain' ? copy.declined(value.category) : copy.notOffered;
        return { value, detail };
      },
      () => new StageFailure('check_pick', 'invalid_pick', copy.failure.pick, { status: 502, requestId: picked.requestId }),
    );
    if (pick.decision === 'pick') return { outcome: 'suggested', option: pick.option, why: pick.why, requestIds };
    if (pick.decision === 'abstain') return { outcome: 'declined', category: pick.category, reason: pick.reason, requestIds };
    return { outcome: 'open', requestIds };
  } finally {
    await release();
  }
}

/**
 * The stages a replan will go through. Building the options is done by code
 * in the browser before the request, so it is shown first and already done.
 */
export function plannedReplanSteps(mode: 'demo' | 'live'): StepView[] {
  const model: StageActor = mode === 'live' ? 'model' : 'sample';
  const stages: Array<[StageId, StageActor]> = [
    ['build_options', 'code'],
    ['check_request', 'code'],
    ...(mode === 'live' ? [['reserve', 'code'] as [StageId, StageActor]] : []),
    ['pick_option', model],
    ['check_pick', 'code'],
  ];
  return stages.map(([stage, actor]) => ({ stage, actor, status: 'pending' }));
}
