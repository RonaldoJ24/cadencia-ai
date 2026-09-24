import test from 'node:test';
import assert from 'node:assert/strict';
import { CALENDAR_LIMITS, CalendarError, readBusyTimes, type ReadOptions } from '../lib/calendar-import.ts';
import { daysBetween } from '../lib/planner/time.ts';

/** A calendar with one VEVENT per list of lines. */
function calendar(...events: string[][]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cadencia tests//EN',
    ...events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n');
}

// Mexico City has kept UTC-6 all year since 2022.
const MEXICO: ReadOptions = { zone: 'America/Mexico_City', from: '2026-10-01', to: '2027-03-31' };

void test('UTC and floating times land on the local clock, and nothing else about an event is read', () => {
  const result = readBusyTimes(calendar(
    ['UID:a', 'SUMMARY:Dentist appointment', 'LOCATION:Secret clinic', 'DTSTART:20261005T150000Z', 'DTEND:20261005T160000Z'],
    ['UID:b', 'DESCRIPTION:Private notes', 'DTSTART:20261006T180000', 'DTEND:20261006T193000'],
  ), MEXICO);
  assert.deepEqual(result.busy, [
    { start: '2026-10-05T09:00', end: '2026-10-05T10:00' },
    { start: '2026-10-06T18:00', end: '2026-10-06T19:30' },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /Dentist|Secret|Private/u);
  assert.deepEqual(result.summary, { events: 2, skipped: 0, repeatsReadOnce: 0, unknownZones: [], truncated: false });
});

void test('a weekly meeting keeps its own clock across a daylight-saving change elsewhere', () => {
  // 9:00 in New York is 7:00 in Mexico City in October and 8:00 after the
  // United States falls back on 2026-11-01.
  const { busy } = readBusyTimes(calendar([
    'UID:weekly',
    'DTSTART;TZID=America/New_York:20261020T090000',
    'DTEND;TZID=America/New_York:20261020T100000',
    'RRULE:FREQ=WEEKLY;COUNT=4',
  ]), MEXICO);
  assert.deepEqual(busy, [
    { start: '2026-10-20T07:00', end: '2026-10-20T08:00' },
    { start: '2026-10-27T07:00', end: '2026-10-27T08:00' },
    { start: '2026-11-03T08:00', end: '2026-11-03T09:00' },
    { start: '2026-11-10T08:00', end: '2026-11-10T09:00' },
  ]);
});

void test('Windows and path-style zone names resolve; unknown ones read as local and are reported', () => {
  const { busy, summary } = readBusyTimes(calendar(
    ['UID:w', 'DTSTART;TZID="Central Standard Time (Mexico)":20261007T070000', 'DURATION:PT1H30M'],
    ['UID:m', 'DTSTART;TZID=/mozilla.org/20050126_1/America/New_York:20261008T120000', 'DTEND;TZID=/mozilla.org/20050126_1/America/New_York:20261008T130000'],
    ['UID:u', 'DTSTART;TZID=Mars/Olympus:20261009T100000', 'DTEND;TZID=Mars/Olympus:20261009T110000'],
  ), MEXICO);
  assert.deepEqual(busy, [
    { start: '2026-10-07T07:00', end: '2026-10-07T08:30' },
    { start: '2026-10-08T10:00', end: '2026-10-08T11:00' },
    { start: '2026-10-09T10:00', end: '2026-10-09T11:00' },
  ]);
  assert.deepEqual(summary.unknownZones, ['Mars/Olympus']);
});

void test('all-day events block whole local days', () => {
  const { busy } = readBusyTimes(calendar(
    ['UID:trip', 'DTSTART;VALUE=DATE:20261010', 'DTEND;VALUE=DATE:20261013'],
    ['UID:one', 'DTSTART;VALUE=DATE:20261020'],
    ['UID:repeat', 'DTSTART;VALUE=DATE:20261101', 'RRULE:FREQ=DAILY;UNTIL=20261103'],
  ), MEXICO);
  assert.deepEqual(busy, [
    { start: '2026-10-10T00:00', end: '2026-10-13T00:00' },
    { start: '2026-10-20T00:00', end: '2026-10-21T00:00' },
    // Three touching days merge into one busy time.
    { start: '2026-11-01T00:00', end: '2026-11-04T00:00' },
  ]);
});

void test('weekly rules follow BYDAY, INTERVAL and WKST as in RFC 5545', () => {
  // The RFC's own example: WKST changes which weeks count as "every other".
  const options: ReadOptions = { zone: 'America/New_York', from: '1997-08-01', to: '1997-09-30' };
  const event = (weekStart: string) => calendar([
    'UID:rfc',
    'DTSTART;TZID=America/New_York:19970805T090000',
    'DTEND;TZID=America/New_York:19970805T100000',
    `RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=${weekStart}`,
  ]);
  const days = (weekStart: string) => readBusyTimes(event(weekStart), options).busy.map((interval) => interval.start.slice(0, 10));
  assert.deepEqual(days('MO'), ['1997-08-05', '1997-08-10', '1997-08-19', '1997-08-24']);
  assert.deepEqual(days('SU'), ['1997-08-05', '1997-08-17', '1997-08-19', '1997-08-31']);

  // UNTIL as a UTC time bounds the series; the last kept evening is Oct 22.
  const { busy } = readBusyTimes(calendar([
    'UID:biweekly',
    'DTSTART;TZID=America/Mexico_City:20261005T190000',
    'DTEND;TZID=America/Mexico_City:20261005T200000',
    'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261031T000000Z',
  ]), MEXICO);
  assert.deepEqual(busy.map((interval) => interval.start), ['2026-10-05T19:00', '2026-10-08T19:00', '2026-10-19T19:00', '2026-10-22T19:00']);
});

void test('EXDATE removes occurrences but still counts toward COUNT', () => {
  const { busy } = readBusyTimes(calendar([
    'UID:daily',
    'DTSTART;TZID=America/Mexico_City:20261012T060000',
    'DTEND;TZID=America/Mexico_City:20261012T063000',
    'RRULE:FREQ=DAILY;COUNT=5',
    'EXDATE;TZID=America/Mexico_City:20261013T060000,20261015T060000',
  ]), MEXICO);
  assert.deepEqual(busy.map((interval) => interval.start), ['2026-10-12T06:00', '2026-10-14T06:00', '2026-10-16T06:00']);
});

void test('a changed occurrence replaces the original, and a cancelled one removes it', () => {
  const { busy, summary } = readBusyTimes(calendar(
    ['UID:m', 'DTSTART;TZID=America/Mexico_City:20261005T120000', 'DTEND;TZID=America/Mexico_City:20261005T130000', 'RRULE:FREQ=WEEKLY;COUNT=3'],
    ['UID:m', 'RECURRENCE-ID;TZID=America/Mexico_City:20261012T120000', 'DTSTART;TZID=America/Mexico_City:20261013T150000', 'DTEND;TZID=America/Mexico_City:20261013T160000'],
    ['UID:m', 'RECURRENCE-ID;TZID=America/Mexico_City:20261019T120000', 'STATUS:CANCELLED', 'DTSTART;TZID=America/Mexico_City:20261019T120000', 'DTEND;TZID=America/Mexico_City:20261019T130000'],
    ['UID:free', 'TRANSP:TRANSPARENT', 'DTSTART:20261021T150000Z', 'DTEND:20261021T160000Z'],
  ), MEXICO);
  assert.deepEqual(busy, [
    { start: '2026-10-05T12:00', end: '2026-10-05T13:00' },
    { start: '2026-10-13T15:00', end: '2026-10-13T16:00' },
  ]);
  assert.equal(summary.skipped, 2);
});

void test('rules this reader does not expand count once and are reported', () => {
  const { busy, summary } = readBusyTimes(calendar([
    'UID:monthly',
    'DTSTART;TZID=America/Mexico_City:20261005T090000',
    'DTEND;TZID=America/Mexico_City:20261005T100000',
    'RRULE:FREQ=MONTHLY;BYDAY=1MO',
  ]), MEXICO);
  assert.deepEqual(busy, [{ start: '2026-10-05T09:00', end: '2026-10-05T10:00' }]);
  assert.equal(summary.repeatsReadOnce, 1);
});

void test('old repeating events jump to the window and keep their rhythm', () => {
  const { busy } = readBusyTimes(calendar(
    ['UID:old', 'DTSTART:20150105T070000', 'DTEND:20150105T073000', 'RRULE:FREQ=DAILY;INTERVAL=3'],
  ), MEXICO);
  assert.equal(busy.length, 61);
  assert.ok(busy[0].start >= '2026-10-01T07:00' && busy[0].start <= '2026-10-03T07:00');
  for (const interval of busy) assert.equal(daysBetween('2015-01-05', interval.start.slice(0, 10)) % 3, 0);

  // A multi-day occurrence that starts before the window still reaches into it.
  const reach = readBusyTimes(calendar(
    ['UID:long', 'DTSTART;VALUE=DATE:20260921', 'DTEND;VALUE=DATE:20260926', 'RRULE:FREQ=WEEKLY;COUNT=2'],
  ), MEXICO);
  assert.deepEqual(reach.busy, [{ start: '2026-10-01T00:00', end: '2026-10-03T00:00' }]);
});

void test('times are clipped to the window, and overlapping or touching times merge', () => {
  const { busy } = readBusyTimes(calendar(
    ['UID:night', 'DTSTART:20260930T220000', 'DTEND:20261001T020000'],
    ['UID:a', 'DTSTART:20261002T090000', 'DTEND:20261002T100000'],
    ['UID:b', 'DTSTART:20261002T093000', 'DTEND:20261002T110000'],
    ['UID:c', 'DTSTART:20261002T110000', 'DTEND:20261002T120000'],
    ['UID:late', 'DTSTART:20270331T230000', 'DTEND:20270401T010000'],
  ), MEXICO);
  assert.deepEqual(busy, [
    { start: '2026-10-01T00:00', end: '2026-10-01T02:00' },
    { start: '2026-10-02T09:00', end: '2026-10-02T12:00' },
    { start: '2027-03-31T23:00', end: '2027-04-01T00:00' },
  ]);
});

void test('the hours clocks repeat or skip keep events whole', () => {
  // 01:30 EDT to 01:15 EST is 45 minutes, though its end reads earlier.
  const fallBack = readBusyTimes(
    calendar(['UID:f', 'DTSTART:20261101T053000Z', 'DTEND:20261101T061500Z']),
    { zone: 'America/New_York', from: '2026-10-01', to: '2026-12-31' },
  );
  assert.deepEqual(fallBack.busy, [{ start: '2026-11-01T01:30', end: '2026-11-01T02:15' }]);

  // 01:30 happens twice on 2026-11-01 in New York: the first one counts.
  const repeated = readBusyTimes(
    calendar(['UID:r', 'DTSTART;TZID=America/New_York:20261101T013000', 'DTEND;TZID=America/New_York:20261101T020000']),
    { zone: 'UTC', from: '2026-10-01', to: '2026-12-31' },
  );
  assert.deepEqual(repeated.busy, [{ start: '2026-11-01T05:30', end: '2026-11-01T07:00' }]);

  // 02:30 never happens on 2027-03-14 in New York: it moves to 03:30.
  const skipped = readBusyTimes(
    calendar(['UID:s', 'DTSTART;TZID=America/New_York:20270314T023000', 'DTEND;TZID=America/New_York:20270314T040000']),
    { zone: 'America/New_York', from: '2027-03-01', to: '2027-03-31' },
  );
  assert.deepEqual(skipped.busy, [{ start: '2027-03-14T03:30', end: '2027-03-14T04:00' }]);
});

void test('folded lines, bare line feeds and alarms inside events parse correctly', () => {
  const text = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:folded',
    'DTSTART;TZID=America/Mexico_City:2026101',
    ' 4T080000',
    'DTEND;TZID=America/Mexico_City:20261014T090000',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'DURATION:PT5M',
    'REPEAT:2',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n');
  assert.deepEqual(readBusyTimes(text, MEXICO).busy, [{ start: '2026-10-14T08:00', end: '2026-10-14T09:00' }]);
});

void test('limits: size, events and busy times', () => {
  assert.throws(() => readBusyTimes('x'.repeat(CALENDAR_LIMITS.maxBytes + 1), MEXICO), (error: unknown) => error instanceof CalendarError && error.reason === 'too_large');
  assert.throws(() => readBusyTimes('hello', MEXICO), (error: unknown) => error instanceof CalendarError && error.reason === 'not_a_calendar');
  const many = calendar(...Array.from({ length: CALENDAR_LIMITS.maxEvents + 1 }, () => ['DTSTART:20261005T150000Z']));
  assert.throws(() => readBusyTimes(many, MEXICO), (error: unknown) => error instanceof CalendarError && error.reason === 'too_many_events');

  // Twelve daily one-hour events over 182 days make 2,184 busy times.
  const hourly = calendar(...Array.from({ length: 12 }, (_, slot) => {
    const hour = String(slot * 2).padStart(2, '0');
    return [`UID:h${slot}`, `DTSTART:20261001T${hour}0000`, `DTEND:20261001T${hour}5900`, 'RRULE:FREQ=DAILY'];
  }));
  const { busy, summary } = readBusyTimes(hourly, MEXICO);
  assert.equal(busy.length, CALENDAR_LIMITS.maxIntervals);
  assert.equal(summary.truncated, true);
  assert.deepEqual(busy[0], { start: '2026-10-01T00:00', end: '2026-10-01T00:59' });
  // The earliest are kept: day 166 (2027-03-16), slot 7 (14:00).
  assert.deepEqual(busy[busy.length - 1], { start: '2027-03-16T14:00', end: '2027-03-16T14:59' });
});
