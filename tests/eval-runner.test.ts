import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worstRunMicroUsd, type Prices } from '../evals/lib/budget.ts';
import { parseCases, type EvalCase } from '../evals/lib/cases.ts';
import { RunRefused, runEvaluation, type Arm, type ResultLine, type RunOptions } from '../evals/lib/runner.ts';

const PRICES: Prices = { inputPerMillion: 0.3, outputPerMillion: 1.2, source: 'test', read: '2026-09-24' };
const VERSIONS = { readGoal: 'read-goal-aaaaaaaaaaaa', draft: 'draft-bbbbbbbbbbbb' };
const REQUEST_ID = '8b0c3f5e-2a4d-4c1b-9e7f-1a2b3c4d5e6f';
const BUDGET = 10_000_000;

function arm(id: string, host: string, overrides: Partial<Arm> = {}): Arm {
  return { id, label: id, serviceUrl: `https://${host}`, prices: PRICES, expect: { ...VERSIONS, model: 'model-x' }, ...overrides };
}

const ARMS = [arm('A', 'a.test'), arm('B', 'b.test')];

const CASES = parseCases([
  { id: 'c1', text: 'Learn TypeScript on Monday and Wednesday evenings', language: 'en', today: '2026-10-05', expect: { decision: 'plan', domain: 'learning' } },
  { id: 'c2', text: 'A vague goal', language: 'en', today: '2026-10-05', answer: 'Learn TypeScript', expect: { decision: 'clarify' } },
  { id: 'c3', text: 'A risky timeline', language: 'es', today: '2026-10-05', expect: { decision: 'abstain', abstain_category: 'extreme_timeline' } },
].map((item) => JSON.stringify(item)).join('\n')).cases;

function reading(decision: 'plan' | 'clarify' | 'abstain') {
  return {
    decision,
    title: 'Learn TypeScript',
    summary: 'Learn TypeScript in the evenings.',
    domain: 'learning',
    level: 'unknown',
    deadline: null,
    deadline_basis: 'none',
    days: [0, 2],
    window: 'evening',
    weekly_minutes: 60,
    session_minutes: 30,
    question: decision === 'clarify' ? 'What do you want to get better at?' : null,
    abstain: decision === 'abstain' ? { category: 'extreme_timeline', reason: 'Too fast to be safe.' } : null,
  };
}

type Call = { url: string; body: Record<string, unknown> };

/**
 * A fake service: a health check, the token check, decisions from the goal
 * text, and drafts that fit the calendar sent. A hook can answer a model call
 * first, or throw to act as an unreachable service.
 */
function fakeService(options: { draftVersion?: string; hook?: (call: Call) => Response | undefined } = {}): { fetcher: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (target, init) => {
    const url = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
    if (url.endsWith('/healthz')) return Response.json({ status: 'ok' });
    if (new Headers(init?.headers).get('authorization') !== 'Bearer token') return Response.json({ error: 'Not authorized.' }, { status: 401 });
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;
    if (body.text === undefined && body.calendar === undefined) return Response.json({ error: 'Invalid request.' }, { status: 400 });
    const hooked = options.hook?.({ url, body });
    if (hooked) return hooked;
    calls.push(url);
    const meta = (version: string) => ({ attempts: 1, model: 'model-x', prompt_version: version, usage: { prompt_tokens: 500, completion_tokens: 200 } });
    if (url.endsWith('/v1/read-goal')) {
      const text = String(body.text);
      const answered = typeof body.clarification === 'object';
      const decision = text.includes('vague') && !answered ? 'clarify' : text.includes('risky') ? 'abstain' : 'plan';
      return Response.json({ reading: reading(decision), scope_refused: false, meta: meta(VERSIONS.readGoal) });
    }
    const weeks = (body.calendar as { weeks: Array<{ week: number; room: number; maxMinutes: number }> }).weeks;
    return Response.json({
      draft: {
        phases: [{ title: 'Practice', fromWeek: 1, toWeek: weeks.length, focus: 'A little each week.' }],
        sessionTypes: [{ id: 'practice', title: 'Practice', minutes: 30, intensity: 'moderate', role: 'key', blocks: [{ minutes: 30, activity: 'Write code.' }], deliverable: 'Code.', doneWhen: 'It runs.' }],
        weeks: weeks.map((week) => ({ week: week.week, sessions: Array.from({ length: Math.min(week.room, Math.floor(week.maxMinutes / 30)) }, () => 'practice') })),
        templateId: null,
      },
      meta: meta(options.draftVersion ?? VERSIONS.draft),
    });
  };
  return { fetcher, calls };
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'eval-run-'));
}

function lines(dir: string): ResultLine[] {
  return readFileSync(join(dir, 'results.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as ResultLine);
}

function manifestOf(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
}

function options(dir: string, fetcher: typeof fetch, arms: Arm[], budgetMicroUsd: number, extra: Partial<RunOptions> = {}): RunOptions {
  return { runId: 'test', outDir: dir, cases: CASES, arms, token: 'token', budgetMicroUsd, gitSha: 'abc', fetcher, ...extra };
}

void test('every case runs on every arm, with a scripted answer after a question', async () => {
  const dir = tmp();
  const { fetcher } = fakeService();
  const summary = await runEvaluation(options(dir, fetcher, ARMS, BUDGET));
  assert.equal(summary.completed, true);
  const results = lines(dir);
  assert.deepEqual(results.map((line) => `${line.caseId}/${line.arm}/${line.round}:${line.outcome}`), [
    'c1/A/1:ready', 'c1/B/1:ready',
    'c2/A/1:needs_answer', 'c2/A/2:ready', 'c2/B/1:needs_answer', 'c2/B/2:ready',
    'c3/A/1:cannot_plan', 'c3/B/1:cannot_plan',
  ]);
  const ready = results[0];
  assert.equal(ready.decision, 'plan');
  assert.deepEqual(ready.drafts, { first: 'valid', retry: 'none' });
  assert.equal(ready.plan?.violations, 0);
  assert.ok(ready.planData);
  // Each call costs 500 in and 200 out: 150 + 240 micro-USD.
  assert.equal(ready.costMicroUsd, 2 * 390);
  assert.equal(results[6].abstainCategory, 'extreme_timeline');
  assert.equal(summary.spentMicroUsd, results.reduce((total, line) => total + line.costMicroUsd, 0));
  const manifest = manifestOf(dir);
  assert.equal(manifest.status, 'completed');
  assert.equal(manifest.gitSha, 'abc');
  assert.match(String(manifest.casesSha256), /^[0-9a-f]{64}$/u);
});

void test('every service is checked before the first case, at no cost', async () => {
  const down: typeof fetch = () => Promise.reject(new TypeError('fetch failed'));
  await assert.rejects(runEvaluation(options(tmp(), down, ARMS, BUDGET)), /arm A: no service answers/u);
  const { fetcher, calls } = fakeService();
  await assert.rejects(runEvaluation(options(tmp(), fetcher, ARMS, BUDGET, { token: 'wrong' })), /arm A: the service refused the token/u);
  await assert.rejects(runEvaluation(options(tmp(), fetcher, [arm('A', 'a.test', { serviceUrl: 'http://example.com' })], BUDGET)), /unusable service URL/u);
  await assert.rejects(runEvaluation(options(tmp(), fetcher, [arm('B', 'b.test', { prices: null })], BUDGET)), /no complete rate card/u);
  assert.equal(calls.length, 0);
});

void test('a case starts only if the budget covers every arm’s worst case for it', async () => {
  const dir = tmp();
  const { fetcher, calls } = fakeService();
  const worst = worstRunMicroUsd(PRICES);
  const summary = await runEvaluation(options(dir, fetcher, ARMS, 2 * worst - 1));
  assert.deepEqual([summary.completed, summary.stopReason, summary.stoppedBeforeCase], [false, 'budget', 'c1']);
  assert.equal(calls.length, 0);
});

void test('a stopped run resumes where it stopped and never repeats a case', async () => {
  const dir = tmp();
  const { fetcher } = fakeService();
  const worst = worstRunMicroUsd(PRICES);
  // Room for case c1 on both arms, not for c2, which may need two rounds.
  const first = await runEvaluation(options(dir, fetcher, ARMS, 2 * worst + 1_000));
  assert.equal(first.stoppedBeforeCase, 'c2');
  assert.equal(lines(dir).length, 2);
  const second = await runEvaluation(options(dir, fetcher, ARMS, BUDGET));
  assert.equal(second.completed, true);
  assert.equal(lines(dir).length, 8);
  assert.equal(new Set(lines(dir).map((line) => `${line.caseId}/${line.arm}/${line.round}`)).size, 8);
  assert.equal((manifestOf(dir).sessions as unknown[]).length, 2);
});

void test('a run resumes only with the same commit, cases and arms', async () => {
  const dir = tmp();
  const { fetcher } = fakeService();
  await runEvaluation(options(dir, fetcher, ARMS, BUDGET));
  await assert.rejects(runEvaluation(options(dir, fetcher, ARMS, BUDGET, { gitSha: 'def' })), /gitSha changed/u);
  await assert.rejects(runEvaluation(options(dir, fetcher, ARMS, BUDGET, { cases: CASES.slice(1) })), /casesSha256 changed/u);
  await assert.rejects(runEvaluation(options(dir, fetcher, [arm('A', 'a.test', { expect: { ...VERSIONS, model: 'model-y' } }), ARMS[1]], BUDGET)), /arms changed/u);
});

void test('a harness failure is kept with its cost, stops the run, and is re-run on resume', async () => {
  const dir = tmp();
  let down = true;
  const { fetcher } = fakeService({
    hook: ({ url, body }) => {
      // Arm A's service goes away while c2 waits for its scripted answer.
      if (down && url.startsWith('https://a.test/') && typeof body.clarification === 'object') throw new TypeError('fetch failed');
      return undefined;
    },
  });
  const first = await runEvaluation(options(dir, fetcher, ARMS, BUDGET));
  assert.deepEqual([first.stopReason, first.stoppedBeforeCase], ['harness', 'c2']);
  const stopped = lines(dir).at(-1)!;
  assert.deepEqual(
    [stopped.caseId, stopped.arm, stopped.round, stopped.harness, stopped.failedCode],
    ['c2', 'A', 2, true, 'upstream_fetch_failed'],
  );
  assert.ok(stopped.costMicroUsd > 0, 'a call that may have reached the provider is charged');
  assert.equal(manifestOf(dir).status, 'stopped_by_harness');
  down = false;
  const second = await runEvaluation(options(dir, fetcher, ARMS, BUDGET));
  assert.equal(second.completed, true);
  const c2a = lines(dir).filter((line) => line.caseId === 'c2' && line.arm === 'A');
  assert.deepEqual(c2a.map((line) => `${line.round}:${line.harness ? 'harness' : line.outcome}`), ['1:needs_answer', '2:harness', '2:ready']);
});

void test('a refusal before any provider call is the harness; provider failures are scored, and three in a row stop the run', async () => {
  const unconfigured = fakeService({
    hook: ({ url }) => url.endsWith('/v1/read-goal') ? Response.json({ error: 'Not configured.', request_id: REQUEST_ID }, { status: 503 }) : undefined,
  });
  const refused = await runEvaluation(options(tmp(), unconfigured.fetcher, ARMS, BUDGET));
  assert.equal(refused.stopReason, 'harness');

  const four: EvalCase[] = ['d1', 'd2', 'd3', 'd4'].map((id) => ({ ...CASES[0], id }));
  const dir = tmp();
  const failing = fakeService({
    hook: ({ url }) => url.startsWith('https://b.test/') && url.endsWith('/v1/read-goal')
      ? Response.json({ error: 'The provider failed.', request_id: REQUEST_ID, attempts: 1, usage: { prompt_tokens: 500, completion_tokens: 0 } }, { status: 502 })
      : undefined,
  });
  const summary = await runEvaluation(options(dir, failing.fetcher, ARMS, BUDGET, { cases: four }));
  assert.deepEqual([summary.stopReason, summary.stoppedBeforeCase], ['failures', 'd4']);
  const failed = lines(dir).filter((line) => line.arm === 'B');
  assert.equal(failed.length, 3);
  for (const line of failed) {
    assert.deepEqual([line.outcome, line.harness, line.failedStage, line.failedCode], ['failed', undefined, 'read_goal', 'backend_rejected']);
    // 500 prompt tokens at $0.30 per million.
    assert.equal(line.costMicroUsd, 150);
  }
});

void test('an arm whose service serves another prompt is refused, and the refused run keeps its cost', async () => {
  const dir = tmp();
  const { fetcher } = fakeService({ draftVersion: 'draft-cccccccccccc' });
  await assert.rejects(runEvaluation(options(dir, fetcher, [ARMS[0]], BUDGET)), RunRefused);
  const [line] = lines(dir);
  assert.deepEqual([line.harness, line.failedStage, line.failedCode], [true, 'draft', 'refused']);
  assert.equal(line.costMicroUsd, 2 * 390);
  assert.equal(manifestOf(dir).status, 'refused');
});
