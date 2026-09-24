// Evaluation cases: parsing, checks, provenance, coverage quotas and
// development contamination. Cases are drafted under evals/cases/SOURCING.md,
// audited, and decided and spot-checked by the owner; this code only checks them.

import { ABSTAIN_CATEGORIES, validateGoalRequest, type AbstainCategory, type GoalControls } from '../../lib/planner/goal-input.ts';
import { SpecError } from '../../lib/planner/spec.ts';
import { isLocalDate } from '../../lib/planner/time.ts';
import type { Domain } from '../../lib/planner/types.ts';
import { GOAL_SAMPLES } from '../../lib/samples/goal-samples.ts';

export type Decision = 'plan' | 'clarify' | 'abstain';
export const TAGS = ['relative_deadline', 'adversarial'] as const;
export type Tag = (typeof TAGS)[number];

export type EvalCase = {
  id: string;
  text: string;
  language: 'en' | 'es';
  today: string;
  controls?: GoalControls;
  answer?: string;
  expect: { decision: Decision; abstain_category?: AbstainCategory; domain?: Domain; deadline?: string };
  tags: Tag[];
  notes?: string;
};

export type CaseProblem = { line: number; id?: string; message: string };

const DOMAINS: readonly Domain[] = ['fitness', 'learning', 'creative', 'general'];
const DECISIONS: readonly Decision[] = ['plan', 'clarify', 'abstain'];
const KNOWN_FIELDS = new Set(['id', 'text', 'language', 'today', 'controls', 'answer', 'expect', 'tags', 'notes']);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Parses JSONL and checks every case; problems carry the line they came from. */
export function parseCases(source: string): { cases: EvalCase[]; problems: CaseProblem[] } {
  const cases: EvalCase[] = [];
  const problems: CaseProblem[] = [];
  const seen = new Set<string>();
  source.split('\n').forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    let value: Record<string, unknown> | null;
    try {
      value = record(JSON.parse(raw));
    } catch {
      problems.push({ line, message: 'not valid JSON' });
      return;
    }
    if (!value) {
      problems.push({ line, message: 'each line must be a JSON object' });
      return;
    }
    const id = typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/u.test(value.id) ? value.id : undefined;
    const fail = (message: string) => problems.push({ line, id, message });
    if (!id) return fail('id must be 1 to 40 letters, digits, - or _');
    if (seen.has(id)) return fail(`duplicate id ${id}`);
    seen.add(id);
    const unknown = Object.keys(value).filter((key) => !KNOWN_FIELDS.has(key));
    if (unknown.length > 0) return fail(`unknown fields: ${unknown.join(', ')}`);
    try {
      validateGoalRequest({ text: value.text, language: value.language, today: value.today, controls: value.controls });
    } catch (error) {
      return fail(error instanceof SpecError ? `${error.field}: ${error.message}` : 'invalid request fields');
    }
    if (value.answer !== undefined && (typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > 500)) {
      return fail('answer must be 1 to 500 characters');
    }
    const expect = record(value.expect);
    if (!expect || !DECISIONS.includes(expect.decision as Decision)) return fail('expect.decision must be plan, clarify or abstain');
    const decision = expect.decision as Decision;
    if ((decision === 'abstain') !== (expect.abstain_category !== undefined)) {
      return fail('expect.abstain_category is required exactly when the decision is abstain');
    }
    if (expect.abstain_category !== undefined && !ABSTAIN_CATEGORIES.includes(expect.abstain_category as AbstainCategory)) {
      return fail(`expect.abstain_category must be one of ${ABSTAIN_CATEGORIES.join(', ')}`);
    }
    if (decision === 'plan' && !DOMAINS.includes(expect.domain as Domain)) return fail('expect.domain is required for plan cases');
    if (expect.domain !== undefined && !DOMAINS.includes(expect.domain as Domain)) return fail('expect.domain is not a known domain');
    if (expect.deadline !== undefined && !isLocalDate(expect.deadline)) return fail('expect.deadline must be YYYY-MM-DD');
    const tags = value.tags === undefined ? [] : value.tags;
    if (!Array.isArray(tags) || tags.some((tag) => !TAGS.includes(tag as Tag))) return fail(`tags must be among ${TAGS.join(', ')}`);
    if (value.notes !== undefined && typeof value.notes !== 'string') return fail('notes must be text');
    cases.push({
      id,
      text: value.text as string,
      language: value.language as 'en' | 'es',
      today: value.today as string,
      ...(value.controls !== undefined ? { controls: value.controls as GoalControls } : {}),
      ...(value.answer !== undefined ? { answer: value.answer as string } : {}),
      expect: {
        decision,
        ...(expect.abstain_category !== undefined ? { abstain_category: expect.abstain_category as AbstainCategory } : {}),
        ...(expect.domain !== undefined ? { domain: expect.domain as Domain } : {}),
        ...(expect.deadline !== undefined ? { deadline: expect.deadline as string } : {}),
      },
      tags: tags as Tag[],
      ...(value.notes !== undefined ? { notes: value.notes as string } : {}),
    });
  });
  return { cases, problems };
}

export const ORIGINS = ['post', 'composite', 'constructed'] as const;
export type Origin = (typeof ORIGINS)[number];
export const SEGMENTS = ['busy_worker', 'shift_worker', 'parent', 'student', 'career_switcher', 'returning', 'event', 'hobbyist'] as const;
export type Segment = (typeof SEGMENTS)[number];
export const REVIEWS = ['accepted', 'relabeled', 'rewritten'] as const;
export type Review = (typeof REVIEWS)[number];

export type Provenance = {
  id: string;
  origin: Origin;
  platform?: string;
  community?: string;
  source_language?: 'en' | 'es';
  read?: 'full' | 'snippet';
  segment: Segment;
  collected: string;
  review: Review;
};

const PROVENANCE_FIELDS = new Set(['id', 'origin', 'platform', 'community', 'source_language', 'read', 'segment', 'collected', 'review']);
const SOURCE_FIELDS = ['platform', 'community', 'source_language', 'read'] as const;
const LINK_OR_USER = /:\/\/|www\.|(^|[\s/])u\/|@\w/iu;

/** Checks provenance.jsonl (SOURCING.md): one reviewed line per case, and no links or usernames. */
export function parseProvenance(source: string, cases: readonly EvalCase[]): { lines: Provenance[]; problems: CaseProblem[] } {
  const lines: Provenance[] = [];
  const problems: CaseProblem[] = [];
  const caseIds = new Set(cases.map((item) => item.id));
  const seen = new Set<string>();
  source.split('\n').forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    let value: Record<string, unknown> | null;
    try {
      value = record(JSON.parse(raw));
    } catch {
      problems.push({ line, message: 'not valid JSON' });
      return;
    }
    if (!value) {
      problems.push({ line, message: 'each line must be a JSON object' });
      return;
    }
    const id = typeof value.id === 'string' ? value.id.slice(0, 40) : undefined;
    const fail = (message: string) => problems.push({ line, id, message });
    if (!id || !caseIds.has(id)) return fail('id must be the id of a case');
    if (seen.has(id)) return fail(`duplicate id ${id}`);
    seen.add(id);
    const unknown = Object.keys(value).filter((key) => !PROVENANCE_FIELDS.has(key));
    if (unknown.length > 0) return fail(`unknown fields: ${unknown.join(', ')}`);
    if (Object.values(value).some((field) => typeof field === 'string' && LINK_OR_USER.test(field))) {
      return fail('provenance must not hold links or usernames; they go in sources.private.jsonl');
    }
    const origin = value.origin as Origin;
    if (!ORIGINS.includes(origin)) return fail(`origin must be one of ${ORIGINS.join(', ')}`);
    for (const [field, max] of [['platform', 40], ['community', 60]] as const) {
      const text = value[field];
      if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > max)) {
        return fail(`${field} must be 1 to ${max} characters`);
      }
    }
    if (value.source_language !== undefined && value.source_language !== 'en' && value.source_language !== 'es') {
      return fail('source_language must be en or es');
    }
    if (value.read !== undefined && value.read !== 'full' && value.read !== 'snippet') return fail('read must be full or snippet');
    if (origin === 'post' && (value.platform === undefined || value.source_language === undefined || value.read === undefined)) {
      return fail('a post needs platform, source_language and read');
    }
    if (origin === 'composite' && value.community !== undefined) return fail('a composite never names a community');
    if (origin === 'constructed' && SOURCE_FIELDS.some((field) => value[field] !== undefined)) {
      return fail('a constructed case has no source fields');
    }
    if (!SEGMENTS.includes(value.segment as Segment)) return fail(`segment must be one of ${SEGMENTS.join(', ')}`);
    if (!isLocalDate(value.collected)) return fail('collected must be YYYY-MM-DD');
    if (!REVIEWS.includes(value.review as Review)) {
      return fail(`review must be one of ${REVIEWS.join(', ')}: every case has a review outcome`);
    }
    lines.push(value as Provenance);
  });
  const missing = cases.filter((item) => !seen.has(item.id)).map((item) => item.id);
  if (missing.length > 0) problems.push({ line: 0, message: `no provenance line for ${missing.join(', ')}` });
  return { lines, problems };
}

/** How many cases came from where, and what the review did (reported with the results). */
export function provenanceCounts(lines: readonly Provenance[]): Array<{ name: string; count: number }> {
  const count = (test: (item: Provenance) => boolean) => lines.filter(test).length;
  return [
    ...ORIGINS.map((origin) => ({ name: `origin ${origin}`, count: count((item) => item.origin === origin) })),
    { name: 'posts read in full', count: count((item) => item.origin === 'post' && item.read === 'full') },
    { name: 'posts read from a search result', count: count((item) => item.origin === 'post' && item.read === 'snippet') },
    ...REVIEWS.map((review) => ({ name: `review ${review}`, count: count((item) => item.review === review) })),
  ];
}

export const SPOT_CHECK_SIZE = 20;

/** review.json beside the cases (SOURCING.md): drafts written and dropped, the shuffle seed, and the owner's random check. */
export type ReviewSummary = {
  drafted: number;
  dropped: number;
  seed: number;
  reviewed: string;
  spotCheck: { seed: number; ids: string[]; agreed: number };
};

const REVIEW_FIELDS = new Set(['drafted', 'dropped', 'seed', 'reviewed', 'spotCheck']);
const SPOT_CHECK_FIELDS = new Set(['seed', 'method', 'ids', 'agreed']);
const wholeAtLeast = (value: unknown, min: number) => typeof value === 'number' && Number.isInteger(value) && value >= min;

/** Checks review.json against the cases; every problem is listed. */
export function parseReviewSummary(raw: unknown, cases: readonly EvalCase[]): { summary?: ReviewSummary; problems: string[] } {
  const value = record(raw);
  if (!value) return { problems: ['review.json must be a JSON object'] };
  const problems: string[] = [];
  const unknown = Object.keys(value).filter((key) => !REVIEW_FIELDS.has(key));
  if (unknown.length > 0) problems.push(`unknown fields: ${unknown.join(', ')}`);
  if (!wholeAtLeast(value.drafted, 1) || !wholeAtLeast(value.dropped, 0)) problems.push('drafted and dropped must be whole numbers');
  else if ((value.drafted as number) - (value.dropped as number) !== cases.length) {
    problems.push(`drafted minus dropped is ${(value.drafted as number) - (value.dropped as number)}, but there are ${cases.length} cases`);
  }
  if (!wholeAtLeast(value.seed, 1)) problems.push('seed must be a positive whole number');
  if (!isLocalDate(value.reviewed)) problems.push('reviewed must be YYYY-MM-DD');
  const check = record(value.spotCheck);
  if (!check) {
    problems.push(`spotCheck is missing: the owner checks a random ${SPOT_CHECK_SIZE} cases`);
  } else {
    const extra = Object.keys(check).filter((key) => !SPOT_CHECK_FIELDS.has(key));
    if (extra.length > 0) problems.push(`unknown spotCheck fields: ${extra.join(', ')}`);
    const caseIds = new Set(cases.map((item) => item.id));
    const ids = Array.isArray(check.ids) ? check.ids : [];
    if (!wholeAtLeast(check.seed, 1)) problems.push('spotCheck.seed must be a positive whole number');
    if (ids.length !== SPOT_CHECK_SIZE || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !caseIds.has(id))) {
      problems.push(`spotCheck.ids must be ${SPOT_CHECK_SIZE} distinct case ids`);
    }
    if (!wholeAtLeast(check.agreed, 0) || (check.agreed as number) > SPOT_CHECK_SIZE) {
      problems.push(`spotCheck.agreed must be 0 to ${SPOT_CHECK_SIZE}: the labels the owner agreed with`);
    }
  }
  if (problems.length > 0) return { problems };
  const spot = check as { seed: number; ids: string[]; agreed: number };
  return {
    summary: {
      drafted: value.drafted as number,
      dropped: value.dropped as number,
      seed: value.seed as number,
      reviewed: value.reviewed as string,
      spotCheck: { seed: spot.seed, ids: spot.ids, agreed: spot.agreed },
    },
    problems,
  };
}

export type Quota = { name: string; minimum: number; count: number };

/** Coverage quotas from section 4 of the pre-registration. */
export function coverage(cases: EvalCase[]): Quota[] {
  const count = (test: (item: EvalCase) => boolean) => cases.filter(test).length;
  const abstainCategories = new Set(cases.flatMap((item) => (item.expect.abstain_category ? [item.expect.abstain_category] : [])));
  return [
    { name: 'cases', minimum: 100, count: cases.length },
    { name: 'Spanish cases', minimum: 35, count: count((item) => item.language === 'es') },
    { name: 'expected clarifying question', minimum: 15, count: count((item) => item.expect.decision === 'clarify') },
    { name: 'expected abstention', minimum: 15, count: count((item) => item.expect.decision === 'abstain') },
    { name: 'abstention categories', minimum: 4, count: abstainCategories.size },
    { name: 'fitness goals', minimum: 20, count: count((item) => item.expect.domain === 'fitness') },
    { name: 'cases with settings', minimum: 10, count: count((item) => item.controls !== undefined && Object.keys(item.controls).length > 0) },
    { name: 'relative deadlines', minimum: 10, count: count((item) => item.tags.includes('relative_deadline')) },
    { name: 'adversarial texts', minimum: 5, count: count((item) => item.tags.includes('adversarial')) },
  ];
}

/** Texts used while tuning prompts and rules (pre-registration, section 4). */
export const DEVELOPMENT_TEXTS: readonly string[] = [
  ...GOAL_SAMPLES.map((sample) => String(sample.text)),
  'I want to run a 10K by December, weekday mornings only, 3 hours a week max',
  'Quiero aprender a tocar guitarra para fin de año, martes y jueves en la noche, máximo 2 horas por semana',
  '<'.repeat(2_000),
];

function words(text: string): Set<string> {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return new Set(plain.split(/[^a-z0-9<]+/u).filter((word) => word.length >= 3 || word.startsWith('<')));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export const CONTAMINATION_THRESHOLD = 0.5;

/** Cases whose words overlap a development text by half or more. */
export function contamination(cases: EvalCase[]): Array<{ id: string; similarity: number; text: string }> {
  const development = DEVELOPMENT_TEXTS.map((text) => ({ text, words: words(text) }));
  return cases.flatMap((item) => {
    const own = words(item.text);
    const best = development
      .map((entry) => ({ text: entry.text, similarity: jaccard(own, entry.words) }))
      .sort((a, b) => b.similarity - a.similarity)[0];
    return best && best.similarity >= CONTAMINATION_THRESHOLD
      ? [{ id: item.id, similarity: Math.round(best.similarity * 100) / 100, text: best.text.slice(0, 80) }]
      : [];
  });
}
