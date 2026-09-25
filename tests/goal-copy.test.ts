import test from 'node:test';
import assert from 'node:assert/strict';
import { goalCopyFor, waitTime } from '../lib/goal-copy.ts';

void test('a retry time reads in seconds, minutes, or hours and minutes', () => {
  assert.equal(waitTime(5), '5 s');
  assert.equal(waitTime(42), '42 s');
  assert.equal(waitTime(60), '1 min');
  assert.equal(waitTime(61), '2 min');
  assert.equal(waitTime(3599), '1 h');
  assert.equal(waitTime(3600), '1 h');
  // What a visitor saw after the daily quota, about nine hours before midnight UTC.
  assert.equal(waitTime(33_453), '9 h 18 min');
});

void test('the wait reads naturally in both languages', () => {
  assert.equal(goalCopyFor('en').errors.wait(33_453), 'try again in 9 h 18 min');
  assert.equal(goalCopyFor('es').errors.wait(42), 'inténtalo de nuevo en 42 s');
});
