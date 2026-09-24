// Runs the real goal pipeline for every case and arm, against each arm's own
// running service, and writes one result line per run. It checks every service
// before the first case, stops at a case boundary when the budget could not
// cover every arm's worst case, refuses an arm whose service is not the one
// pre-registered, stops when the harness fails, and can resume a run.

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGoalPipeline, type GoalOutcome, type GoalPipelineDeps } from '../../lib/goal-stream.ts';
import { StageFailure, type StageEvent } from '../../lib/plan-stream.ts';
import { buildSkeleton } from '../../lib/planner/availability.ts';
import { checkPlan } from '../../lib/planner/check.ts';
import { validateDraft } from '../../lib/planner/draft.ts';
import { validateReading } from '../../lib/planner/goal-input.ts';
import type { GoalPlan } from '../../lib/planner/types.ts';
import {
  normalizeServiceUrl,
  requestDraft,
  requestReadGoal,
  serviceEndpoint,
  ServiceFailure,
  type LiveConfig,
  type ServiceUsage,
} from '../../lib/server/live.ts';
import { chargeMicroUsd, validPrices, worstRunMicroUsd, type Prices } from './budget.ts';
import type { EvalCase } from './cases.ts';

export type Arm = {
  id: string;
  label: string;
  serviceUrl: string;
  prices: Prices | null;
  /** What the arm's service must report; the runner refuses anything else. */
  expect: { readGoal: string; draft: string; model: string | null };
};

export type CallRecord = {
  call: 'read' | 'draft';
  ms: number;
  costMicroUsd: number;
  usage?: ServiceUsage;
  promptVersion?: string;
  requestId?: string;
  failed?: string;
};

/** How one draft attempt ended: its check passed or not, or the call itself failed. */
export type DraftAttempt = 'valid' | 'invalid' | 'call_failed' | 'none';

export type ResultLine = {
  caseId: string;
  arm: string;
  /** 2 is the run with the case's scripted answer to a question. */
  round: 1 | 2;
  outcome: GoalOutcome['outcome'] | 'failed';
  /**
   * The harness failed, not the system under test: the local service was
   * unreachable, refused the call before any provider attempt, or was not the
   * pre-registered one. Kept with its cost, never scored, re-run on resume.
   */
  harness?: true;
  failedStage?: string;
  failedCode?: string;
  /** For a failed draft check or fit: the issue codes or the broken rules. */
  failedIssues?: string[];
  decision?: 'plan' | 'clarify' | 'abstain';
  abstainCategory?: string;
  byGuard?: boolean;
  question?: string;
  drafts?: { first: DraftAttempt; retry: DraftAttempt };
  plan?: { weeks: number; sessions: number; trimmed: number; unplaced: number; weeksOverLimits: number; violations: number };
  planData?: GoalPlan;
  stages: Array<{ stage: string; attempt: number; status: string; ms: number }>;
  calls: CallRecord[];
  costMicroUsd: number;
  totalMs: number;
};

export class RunRefused extends Error {}

export type RunOptions = {
  runId: string;
  outDir: string;
  cases: EvalCase[];
  arms: Arm[];
  token: string;
  budgetMicroUsd: number;
  gitSha: string;
  fetcher?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
};

export type RunSummary = {
  runs: number;
  spentMicroUsd: number;
  completed: boolean;
  stoppedBeforeCase?: string;
  stopReason?: 'budget' | 'harness' | 'failures';
};

/** Failed runs in a row on one arm before the run stops for the owner to look. */
export const MAX_FAILED_IN_A_ROW = 3;

type ReadyArm = Arm & { prices: Prices; endpoint: string };

function draftsFrom(events: StageEvent[]): NonNullable<ResultLine['drafts']> {
  const ended = (stage: string, attempt: number) =>
    events.find((event) => event.stage === stage && (event.attempt ?? 1) === attempt && event.status !== 'started');
  const retried = events.some((event) => event.stage === 'draft' && event.attempt === 2);
  const attempt = (number: 1 | 2): DraftAttempt => {
    const call = ended('draft', number);
    if (!call) return 'none';
    if (call.status === 'failed') return 'call_failed';
    // A first draft that fails its check still completes the stage; the retry
    // that follows is what marks it invalid.
    return ended('check_draft', number)?.status === 'completed' && !(number === 1 && retried) ? 'valid' : 'invalid';
  };
  return { first: attempt(1), retry: attempt(2) };
}

function planSummary(plan: GoalPlan): NonNullable<ResultLine['plan']> {
  const dropped = plan.notes.filter((note) => note.kind === 'dropped');
  const checked = validateDraft(plan.draft, plan.spec, buildSkeleton(plan.spec, []));
  return {
    weeks: plan.weeks.length,
    sessions: plan.weeks.reduce((total, week) => total + week.sessions.length, 0),
    trimmed: dropped.filter((note) => note.kind === 'dropped' && note.reason !== 'no_free_slot').length,
    unplaced: dropped.filter((note) => note.kind === 'dropped' && note.reason === 'no_free_slot').length,
    weeksOverLimits: checked.ok ? new Set(checked.overLimits.map((issue) => issue.path)).size : 0,
    violations: checkPlan(plan, []).length,
  };
}

function issuesOf(failure: StageFailure | undefined): string[] | undefined {
  const diagnostic = failure?.options.diagnostic;
  const list = diagnostic?.rules ?? diagnostic?.codes;
  return Array.isArray(list) ? list.map(String) : undefined;
}

/** The call never reached the model: the service was unreachable or refused it first. */
function harnessFailure(error: unknown): boolean {
  if (!(error instanceof ServiceFailure)) return false;
  return error.reason === 'upstream_fetch_failed' ||
    error.reason === 'invalid_authorization_header' ||
    (error.reason === 'backend_rejected' && error.providerAttempts === 0);
}

function checkArm(arm: Arm): ReadyArm {
  if (!validPrices(arm.prices)) throw new RunRefused(`arm ${arm.id} has no complete rate card`);
  if (!arm.expect.model) throw new RunRefused(`arm ${arm.id} has no expected model`);
  const endpoint = normalizeServiceUrl(arm.serviceUrl);
  if (!endpoint) throw new RunRefused(`arm ${arm.id} has an unusable service URL`);
  return { ...arm, prices: arm.prices, endpoint };
}

/**
 * Before any case, and at no cost: the service answers its health check and
 * accepts the token. An empty request is refused before any provider call,
 * with 400 when the token works and 401 when it does not.
 */
async function preflight(arm: ReadyArm, options: RunOptions): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const send = async (path: string, init: RequestInit = {}) => {
    try {
      const response = await fetcher(serviceEndpoint(arm.endpoint, path), { ...init, redirect: 'manual', signal: AbortSignal.timeout(5_000) });
      await response.body?.cancel();
      return response.status;
    } catch {
      throw new RunRefused(`arm ${arm.id}: no service answers at ${serviceEndpoint(arm.endpoint, '/')}`);
    }
  };
  if ((await send('/healthz')) !== 200) throw new RunRefused(`arm ${arm.id}: the service's health check failed`);
  const status = await send('/v1/read-goal', {
    method: 'POST',
    headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  if (status === 401) throw new RunRefused(`arm ${arm.id}: the service refused the token`);
  if (status !== 400) throw new RunRefused(`arm ${arm.id}: an empty request got ${status}, expected 400`);
}

/** Runs one case on one arm. A refusal comes back with the line, which keeps its cost. */
async function runOne(
  arm: ReadyArm,
  item: EvalCase,
  round: 1 | 2,
  clarification: { question: string; answer: string } | undefined,
  options: RunOptions,
): Promise<{ line: ResultLine; refused?: RunRefused }> {
  const now = options.now ?? (() => performance.now());
  const config: LiveConfig = { serviceUrl: arm.endpoint, token: options.token };
  const events: StageEvent[] = [];
  const stages: ResultLine['stages'] = [];
  const calls: CallRecord[] = [];
  let decision: ResultLine['decision'];
  let harness = false;
  // The pipeline turns unknown errors into stage failures, so a refusal is
  // kept here and reported once the pipeline returns.
  let refused: RunRefused | undefined;
  const verify = (call: 'read' | 'draft', version: string | undefined, usage: ServiceUsage | undefined) => {
    const expected = call === 'read' ? arm.expect.readGoal : arm.expect.draft;
    if (version !== expected) refused = new RunRefused(`arm ${arm.id} served ${call} prompt ${version ?? 'unknown'}, expected ${expected}`);
    else if (usage?.model && usage.model !== arm.expect.model) refused = new RunRefused(`arm ${arm.id} served model ${usage.model}, expected ${arm.expect.model}`);
    if (refused) throw refused;
  };
  async function recorded<T extends { usage?: ServiceUsage; promptVersion?: string; requestId?: string }>(call: 'read' | 'draft', work: () => Promise<T>): Promise<T> {
    const started = now();
    try {
      const answer = await work();
      calls.push({
        call,
        ms: Math.round(now() - started),
        costMicroUsd: chargeMicroUsd(arm.prices, call, answer.usage),
        usage: answer.usage,
        promptVersion: answer.promptVersion,
        requestId: answer.requestId,
      });
      verify(call, answer.promptVersion, answer.usage);
      return answer;
    } catch (error) {
      if (error instanceof RunRefused) throw error;
      const failure = error instanceof ServiceFailure ? error : undefined;
      if (harnessFailure(error)) harness = true;
      calls.push({
        call,
        ms: Math.round(now() - started),
        // Charged like any failure: a service that dropped the connection may
        // still have called the provider.
        costMicroUsd: chargeMicroUsd(arm.prices, call, failure?.usage),
        usage: failure?.usage,
        requestId: failure?.requestId,
        failed: failure?.reason ?? 'error',
      });
      throw error;
    }
  }
  const deps: GoalPipelineDeps = {
    mode: 'live',
    now,
    emit: (event) => {
      events.push(event);
      if (event.status !== 'started') stages.push({ stage: event.stage, attempt: event.attempt ?? 1, status: event.status, ms: event.durationMs });
    },
    readGoal: async (payload) => {
      const answer = await recorded('read', () => requestReadGoal(payload, config, options.fetcher));
      try {
        decision = validateReading(answer.reading).decision;
      } catch {
        decision = undefined;
      }
      return answer;
    },
    draft: (payload) => recorded('draft', () => requestDraft(payload, config, options.fetcher)),
  };
  const input = {
    text: item.text,
    language: item.language,
    today: item.today,
    ...(item.controls ? { controls: item.controls } : {}),
    ...(clarification ? { clarification } : {}),
  };
  const started = now();
  const base = { caseId: item.id, arm: arm.id, round, stages, calls };
  const total = () => ({ costMicroUsd: calls.reduce((sum, call) => sum + call.costMicroUsd, 0), totalMs: Math.round(now() - started) });
  let outcome: GoalOutcome | undefined;
  let failure: StageFailure | undefined;
  try {
    outcome = await runGoalPipeline(input, deps);
  } catch (error) {
    failure = error instanceof StageFailure ? error : undefined;
  }
  if (refused || harness) {
    return {
      line: {
        ...base,
        outcome: 'failed',
        harness: true,
        failedStage: failure?.stage ?? 'unknown',
        failedCode: refused ? 'refused' : failure?.code ?? 'internal_error',
        ...total(),
      },
      refused,
    };
  }
  if (!outcome) {
    const issues = issuesOf(failure);
    return {
      line: {
        ...base,
        outcome: 'failed',
        failedStage: failure?.stage ?? 'unknown',
        failedCode: failure?.code ?? 'internal_error',
        ...(issues ? { failedIssues: issues } : {}),
        decision,
        drafts: draftsFrom(events),
        ...total(),
      },
    };
  }
  const summary: Partial<ResultLine> = outcome.outcome === 'ready'
    ? { plan: planSummary(outcome.plan), planData: outcome.plan }
    : outcome.outcome === 'needs_answer'
      ? { question: outcome.question }
      : { abstainCategory: outcome.category, byGuard: outcome.byGuard };
  return { line: { ...base, outcome: outcome.outcome, decision, drafts: draftsFrom(events), ...summary, ...total() } };
}

function readExisting(path: string): ResultLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as ResultLine);
}

type Manifest = {
  runId: string;
  gitSha: string;
  casesSha256: string;
  cases: number;
  arms: Array<Pick<Arm, 'id' | 'label' | 'prices' | 'expect'>>;
  order: string;
  sessions: Array<{ startedAt: string; budgetMicroUsd: number }>;
};

/**
 * Cases run in id order and, within a case, arms in the given order. Before a
 * case starts, the remaining budget must cover every arm's worst case for it
 * (twice for a case with a scripted answer); otherwise the run stops there. A
 * harness failure stops the run at once, and so many failed runs in a row on
 * one arm stop it before the next case. Resuming needs the same commit, cases
 * and arms, and re-runs only what has no scored line.
 */
export async function runEvaluation(options: RunOptions): Promise<RunSummary> {
  const arms = options.arms.map(checkArm);
  for (const arm of arms) await preflight(arm, options);
  const resultsPath = join(options.outDir, 'results.jsonl');
  const manifestPath = join(options.outDir, 'manifest.json');
  const cases = [...options.cases].sort((a, b) => a.id.localeCompare(b.id));
  const setup = {
    runId: options.runId,
    gitSha: options.gitSha,
    casesSha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    cases: cases.length,
    arms: arms.map(({ id, label, prices, expect }) => ({ id, label, prices, expect })),
    order: 'cases by id; within a case, arms in listed order',
  };
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest : undefined;
  if (previous) {
    for (const field of ['gitSha', 'casesSha256', 'arms'] as const) {
      if (JSON.stringify(previous[field]) !== JSON.stringify(setup[field])) {
        throw new RunRefused(`run ${options.runId} cannot resume: its ${field} changed since it started`);
      }
    }
  }
  const manifest: Manifest = {
    ...setup,
    sessions: [...(previous?.sessions ?? []), { startedAt: new Date().toISOString(), budgetMicroUsd: options.budgetMicroUsd }],
  };
  const writeManifest = (extra: Record<string, unknown>) =>
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, ...extra }, null, 2)}\n`);

  const key = (caseId: string, armId: string, round: number) => `${caseId}|${armId}|${round}`;
  const existing = readExisting(resultsPath);
  // Harness lines are never scored, so their runs are still to do.
  const scored = new Map(existing.filter((line) => !line.harness).map((line) => [key(line.caseId, line.arm, line.round), line]));
  let spent = existing.reduce((sum, line) => sum + line.costMicroUsd, 0);
  let runs = 0;
  const failedInARow = new Map<string, number>();
  const record = (line: ResultLine) => {
    appendFileSync(resultsPath, `${JSON.stringify(line)}\n`);
    if (!line.harness) scored.set(key(line.caseId, line.arm, line.round), line);
    spent += line.costMicroUsd;
    runs += 1;
    options.log?.(`${line.caseId} ${line.arm} round ${line.round}: ${line.harness ? 'harness failure' : line.outcome} $${(line.costMicroUsd / 1e6).toFixed(4)}`);
  };
  const stop = (reason: NonNullable<RunSummary['stopReason']>, caseId: string): RunSummary => {
    writeManifest({ status: `stopped_by_${reason}`, stoppedBeforeCase: caseId, spentMicroUsd: spent });
    return { runs, spentMicroUsd: spent, completed: false, stoppedBeforeCase: caseId, stopReason: reason };
  };

  writeManifest({ status: 'running' });
  for (const item of cases) {
    if ([...failedInARow.values()].some((count) => count >= MAX_FAILED_IN_A_ROW)) return stop('failures', item.id);
    const firstOf = (arm: ReadyArm) => scored.get(key(item.id, arm.id, 1));
    const answerDue = (arm: ReadyArm) => {
      const first = firstOf(arm);
      return first?.outcome === 'needs_answer' && Boolean(item.answer && first.question) && !scored.has(key(item.id, arm.id, 2));
    };
    const pending = arms.filter((arm) => !firstOf(arm) || answerDue(arm));
    if (pending.length === 0) continue;
    const need = pending.reduce((sum, arm) => sum + (firstOf(arm) ? 1 : item.answer ? 2 : 1) * worstRunMicroUsd(arm.prices), 0);
    if (spent + need > options.budgetMicroUsd) return stop('budget', item.id);
    for (const arm of pending) {
      const rounds: Array<1 | 2> = firstOf(arm) ? [2] : [1, 2];
      let last: ResultLine | undefined;
      for (const round of rounds) {
        if (round === 2 && !answerDue(arm)) break;
        const clarification = round === 2 ? { question: firstOf(arm)!.question!, answer: item.answer! } : undefined;
        const { line, refused } = await runOne(arm, item, round, clarification, options);
        record(line);
        if (refused) {
          writeManifest({ status: 'refused', reason: refused.message, spentMicroUsd: spent });
          throw refused;
        }
        if (line.harness) return stop('harness', item.id);
        last = line;
      }
      if (last) failedInARow.set(arm.id, last.outcome === 'failed' ? (failedInARow.get(arm.id) ?? 0) + 1 : 0);
    }
  }
  writeManifest({ status: 'completed', spentMicroUsd: spent, finishedAt: new Date().toISOString() });
  return { runs, spentMicroUsd: spent, completed: true };
}
