import type { RoutinePlan } from './routine.ts';

export type RoutineInsights = {
  capacity: string;
  fourWeekProjection: string;
  clarifyingQuestions: string[];
  successSignals: string[];
  recommendation: string;
};

const MAX_INSIGHT_TEXT = 360;

function bounded(value: string): string {
  return value.slice(0, MAX_INSIGHT_TEXT);
}

function activeSessions(plan: RoutinePlan): RoutinePlan['sessions'] {
  return plan.sessions.filter((session) => session.status !== 'missed');
}

function minutesIn(sessions: RoutinePlan['sessions']): number {
  return sessions.reduce((total, session) => total + session.minutes, 0);
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function hasHorizon(request: string): boolean {
  return [
    /\b(?:esta|este|la proxima|proximas?|siguiente)\s+(?:semana|mes|trimestre|ano)\b/u,
    /\b(?:al final|a final|fin)\s+(?:de\s+la\s+)?(?:semana|mes|trimestre|ano)\b/u,
    /\b(?:durante|por|en|dentro de)\s+(?:las?\s+)?(?:proximas?\s+)?(?:un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\s+(?:semanas?|mes(?:es)?|trimestres?|anos?)\b/u,
    /\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/u,
    /\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/u,
    /\b(?:this|next|last)\s+(?:week|month|quarter|year)\b/u,
    /\b(?:in|within|for|over)\s+(?:the\s+)?(?:next\s+)?(?:one|a|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:weeks?|months?|quarters?|years?)\b/u,
  ].some((pattern) => pattern.test(request));
}

function hasLevel(request: string): boolean {
  return /\b(?:desde cero|sin experiencia|ninguna? experiencia|principiante|novato|inicial|basico|intermedio|avanzado|nivel\s+(?:inicial|basico|intermedio|avanzado|\d+)|ya se|ya conozco|tengo (?:algo|poca|mucha)?\s*experiencia|llevo\s+\S+\s+(?:ano|anos|mes|meses)|from scratch|beginner|novice|basic|intermediate|advanced|zero experience|no experience|some experience|level\s+\d+)/u.test(
    request,
  );
}

function hasEvidence(
  request: string,
  domain: RoutinePlan['intent']['domain'],
): boolean {
  const patterns = {
    learning:
      /\b(?:ejercicio|problema|proyecto|examen|certificacion|tema|concepto|explicar|aplicar|resolver|demostrar|portafolio|resultado|evidencia|conversar)\b/u,
    creative:
      /\b(?:pieza|muestra|boceto|obra|ilustracion|cancion|cuento|poema|novela|diseno|portafolio|version|publicar|exhibir)\b/u,
    general:
      /\b(?:resultado|entregable|tarea|documento|lista|plan|proyecto|entregar|terminar|decision|siguiente paso)\b/u,
  };
  return patterns[domain].test(request);
}

function hasFormat(request: string): boolean {
  return /\b(?:acuarela|oleo|digital|lapiz|tinta|arcilla|camara|audio|video|fotografia|musica|cuento|poema|novela|ilustracion|diseno|formato|material|papel|lienzo|instrumento|software|app)\b/u.test(
    request,
  );
}

function hasConstraint(request: string): boolean {
  return /\b(?:limite|restriccion|presupuesto|bloqueo|bloqueado|dependencia|prioridad|tiempo|disponible|minutos?|horas?|dias?|semanas?|deadline|constraint)\b/u.test(
    request,
  );
}

function outOfScope(plan: RoutinePlan): boolean {
  return (
    plan.sessions.length === 0 &&
    (plan.intent.title === 'Solicitud fuera de alcance' ||
      plan.warnings.some((warning) =>
        /fuera de alcance/u.test(normalize(warning)),
      ))
  );
}

function clarifyingQuestions(plan: RoutinePlan): string[] {
  if (outOfScope(plan)) return [];

  const request = normalize(plan.input.request);
  const questions: string[] = [];
  if (!hasHorizon(request))
    questions.push('¿Qué horizonte quieres usar para revisar el avance?');

  if (plan.intent.domain === 'learning') {
    if (!hasLevel(request))
      questions.push('¿Qué puedes hacer ya con este tema?');
    if (!hasEvidence(request, 'learning'))
      questions.push('¿Qué evidencia pequeña mostraría tu avance?');
  } else if (plan.intent.domain === 'creative') {
    if (!hasFormat(request)) questions.push('¿Qué formato o material usarás?');
    if (!hasEvidence(request, 'creative'))
      questions.push('¿Qué pieza o muestra guardarás para revisar el avance?');
  } else {
    if (!hasEvidence(request, 'general'))
      questions.push('¿Qué resultado concreto revisarás al cierre?');
    if (!hasConstraint(request))
      questions.push('¿Qué límite o dependencia debemos tener presente?');
  }
  return questions.slice(0, 3).map(bounded);
}

function successSignals(
  plan: RoutinePlan,
  sessions: RoutinePlan['sessions'],
): string[] {
  if (sessions.length === 0) {
    if (outOfScope(plan)) {
      return [
        'No hay sesiones programadas esta semana, así que no hay una señal de progreso que observar.',
        'Tras reformular la solicitud dentro del alcance, registra una evidencia concreta al cerrar cada sesión.',
      ];
    }
    return [
      'No hay sesiones programadas esta semana; todavía no hay práctica observable que revisar.',
      'Cuando exista una sesión, guarda una evidencia concreta al cerrar el bloque.',
    ];
  }

  if (plan.intent.domain === 'learning') {
    return [
      'Puedes explicar con tus propias palabras el concepto trabajado.',
      'Resuelves o produces un ejercicio breve sin copiar el ejemplo.',
      'Anotas una duda concreta para la siguiente sesión.',
    ];
  }
  if (plan.intent.domain === 'creative') {
    return [
      'Guardas una versión fechada de la pieza o del boceto.',
      'Puedes señalar una decisión de técnica o enfoque que probaste.',
      'Comparas dos versiones y nombras qué cambiarías.',
    ];
  }
  return [
    'Dejas un resultado pequeño y verificable al cerrar la sesión.',
    'Anotas el siguiente paso concreto y cualquier bloqueo.',
    'Revisas al final de la semana qué sesiones se completaron y qué quedó pendiente.',
  ];
}

function recommendation(
  plan: RoutinePlan,
  selectedDays: number,
  schedulableSessions: number,
  sessions: RoutinePlan['sessions'],
): string {
  if (selectedDays > schedulableSessions) {
    const excess = selectedDays - schedulableSessions;
    return bounded(
      `Hay un desfase de capacidad: elegiste ${selectedDays} días, pero el tope permite ${schedulableSessions} sesiones de ${plan.input.sessionMinutes} min. Deja ${excess} día${excess === 1 ? '' : 's'} fuera o ajusta el tope semanal antes de continuar.`,
    );
  }
  if (sessions.length === 0) {
    return outOfScope(plan)
      ? 'No hay sesiones que revisar; reformula la solicitud dentro del alcance antes del próximo check-in.'
      : 'No hay sesiones programadas para revisar; aclara el objetivo y vuelve a generar el plan antes del próximo check-in.';
  }
  return 'Haz un check-in breve al final de la semana: marca las sesiones realizadas y anota qué facilitó o bloqueó el siguiente paso.';
}

export function buildInsights(plan: RoutinePlan): RoutineInsights {
  const sessions = activeSessions(plan);
  const selectedDays = plan.input.days.length;
  const scheduledSessions = sessions.length;
  const weeklyMinutes = minutesIn(sessions);
  const schedulableSessions = Math.floor(
    plan.input.weeklyMinutes / plan.input.sessionMinutes,
  );
  const fourWeekMinutes = weeklyMinutes * 4;

  return {
    capacity: bounded(
      `Elegiste ${selectedDays} ${selectedDays === 1 ? 'día' : 'días'} y el plan contiene ${scheduledSessions} ${scheduledSessions === 1 ? 'sesión programada' : 'sesiones programadas'}; suman ${weeklyMinutes} min semanales frente al tope de ${plan.input.weeklyMinutes} min.`,
    ),
    fourWeekProjection: bounded(
      `${fourWeekMinutes} min de tiempo de práctica disponible en cuatro semanas (${weeklyMinutes} min por semana × 4); es una proyección de tiempo, no una promesa de éxito.`,
    ),
    clarifyingQuestions: clarifyingQuestions(plan),
    successSignals: successSignals(plan, sessions).slice(0, 3).map(bounded),
    recommendation: recommendation(
      plan,
      selectedDays,
      schedulableSessions,
      sessions,
    ),
  };
}
