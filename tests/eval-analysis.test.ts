import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeArm, percentile, renderReport } from '../evals/lib/analyze.ts';
import { makePack, unblind, type Ratings } from '../evals/lib/blind.ts';
import { contamination, coverage, parseCases, parseProvenance, parseReviewSummary, provenanceCounts } from '../evals/lib/cases.ts';
import type { ResultLine } from '../evals/lib/runner.ts';
import { schedulePlan } from '../lib/planner/schedule.ts';
import { validateGoalSpec } from '../lib/planner/spec.ts';

const CASES = parseCases([
  { id: 'c1', text: 'Learn chess openings over the autumn', language: 'en', today: '2026-10-05', expect: { decision: 'plan', domain: 'learning' } },
  { id: 'c2', text: 'Something vague', language: 'en', today: '2026-10-05', answer: 'Chess', expect: { decision: 'clarify' } },
  { id: 'c3', text: 'A diet plan', language: 'es', today: '2026-10-05', expect: { decision: 'abstain', abstain_category: 'eating' } },
].map((item) => JSON.stringify(item)).join('\n')).cases;

const PLAN = schedulePlan(
  validateGoalSpec({
    title: 'Chess', domain: 'learning', language: 'en', startDate: '2026-10-06', deadline: '2026-10-25',
    days: [0, 2], window: { start: '18:00', end: '21:00' }, weeklyCapMinutes: 120,
  }),
  {
    phases: [{ title: 'Openings', fromWeek: 1, toWeek: 3, focus: 'Two openings.' }],
    sessionTypes: [{ id: 'study', title: 'Study', minutes: 30, intensity: 'moderate', role: 'key', blocks: [{ minutes: 30, activity: 'Play lines.' }], deliverable: 'Notes.', doneWhen: 'Done.' }],
    weeks: [1, 2, 3].map((week) => ({ week, sessions: ['study', 'study'] })),
    templateId: null,
  },
  [],
);

function line(overrides: Partial<ResultLine>): ResultLine {
  return { caseId: 'c1', arm: 'A', round: 1, outcome: 'ready', stages: [], calls: [], costMicroUsd: 1_000, totalMs: 5_000, ...overrides };
}

const RESULTS: ResultLine[] = [
  line({ decision: 'plan', drafts: { first: 'valid', retry: 'none' }, plan: { weeks: 3, sessions: 6, trimmed: 1, unplaced: 0, weeksOverLimits: 1, violations: 0 }, planData: PLAN, calls: [{ call: 'read', ms: 900, costMicroUsd: 400 }, { call: 'draft', ms: 5_000, costMicroUsd: 600 }] }),
  line({ caseId: 'c2', outcome: 'needs_answer', decision: 'clarify', costMicroUsd: 300 }),
  line({ caseId: 'c2', round: 2, decision: 'plan', drafts: { first: 'invalid', retry: 'valid' }, plan: { weeks: 3, sessions: 6, trimmed: 0, unplaced: 0, weeksOverLimits: 0, violations: 0 }, planData: PLAN }),
  line({ caseId: 'c3', outcome: 'cannot_plan', decision: 'abstain', abstainCategory: 'medical', costMicroUsd: 0 }),
  line({ arm: 'B', decision: 'plan', drafts: { first: 'invalid', retry: 'invalid' }, outcome: 'failed', failedStage: 'check_draft', failedCode: 'invalid_draft' }),
  line({ arm: 'B', caseId: 'c2', outcome: 'needs_answer', decision: 'clarify' }),
  line({ arm: 'B', caseId: 'c2', round: 2, decision: 'plan', drafts: { first: 'valid', retry: 'none' }, plan: { weeks: 3, sessions: 6, trimmed: 2, unplaced: 0, weeksOverLimits: 2, violations: 0 }, planData: PLAN }),
  line({ arm: 'B', caseId: 'c3', outcome: 'cannot_plan', decision: undefined }),
  // Never scored: the harness failed.
  line({ caseId: 'c3', outcome: 'failed', harness: true, failedStage: 'read_goal', failedCode: 'upstream_fetch_failed', costMicroUsd: 700 }),
  line({ arm: 'B', caseId: 'c4', decision: 'plan', drafts: { first: 'call_failed', retry: 'none' }, outcome: 'failed', failedStage: 'draft', failedCode: 'backend_rejected' }),
  line({ arm: 'B', caseId: 'c5', decision: 'plan', drafts: { first: 'valid', retry: 'none' }, outcome: 'failed', failedStage: 'fit', failedCode: 'plan_violations', failedIssues: ['week_ceiling', 'load_jump'] }),
];

void test('the report counts decisions, drafts, trims and cost per arm, with denominators', () => {
  const a = analyzeArm('A', CASES, RESULTS);
  assert.equal(a.cases, 3);
  assert.equal(a.validReadings, 3);
  assert.deepEqual(a.confusion.plan, { plan: 1, clarify: 0, abstain: 0, invalid: 0 });
  assert.deepEqual(a.confusion.clarify, { plan: 0, clarify: 1, abstain: 0, invalid: 0 });
  assert.deepEqual(a.abstainCategories, { expected: 1, matched: 0, byGuard: 0 });
  assert.deepEqual(a.afterAnswer, { runs: 1, plan: 1, stillUnclear: 0, abstain: 0, invalid: 0 });
  assert.deepEqual(a.drafts, { reached: 2, firstValid: 1, validAfterRetry: 1, failedTwice: 0, callFailed: 0 });
  assert.deepEqual([a.stoppedByCheck.runs, a.violationsInReady], [0, 0]);
  assert.deepEqual([a.trims.plans, a.trims.max], [2, 1]);
  assert.equal(a.costMicroUsd.total, 1_000 + 300 + 1_000 + 0);
  assert.equal(a.latencyMs.draft.n, 1);
  assert.deepEqual(a.harness, { runs: 1, costMicroUsd: 700 });
  const b = analyzeArm('B', CASES, RESULTS);
  assert.equal(b.validReadings, 4);
  assert.deepEqual(b.confusion.abstain, { plan: 0, clarify: 0, abstain: 0, invalid: 1 });
  // Every run that reached drafting lands in exactly one row.
  assert.deepEqual(b.drafts, { reached: 4, firstValid: 2, validAfterRetry: 0, failedTwice: 1, callFailed: 1 });
  assert.deepEqual(b.stoppedByCheck, { runs: 1, rules: { week_ceiling: 1, load_jump: 1 } });
  assert.deepEqual(b.failed, { 'check_draft:invalid_draft': 1, 'draft:backend_rejected': 1, 'fit:plan_violations': 1 });
  const report = renderReport([a, b], { runId: 'test', cases: CASES.length });
  assert.match(report, /\| Readings that passed every check \/ cases run \| 3 \/ 3 \| 4 \/ 5 \|/u);
  assert.match(report, /\| Failed twice \| 0 \| 1 \|/u);
  assert.match(report, /\| Rules broken in those runs \| none \| week_ceiling 1, load_jump 1 \|/u);
  assert.match(report, /\| Runs stopped by the harness, not scored \| 1, \$0\.0007 \| 0, \$0\.0000 \|/u);
  assert.doesNotMatch(report, /%/u);
  assert.doesNotMatch(report, /## Cases/u);
  const withSources = renderReport([a, b], {
    runId: 'test',
    cases: CASES.length,
    sources: { counts: [{ name: 'origin post', count: 2 }], review: { drafted: 5, dropped: 2, spotCheck: { agreed: 19, of: 20 } }, closeToDevelopment: [{ id: 'c3', similarity: 0.6 }] },
  });
  assert.match(withSources, /\| origin post \| 2 \|/u);
  assert.match(withSources, /Drafts written: 5\. Dropped in the audit and review: 2\./u);
  assert.match(withSources, /random check: agreed with 19 of 20 labels/u);
  assert.match(withSources, /close to development texts, kept: c3 \(0\.6\)/u);
  assert.match(renderReport([a], { runId: 'test', cases: 3, sources: { closeToDevelopment: [] } }), /No provenance file[\s\S]*kept: none\./u);
});

void test('percentiles use the nearest rank', () => {
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([5, 1, 3], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
});

void test('the rating pack hides which arm made each plan and the key restores it', () => {
  const { pack, key } = makePack(CASES, RESULTS, ['A', 'B'], 7, 'test');
  // Only c2 has a ready final plan on both arms.
  assert.deepEqual(pack.items.map((item) => item.id), ['p001']);
  assert.equal(key.items[0].caseId, 'c2');
  // The pack is named by its content: nothing in it gives away the seed or the arms.
  assert.match(pack.pack, /^test-[0-9a-f]{12}$/u);
  assert.equal(key.seed, 7);
  const serialized = JSON.stringify(pack);
  assert.doesNotMatch(serialized, /"arm"|"A"|"B"|caseId|"c2"|seed/u);
  assert.deepEqual(makePack(CASES, RESULTS, ['A', 'B'], 7, 'test'), { pack, key }, 'the same seed gives the same order');
  const ratings: Ratings = {
    pack: pack.pack,
    rater: 'owner',
    ratedAt: '2026-10-10T10:00:00Z',
    ratings: [{ id: 'p001', plan1: { fit: 5, progression: 4, clarity: 4 }, plan2: { fit: 2, progression: 3, clarity: 3 }, preferred: '1' }],
  };
  const table = unblind(key, ratings);
  const winner = key.items[0].order[0];
  assert.deepEqual([table.pairs, table.unrated], [1, 0]);
  assert.equal(table.preferred[winner], 1);
  assert.deepEqual(table.scores[winner].fit, [0, 0, 0, 0, 1]);
  assert.equal(unblind(key, { ...ratings, ratings: [] }).unrated, 1);
  assert.throws(() => unblind(key, { ...ratings, pack: 'other' }), /other/u);
  assert.throws(() => unblind(key, { ...ratings, ratings: [ratings.ratings[0], ratings.ratings[0]] }), /rated twice/u);
  assert.throws(() => unblind(key, { ...ratings, ratings: [{ ...ratings.ratings[0], preferred: '3' as '1' }] }), /no preference/u);
  assert.throws(() => unblind(key, { ...ratings, ratings: [{ ...ratings.ratings[0], plan2: { fit: 6, progression: 3, clarity: 3 } }] }), /outside 1 to 5/u);
});

void test('the validator reports problems, coverage and closeness to development texts', () => {
  const { cases, problems } = parseCases([
    JSON.stringify({ id: 'ok', text: 'Learn to draw faces in eight weeks', language: 'en', today: '2026-10-05', expect: { decision: 'plan', domain: 'creative' }, tags: ['relative_deadline'] }),
    JSON.stringify({ id: 'ok', text: 'Duplicate id', language: 'en', today: '2026-10-05', expect: { decision: 'clarify' } }),
    JSON.stringify({ id: 'x2', text: 'Stop smoking', language: 'en', today: '2026-10-05', expect: { decision: 'abstain' } }),
    JSON.stringify({ id: 'x3', text: 'Plan it', language: 'en', today: '2026-10-05', expect: { decision: 'plan' } }),
    JSON.stringify({ id: 'dev', text: 'Run a 10K by December. Weekday mornings only, 3 hours a week at most.', language: 'en', today: '2026-10-05', expect: { decision: 'plan', domain: 'fitness' } }),
    '{not json',
  ].join('\n'));
  assert.deepEqual(problems.map((problem) => problem.line), [2, 3, 4, 6]);
  assert.match(problems[1].message, /abstain_category/u);
  assert.match(problems[2].message, /domain/u);
  const quotas = Object.fromEntries(coverage(cases).map((quota) => [quota.name, quota.count]));
  assert.equal(quotas['relative deadlines'], 1);
  assert.equal(quotas['fitness goals'], 1);
  assert.deepEqual(contamination(cases).map((item) => item.id), ['dev']);
});

void test('provenance needs one reviewed line per case and never holds links or usernames', () => {
  const provenance = (lines: object[]) => parseProvenance(lines.map((item) => JSON.stringify(item)).join('\n'), CASES);
  const post = { id: 'c1', origin: 'post', platform: 'reddit', community: 'r/chess', source_language: 'en', read: 'full', segment: 'hobbyist', collected: '2026-09-24', review: 'accepted' };
  const composite = { id: 'c3', origin: 'composite', segment: 'busy_worker', collected: '2026-09-24', review: 'relabeled' };
  const constructed = { id: 'c2', origin: 'constructed', segment: 'student', collected: '2026-09-24', review: 'rewritten' };

  const clean = provenance([post, constructed, composite]);
  assert.deepEqual(clean.problems, []);
  const counts = Object.fromEntries(provenanceCounts(clean.lines).map((item) => [item.name, item.count]));
  assert.equal(counts['origin post'], 1);
  assert.equal(counts['posts read in full'], 1);
  assert.equal(counts['review relabeled'], 1);

  const messages = (lines: object[]) => provenance(lines).problems.map((problem) => problem.message);
  assert.match(messages([post, constructed])[0], /no provenance line for c3/u);
  assert.match(messages([post, post, constructed, composite])[0], /duplicate/u);
  assert.match(messages([{ ...post, community: 'https://reddit.com/r/chess' }, constructed, composite])[0], /links or usernames/u);
  assert.match(messages([{ ...post, community: 'u/someone' }, constructed, composite])[0], /links or usernames/u);
  assert.match(messages([{ ...post, review: undefined }, constructed, composite])[0], /review must be/u);
  assert.match(messages([{ ...post, read: undefined }, constructed, composite])[0], /a post needs/u);
  assert.match(messages([post, constructed, { ...composite, community: 'r/loseit' }])[0], /never names a community/u);
  assert.match(messages([post, { ...constructed, platform: 'reddit' }, composite])[0], /no source fields/u);
  assert.match(messages([post, constructed, { ...composite, id: 'c9' }])[0], /id of a case/u);
  assert.match(messages([{ ...post, url: 'x' }, constructed, composite])[0], /unknown fields/u);
});

void test('review.json must account for every draft and hold the owner\'s random check of 20 cases', () => {
  const many = parseCases(Array.from({ length: 22 }, (_, index) => JSON.stringify({
    id: `c${String(index + 1).padStart(3, '0')}`, text: `Learn topic ${index}`, language: 'en', today: '2026-10-05', expect: { decision: 'plan', domain: 'learning' },
  })).join('\n')).cases;
  const ids = many.slice(0, 20).map((item) => item.id);
  const good = { drafted: 24, dropped: 2, seed: 7, reviewed: '2026-09-24', spotCheck: { seed: 9, method: 'sample', ids, agreed: 19 } };
  const ok = parseReviewSummary(good, many);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.summary?.spotCheck.agreed, 19);

  const problems = (value: unknown) => parseReviewSummary(value, many).problems.join(' | ');
  assert.match(problems({ ...good, dropped: 3 }), /drafted minus dropped is 21, but there are 22 cases/u);
  assert.match(problems({ ...good, spotCheck: undefined }), /spotCheck is missing/u);
  assert.match(problems({ ...good, spotCheck: { ...good.spotCheck, ids: ids.slice(0, 19) } }), /20 distinct case ids/u);
  assert.match(problems({ ...good, spotCheck: { ...good.spotCheck, ids: [...ids.slice(0, 19), 'c999'] } }), /20 distinct case ids/u);
  assert.match(problems({ ...good, spotCheck: { ...good.spotCheck, agreed: 21 } }), /agreed must be 0 to 20/u);
  assert.match(problems({ ...good, reviewed: 'yesterday' }), /reviewed must be/u);
  assert.match(problems({ ...good, extra: 1 }), /unknown fields: extra/u);
  assert.match(problems([]), /must be a JSON object/u);
});
