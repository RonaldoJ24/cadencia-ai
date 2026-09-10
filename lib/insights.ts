import type { Locale, RoutinePlan } from './routine.ts';

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
      /\b(?:ejercicio|problema|proyecto|examen|certificacion|tema|concepto|explicar|aplicar|resolver|demostrar|portafolio|resultado|evidencia|conversar|exercise|problem|project|exam|certification|topic|concept|explain|apply|solve|demonstrate|portfolio|result|evidence|conversation)\b/u,
    creative:
      /\b(?:pieza|muestra|boceto|obra|ilustracion|cancion|cuento|poema|novela|diseno|portafolio|version|publicar|exhibir|piece|sample|sketch|artwork|illustration|song|story|poem|novel|design|portfolio|version|publish|exhibit)\b/u,
    general:
      /\b(?:resultado|entregable|tarea|documento|lista|plan|proyecto|entregar|terminar|decision|siguiente paso|result|deliverable|task|document|list|plan|project|deliver|finish|decision|next step)\b/u,
  };
  return patterns[domain].test(request);
}

function hasFormat(request: string): boolean {
  return /\b(?:acuarela|oleo|digital|lapiz|tinta|arcilla|camara|audio|video|fotografia|musica|cuento|poema|novela|ilustracion|diseno|formato|material|papel|lienzo|instrumento|watercolor|oil|digital|pencil|ink|clay|camera|audio|video|photography|music|story|poem|novel|illustration|design|format|material|paper|canvas|instrument|software|app)\b/u.test(
    request,
  );
}

function hasConstraint(request: string): boolean {
  return /\b(?:limite|restriccion|presupuesto|bloqueo|bloqueado|dependencia|prioridad|tiempo|disponible|minutos?|horas?|dias?|semanas?|limit|restriction|budget|blocker|blocked|dependency|priority|time|available|minutes?|hours?|days?|weeks?|deadline|constraint)\b/u.test(
    request,
  );
}

function outOfScope(plan: RoutinePlan): boolean {
  return (
    plan.sessions.length === 0 &&
    (plan.intent.title === 'Solicitud fuera de alcance' ||
      plan.intent.title === 'Request outside the current scope' ||
      plan.warnings.some((warning) =>
        /fuera de alcance/u.test(normalize(warning)),
      ))
  );
}

function clarifyingQuestions(plan: RoutinePlan, locale: Locale): string[] {
  if (outOfScope(plan)) return [];

  const request = normalize(plan.input.request);
  const questions: string[] = [];
  if (locale === 'en') {
    if (!hasHorizon(request))
      questions.push('What time horizon will you use to review progress?');
    if (plan.intent.domain === 'learning') {
      if (!hasLevel(request))
        questions.push('What can you already do with this topic?');
      if (!hasEvidence(request, 'learning'))
        questions.push('What small piece of evidence would show progress?');
    } else if (plan.intent.domain === 'creative') {
      if (!hasFormat(request))
        questions.push('What format or material will you use?');
      if (!hasEvidence(request, 'creative'))
        questions.push(
          'What piece or sample will you save to review progress?',
        );
    } else {
      if (!hasEvidence(request, 'general'))
        questions.push('What concrete result will you review at the end?');
      if (!hasConstraint(request))
        questions.push('What limit or dependency should the plan account for?');
    }
    return questions.slice(0, 3).map(bounded);
  }
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
  locale: Locale,
): string[] {
  if (locale === 'en') {
    if (sessions.length === 0) {
      return outOfScope(plan)
        ? [
            'There are no scheduled sessions this week, so there is no progress signal to observe.',
            'After reframing the request within scope, record one concrete piece of evidence at the end of each session.',
          ]
        : [
            'There are no scheduled sessions this week, so there is no observable practice to review yet.',
            'Once a session exists, save one concrete piece of evidence when the block ends.',
          ];
    }
    if (plan.intent.domain === 'learning')
      return [
        'You can explain the concept in your own words.',
        'You solve or produce a short exercise without copying the example.',
        'You note one specific question for the next session.',
      ];
    if (plan.intent.domain === 'creative')
      return [
        'You save a dated version of the piece or sketch.',
        'You can identify one technique or approach you tried.',
        'You compare two versions and name what you would change.',
      ];
    return [
      'You leave a small, verifiable result at the end of the session.',
      'You record the next concrete step and any blocker.',
      'At the end of the week, you review what was completed and what remains.',
    ];
  }
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
  locale: Locale,
): string {
  if (locale === 'en') {
    if (selectedDays > schedulableSessions) {
      const excess = selectedDays - schedulableSessions;
      return bounded(
        `There is a capacity mismatch: you selected ${selectedDays} days, but the limit fits ${schedulableSessions} sessions of ${plan.input.sessionMinutes} min. Remove ${excess} day${excess === 1 ? '' : 's'} or adjust the weekly limit before continuing.`,
      );
    }
    if (sessions.length === 0) {
      return outOfScope(plan)
        ? 'There are no sessions to review; reframe the request within scope before the next check-in.'
        : 'There are no scheduled sessions to review; clarify the goal and generate the plan again before the next check-in.';
    }
    return 'Do a short check-in at the end of the week: mark completed sessions and note what enabled or blocked the next step.';
  }
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

export function buildInsights(
  plan: RoutinePlan,
  locale: Locale = plan.locale ?? 'es',
): RoutineInsights {
  const sessions = activeSessions(plan);
  const selectedDays = plan.input.days.length;
  const scheduledSessions = sessions.length;
  const weeklyMinutes = minutesIn(sessions);
  const schedulableSessions = Math.floor(
    plan.input.weeklyMinutes / plan.input.sessionMinutes,
  );
  const fourWeekMinutes = weeklyMinutes * 4;

  if (locale === 'en') {
    return {
      capacity: bounded(
        `You selected ${selectedDays} ${selectedDays === 1 ? 'day' : 'days'}, and the plan contains ${scheduledSessions} scheduled ${scheduledSessions === 1 ? 'session' : 'sessions'} totaling ${weeklyMinutes} min against a ${plan.input.weeklyMinutes} min weekly limit.`,
      ),
      fourWeekProjection: bounded(
        `${fourWeekMinutes} min of practice time is available over four weeks (${weeklyMinutes} min per week × 4). This is a time projection, not a promise of success.`,
      ),
      clarifyingQuestions: clarifyingQuestions(plan, locale),
      successSignals: successSignals(plan, sessions, locale)
        .slice(0, 3)
        .map(bounded),
      recommendation: recommendation(
        plan,
        selectedDays,
        schedulableSessions,
        sessions,
        locale,
      ),
    };
  }
  return {
    capacity: bounded(
      `Elegiste ${selectedDays} ${selectedDays === 1 ? 'día' : 'días'} y el plan contiene ${scheduledSessions} ${scheduledSessions === 1 ? 'sesión programada' : 'sesiones programadas'}; suman ${weeklyMinutes} min semanales frente al tope de ${plan.input.weeklyMinutes} min.`,
    ),
    fourWeekProjection: bounded(
      `${fourWeekMinutes} min de tiempo de práctica disponible en cuatro semanas (${weeklyMinutes} min por semana × 4); es una proyección de tiempo, no una promesa de éxito.`,
    ),
    clarifyingQuestions: clarifyingQuestions(plan, locale),
    successSignals: successSignals(plan, sessions, locale)
      .slice(0, 3)
      .map(bounded),
    recommendation: recommendation(
      plan,
      selectedDays,
      schedulableSessions,
      sessions,
      locale,
    ),
  };
}
