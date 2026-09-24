// An independent check of a finished plan. It shares no scheduling code:
// weekdays, windows and overlaps are recomputed here from the raw dates, so a
// bug in the scheduler cannot hide itself. Tests and the evaluation use it.

import type { BusyInterval, GoalPlan } from './types.ts';

export type Rule =
  | 'in_range'
  | 'allowed_day'
  | 'in_window'
  | 'busy_overlap'
  | 'one_per_day'
  | 'weekly_cap'
  | 'duration'
  | 'blocks_sum'
  | 'rest_spacing'
  | 'week_membership'
  | 'draft_consistency';

export type Violation = { rule: Rule; detail: string; sessionId?: string; week?: number };

function epochMinutes(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00Z`) / 60_000;
}

function mondayBasedWeekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function checkPlan(plan: GoalPlan, busy: BusyInterval[]): Violation[] {
  const { spec, draft } = plan;
  const violations: Violation[] = [];
  const typeById = new Map(draft.sessionTypes.map((type) => [type.id, type]));
  const busyRanges = busy.map((interval) => [
    Date.parse(`${interval.start}:00Z`) / 60_000,
    Date.parse(`${interval.end}:00Z`) / 60_000,
  ]);
  const [windowStart, windowEnd] = [spec.window.start, spec.window.end].map((time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  });
  const perDay = new Map<string, number>();
  const hardDays: number[] = [];

  for (const week of plan.weeks) {
    const weekMinutes = week.sessions.reduce((total, session) => total + session.minutes, 0);
    if (weekMinutes > spec.weeklyCapMinutes) {
      violations.push({ rule: 'weekly_cap', week: week.week, detail: `${weekMinutes} > ${spec.weeklyCapMinutes}` });
    }
    const requested = [...(draft.weeks.find((entry) => entry.week === week.week)?.sessions ?? [])];
    for (const session of week.sessions) {
      const at = { sessionId: session.id, week: week.week };
      if (session.date < spec.startDate || session.date > spec.deadline) {
        violations.push({ rule: 'in_range', ...at, detail: session.date });
      }
      if (session.date < week.start || session.date > week.end || mondayBasedWeekday(week.start) !== 0) {
        violations.push({ rule: 'week_membership', ...at, detail: `${session.date} not in ${week.start}..${week.end}` });
      }
      if (!spec.days.includes(mondayBasedWeekday(session.date) as (typeof spec.days)[number])) {
        violations.push({ rule: 'allowed_day', ...at, detail: session.date });
      }
      const [hours, minutes] = session.start.split(':').map(Number);
      const start = hours * 60 + minutes;
      if (start < windowStart || start + session.minutes > windowEnd) {
        violations.push({ rule: 'in_window', ...at, detail: `${session.start} + ${session.minutes} min` });
      }
      const begin = epochMinutes(session.date, session.start);
      const end = begin + session.minutes;
      if (busyRanges.some(([busyStart, busyEnd]) => begin < busyEnd && busyStart < end)) {
        violations.push({ rule: 'busy_overlap', ...at, detail: `${session.date} ${session.start}` });
      }
      perDay.set(session.date, (perDay.get(session.date) ?? 0) + 1);
      const type = typeById.get(session.typeId);
      if (!type || type.minutes !== session.minutes) {
        violations.push({ rule: 'duration', ...at, detail: `${session.typeId}: ${session.minutes} min` });
      }
      if (session.blocks.reduce((total, block) => total + block.minutes, 0) !== session.minutes) {
        violations.push({ rule: 'blocks_sum', ...at, detail: session.id });
      }
      const slot = requested.indexOf(session.typeId);
      if (slot === -1) violations.push({ rule: 'draft_consistency', ...at, detail: `${session.typeId} not requested` });
      else requested.splice(slot, 1);
      if (spec.domain === 'fitness' && session.intensity === 'hard') {
        hardDays.push(Date.parse(`${session.date}T00:00:00Z`) / 86_400_000);
      }
    }
  }

  for (const [date, count] of perDay) {
    if (count > 1) violations.push({ rule: 'one_per_day', detail: `${date}: ${count} sessions` });
  }
  hardDays.sort((a, b) => a - b);
  for (let index = 1; index < hardDays.length; index += 1) {
    if (hardDays[index] - hardDays[index - 1] <= 1) {
      violations.push({ rule: 'rest_spacing', detail: `hard sessions on consecutive days (${hardDays[index - 1]}, ${hardDays[index]})` });
    }
  }
  return violations;
}
