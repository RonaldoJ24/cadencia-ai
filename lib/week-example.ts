import {
  buildPlan,
  markDone,
  replan,
  type Intent,
  type RoutinePlan,
} from './routine.ts';

export type WeekExample = 'with-room' | 'full';

// A fixed, explicitly labelled example keeps the interaction reproducible.
// Content is authored here; dates and changes use the product's real planner.
const intent: Intent = {
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
};

export function createWeekExample(example: WeekExample): RoutinePlan {
  const plan = buildPlan(
    {
      request: 'Practicar inglés para entrevistas',
      days: example === 'with-room' ? [0, 1, 2, 3] : [0, 1, 2],
      sessionMinutes: 30,
      weeklyMinutes: 90,
      startDate: '2026-08-31',
      time: '18:00',
    },
    intent,
    'demo',
  );
  return markDone(plan, plan.sessions[0].id);
}

export function missExampleTuesday(plan: RoutinePlan): RoutinePlan {
  const tuesday = plan.sessions.find((session) => session.dayIndex === 1);
  if (!tuesday) throw new Error('El ejemplo no contiene una sesión el martes.');
  return replan(plan, tuesday.id);
}
