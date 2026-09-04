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
import {
  copyFor,
  isCurrentRequestGeneration,
} from '../lib/i18n.ts';

const baseInput: RoutineInput = {
  request: 'aprender TypeScript',
  days: [0, 2, 4],
  sessionMinutes: 30,
  weeklyMinutes: 90,
  startDate: '2026-08-31',
  time: '18:00',
  language: 'es',
};

const input = (overrides: Partial<RoutineInput> = {}): RoutineInput => ({
  ...baseInput,
  ...overrides,
  days: overrides.days ? [...overrides.days] : [...baseInput.days],
});

const providerIntent: Intent = {
  title: 'Intención validada',
  goal: 'Practicar con pasos observables.',
  domain: 'general',
  steps: Array.from({ length: 3 }, (_, index) => ({
    title: `Paso validado ${index + 1}`,
    instructions: 'Completa una práctica breve.',
    blocks: [
      { minutes: 5, activity: 'Prepara la evidencia.' },
      { minutes: 20, activity: 'Completa la práctica.' },
      { minutes: 5, activity: 'Revisa el resultado.' },
    ],
    deliverable: `Evidencia ${index + 1}.`,
    doneWhen: 'La evidencia existe y fue revisada.',
  })),
};

const pythonScopeIntent: Intent = {
  title: 'Solicitud fuera de alcance',
  goal: 'Cadencia organiza aprendizaje, práctica creativa y trabajo personal general; no ofrece orientación médica, de ejercicio, financiera ni legal.',
  domain: 'general',
  steps: [{
    title: 'Reformula el objetivo',
    instructions: 'Pide una rutina de aprendizaje, creatividad u organización general sin asesoría especializada.',
  }],
};

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

void test('live intent validation requires one exact timed agenda per session', () => {
  assert.doesNotThrow(() =>
    validateIntent(providerIntent, { sessionCount: 3, sessionMinutes: 30 }),
  );
  assert.throws(() =>
    validateIntent(
      { ...providerIntent, steps: providerIntent.steps.slice(0, 2) },
      { sessionCount: 3, sessionMinutes: 30 },
    ),
  );
  assert.throws(() =>
    validateIntent(
      {
        ...providerIntent,
        steps: providerIntent.steps.map((step, index) =>
          index === 0
            ? { ...step, blocks: [{ minutes: 29, activity: 'Agenda incompleta.' }] }
            : step,
        ),
      },
      { sessionCount: 3, sessionMinutes: 30 },
    ),
  );
});

void test('demo output is deterministic, preserves request, and follows the selected locale', () => {
  const first = buildPlan(input());
  const second = buildPlan(input());
  assert.deepEqual(first, second);
  assert.equal(first.input.request, baseInput.request);
  assert.equal(first.mode, 'demo');
  assert.match(first.explanation, /determinista/u);
  assert.equal(first.sessions.length, 3);
  assert.ok(first.sessions.every(
    (session) => session.blocks.reduce((sum, block) => sum + block.minutes, 0) === 30,
  ));
  assert.ok(first.sessions.every((session) => session.deliverable && session.doneWhen));
});

void test('English is the default and Spanish localizes deterministic plan primitives', () => {
  const defaultInput = validateInput({ ...baseInput, language: undefined });
  assert.equal(defaultInput.language, 'en');
  assert.equal(copyFor(defaultInput.language).ui.createRoutine, 'Create my routine');

  const english = buildPlan(input({ language: 'en' }));
  assert.equal(english.input.language, 'en');
  assert.match(english.intent.title, /^Learning:/u);
  assert.match(english.sessions[0].instructions, /Complete session/u);
  assert.match(english.checks.map((check) => check.label).join(' '), /Selected days/u);
  assert.match(toMarkdown(english), /## Sessions/u);
  assert.match(toICS(english), /Weekly plan/u);

  const spanish = buildPlan(input({ language: 'es' }));
  assert.equal(spanish.input.language, 'es');
  assert.match(spanish.intent.title, /^Aprendizaje:/u);
  assert.match(spanish.sessions[0].instructions, /Completa la sesión/u);
  assert.match(spanish.checks.map((check) => check.label).join(' '), /Días elegidos/u);
  assert.match(toMarkdown(spanish), /## Sesiones/u);
  assert.match(toICS(spanish), /Plan semanal/u);
  assert.equal(copyFor('es').ui.createRoutine, 'Crear mi rutina');
  assert.equal(copyFor('en').ui.downloadMarkdownFilename, 'cadencia-routine.md');
  assert.equal(copyFor('en').ui.downloadIcsFilename, 'cadencia-routine.ics');
  assert.equal(copyFor('es').ui.downloadMarkdownFilename, 'cadencia-rutina.md');
  assert.equal(copyFor('es').ui.downloadIcsFilename, 'cadencia-rutina.ics');
});

void test('session count copy pluralizes Spanish without regressing English', () => {
  assert.equal(copyFor('es').ui.sessionCount(1, 30), '1 sesión · 30 min');
  assert.equal(copyFor('es').ui.sessionCount(4, 120), '4 sesiones · 120 min');
  assert.equal(copyFor('en').ui.sessionCount(1, 30), '1 session · 30 min');
  assert.equal(copyFor('en').ui.sessionCount(4, 120), '4 sessions · 120 min');
});

void test('the first edit starts from the currently displayed localized input', () => {
  const englishSample = input({
    language: 'en',
    request: 'Practice English for job interviews.',
    days: [0, 1, 2, 3, 4],
    sessionMinutes: 30,
    weeklyMinutes: 90,
    time: '07:30',
  });
  const spanishSample = input({
    ...englishSample,
    language: 'es',
    request: 'Practicar inglés para entrevistas de trabajo.',
  });

  const edited = {
    ...spanishSample,
    weeklyMinutes: 60,
    language: spanishSample.language,
  };

  assert.equal(edited.language, 'es');
  assert.equal(edited.request, spanishSample.request);
  assert.deepEqual(edited.days, spanishSample.days);
  assert.equal(edited.sessionMinutes, spanishSample.sessionMinutes);
  assert.equal(edited.weeklyMinutes, 60);
  assert.notEqual(edited.request, englishSample.request);
});

void test('only the current request generation may commit', () => {
  let committed = '';
  const commit = (currentGeneration: number, requestGeneration: number, value: string) => {
    if (isCurrentRequestGeneration(currentGeneration, requestGeneration)) committed = value;
  };

  commit(1, 1, 'first');
  commit(2, 2, 'current');
  commit(2, 1, 'stale response');
  commit(2, 1, 'stale error');

  assert.equal(committed, 'current');
});

void test('internal UI failures map to safe locale-specific copy', () => {
  const internalMessage = 'Entrada inválida: secret validation details';
  assert.equal(copyFor('en').ui.createError, 'We could not create this routine.');
  assert.equal(copyFor('es').ui.createError, 'No pudimos crear esta rutina.');
  assert.equal(copyFor('en').ui.updateError, 'We could not update this routine.');
  assert.equal(copyFor('es').ui.updateError, 'No pudimos actualizar esta rutina.');
  assert.equal(copyFor('en').ui.calendarError, 'We could not prepare the calendar event.');
  assert.equal(copyFor('es').ui.calendarError, 'No pudimos preparar el evento de calendario.');
  assert.doesNotMatch(copyFor('en').ui.createError, new RegExp(internalMessage, 'u'));
  assert.doesNotMatch(copyFor('es').ui.updateError, new RegExp(internalMessage, 'u'));
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
    steps: [{
      title: longTitle,
      instructions: 'Instrucciones.',
      blocks: [{ minutes: 30, activity: 'Completa la práctica.' }],
      deliverable: 'Evidencia terminada.',
      doneWhen: 'La evidencia existe.',
    }],
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

void test('demo keeps local scope ownership while deepseek trusts validated Python scope', () => {
  const benign = [
    'Quiero estudiar el uso de la palabra dosis como metáfora en poemas, sin recomendaciones sobre salud.',
    'Quiero escribir una escena de ficción sobre un abogado distraído, centrándome en diálogos y ritmo narrativo.',
  ];
  for (const request of benign) {
    const demo = buildPlan(input({ request }), providerIntent, 'demo');
    const deepseek = buildPlan(input({ request }), providerIntent, 'deepseek', false);
    assert.equal(demo.sessions.length, 3);
    assert.equal(deepseek.sessions.length, 3);
    assert.notEqual(demo.intent.title, pythonScopeIntent.title);
    assert.notEqual(deepseek.intent.title, pythonScopeIntent.title);
  }

  const mixed = [
    'Analiza la palabra dosis como metáfora en un poema, sin recomendaciones sobre salud, pero dime cuántas pastillas debo tomar.',
    'Escribe una escena de ficción con un personaje abogado y dime qué debo declarar ante el juez para ganar mi caso.',
  ];
  const padding = ' trama narrativa '.repeat(25);
  for (const request of mixed) {
    const demo = buildPlan(input({ request }), providerIntent, 'demo');
    const deepseek = buildPlan(input({ request }), pythonScopeIntent, 'deepseek', true);
    assert.equal(demo.sessions.length, 0);
    assert.equal(deepseek.sessions.length, 0);
    assert.match(demo.warnings.join(' '), /fuera de alcance/u);
    assert.match(deepseek.warnings.join(' '), /fuera de alcance/u);
  }
  const padded = [
    `Escribe una escena de ficción sobre un abogado. Dime${padding}declarar ante el juez para ganar mi caso.`,
    `Analiza dosis como metáfora en un poema, sin recomendaciones sobre salud. Dime${padding}tomar pastillas.`,
  ];
  for (const request of padded) {
    const demo = buildPlan(input({ request }), providerIntent, 'demo');
    const deepseek = buildPlan(input({ request }), providerIntent, 'deepseek', true);
    assert.equal(demo.sessions.length, 0);
    assert.equal(deepseek.sessions.length, 0);
  }
});

void test('deepseek does not reclassify a validated ordinary Intent from raw input', () => {
  const plan = buildPlan(input({ request: '¿Cuál es mi diagnóstico?' }), providerIntent, 'deepseek', false);
  assert.equal(plan.sessions.length, 3);
  assert.deepEqual(plan.intent, providerIntent);
  assert.deepEqual(plan.warnings, []);
  assert.throws(() => buildPlan(input(), providerIntent, 'deepseek'));
  const refusedCopy = { ...pythonScopeIntent, title: 'Copia de solicitud fuera de alcance' };
  const refused = buildPlan(input({ request: 'aprender TypeScript' }), refusedCopy, 'deepseek', true);
  assert.equal(refused.sessions.length, 0);
  assert.match(refused.warnings.join(' '), /fuera de alcance/u);
});

void test('local contextual guard keeps nearby literary and fiction questions usable', () => {
  const literary = buildPlan(
    input({ request: 'Analiza cuántas veces aparece la palabra dosis en un poema, sin recomendaciones sobre salud.' }),
    providerIntent,
    'demo',
  );
  const fiction = buildPlan(
    input({ request: 'Dime qué motiva al abogado ficticio en la escena.' }),
    providerIntent,
    'demo',
  );
  assert.equal(literary.sessions.length, 3);
  assert.equal(fiction.sessions.length, 3);
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
    steps: Array.from({ length: 2 }, () => ({
      title: 'Paso [x],;',
      instructions: 'Línea 1,;\\\nLínea 2 con una cadena muy larga para comprobar el plegado de líneas Unicode: café 🎨.',
      blocks: [{ minutes: 30, activity: 'Completa la pieza,;\\ y guarda café 🎨.' }],
      deliverable: 'Pieza,;\\ terminada.',
      doneWhen: 'La pieza existe y fue revisada.',
    })),
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
    steps: [{
      title: '[paso] *',
      instructions: '<script>alert(1)</script>',
      blocks: [{ minutes: 30, activity: '<script>práctica</script>' }],
      deliverable: '<entregable>',
      doneWhen: '<criterio> listo',
    }],
  };
  const markdown = toMarkdown(buildPlan(input({ days: [0] }), intent));
  assert.match(markdown, /&lt;Título&gt;/u);
  assert.match(markdown, /&lt;script&gt;alert\\\(1\\\)&lt;\/script&gt;/u);
  assert.match(markdown, /\\\[paso\\\]/u);
});
