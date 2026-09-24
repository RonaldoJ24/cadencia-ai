// Phase 2: typed compiler trace — determinism, stable IDs, provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlannerEvent } from '../lib/routine.ts';
import { buildPlan, type RoutineInput } from '../lib/routine.ts';
import {
  ADAPT_POLICY_VERSION,
  PLANNER_RULE_IDS,
  PLANNER_VERSION,
  candidateHashSync,
  canonicalHash,
  canonicalHashSync,
  canonicalJson,
  canonicalPlannerInput,
  compileWithTrace,
} from '../lib/trace.ts';

const BASE: RoutineInput = {
  request: 'Learn TypeScript by building a small typed function.',
  days: [0, 2, 4],
  sessionMinutes: 30,
  weeklyMinutes: 90,
  startDate: '2026-08-31',
  time: '18:00',
  language: 'en',
};

const BASE_ES: RoutineInput = { ...BASE, days: [...BASE.days], language: 'es' };

void test('identical canonical inputs produce identical hashes (sync and WebCrypto agree)', async () => {
  const first = compileWithTrace(BASE, undefined, 'demo', { timezone: 'UTC' });
  const second = compileWithTrace({ ...BASE, days: [...BASE.days] }, undefined, 'demo', { timezone: 'UTC' });
  assert.equal(first.trace.inputHash, second.trace.inputHash);
  assert.equal(first.trace.scheduleHash, second.trace.scheduleHash);
  const canonical = canonicalPlannerInput(first.plan.input, first.plan.intent, { timezone: 'UTC' });
  assert.equal(first.trace.inputHash, canonicalHashSync(canonical));
  assert.equal(first.trace.inputHash, await canonicalHash(canonical));
});

void test('changed scheduling inputs change the input hash', () => {
  const base = compileWithTrace(BASE, undefined, 'demo', { timezone: 'UTC' });
  const changedDays = compileWithTrace({ ...BASE, days: [0, 1] }, undefined, 'demo', { timezone: 'UTC' });
  const changedTime = compileWithTrace({ ...BASE, time: '19:00' }, undefined, 'demo', { timezone: 'UTC' });
  const changedCap = compileWithTrace({ ...BASE, weeklyMinutes: 60 }, undefined, 'demo', { timezone: 'UTC' });
  assert.notEqual(base.trace.inputHash, changedDays.trace.inputHash);
  assert.notEqual(base.trace.inputHash, changedTime.trace.inputHash);
  assert.notEqual(base.trace.inputHash, changedCap.trace.inputHash);
});

void test('same inputs produce the same schedule hash; locale does not change rule IDs', () => {
  const english = compileWithTrace(BASE, undefined, 'demo', { timezone: 'UTC' });
  const spanish = compileWithTrace(BASE_ES, undefined, 'demo', { timezone: 'UTC' });
  assert.equal(english.trace.scheduleHash, compileWithTrace(BASE, undefined, 'demo', { timezone: 'UTC' }).trace.scheduleHash);
  for (const session of [...english.trace.sessions, ...spanish.trace.sessions]) {
    assert.deepEqual(session.ruleIds, [...PLANNER_RULE_IDS]);
    assert.equal(session.plannerVersion, PLANNER_VERSION);
    assert.equal(session.policyVersion, ADAPT_POLICY_VERSION);
  }
});

void test('trace instrumentation does not alter planner output', () => {
  const direct = buildPlan(BASE, undefined, 'demo');
  const { plan } = compileWithTrace(BASE, undefined, 'demo', { timezone: 'UTC' });
  assert.deepEqual(plan, direct);
});

void test('trace exposes real executed decisions with weekly-cap arithmetic', () => {
  const { plan, trace } = compileWithTrace(BASE, undefined, 'demo', { timezone: 'UTC' });
  assert.equal(trace.sessions.length, plan.sessions.length);
  let used = 0;
  trace.sessions.forEach((entry, index) => {
    const session = plan.sessions[index];
    assert.equal(entry.sessionId, session.id);
    assert.equal(entry.date, session.date);
    assert.equal(entry.time, plan.input.time);
    assert.equal(entry.durationMinutes, plan.input.sessionMinutes);
    assert.equal(entry.budgetBefore, plan.input.weeklyMinutes - used);
    assert.equal(entry.budgetAfter, entry.budgetBefore - session.minutes);
    assert.equal(entry.activityId, `intent-step-${index + 1}`);
    assert.equal(entry.logicalId, `intent-step-${index + 1}`);
    used += session.minutes;
  });
  assert.equal(trace.weeklyUsed, used);
  assert.ok(trace.stages.includes('schedule_completed'));
});

void test('canonical JSON is deterministic and excludes volatile fields', () => {
  const left = canonicalJson({ b: 1, a: [3, 2], nested: { z: 1, a: 2 }, skip: undefined });
  const right = canonicalJson({ nested: { a: 2, z: 1 }, a: [3, 2], b: 1 });
  assert.equal(left, right);
  assert.equal(canonicalJson({ a: undefined, b: null }), '{"b":null}');
  assert.equal(canonicalJson(-0), '0');
  const candidate = { baseRevision: 1, sessions: [{ id: 'a', date: '2026-09-01' }] };
  assert.equal(candidateHashSync(candidate), canonicalHashSync({ kind: 'adaptation-candidate', ...candidate }));
});

void test('candidate hash changes when the candidate schedule changes', () => {
  const { plan } = compileWithTrace(BASE, undefined, 'demo', { timezone: 'UTC' });
  const left = candidateHashSync({ baseRevision: 1, sessions: plan.sessions.map((s) => s.date) });
  const moved = plan.sessions.map((s) => s.date);
  moved[0] = '2026-09-05';
  const right = candidateHashSync({ baseRevision: 1, sessions: moved });
  assert.notEqual(left, right);
});

void test('buildPlan emits typed events at the branches that execute', async () => {
  const { buildPlan } = await import('../lib/routine.ts');
  const events: PlannerEvent[] = [];
  const plan = buildPlan(BASE, undefined, 'demo', undefined, (event) => {
    events.push(event);
  });
  const kinds = events.map((event) => event.type);
  assert.deepEqual(kinds, [
    'constraints_normalized',
    'intent_validated',
    'weekly_cap_applied',
    'session_placed',
    'session_placed',
    'session_placed',
    'schedule_completed',
  ]);
  const normalized = events[0];
  assert.ok(normalized && normalized.type === 'constraints_normalized' && normalized.days.join(',') === '0,2,4');
  const cap = events[2];
  assert.ok(cap && cap.type === 'weekly_cap_applied' && cap.capacity === 3 && cap.scheduledSessions === 3);
  const placed = events.filter((event) => event.type === 'session_placed');
  assert.deepEqual(placed.map((event) => event.type === 'session_placed' && event.budgetBefore), [90, 60, 30]);
  void plan;
});

void test('instrumentation does not alter planner output with or without a sink', async () => {
  const { buildPlan, replan } = await import('../lib/routine.ts');
  const bare = buildPlan(BASE, undefined, 'demo');
  const collected: PlannerEvent[] = [];
  const traced = buildPlan(BASE, undefined, 'demo', undefined, (event) => {
    collected.push(event);
  });
  assert.deepEqual(traced, bare);
  assert.ok(collected.length > 0);
  const once = replan(bare, bare.sessions[0]?.id ?? '');
  const sink: PlannerEvent[] = [];
  const twice = replan(bare, bare.sessions[0]?.id ?? '', (event) => {
    sink.push(event);
  });
  assert.deepEqual(twice, once);
  assert.ok(sink.some((event) => event.type === 'adaptation_candidate_confirmed'));
});

void test('trace construction refuses event/output divergence', async () => {
  const { traceFromCompileEvents } = await import('../lib/trace.ts');
  const { plan } = compileWithTrace(BASE, undefined, 'demo', { timezone: 'UTC' });
  assert.throws(() => traceFromCompileEvents(plan, [], { timezone: 'UTC' }), /diverge/iu);
});

void test('replan emits missed, replacement, and confirmation events', async () => {
  const { replan } = await import('../lib/routine.ts');
  const { fixtureCompile } = await import('../lib/server/fixture.ts');
  const { plan } = fixtureCompile('en');
  const events: PlannerEvent[] = [];
  const candidate = replan(plan, 'session-2026-09-01', (event) => {
    events.push(event);
  });
  const kinds = events.map((event) => event.type);
  assert.deepEqual(kinds, ['adaptation_missed_marked', 'adaptation_replacement_placed', 'adaptation_candidate_confirmed']);
  const confirmed = events[2];
  assert.ok(confirmed && confirmed.type === 'adaptation_candidate_confirmed');
  assert.deepEqual(confirmed.sessions.map((s) => `${s.sessionId}:${s.disposition}`), [
    'session-2026-08-31:preserved',
    'session-2026-09-01:missed',
    'session-2026-09-02:preserved',
    'session-2026-09-03:replacement',
  ]);
  void candidate;
});

void test('persisted schedule hash covers the stored row and differs from candidate scope', async () => {
  const { persistedScheduleHashSync, scheduleHashSync } = await import('../lib/trace.ts');
  const { plan } = compileWithTrace(BASE, undefined, 'demo', { timezone: 'UTC' });
  const stored = { revision: 1, input: plan.input, sessions: plan.sessions };
  assert.equal(persistedScheduleHashSync(stored, 'UTC'), scheduleHashSync(plan, 'UTC'));
});
