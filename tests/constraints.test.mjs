import assert from 'node:assert/strict';
import { buildPlan, replan, markDone, toICS, validateInput } from '../lib/routine.ts';

const base = { request: 'Aprender TypeScript desde cero', days: [0, 2, 4], sessionMinutes: 25, weeklyMinutes: 75, startDate: '2026-08-31', time: '18:30' };
let combinations = 0;
for (let mask = 1; mask < 128; mask++) {
  const days = Array.from({ length: 7 }, (_, i) => i).filter(i => mask & (1 << i));
  for (const minutes of [5, 25, 60]) for (const capacity of [1, 2, 4, 7]) {
    const input = { ...base, days, sessionMinutes: minutes, weeklyMinutes: minutes * capacity };
    const plan = buildPlan(input);
    const before = JSON.stringify(plan);
    assert.equal(plan.sessions.length, Math.min(days.length, capacity));
    assert(plan.checks.every(c => c.passed));
    assert.deepEqual(plan, buildPlan(input));
    const done = plan.sessions.length > 1 ? markDone(plan, plan.sessions[0].id) : plan;
    const target = done.sessions.find(s => s.status === 'planned');
    const changed = replan(done, target.id);
    assert(changed.checks.every(c => c.passed));
    assert.equal(changed.intent.goal, plan.intent.goal);
    assert.equal(JSON.stringify(plan), before);
    assert.throws(() => replan(changed, target.id));
    if (done !== plan) assert.deepEqual(changed.sessions.find(s => s.id === done.sessions[0].id), done.sessions[0]);
    const active = changed.sessions.filter(s => s.status !== 'missed');
    assert(active.every(s => days.includes(s.dayIndex)));
    assert(active.reduce((n, s) => n + s.minutes, 0) <= input.weeklyMinutes);
    const calendar = toICS(changed);
    assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, active.length);
    assert.equal((calendar.match(/DTSTAMP:/g) || []).length, active.length);
    combinations++;
  }
}
for (const time of ['12:99', '23:60', '24:00', '-1:00']) assert.throws(() => validateInput({ ...base, time }));
for (const request of ['I will learn TypeScript', 'Practice painting', 'Revisar mis apuntes', 'Aprender fracciones']) {
  assert.notEqual(buildPlan({ ...base, request }).intent.title, 'Solicitud fuera de alcance');
}
const a = toICS(buildPlan(base));
const b = toICS(buildPlan({ ...base, request: 'Aprender italiano' }));
assert.notEqual(a.match(/UID:(.*)/)?.[1], b.match(/UID:(.*)/)?.[1]);
console.log(`PASS: ${combinations} deterministic schedule/replan combinations, invalid-time regressions, ordinary-language regressions, distinct calendar UIDs.`);
console.log('No model calls were made. These results do not measure language-model quality.');
