import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlan,
  demoIntent,
  markDone,
  replan,
  toICS,
  toMarkdown,
  validateInput,
  validateIntent,
  type Intent,
  type RoutineInput,
} from '../lib/routine.ts';

const baseInput: RoutineInput = {
  request: 'aprender TypeScript',
  days: [0, 2, 4],
  sessionMinutes: 30,
  weeklyMinutes: 90,
  startDate: '2026-08-31',
  time: '18:00',
};

const input = (overrides: Partial<RoutineInput> = {}): RoutineInput => ({
  ...baseInput,
  ...overrides,
  days: overrides.days ? [...overrides.days] : [...baseInput.days],
});

void test('validates bounded routine inputs and rejects malformed fixtures', () => {
  assert.deepEqual(validateInput(input()), input());
  const invalidInputs: unknown[] = [
    input({ request: '' }),
    input({ days: [-1] }),
    input({ days: [7] }),
    input({ days: [0, 0] }),
    input({ sessionMinutes: Number.NaN }),
    input({ sessionMinutes: 30.5 }),
    input({ weeklyMinutes: 20 }),
    input({ weeklyMinutes: 10_081 }),
    input({ startDate: '2026-09-01' }),
    input({ startDate: '2026-02-30' }),
    input({ time: '12:99' }),
    input({ time: '23:50', sessionMinutes: 30 }),
  ];
  for (const candidate of invalidInputs) assert.throws(() => validateInput(candidate));
});

void test('validates intent shape and accepts Unicode content', () => {
  const intent = {
    title: 'Crear una pieza 🎨',
    goal: 'Terminar una muestra breve.',
    domain: 'creative',
    steps: [{ title: 'Boceto', instructions: 'Prueba una versión y guárdala.' }],
  } as const;
  assert.deepEqual(validateIntent(intent), intent);
  assert.throws(() => validateIntent({ ...intent, domain: 'medical' }));
  assert.throws(() => validateIntent({ ...intent, steps: [] }));
});

void test('demo output is deterministic, Spanish first, and preserves request', () => {
  const first = buildPlan(input());
  const second = buildPlan(input());
  assert.deepEqual(first, second);
  assert.equal(first.input.request, baseInput.request);
  assert.equal(first.mode, 'demo');
  assert.match(first.explanation, /determinista/u);
  assert.equal(first.sessions.length, 3);
});

void test('fixture cases cover the three supported domains without model claims', () => {
  const fixtures: Array<{ request: string; domain: Intent['domain'] }> = [
    { request: 'aprender inglés', domain: 'learning' },
    { request: 'estudiar álgebra', domain: 'learning' },
    { request: 'leer un ensayo', domain: 'learning' },
    { request: 'practicar programación', domain: 'learning' },
    { request: 'aprender un idioma', domain: 'learning' },
    { request: 'pintar acuarela', domain: 'creative' },
    { request: 'dibujar retratos', domain: 'creative' },
    { request: 'escribir cuentos', domain: 'creative' },
    { request: 'practicar música', domain: 'creative' },
    { request: 'crear un collage', domain: 'creative' },
    { request: 'ordenar mis notas', domain: 'general' },
    { request: 'preparar una presentación', domain: 'general' },
    { request: 'organizar un proyecto personal', domain: 'general' },
    { request: 'hacer una revisión semanal', domain: 'general' },
    { request: 'avanzar en una idea', domain: 'general' },
  ];
  assert.equal(fixtures.length, 15);
  for (const fixture of fixtures) {
    const result = demoIntent(fixture.request);
    assert.equal(result.domain, fixture.domain);
    assert.ok(result.steps.length > 0);
    assert.doesNotMatch(result.goal, /benchmark|precisión|accuracy/iu);
  }
});

void test('schedules only selected weekdays and enforces the weekly budget', () => {
  const plan = buildPlan(input({ days: [1, 3], weeklyMinutes: 90, sessionMinutes: 45 }));
  assert.deepEqual(plan.sessions.map((session) => [session.date, session.dayIndex]), [
    ['2026-09-01', 1],
    ['2026-09-03', 3],
  ]);
  assert.equal(plan.sessions.reduce((total, session) => total + session.minutes, 0), 90);
  assert.ok(plan.checks.every((check) => check.passed));
});

void test('reports partial capacity honestly when the cap leaves selected days unscheduled', () => {
  const plan = buildPlan(input({ days: [0, 1, 2], weeklyMinutes: 60 }));
  assert.equal(plan.sessions.length, 2);
  assert.match(plan.warnings.join(' '), /permite 2 de 3/u);
  assert.ok(plan.checks.find((check) => check.label === 'Tope semanal')?.passed);
});

void test('long valid step titles remain valid after session prefixing', () => {
  const longTitle = 'x'.repeat(160);
  const intent: Intent = {
    title: 'Título',
    goal: 'Objetivo',
    domain: 'general',
    steps: [{ title: longTitle, instructions: 'Instrucciones.' }],
  };
  const plan = buildPlan(input({ days: [0] }), intent);
  assert.equal(plan.sessions[0].title.length, 160);
  assert.doesNotThrow(() => toMarkdown(plan));
  assert.doesNotThrow(() => markDone(plan, plan.sessions[0].id));
});

void test('scope guard refuses specialized requests instead of creating advice sessions', () => {
  const restricted = buildPlan(input({ request: 'rutina de ejercicio para ganar músculo' }));
  assert.equal(restricted.sessions.length, 0);
  assert.match(restricted.warnings.join(' '), /fuera de alcance/u);
  assert.match(restricted.intent.goal, /no ofrece orientación/u);
  assert.equal(demoIntent('I will learn TypeScript').domain, 'learning');
  assert.equal(demoIntent('painting landscapes').domain, 'creative');
  assert.equal(demoIntent('revisar fracciones').domain, 'general');
});

void test('markDone returns an immutable plan and preserves the original status', () => {
  const plan = buildPlan(input({ days: [0, 2] }));
  const done = markDone(plan, plan.sessions[0].id);
  assert.equal(plan.sessions[0].status, 'planned');
  assert.equal(done.sessions[0].status, 'done');
  assert.notEqual(done, plan);
  assert.notEqual(done.sessions, plan.sessions);
  assert.throws(() => markDone(done, 'missing-session'));
});

void test('replan marks missed, preserves content, and uses a later free selected day', () => {
  const plan = buildPlan(input({ days: [0, 1, 2, 4], weeklyMinutes: 60 }));
  const missed = plan.sessions[0];
  const replanned = replan(plan, missed.id);
  const old = replanned.sessions.find((session) => session.id === missed.id);
  const replacement = replanned.sessions.find((session) => session.status === 'planned' && session.date === '2026-09-02');
  assert.equal(old?.status, 'missed');
  assert.equal(replacement?.date, '2026-09-02');
  assert.equal(replacement?.dayIndex, 2);
  assert.equal(replacement?.title, missed.title);
  assert.equal(replacement?.instructions, missed.instructions);
  assert.notEqual(replacement?.id, missed.id);
  assert.equal(plan.sessions[0].status, 'planned');
  assert.ok(replanned.checks.find((check) => check.label === 'Tope semanal')?.passed);
});

void test('replan keeps done sessions and warns when no free slot exists', () => {
  const plan = buildPlan(input({ days: [0, 1, 2], weeklyMinutes: 90 }));
  const done = markDone(plan, plan.sessions[0].id);
  const replanned = replan(done, done.sessions[1].id);
  assert.equal(replanned.sessions.find((session) => session.id === done.sessions[0].id)?.status, 'done');
  assert.equal(replanned.sessions.filter((session) => session.status === 'planned').length, 1);
  assert.ok(replanned.warnings.some((warning) => /no hay un día permitido/iu.test(warning)));
  assert.throws(() => replan(replanned, done.sessions[1].id));
});

void test('ICS is local floating, namespaced, escaped, folded, and excludes missed sessions', () => {
  const intent: Intent = {
    title: '<Rutina>,;\\',
    goal: 'Objetivo',
    domain: 'general',
    steps: [{ title: 'Paso [x],;', instructions: 'Línea 1,;\\\nLínea 2 con una cadena muy larga para comprobar el plegado de líneas Unicode: café 🎨.' }],
  };
  const plan = buildPlan(input({ request: 'escribir una pieza', days: [0, 1], weeklyMinutes: 60 }), intent);
  const missed = replan(plan, plan.sessions[0].id);
  const ics = toICS(missed);
  assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/u);
  assert.match(ics, /DTSTART:20260901T180000\r?\n/u);
  assert.doesNotMatch(ics, /DTSTART:[^\r\n]*Z/u);
  assert.match(ics, /SUMMARY:[^\r\n]*\\,[^\r\n]*\\;/u);
  assert.match(ics, /DESCRIPTION:[^\r\n]*\\n/u);
  assert.match(ics, /UID:routine-[0-9a-f]{8}-session-/u);
  for (const line of ics.split('\r\n').filter(Boolean)) {
    assert.ok(new TextEncoder().encode(line).byteLength <= 75, `ICS line too long: ${line}`);
  }
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
});

void test('Markdown exports generated content as text, including escaped session title', () => {
  const intent: Intent = {
    title: '<Título>',
    goal: 'Objetivo',
    domain: 'general',
    steps: [{ title: '[paso] *', instructions: '<script>alert(1)</script>' }],
  };
  const markdown = toMarkdown(buildPlan(input({ days: [0] }), intent));
  assert.match(markdown, /&lt;Título&gt;/u);
  assert.match(markdown, /&lt;script&gt;alert\\\(1\\\)&lt;\/script&gt;/u);
  assert.match(markdown, /\\\[paso\\\]/u);
});
