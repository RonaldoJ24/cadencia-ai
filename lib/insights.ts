import type { RoutinePlan } from './routine.ts';
import { copyFor } from './i18n.ts';

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
      /\b(?:pieza|muestra|boceto|obra|ilustracion|cancion|cuento|poema|novela|diseno|portafolio|version|publicar|exhibir|piece|sample|sketch(?:es)?|artwork|illustration|song|story|poem|novel|design|portfolio|publish|exhibit)\b/u,
    general:
      /\b(?:resultado|entregable|tarea|documento|lista|plan|proyecto|entregar|terminar|decision|siguiente paso|result|deliverable|task|document|list|project|deliver|finish|next step)\b/u,
  };
  return patterns[domain].test(request);
}

function hasFormat(request: string): boolean {
  return /\b(?:acuarela|oleo|digital|lapiz|tinta|arcilla|camara|audio|video|fotografia|musica|cuento|poema|novela|ilustracion|diseno|formato|material|papel|lienzo|instrumento|software|app|watercolou?r|oil|pencil|ink|clay|camera|photography|music|story|poem|novel|illustration|design|format|paper|canvas|instrument)\b/u.test(
    request,
  );
}

function hasConstraint(request: string): boolean {
  return /\b(?:limite|restriccion|presupuesto|bloqueo|bloqueado|dependencia|prioridad|tiempo|disponible|minutos?|horas?|dias?|semanas?|deadline|constraint|limit|restriction|budget|blocker|blocked|dependency|priority|time|available|minutes?|hours?|days?|weeks?)\b/u.test(
    request,
  );
}

function outOfScope(plan: RoutinePlan): boolean {
  const title = copyFor(plan.input.language).routine.scopeTitle;
  return (
    plan.sessions.length === 0 &&
    (plan.intent.title === title ||
      plan.warnings.some((warning) =>
        /fuera de alcance|out of scope/u.test(normalize(warning)),
      ))
  );
}

function clarifyingQuestions(plan: RoutinePlan): string[] {
  if (outOfScope(plan)) return [];

  const request = normalize(plan.input.request);
  const english = plan.input.language === 'en';
  const questions: string[] = [];
  if (!hasHorizon(request)) {
    questions.push(
      english ? 'What horizon will you use to review progress?' : '¿Qué horizonte quieres usar para revisar el avance?',
    );
  }

  if (plan.intent.domain === 'learning') {
    if (!hasLevel(request)) {
      questions.push(english ? 'What can you already do with this topic?' : '¿Qué puedes hacer ya con este tema?');
    }
    if (!hasEvidence(request, 'learning')) {
      questions.push(english ? 'What small piece of evidence would show progress?' : '¿Qué evidencia pequeña mostraría tu avance?');
    }
  } else if (plan.intent.domain === 'creative') {
    if (!hasFormat(request)) {
      questions.push(english ? 'What format or material will you use?' : '¿Qué formato o material usarás?');
    }
    if (!hasEvidence(request, 'creative')) {
      questions.push(english ? 'What piece or sample will you save to review progress?' : '¿Qué pieza o muestra guardarás para revisar el avance?');
    }
  } else {
    if (!hasEvidence(request, 'general')) {
      questions.push(english ? 'What concrete result will you review at the close?' : '¿Qué resultado concreto revisarás al cierre?');
    }
    if (!hasConstraint(request)) {
      questions.push(english ? 'What limit or dependency should we keep in mind?' : '¿Qué límite o dependencia debemos tener presente?');
    }
  }
  return questions.slice(0, 3).map(bounded);
}

function successSignals(
  plan: RoutinePlan,
  sessions: RoutinePlan['sessions'],
): string[] {
  const english = plan.input.language === 'en';
  if (sessions.length === 0) {
    if (outOfScope(plan)) {
      return english
        ? [
            'There are no sessions scheduled this week, so there is no progress signal to observe.',
            'After reframing the request within scope, record concrete evidence when each session closes.',
          ]
        : [
            'No hay sesiones programadas esta semana, así que no hay una señal de progreso que observar.',
            'Tras reformular la solicitud dentro del alcance, registra una evidencia concreta al cerrar cada sesión.',
          ];
    }
    return english
      ? [
          'There are no sessions scheduled this week; there is no observable practice to review yet.',
          'When a session exists, save concrete evidence when the block closes.',
        ]
      : [
          'No hay sesiones programadas esta semana; todavía no hay práctica observable que revisar.',
          'Cuando exista una sesión, guarda una evidencia concreta al cerrar el bloque.',
        ];
  }

  if (plan.intent.domain === 'learning') {
    return english
      ? [
          'You can explain the concept in your own words.',
          'You solve or produce a short exercise without copying the example.',
          'You write down one concrete question for the next session.',
        ]
      : [
          'Puedes explicar con tus propias palabras el concepto trabajado.',
          'Resuelves o produces un ejercicio breve sin copiar el ejemplo.',
          'Anotas una duda concreta para la siguiente sesión.',
        ];
  }
  if (plan.intent.domain === 'creative') {
    return english
      ? [
          'You save a dated version of the piece or sketch.',
          'You can point to one technique or approach you tested.',
          'You compare two versions and name what you would change.',
        ]
      : [
          'Guardas una versión fechada de la pieza o del boceto.',
          'Puedes señalar una decisión de técnica o enfoque que probaste.',
          'Comparas dos versiones y nombras qué cambiarías.',
        ];
  }
  return english
    ? [
        'You leave a small, verifiable result when the session closes.',
        'You note the next concrete step and any blocker.',
        'At the end of the week, you review which sessions were completed and what remains.',
      ]
    : [
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
  const english = plan.input.language === 'en';
  if (selectedDays > schedulableSessions) {
    const excess = selectedDays - schedulableSessions;
    return bounded(
      english
        ? `There is a capacity mismatch: you chose ${selectedDays} days, but the cap allows ${schedulableSessions} sessions of ${plan.input.sessionMinutes} min. Leave ${excess} day${excess === 1 ? '' : 's'} out or adjust the weekly cap before continuing.`
        : `Hay un desfase de capacidad: elegiste ${selectedDays} días, pero el tope permite ${schedulableSessions} sesiones de ${plan.input.sessionMinutes} min. Deja ${excess} día${excess === 1 ? '' : 's'} fuera o ajusta el tope semanal antes de continuar.`,
    );
  }
  if (sessions.length === 0) {
    return outOfScope(plan)
      ? english
        ? 'There are no sessions to review; reframe the request within scope before the next check-in.'
        : 'No hay sesiones que revisar; reformula la solicitud dentro del alcance antes de la próxima revisión.'
      : english
        ? 'There are no scheduled sessions to review; clarify the goal and generate the plan again before the next check-in.'
        : 'No hay sesiones programadas para revisar; aclara el objetivo y vuelve a generar el plan antes de la próxima revisión.';
  }
  return english
    ? 'Do a brief check-in at the end of the week: mark completed sessions and note what enabled or blocked the next step.'
    : 'Haz una breve revisión al final de la semana: marca las sesiones realizadas y anota qué facilitó o bloqueó el siguiente paso.';
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
  const english = plan.input.language === 'en';
  const dayLabel = selectedDays === 1 ? (english ? 'day' : 'día') : (english ? 'days' : 'días');
  const sessionLabel = scheduledSessions === 1
    ? (english ? 'scheduled session' : 'sesión programada')
    : (english ? 'scheduled sessions' : 'sesiones programadas');

  return {
    capacity: bounded(
      english
        ? `You chose ${selectedDays} ${dayLabel} and the plan contains ${scheduledSessions} ${sessionLabel}; that is ${weeklyMinutes} weekly min against a ${plan.input.weeklyMinutes} min cap.`
        : `Elegiste ${selectedDays} ${dayLabel} y el plan contiene ${scheduledSessions} ${sessionLabel}; suman ${weeklyMinutes} min semanales frente al tope de ${plan.input.weeklyMinutes} min.`,
    ),
    fourWeekProjection: bounded(
      english
        ? `${fourWeekMinutes} min of practice time available over four weeks (${weeklyMinutes} min per week × 4); this is a time projection, not a promise of success.`
        : `${fourWeekMinutes} min de tiempo de práctica disponible en cuatro semanas (${weeklyMinutes} min por semana × 4); es una proyección de tiempo, no una promesa de éxito.`,
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
