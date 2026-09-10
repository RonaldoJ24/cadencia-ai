import assert from 'node:assert/strict';
import test from 'node:test';
import { routineShareText } from '../lib/calendar.ts';
import { toMarkdown } from '../lib/routine.ts';
import { createWeekExample, missExampleTuesday } from '../lib/week-example.ts';

void test('the interactive example moves Tuesday to Thursday without losing completed work or adding time', () => {
  const before = createWeekExample('with-room');
  const snapshot = JSON.stringify(before);
  const after = missExampleTuesday(before);
  assert.deepEqual(
    after.sessions.map((session) => [session.dayIndex, session.status]),
    [
      [0, 'done'],
      [1, 'missed'],
      [2, 'planned'],
      [3, 'planned'],
    ],
  );
  assert.deepEqual(after.sessions[0], before.sessions[0]);
  assert.equal(after.sessions[3].instructions, before.sessions[1].instructions);
  assert.equal(
    after.sessions
      .filter((session) => session.status !== 'missed')
      .reduce((sum, session) => sum + session.minutes, 0),
    90,
  );
  assert.ok(after.checks.every((check) => check.passed));
  assert.equal(JSON.stringify(before), snapshot);
  assert.deepEqual(createWeekExample('with-room'), before);
});

void test('the full-week example reports no replacement rather than inventing an unavailable day', () => {
  const before = createWeekExample('full');
  const after = missExampleTuesday(before);
  assert.equal(after.sessions.length, before.sessions.length);
  assert.equal(
    after.sessions
      .filter((session) => session.status !== 'missed')
      .reduce((sum, session) => sum + session.minutes, 0),
    60,
  );
  assert.ok(
    after.warnings.some((warning) =>
      warning.startsWith('No hay un día permitido y libre después'),
    ),
  );
  assert.deepEqual(after.sessions[0], before.sessions[0]);
  assert.deepEqual(after.sessions[2], before.sessions[2]);
  assert.ok(after.checks.every((check) => check.passed));
  assert.throws(() => missExampleTuesday(after));
});

void test('the English example localizes planner output and replanning evidence', () => {
  const before = createWeekExample('with-room', 'en');
  const after = missExampleTuesday(before);
  assert.equal(before.locale, 'en');
  assert.equal(before.intent.title, 'English for interviews');
  assert.match(before.sessions[0].title, /^Step 1: /u);
  assert.deepEqual(
    before.checks.map((check) => check.label),
    ['Selected days', 'Session length', 'Weekly limit', 'No overlaps'],
  );
  assert.match(after.explanation, /marked missed and rescheduled/u);
  assert.ok(after.checks.every((check) => check.passed));
  assert.match(toMarkdown(after), /## Sessions/u);
  assert.match(routineShareText(after), /Scheduled sessions:/u);
});
