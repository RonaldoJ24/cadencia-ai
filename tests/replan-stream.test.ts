import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POST } from '../app/api/routine/route.ts';
import { StageFailure, type StageEvent } from '../lib/plan-stream.ts';
import { replanOptions, REPLAN_OPTIONS } from '../lib/planner/replan.ts';
import { schedulePlan } from '../lib/planner/schedule.ts';
import { SpecError, validateGoalSpec } from '../lib/planner/spec.ts';
import type { GoalPlan, SessionType } from '../lib/planner/types.ts';
import { checkPick, plannedReplanSteps, REPLAN_LIMITS, replanRequestFor, runReplanPipeline, validateReplanRequest, type ReplanRequest } from '../lib/replan-stream.ts';
import { REPLAN_LEASE_SEC } from '../lib/server/goal-run.ts';
import type { ReplanAnswer } from '../lib/server/live.ts';
import { REPLAN_BOUNDS, REPLAN_WORST_CASE_MICROUSD } from '../lib/server/spend.ts';
import { SseParser, type SseMessage } from '../lib/sse.ts';
import { migratedDb } from './helpers/sqlite-d1.ts';

const NOW_ISO = '2026-10-11T12:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const MIGRATIONS = ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql'];
const liveEnv = {
  CADENCIA_ENABLE_LIVE: 'true',
  CADENCIA_INTENT_SERVICE_URL: 'https://intents.example',
  CADENCIA_SERVICE_TOKEN: 'replan-route-test-token',
};

function type(id: string, minutes: number): SessionType {
  return { id, title: id, minutes, intensity: 'moderate', role: 'key', blocks: [{ minutes, activity: 'Practice.' }], deliverable: 'Notes.', doneWhen: 'Done.' };
}

// A learning plan with week 1 done and week 2 missed, asked on Sunday of week 2.
const spec = validateGoalSpec({
  title: 'Learn chords',
  domain: 'learning',
  language: 'en',
  startDate: '2026-09-28',
  deadline: '2026-12-06',
  days: [0, 2, 4],
  window: { start: '18:00', end: '21:00' },
  weeklyCapMinutes: 180,
});
const content: Record<number, string[]> = { 1: ['practice'], 2: ['practice', 'project'], 3: ['practice', 'project', 'practice'] };
const plan: GoalPlan = schedulePlan(spec, {
  phases: [{ title: 'All', fromWeek: 1, toWeek: 10, focus: 'Chords.' }],
  sessionTypes: [type('practice', 30), type('project', 60)],
  weeks: Array.from({ length: 10 }, (_, index) => ({ week: index + 1, sessions: content[index + 1] ?? ['practice', 'project'] })),
  templateId: null,
}, []);
const missed: GoalPlan = {
  ...plan,
  weeks: plan.weeks.map((week) => ({
    ...week,
    sessions: week.sessions.map((session) => ({ ...session, status: week.week === 1 ? 'done' : week.week === 2 ? 'missed' : session.status })),
  })),
};
const TODAY = '2026-10-11';
const replan = replanOptions(missed, [], TODAY)!;

/** The request the page sends: the situation and the summaries, and nothing about the goal but its area and level. */
const REQUEST: ReplanRequest = replanRequestFor(missed, replan, TODAY, 'en', 'I was traveling for work all week.');

const PICK = { decision: 'pick', option: 'repeat', why: 'Your trip is over, so redo the missed week now.', abstain: null };

void test('a request built from the planner’s options passes, and each field is checked', () => {
  assert.deepEqual(REQUEST.options.map((option) => option.id), ['keep', 'repeat', 'extend', 'lighter']);
  assert.deepEqual(validateReplanRequest(REQUEST, TODAY), REQUEST);
  const fieldOf = (change: Record<string, unknown>, serverToday = TODAY) => {
    try {
      validateReplanRequest({ ...REQUEST, ...change }, serverToday);
    } catch (error) {
      if (error instanceof SpecError) return error.field;
      throw error;
    }
    return 'no error';
  };
  assert.equal(fieldOf({ reason: ' ' }), 'reason');
  assert.equal(fieldOf({ reason: 'x'.repeat(501) }), 'reason');
  assert.equal(fieldOf({ title: 'Learn chords' }), 'input');
  assert.equal(fieldOf({ options: [REQUEST.options[0], REQUEST.options[0]] }), 'options');
  assert.equal(fieldOf({ options: [{ ...REQUEST.options[0], id: 'skip' }] }), 'options[0]');
  assert.equal(fieldOf({ options: [{ ...REQUEST.options[0], sessionsLeft: 999 }] }), 'sessionsLeft');
  assert.equal(fieldOf({ options: [{ ...REQUEST.options[0], note: 'x' }] }), 'options[0]');
  assert.equal(fieldOf({ situation: { ...REQUEST.situation, missedWeeks: 4 } }), 'missedWeeks');
  assert.equal(fieldOf({ domain: 'cooking' }), 'domain');
  assert.equal(fieldOf({}, '2026-10-14'), 'today');
});

void test('a pick is checked again in code against the options offered', () => {
  const offered = ['keep', 'repeat'] as const;
  assert.deepEqual(checkPick(PICK, offered), { decision: 'pick', option: 'repeat', why: PICK.why });
  assert.deepEqual(checkPick({ ...PICK, option: 'extend' }, offered), { decision: 'not_offered' });
  const abstain = { decision: 'abstain', option: null, why: null, abstain: { category: 'medical', reason: 'See a professional first.' } };
  assert.deepEqual(checkPick(abstain, offered), { decision: 'abstain', category: 'medical', reason: 'See a professional first.' });
  for (const broken of [
    { ...PICK, why: 'Redo the 2 missed sessions.' },
    { ...PICK, why: null },
    { ...PICK, option: 'skip' },
    { ...PICK, abstain: abstain.abstain },
    { ...abstain, option: 'keep' },
    { ...abstain, abstain: { category: 'legal', reason: 'No.' } },
    { ...PICK, decision: 'maybe' },
    { ...PICK, extra: true },
  ]) {
    assert.throws(() => checkPick(broken, offered), SpecError, JSON.stringify(broken));
  }
});

async function demo(pick: unknown) {
  const events: StageEvent[] = [];
  const outcome = await runReplanPipeline(REQUEST, {
    mode: 'demo',
    now: () => 0,
    emit: (event) => events.push(event),
    pickOption: async () => ({ pick }),
  });
  return { outcome, events };
}

void test('the demo runs the same stages with a recorded pick, and falls back when it is not offered', async () => {
  const suggested = await demo(PICK);
  assert.deepEqual(suggested.outcome, { outcome: 'suggested', option: 'repeat', why: PICK.why, requestIds: [] });
  assert.deepEqual(
    suggested.events.filter((event) => event.status !== 'started').map((event) => `${event.stage}:${event.actor}:${event.status}`),
    ['check_request:code:completed', 'pick_option:sample:completed', 'check_pick:code:completed'],
  );
  const declined = await demo({ decision: 'abstain', option: null, why: null, abstain: { category: 'unclear', reason: 'Nothing to choose from.' } });
  assert.equal(declined.outcome.outcome, 'declined');
  // A recording made on another day may name an option this plan does not offer.
  const narrow = await runReplanPipeline({ ...REQUEST, options: REQUEST.options.slice(0, 1) }, {
    mode: 'demo',
    now: () => 0,
    emit: () => undefined,
    pickOption: async () => ({ pick: PICK }),
  });
  assert.deepEqual(narrow, { outcome: 'open', requestIds: [] });
  await assert.rejects(demo({ ...PICK, why: 'Redo 2 sessions.' }), (error: unknown) => error instanceof StageFailure && error.stage === 'check_pick');
  assert.deepEqual(plannedReplanSteps('live').map((step) => step.stage), ['build_options', 'check_request', 'reserve', 'pick_option', 'check_pick']);
});

function replanRequest(input: unknown, ip: string, stream = true): Request {
  return new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(stream ? { accept: 'text/event-stream' } : {}) },
    body: JSON.stringify({ mode: 'deepseek', kind: 'replan', input }),
  });
}

async function events(response: Response) {
  const messages: SseMessage[] = [];
  const parser = new SseParser((message) => messages.push(message));
  parser.push(await response.text());
  parser.end();
  return messages.map((message) => ({ event: message.event, data: JSON.parse(message.data) as Record<string, unknown> }));
}

function ledger(db: ReturnType<typeof migratedDb>) {
  return { ...(db.raw.prepare('SELECT status, reserved_microusd, actual_microusd, prompt_tokens, completion_tokens, attempts FROM spend_ledger').get() as Record<string, unknown>) };
}

void test('a live replan reserves its own worst case, sends only the checked request, settles and frees its slot', async () => {
  const db = migratedDb(MIGRATIONS);
  const sent: unknown[] = [];
  const response = await POST(replanRequest(REQUEST, '203.0.113.60'), {
    db,
    env: liveEnv,
    nowIso: () => NOW_ISO,
    nowMs: () => NOW_MS,
    replanFetcher: async (payload): Promise<ReplanAnswer> => {
      sent.push(payload);
      assert.equal(ledger(db).reserved_microusd, REPLAN_WORST_CASE_MICROUSD);
      const lease = db.raw.prepare('SELECT expires_at FROM public_concurrency').get() as { expires_at: number };
      assert.equal(lease.expires_at, NOW_MS + REPLAN_LEASE_SEC * 1000);
      return { pick: PICK, requestId: '33333333-3333-4333-8333-333333333333', usage: { promptTokens: 760, completionTokens: 45, attempts: 1 } };
    },
  });
  const list = await events(response);
  assert.deepEqual(
    list.filter((item) => item.event === 'stage' && item.data.status !== 'started').map((item) => `${String(item.data.stage)}:${String(item.data.status)}`),
    ['check_request:completed', 'reserve:completed', 'pick_option:completed', 'check_pick:completed'],
  );
  assert.equal(list.at(-1)?.data.outcome, 'suggested');
  assert.deepEqual(sent, [REQUEST]);
  // 760 in and 45 out cost 76 + 22.5, rounded up to 99 micro-USD.
  assert.deepEqual(ledger(db), {
    status: 'settled',
    reserved_microusd: REPLAN_WORST_CASE_MICROUSD,
    actual_microusd: 99,
    prompt_tokens: 760,
    completion_tokens: 45,
    attempts: 1,
  });
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM public_concurrency').get() as { n: number }).n, 0);
});

void test('an invalid replan is refused before any spend or model call', async () => {
  const db = migratedDb(MIGRATIONS);
  let called = false;
  const response = await POST(replanRequest({ ...REQUEST, reason: '' }, '203.0.113.61', false), {
    db,
    env: liveEnv,
    nowIso: () => NOW_ISO,
    nowMs: () => NOW_MS,
    replanFetcher: async () => {
      called = true;
      throw new Error('not reached');
    },
  });
  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM spend_ledger').get() as { n: number }).n, 0);
});

// The same bounds on both sides: a change on one must fail here.
void test('replan bounds, options and categories match the Python service', () => {
  const planning = readFileSync(new URL('../service/planning.py', import.meta.url), 'utf8');
  const provider = readFileSync(new URL('../service/provider.py', import.meta.url), 'utf8');
  const constant = (source: string, name: string) => Number(new RegExp(`^${name} = ([\\d_]+)`, 'mu').exec(source)?.[1].replaceAll('_', ''));
  assert.equal(constant(planning, 'REPLAN_MAX_PROMPT_BYTES'), REPLAN_BOUNDS.pick.promptBytes);
  assert.equal(constant(planning, 'REPLAN_MAX_TOKENS'), REPLAN_BOUNDS.pick.outputTokens);
  assert.equal(constant(provider, 'MAX_ATTEMPTS'), REPLAN_BOUNDS.attempts);
  const literal = (name: string) => [...(new RegExp(`^${name} = Literal\\[([^\\]]+)\\]`, 'mu').exec(planning)?.[1] ?? '').matchAll(/"([a-z_]+)"/gu)].map((item) => item[1]);
  assert.deepEqual(literal('ReplanOptionId'), [...REPLAN_OPTIONS]);
  assert.deepEqual(literal('ReplanAbstainCategory'), ['medical', 'unclear']);
  for (const name of ['missedSessions', 'missedWeeks', 'weeksLeft', 'sessionsLeft', 'minutesLeft', 'nextSevenDaysMinutes', 'sessionsLeftOut'] as const) {
    const match = new RegExp(`^    ${name}: StrictInt = Field\\(ge=([\\d_]+), le=([\\d_]+)\\)`, 'mu').exec(planning);
    assert.ok(match, name);
    assert.deepEqual([Number(match[1].replaceAll('_', '')), Number(match[2].replaceAll('_', ''))], [...REPLAN_LIMITS[name]], name);
  }
  assert.match(planning, new RegExp(`return _text\\(value, ${REPLAN_LIMITS.maxReasonChars}\\)`, 'u'));
});
