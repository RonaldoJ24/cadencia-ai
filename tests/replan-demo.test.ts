import test from 'node:test';
import assert from 'node:assert/strict';
import { findSample, loadSamples, sampleDeps } from '../lib/goal-demo.ts';
import { runGoalPipeline } from '../lib/goal-stream.ts';
import { checkPlan } from '../lib/planner/check.ts';
import { replanOptions } from '../lib/planner/replan.ts';
import { findReplanSample, loadReplanSamples, REPLAN_REASONS, replanSampleDeps, simulateMissedWeek } from '../lib/replan-demo.ts';
import { replanRequestFor, runReplanPipeline } from '../lib/replan-stream.ts';

void test('every recorded pick replays on every demo plan and date, and never breaks the run', async () => {
  const goals = await loadSamples();
  const picks = await loadReplanSamples();
  assert.equal(picks.length, REPLAN_REASONS.length * 2);
  let suggested = 0;
  let open = 0;
  // The recording date, a Thursday two weeks later, and a Monday a month later.
  for (const today of ['2026-09-24', '2026-10-08', '2026-10-26']) {
    for (const id of ['ten_k', 'guitar', 'interview'] as const) {
      for (const language of ['en', 'es'] as const) {
        const sample = findSample(goals, id, language)!;
        const outcome = await runGoalPipeline(
          { text: sample.text, language, today },
          { mode: 'demo', now: () => 0, emit: () => undefined, ...sampleDeps(sample, today) },
        );
        assert.equal(outcome.outcome, 'ready');
        if (outcome.outcome !== 'ready') continue;
        const simulated = simulateMissedWeek(outcome.plan);
        assert.ok(simulated, `${id}/${language} on ${today} can simulate a missed week`);
        const replan = replanOptions(simulated.plan, [], simulated.today);
        assert.ok(replan && replan.options.some((option) => option.summary.id === 'keep'), `${id}/${language} on ${today}`);
        for (const option of replan.options) assert.deepEqual(checkPlan(option.plan, []), []);
        // Lighter never plans more time than keep in any week ahead.
        const keep = replan.options.find((option) => option.summary.id === 'keep')!;
        const lighter = replan.options.find((option) => option.summary.id === 'lighter');
        if (lighter) {
          for (const week of lighter.plan.weeks) {
            const minutes = (plan: typeof week.sessions) => plan.filter((session) => session.date > simulated.today).reduce((total, session) => total + session.minutes, 0);
            const kept = keep.plan.weeks.find((entry) => entry.week === week.week)?.sessions ?? [];
            assert.ok(minutes(week.sessions) <= minutes(kept), `${id}/${language} on ${today}, week ${week.week}`);
          }
        }
        for (const reason of REPLAN_REASONS) {
          const pick = findReplanSample(picks, reason, language)!;
          const result = await runReplanPipeline(
            replanRequestFor(simulated.plan, replan, simulated.today, language, pick.text),
            { mode: 'demo', now: () => 0, emit: () => undefined, ...replanSampleDeps(pick) },
          );
          if (result.outcome === 'suggested') {
            suggested += 1;
            assert.ok(replan.options.some((option) => option.summary.id === result.option));
          } else if (result.outcome === 'open') {
            open += 1;
          } else {
            assert.equal(reason, 'pain');
            assert.equal(result.category, 'medical');
          }
        }
      }
    }
  }
  // Most replays suggest an option; any that cannot fall back to the person's choice.
  assert.ok(suggested > open, `${suggested} suggested, ${open} open`);
});

void test('the simulation marks the first weeks and pretends today is the missed week’s Sunday', async () => {
  const sample = findSample(await loadSamples(), 'ten_k', 'en')!;
  const outcome = await runGoalPipeline(
    { text: sample.text, language: 'en', today: '2026-09-24' },
    { mode: 'demo', now: () => 0, emit: () => undefined, ...sampleDeps(sample, '2026-09-24') },
  );
  assert.equal(outcome.outcome, 'ready');
  if (outcome.outcome !== 'ready') return;
  const simulated = simulateMissedWeek(outcome.plan)!;
  const missed = simulated.plan.weeks.flatMap((week) => week.sessions).filter((session) => session.status === 'missed');
  assert.ok(missed.length > 0);
  assert.ok(missed.every((session) => session.date <= simulated.today));
  assert.equal(new Date(`${simulated.today}T00:00:00Z`).getUTCDay(), 0);
  assert.ok(simulated.plan.weeks.flatMap((week) => week.sessions).filter((session) => session.date > simulated.today).every((session) => session.status === 'planned'));
});
