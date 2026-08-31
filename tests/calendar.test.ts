import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlan,
  replan,
  type Intent,
  type RoutineInput,
  type RoutinePlan,
} from '../lib/routine.ts';
import { googleCalendarUrl, routineShareText } from '../lib/calendar.ts';

const input: RoutineInput = {
  request: 'practicar acuarela',
  days: [0, 2],
  sessionMinutes: 45,
  weeklyMinutes: 90,
  startDate: '2026-08-31',
  time: '18:00',
};

const intent: Intent = {
  title: 'Acuarela 🎨 & luz',
  goal: 'Crear una muestra breve.',
  domain: 'creative',
  steps: [{ title: 'Boceto', instructions: 'Línea 1, café 🎨\nLínea 2.' }],
};

void test('calendar URL encodes one local event, details, and the IANA timezone', () => {
  const plan = buildPlan(input, intent);
  const session = plan.sessions[0];
  const parsed = new URL(
    googleCalendarUrl(plan, session, 'America/Mexico_City'),
  );

  assert.equal(parsed.origin, 'https://calendar.google.com');
  assert.equal(parsed.pathname, '/calendar/render');
  assert.equal(parsed.searchParams.get('action'), 'TEMPLATE');
  assert.equal(parsed.searchParams.get('text'), session.title);
  assert.equal(
    parsed.searchParams.get('dates'),
    '20260831T180000/20260831T184500',
  );
  assert.equal(parsed.searchParams.get('details'), session.instructions);
  assert.equal(parsed.searchParams.get('ctz'), 'America/Mexico_City');
  assert.match(parsed.href, /%F0%9F%8E%A8/u);
});

void test('calendar URL rejects invalid IANA zones and missed sessions', () => {
  const plan = buildPlan(input, intent);
  const session = plan.sessions[0];
  assert.throws(
    () => googleCalendarUrl(plan, session, 'Mars/Olympus'),
    /Zona horaria IANA inválida/u,
  );

  const missedPlan = replan(
    buildPlan({ ...input, days: [0, 1], weeklyMinutes: 90 }, intent),
    session.id,
  );
  const missed = missedPlan.sessions.find((item) => item.id === session.id);
  assert.ok(missed);
  assert.throws(
    () => googleCalendarUrl(missedPlan, missed, 'UTC'),
    /sesión perdida/u,
  );
});

void test('share text contains title, cadence, active session summaries, and no provider metadata', () => {
  const plan = buildPlan(input, intent);
  const livePlan: RoutinePlan = {
    ...plan,
    mode: 'deepseek',
    explanation: 'DeepSeek API key=secret',
  };
  const share = routineShareText(livePlan);

  assert.match(share, /Acuarela 🎨 & luz/u);
  assert.match(
    share,
    /Cadencia: lunes, miércoles · 18:00 · 45 min por sesión · 90 min semanales/u,
  );
  for (const session of plan.sessions) {
    assert.match(share, new RegExp(session.date, 'u'));
    assert.match(
      share,
      new RegExp(session.title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    );
  }
  assert.match(share, /Línea 1, café 🎨/u);
  assert.doesNotMatch(share, /DeepSeek|API key|secret/iu);
  assert.ok(Array.from(share).length <= 8_000);
});

void test('share text omits missed sessions', () => {
  const plan = buildPlan({ ...input, days: [0] }, intent);
  const missedPlan: RoutinePlan = {
    ...plan,
    sessions: plan.sessions.map((session) => ({
      ...session,
      status: 'missed' as const,
    })),
  };
  const share = routineShareText(missedPlan);
  assert.match(share, /No hay sesiones programadas/u);
  assert.doesNotMatch(share, /2026-08-31/u);
});
