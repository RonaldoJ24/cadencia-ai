import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ABSTAIN_CATEGORIES,
  buildGoalSpec,
  providedSettings,
  validateGoalRequest,
  validateReading,
  WINDOW_PRESETS,
  type GoalReading,
} from '../lib/planner/goal-input.ts';
import { SpecError } from '../lib/planner/spec.ts';
import { GOAL_BOUNDS } from '../lib/server/spend.ts';

const TODAY = '2026-09-24';

const reading = {
  decision: 'plan',
  title: 'Run a 10K',
  summary: 'Run 10 km by December on weekday mornings, up to 3 hours a week.',
  domain: 'fitness',
  level: 'unknown',
  deadline: '2026-12-01',
  deadline_basis: 'inferred',
  days: [0, 1, 2, 3, 4],
  window: 'morning',
  weekly_minutes: 180,
  session_minutes: null,
  question: null,
  abstain: null,
};

function request(extra: Record<string, unknown> = {}) {
  return validateGoalRequest({ text: 'I want to run a 10K by December', language: 'en', today: TODAY, ...extra }, TODAY);
}

function fieldOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof SpecError) return error.field;
    throw error;
  }
  return 'no error';
}

void test('a goal request keeps only plain text and the settings the person touched', () => {
  const value = validateGoalRequest({
    text: '  Learn chess\nopenings\tfast  ',
    language: 'es',
    today: TODAY,
    controls: { days: [4, 0], weeklyMinutes: 120 },
  }, TODAY);
  assert.equal(value.text, 'Learn chess openings fast');
  assert.deepEqual(value.controls, { days: [0, 4], weeklyMinutes: 120 });
  assert.deepEqual(value.busy, []);
  assert.equal(value.clarification, null);
  assert.deepEqual(providedSettings(value.controls), ['days', 'weekly_minutes']);
  assert.deepEqual(providedSettings({ level: 'beginner', deadline: '2026-10-01' }), ['deadline']);
});

void test('goal requests are refused field by field', () => {
  assert.equal(fieldOf(() => request({ text: 'x'.repeat(2_001) })), 'text');
  assert.equal(fieldOf(() => request({ text: 'chess\u0000' })), 'text');
  assert.equal(fieldOf(() => request({ text: ' \n ' })), 'text');
  assert.equal(fieldOf(() => request({ language: 'fr' })), 'language');
  // The browser's date may be a day off the server's, never more.
  assert.doesNotThrow(() => validateGoalRequest({ text: 'chess', language: 'en', today: '2026-09-25' }, TODAY));
  assert.equal(fieldOf(() => validateGoalRequest({ text: 'chess', language: 'en', today: '2026-09-27' }, TODAY)), 'today');
  assert.equal(fieldOf(() => request({ controls: { color: 'blue' } })), 'controls');
  assert.equal(fieldOf(() => request({ controls: { deadline: TODAY } })), 'deadline');
  assert.equal(fieldOf(() => request({ controls: { deadline: '2027-03-26' } })), 'deadline');
  assert.doesNotThrow(() => request({ controls: { deadline: '2027-03-25' } }));
  assert.equal(fieldOf(() => request({ controls: { days: [1, 1] } })), 'days');
  assert.equal(fieldOf(() => request({ controls: { window: { start: '07:00', end: '07:10' } } })), 'window');
  assert.equal(fieldOf(() => request({ controls: { weeklyMinutes: 10 } })), 'weeklyMinutes');
  assert.equal(fieldOf(() => request({ busy: [{ start: '2026-09-25T09:00', end: '2026-09-25T10:00' }] })), 'busy');
  assert.equal(fieldOf(() => request({ clarification: { question: 'Which level?', answer: '' } })), 'answer');
});

void test('the reading is checked again in code and mapped to camelCase', () => {
  const value = validateReading(reading);
  assert.equal(value.deadlineBasis, 'inferred');
  assert.equal(value.weeklyMinutes, 180);
  assert.equal(value.window, 'morning');
  const broken = (change: Record<string, unknown>) => fieldOf(() => validateReading({ ...reading, ...change }));
  assert.equal(broken({ decision: 'clarify' }), 'reading');
  assert.equal(broken({ question: 'When?' }), 'reading');
  assert.equal(broken({ deadline_basis: 'none' }), 'reading');
  assert.equal(broken({ window: 'dawn' }), 'reading');
  assert.equal(broken({ window: 'toString' }), 'reading');
  assert.equal(broken({ days: [0, 0] }), 'reading.days');
  assert.equal(broken({ weekly_minutes: 5 }), 'reading');
  assert.equal(broken({ deadline: '2026-02-30' }), 'reading');
  const abstain = validateReading({
    ...reading,
    decision: 'abstain',
    abstain: { category: 'medical', reason: 'Knee pain needs a physiotherapist first.' },
  });
  assert.equal(abstain.abstain?.category, 'medical');
});

void test('settings the person touched win, then the reading, then defaults, each with its source', () => {
  const read = validateReading(reading);
  const { spec, provenance } = buildGoalSpec(request({ controls: { weeklyMinutes: 120 } }), read);
  assert.equal(spec.startDate, '2026-09-25');
  assert.equal(spec.deadline, '2026-12-01');
  assert.deepEqual(spec.days, [0, 1, 2, 3, 4]);
  assert.deepEqual(spec.window, WINDOW_PRESETS.morning);
  assert.equal(spec.weeklyCapMinutes, 120);
  assert.deepEqual(provenance, {
    deadline: { source: 'goal', basis: 'inferred' },
    days: { source: 'goal' },
    window: { source: 'goal', preset: 'morning' },
    weeklyMinutes: { source: 'you' },
    level: { source: 'default' },
  });

  const vague: GoalReading = { ...read, deadline: null, deadlineBasis: 'none', days: null, window: null, weeklyMinutes: null };
  const defaults = buildGoalSpec(request(), vague);
  assert.equal(defaults.spec.deadline, '2026-11-19');
  assert.deepEqual(defaults.spec.days, [0, 2, 4]);
  assert.deepEqual(defaults.spec.window, WINDOW_PRESETS.evening);
  assert.equal(defaults.spec.weeklyCapMinutes, 150);
  assert.deepEqual(defaults.provenance.deadline, { source: 'default' });
  assert.deepEqual(defaults.provenance.window, { source: 'default', preset: 'evening' });
});

void test('a past or too distant deadline from the reading is replaced and says why', () => {
  const read = validateReading(reading);
  const past = buildGoalSpec(request(), { ...read, deadline: '2026-09-01' });
  assert.equal(past.spec.deadline, '2026-11-19');
  assert.deepEqual(past.provenance.deadline, { source: 'default', note: 'past' });
  const far = buildGoalSpec(request(), { ...read, deadline: '2027-09-01', deadlineBasis: 'stated' });
  assert.equal(far.spec.deadline, '2027-03-25');
  assert.deepEqual(far.provenance.deadline, { source: 'adjusted', note: 'too_far' });
  const mine = buildGoalSpec(request({ controls: { deadline: '2026-10-31', level: 'beginner' } }), read);
  assert.equal(mine.spec.deadline, '2026-10-31');
  assert.equal(mine.spec.level, 'beginner');
  assert.deepEqual(mine.provenance.level, { source: 'you' });
});

// These names and numbers live in both languages; a change on one side must
// fail here instead of drifting silently.
void test('presets, setting names, categories and spend bounds match the Python service', () => {
  const planning = readFileSync(new URL('../service/planning.py', import.meta.url), 'utf8');
  const provider = readFileSync(new URL('../service/provider.py', import.meta.url), 'utf8');
  for (const [name, { start, end }] of Object.entries(WINDOW_PRESETS)) {
    assert.ok(planning.includes(`"${name}" (${start}-${end})`), `${name} ${start}-${end} is in the read-goal prompt`);
  }
  const literal = (name: string) => {
    const match = new RegExp(`^${name} = Literal\\[([^\\]]+)\\]`, 'mu').exec(planning);
    assert.ok(match, `${name} literal`);
    return [...match[1].matchAll(/"([a-z_]+)"/gu)].map((item) => item[1]);
  };
  assert.deepEqual(literal('AbstainCategory'), [...ABSTAIN_CATEGORIES]);
  assert.deepEqual(literal('Window'), Object.keys(WINDOW_PRESETS));
  for (const name of providedSettings({ deadline: '2026-10-01', days: [0], window: WINDOW_PRESETS.night, weeklyMinutes: 60 })) {
    assert.ok(literal('Provided').includes(name), `${name} is a Provided value`);
  }
  const constant = (source: string, name: string) => Number(new RegExp(`^${name} = ([\\d_]+)`, 'mu').exec(source)?.[1].replaceAll('_', ''));
  assert.equal(constant(planning, 'READ_MAX_PROMPT_BYTES'), GOAL_BOUNDS.read.promptBytes);
  assert.equal(constant(planning, 'DRAFT_MAX_PROMPT_BYTES'), GOAL_BOUNDS.draft.promptBytes);
  assert.equal(constant(planning, 'READ_MAX_TOKENS'), GOAL_BOUNDS.read.outputTokens);
  assert.equal(constant(planning, 'DRAFT_MAX_TOKENS'), GOAL_BOUNDS.draft.outputTokens);
  assert.equal(constant(provider, 'MAX_ATTEMPTS'), GOAL_BOUNDS.attempts);
});
