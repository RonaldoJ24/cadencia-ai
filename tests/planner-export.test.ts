import test from 'node:test';
import assert from 'node:assert/strict';
import { googleCalendarLink, sessionTimes, toGoalICS } from '../lib/planner/export.ts';
import { schedulePlan } from '../lib/planner/schedule.ts';
import { validateGoalSpec } from '../lib/planner/spec.ts';
import type { Draft } from '../lib/planner/types.ts';

const spec = validateGoalSpec({
  title: 'Learn TypeScript',
  domain: 'learning',
  language: 'en',
  startDate: '2026-09-28',
  deadline: '2026-10-11',
  days: [0, 2],
  window: { start: '23:30', end: '23:59' },
  weeklyCapMinutes: 60,
});

const draft: Draft = {
  phases: [{ title: 'Basics', fromWeek: 1, toWeek: 2, focus: 'Types, then a tiny tool.' }],
  sessionTypes: [{
    id: 'practice',
    title: 'Types; unions, narrowing',
    minutes: 25,
    intensity: 'moderate',
    blocks: [{ minutes: 25, activity: 'Write, compile and fix one typed function, with notes on every error message you see along the way.' }],
    deliverable: 'One typed function.',
    doneWhen: 'It compiles.',
  }],
  weeks: [{ week: 1, sessions: ['practice', 'practice'] }, { week: 2, sessions: ['practice'] }],
  templateId: null,
};

void test('the calendar file has one event per session, escaped and folded', () => {
  const plan = schedulePlan(spec, draft, []);
  plan.weeks[1].sessions[0] = { ...plan.weeks[1].sessions[0], status: 'missed' };
  const ics = toGoalICS(plan, new Date('2026-09-24T12:00:00Z'));
  assert.equal(ics.match(/BEGIN:VEVENT/gu)?.length, 2);
  assert.match(ics, /DTSTART:20260928T233000\r\nDTEND:20260928T235500/u);
  assert.ok(ics.includes('SUMMARY:Types\\; unions\\, narrowing'), 'commas and semicolons are escaped');
  assert.match(ics, /DTSTAMP:20260924T120000Z/u);
  for (const line of ics.split('\r\n')) {
    assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
  }
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

void test('a session that runs past midnight ends on the next day', () => {
  const late = { ...schedulePlan(spec, draft, []).weeks[0].sessions[0], start: '23:50', minutes: 25 };
  assert.deepEqual(sessionTimes(late), { start: '20260928T235000', end: '20260929T001500' });
});

void test('the Google Calendar link carries the session and a valid time zone', () => {
  const session = schedulePlan(spec, draft, []).weeks[0].sessions[0];
  const url = new URL(googleCalendarLink(session, 'en', 'America/Mexico_City'));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('dates'), '20260928T233000/20260928T235500');
  assert.equal(url.searchParams.get('ctz'), 'America/Mexico_City');
  assert.match(url.searchParams.get('details') ?? '', /Deliverable: One typed function\./u);
  assert.equal(new URL(googleCalendarLink(session, 'en', 'Not/AZone')).searchParams.get('ctz'), 'UTC');
});
