// Times the planner with the most busy times a request may carry, as a local
// stand-in for the Worker's CPU budget. Not a test: timings vary by machine.
//
//   node --experimental-strip-types scripts/bench-busy.mts

import { buildSkeleton } from '../lib/planner/availability.ts';
import { checkPlan } from '../lib/planner/check.ts';
import { schedulePlan } from '../lib/planner/schedule.ts';
import { PLAN_LIMITS, validateGoalSpec } from '../lib/planner/spec.ts';
import { addDays } from '../lib/planner/time.ts';
import type { BusyInterval, Draft } from '../lib/planner/types.ts';

const START = '2026-10-01';
const spec = validateGoalSpec({
  title: 'Worst case',
  domain: 'learning',
  language: 'en',
  startDate: START,
  deadline: addDays(START, PLAN_LIMITS.maxHorizonDays - 1),
  days: [0, 1, 2, 3, 4, 5, 6],
  window: { start: '06:00', end: '22:00' },
  weeklyCapMinutes: 600,
});

// 2,000 meetings of 30 to 90 minutes spread over the horizon, inside the window.
let seed = 42;
const random = () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};
const busy: BusyInterval[] = Array.from({ length: 2_000 }, () => {
  const date = addDays(START, Math.floor(random() * PLAN_LIMITS.maxHorizonDays));
  const start = 360 + Math.floor(random() * 28) * 30;
  const end = Math.min(start + 30 + Math.floor(random() * 3) * 30, 1_320);
  const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return { start: `${date}T${time(start)}`, end: `${date}T${time(end)}` };
});

const weeks = buildSkeleton(spec, busy).weeks.length;
const draft: Draft = {
  phases: [{ title: 'All', fromWeek: 1, toWeek: weeks, focus: 'Steady practice.' }],
  sessionTypes: [{
    id: 'focus',
    title: 'Focus',
    minutes: 60,
    intensity: 'moderate',
    role: 'key',
    blocks: [{ minutes: 60, activity: 'Practice.' }],
    deliverable: 'Notes.',
    doneWhen: 'Done.',
  }],
  weeks: Array.from({ length: weeks }, (_, index) => ({ week: index + 1, sessions: Array.from({ length: 7 }, () => 'focus') })),
  templateId: null,
};

const timings: number[] = [];
for (let run = 0; run < 25; run += 1) {
  // A fresh copy each run, so the busy index is rebuilt as in a new request.
  const request = busy.map((interval) => ({ ...interval }));
  const started = performance.now();
  buildSkeleton(spec, request);
  const plan = schedulePlan(spec, draft, request);
  checkPlan(plan, request);
  timings.push(performance.now() - started);
}
timings.sort((a, b) => a - b);
console.log(`${weeks} weeks, ${busy.length} busy times: median ${timings[12].toFixed(1)} ms, max ${timings[24].toFixed(1)} ms over 25 runs`);
