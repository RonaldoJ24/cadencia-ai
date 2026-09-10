import {
  buildPlan,
  markDone,
  replan,
  type Intent,
  type Locale,
  type RoutinePlan,
} from './routine.ts';

export type WeekExample = 'with-room' | 'full';

// A fixed, explicitly labelled example keeps the interaction reproducible.
// Content is authored here; dates and changes use the product's real planner.
const intents: Record<Locale, Intent> = {
  en: {
    title: 'English for interviews',
    goal: 'Practice clear answers for an interview.',
    domain: 'learning',
    steps: [
      {
        title: 'Introduce yourself clearly',
        instructions: 'Rehearse a short introduction about your experience.',
      },
      {
        title: 'Tell one experience',
        instructions:
          'Explain a situation, your decision, and what you learned.',
      },
      {
        title: 'Rehearse an interview',
        instructions: 'Answer three questions aloud and review one response.',
      },
    ],
  },
  es: {
    title: 'Inglés para entrevistas',
    goal: 'Practicar respuestas claras en una entrevista.',
    domain: 'learning',
    steps: [
      {
        title: 'Presentarte con claridad',
        instructions: 'Ensaya una presentación breve sobre tu experiencia.',
      },
      {
        title: 'Contar una experiencia',
        instructions: 'Explica una situación, tu decisión y lo que aprendiste.',
      },
      {
        title: 'Ensayar una entrevista',
        instructions:
          'Responde tres preguntas en voz alta y revisa una respuesta.',
      },
    ],
  },
};

export function createWeekExample(
  example: WeekExample,
  locale: Locale = 'es',
): RoutinePlan {
  const plan = buildPlan(
    {
      request: locale === 'en' ? 'Practice English for job interviews' : 'Practicar inglés para entrevistas',
      days: example === 'with-room' ? [0, 1, 2, 3] : [0, 1, 2],
      sessionMinutes: 30,
      weeklyMinutes: 90,
      startDate: '2026-08-31',
      time: '18:00',
    },
    intents[locale],
    'demo',
    undefined,
    locale,
  );
  return markDone(plan, plan.sessions[0].id);
}

export function missExampleTuesday(plan: RoutinePlan): RoutinePlan {
  const tuesday = plan.sessions.find((session) => session.dayIndex === 1);
  if (!tuesday) throw new Error('El ejemplo no contiene una sesión el martes.');
  return replan(plan, tuesday.id);
}
