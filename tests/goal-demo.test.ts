import test from 'node:test';
import assert from 'node:assert/strict';
import { findSample, fitDraft, loadSamples, sampleDeps, SAMPLE_IDS } from '../lib/goal-demo.ts';
import { runGoalPipeline } from '../lib/goal-stream.ts';
import type { StageEvent } from '../lib/plan-stream.ts';
import { checkPlan } from '../lib/planner/check.ts';
import { addDays, weekdayOf } from '../lib/planner/time.ts';

void test('a recorded draft keeps its first and last weeks when fitted to another length', () => {
  const draft = {
    phases: [
      { title: 'Base', fromWeek: 1, toWeek: 8, focus: 'Build.' },
      { title: 'Taper', fromWeek: 9, toWeek: 11, focus: 'Ease off.' },
    ],
    sessionTypes: [],
    weeks: Array.from({ length: 11 }, (_, index) => ({ week: index + 1, sessions: [`w${index + 1}`] })),
    templateId: null,
  };
  assert.equal(fitDraft(draft, 11), draft);
  for (const weeks of [7, 10, 12, 16]) {
    const fitted = fitDraft(draft, weeks);
    assert.equal(fitted.weeks.length, weeks);
    assert.deepEqual(fitted.weeks[0].sessions, ['w1']);
    assert.deepEqual(fitted.weeks.at(-1)?.sessions, ['w11']);
    assert.deepEqual(fitted.weeks.map((week) => week.week), Array.from({ length: weeks }, (_, index) => index + 1));
    assert.equal(fitted.phases[0].fromWeek, 1);
    assert.equal(fitted.phases.at(-1)?.toWeek, weeks);
    assert.ok(fitted.phases.every((phase) => phase.fromWeek <= phase.toWeek));
  }
});

void test('every demo sample runs through the real pipeline on later dates too', async () => {
  const samples = await loadSamples();
  assert.equal(samples.length, SAMPLE_IDS.length * 2);
  const expected = { ten_k: 'ready', guitar: 'ready', interview: 'ready', vague: 'needs_answer', marathon: 'cannot_plan' };
  // The recording date, a Thursday two weeks later, and a Monday a month later.
  for (const today of ['2026-09-24', '2026-10-08', '2026-10-26']) {
    for (const id of SAMPLE_IDS) {
      for (const language of ['en', 'es'] as const) {
        const sample = findSample(samples, id, language);
        assert.ok(sample, `${id}/${language}`);
        const outcome = await runGoalPipeline(
          { text: sample.text, language, today },
          { mode: 'demo', now: () => 0, emit: () => undefined, ...sampleDeps(sample, today) },
        );
        assert.equal(outcome.outcome, expected[id], `${id}/${language} on ${today}`);
        if (outcome.outcome === 'ready') {
          assert.deepEqual(checkPlan(outcome.plan, []), [], `${id}/${language} on ${today}`);
          assert.ok(outcome.plan.weeks.some((week) => week.sessions.length > 0));
        }
      }
    }
  }
});

void test('the demo plans around busy times imported from a calendar', async () => {
  const samples = await loadSamples();
  const sample = findSample(samples, 'ten_k', 'en');
  assert.ok(sample);
  // Tuesday and Thursday mornings are taken for the whole plan, as a calendar file would say.
  const busy = [
    ...Array.from({ length: 12 }, (_, week) => addDays('2026-09-29', week * 7)),
    ...Array.from({ length: 12 }, (_, week) => addDays('2026-10-01', week * 7)),
  ].map((date) => ({ start: `${date}T05:00`, end: `${date}T11:00` }));
  const events: StageEvent[] = [];
  // Planned on the day the sample was recorded, so its deadline isn't shifted.
  const today = sample.recordedOn;
  const outcome = await runGoalPipeline(
    { text: sample.text, language: 'en', today, busy },
    { mode: 'demo', now: () => 0, emit: (event) => events.push(event), ...sampleDeps(sample, today) },
  );
  assert.equal(outcome.outcome, 'ready');
  if (outcome.outcome !== 'ready') return;
  const sessions = outcome.plan.weeks.flatMap((week) => week.sessions);
  assert.ok(sessions.length > 0);
  assert.ok(sessions.every((session) => ![1, 3].includes(weekdayOf(session.date))));
  assert.deepEqual(checkPlan(outcome.plan, busy), []);
  // The plan ends on Tuesday, Dec 1: ten Tuesdays and nine Thursdays fall inside it.
  const availability = events.find((event) => event.stage === 'check_availability' && event.status === 'completed');
  assert.match(availability && 'detail' in availability ? availability.detail : '', /around 19 busy times from your calendar/u);
});
