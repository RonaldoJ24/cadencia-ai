import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights } from '../lib/insights.ts';
import { buildPlan, type RoutineInput } from '../lib/routine.ts';

const baseInput: RoutineInput = {
  request: 'aprender TypeScript',
  days: [0, 2, 4],
  sessionMinutes: 30,
  weeklyMinutes: 90,
  startDate: '2026-08-31',
  time: '18:00',
};

function plan(overrides: Partial<RoutineInput> = {}) {
  return buildPlan({
    ...baseInput,
    ...overrides,
    days: overrides.days ?? [...baseInput.days],
  });
}

void test('explica una cadencia de aprendizaje y pide horizonte y nivel cuando faltan', () => {
  const insights = buildInsights(plan());
  assert.match(
    insights.capacity,
    /3 días.*3 sesiones programadas.*90 min semanales/u,
  );
  assert.match(
    insights.fourWeekProjection,
    /360 min.*tiempo de práctica disponible.*no una promesa de éxito/u,
  );
  assert.equal(insights.clarifyingQuestions.length, 3);
  assert.match(insights.clarifyingQuestions.join(' '), /horizonte/u);
  assert.match(insights.clarifyingQuestions.join(' '), /puedes hacer ya/u);
  assert.match(insights.clarifyingQuestions.join(' '), /evidencia/u);
  assert.equal(insights.successSignals.length, 3);
  assert.match(insights.recommendation, /check-in/u);
});

void test('no repite preguntas de horizonte y nivel ya escritos en la solicitud', () => {
  const insights = buildInsights(
    plan({ request: 'aprender TypeScript desde cero en cuatro semanas' }),
  );
  const questions = insights.clarifyingQuestions.join(' ');
  assert.doesNotMatch(questions, /horizonte/u);
  assert.doesNotMatch(questions, /nivel|puedes hacer ya/u);
  assert.match(questions, /evidencia/u);
  assert.ok(insights.clarifyingQuestions.length <= 3);
});

void test('mantiene ambiguo un evento sin fecha ni duración', () => {
  const insights = buildInsights(
    plan({ request: 'Quiero aprender alemán para mi viaje a Zúrich pronto' }),
  );
  assert.match(insights.clarifyingQuestions.join(' '), /horizonte/u);
});

void test('prioriza el desfase cuando los días elegidos superan la capacidad semanal', () => {
  const insights = buildInsights(
    plan({ days: [0, 1, 2], sessionMinutes: 45, weeklyMinutes: 90 }),
  );
  assert.match(
    insights.capacity,
    /3 días.*2 sesiones programadas.*90 min semanales/u,
  );
  assert.match(insights.recommendation, /desfase de capacidad/u);
  assert.match(insights.recommendation, /2 sesiones/u);
  assert.doesNotMatch(insights.recommendation, /check-in/u);
});

void test('trata con honestidad un plan fuera de alcance sin sesiones', () => {
  const insights = buildInsights(
    plan({ request: 'rutina de ejercicio para ganar músculo' }),
  );
  assert.match(
    insights.capacity,
    /3 días.*0 sesiones programadas.*0 min semanales/u,
  );
  assert.match(
    insights.fourWeekProjection,
    /0 min.*disponible.*no una promesa de éxito/u,
  );
  assert.equal(insights.clarifyingQuestions.length, 0);
  assert.equal(insights.successSignals.length, 2);
  assert.match(insights.successSignals.join(' '), /No hay sesiones/u);
  assert.match(insights.recommendation, /dentro del alcance/u);
});
