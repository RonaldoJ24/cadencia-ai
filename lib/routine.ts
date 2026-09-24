import {
  DEFAULT_LANGUAGE,
  copyFor,
  normalizeLanguage,
  type Language,
} from './i18n.ts';

export type RoutineInput = {
  request: string;
  days: number[];
  sessionMinutes: number;
  weeklyMinutes: number;
  startDate: string;
  time: string;
  language: Language;
};

export type RoutineBlock = {
  minutes: number;
  activity: string;
};

export type IntentStep = {
  title: string;
  instructions: string;
  blocks?: RoutineBlock[];
  deliverable?: string;
  doneWhen?: string;
};

export type Intent = {
  title: string;
  goal: string;
  domain: 'learning' | 'creative' | 'general';
  steps: IntentStep[];
};

export type Session = {
  id: string;
  date: string;
  dayIndex: number;
  title: string;
  minutes: number;
  instructions: string;
  blocks: RoutineBlock[];
  deliverable: string;
  doneWhen: string;
  status: 'planned' | 'done' | 'missed';
};

export type RoutinePlan = {
  input: RoutineInput;
  intent: Intent;
  mode: 'demo' | 'deepseek';
  sessions: Session[];
  checks: { label: string; passed: boolean; detail: string }[];
  warnings: string[];
  explanation: string;
};

/**
 * Planner decision events, emitted by buildPlan/replan AT the branch that
 * decides — never reconstructed from a finished plan. A caller-supplied
 * sink collects them while the planner runs.
 */
export type PlannerEvent =
  | { type: 'intent_validated'; scopeRefused: boolean; sessionCount: number; domain: Intent['domain'] }
  | { type: 'constraints_normalized'; days: number[]; weekStart: string; time: string; sessionMinutes: number; weeklyMinutes: number }
  | { type: 'weekly_cap_applied'; capacity: number; selectedDays: number; scheduledSessions: number }
  | { type: 'session_placed'; sessionId: string; activityId: string; date: string; dayIndex: number; minutes: number; budgetBefore: number; budgetAfter: number }
  | { type: 'schedule_completed'; sessionCount: number; weeklyUsedMinutes: number }
  | { type: 'adaptation_missed_marked'; sessionId: string; date: string }
  | { type: 'adaptation_replacement_placed'; fromSessionId: string; fromDate: string; replacementId: string; replacementDate: string; budgetBefore: number; budgetAfter: number }
  | { type: 'adaptation_infeasible'; missedSessionId: string; reason: 'no_free_day' | 'budget_exhausted' };

export type PlannerEventSink = (event: PlannerEvent) => void;

const MAX_REQUEST_CHARS = 2_000;
const MAX_WEEKLY_MINUTES = 10_080;
const MAX_SESSION_MINUTES = 1_440;
const MAX_INTENT_STEPS = 12;
const MAX_TITLE_CHARS = 160;
const MAX_GOAL_CHARS = 600;
const MAX_INSTRUCTIONS_CHARS = 2_000;
const MAX_BLOCKS = 8;
const MAX_ACTIVITY_CHARS = 500;
const MAX_DELIVERABLE_CHARS = 600;
const MAX_DONE_WHEN_CHARS = 600;

export type IntentRequirements = {
  sessionCount: number;
  sessionMinutes: number;
};

type Dict = Record<string, unknown>;

function dict(value: unknown): Dict | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function invalid(message: string): never {
  throw new Error(`Entrada inválida: ${message}`);
}

function hasControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(`${label} debe ser texto no vacío.`);
  }
  if (value.length > max) {
    invalid(`${label} supera el límite permitido.`);
  }
  if (hasControl(value)) {
    invalid(`${label} contiene caracteres de control.`);
  }
  return value;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    invalid(`${label} debe ser un entero finito.`);
  }
  if (value < min || value > max) {
    invalid(`${label} debe estar entre ${min} y ${max}.`);
  }
  return value;
}

function isoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    invalid(`${label} debe usar el formato YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || year > 9_999) {
    invalid(`${label} no es una fecha válida.`);
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    invalid(`${label} no es una fecha válida.`);
  }
  return value;
}

function dateValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(start: string, offset: number): string {
  const date = dateValue(start);
  date.setUTCDate(date.getUTCDate() + offset);
  return dateString(date);
}

function dayOffset(start: string, date: string): number {
  return Math.round((dateValue(date).getTime() - dateValue(start).getTime()) / 86_400_000);
}

function mondayIndex(date: string): number {
  return (dateValue(date).getUTCDay() + 6) % 7;
}

/**
 * The Monday that starts the week containing `now`, as YYYY-MM-DD, read in
 * the visitor's local calendar or in UTC.
 */
export function weekStartOf(now: Date, calendar: 'local' | 'utc'): string {
  const [year, month, day, weekday] = calendar === 'utc'
    ? [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCDay()]
    : [now.getFullYear(), now.getMonth(), now.getDate(), now.getDay()];
  return addDays(dateString(new Date(Date.UTC(year, month, day))), -((weekday + 6) % 7));
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function timeValue(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/u.test(value)) {
    invalid('time debe usar el formato HH:mm.');
  }
  const [hours, minutesPart] = value.split(':').map(Number);
  if (hours > 23 || minutesPart > 59) {
    invalid('time debe ser una hora local válida.');
  }
  return value;
}

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

const RESTRICTED_REQUEST = /\b(?:diagnos(?:is|tico|tica|ticos|ticas|ticar)?|sintom(?:a|as)?|tratamiento(?:s)?|medicamento(?:s)?|dosis|enfermedad(?:es)?|lesion(?:es)?|dolor(?:es)?|ejercicio(?:s)?|entrenamiento(?:s)?|fitness|calorias|dieta(?:s)?|nutricion|perder peso|ganar musculo|symptom(?:s)?|medical|medicine|medication|dosage|disease(?:s)?|injur(?:y|ies)|pain|exercise|workout|calorie(?:s)?|diet(?:s)?|weight loss|muscle gain|invertir|inversion(?:es)?|acciones|cripto(?:moneda)?|trading|prestamo(?:s)?|credito|hipoteca|impuesto(?:s)?|finanzas personales|asesoria financiera|ganar dinero|invest(?:ment|ing)?|stocks?|crypto(?:currency)?|loan|credit|mortgage|tax(?:es)?|personal finance|financial advice|make money|abogado(?:s)?|asesoria legal|demanda(?:s)?|contrato(?:s)?|litigio|derechos legales|divorcio|visa|inmigracion|testamento|lawyer|legal advice|lawsuit|contract|litigation|legal rights|divorce|immigration)\b/u;
const RESTRICTED_REQUEST_GLOBAL = new RegExp(RESTRICTED_REQUEST.source, 'gu');
const DIRECT_REQUEST_CUE = /\b(?:dime|decime|indica(?:me)?|explica(?:me)?|recomiend(?:a|ame)|aconsej(?:a|ame)|sugier(?:e|eme)|que\s+(?:debo|puedo|tengo\s+que)|como\s+(?:debo|puedo|tengo\s+que)|cuant(?:o|a|os|as)\s+(?:pastill(?:a|as)|tableta(?:s)?|capsul(?:a|as)|comprimid(?:o|os|a|as))|tell\s+me|what\s+should|how\s+(?:much|many)|should\s+i|can\s+i)\b/u;
const DIRECT_REQUEST_CUE_GLOBAL = new RegExp(DIRECT_REQUEST_CUE.source, 'gu');
const DIRECT_DOMAIN_ACTION_CUE = /\b(?:pastill(?:a|as)|tableta(?:s)?|capsul(?:a|as)|comprimid(?:o|os|a|as)|tomar|tome|consumir|ingerir|declarar|declare|declar(?:acion|aciones)|testificar|testifique|juez|tribunal|ganar\s+(?:mi|el)\s+caso|defender(?:me)?|presentar\s+(?:ante|al)|pill(?:s)?|tablet(?:s)?|capsule(?:s)?|take|ingest|declare|testify|judge|court|win\s+(?:my|the)\s+case|defend(?:\s+me)?|file\s+(?:with|in))\b/u;
const DIRECT_DOMAIN_ACTION_CUE_GLOBAL = new RegExp(DIRECT_DOMAIN_ACTION_CUE.source, 'gu');
const DOSAGE_MATCH = /\b(?:dosis|dosage)\b/u;
const LAWYER_MATCH = /\b(?:abogado|abogados|lawyer|lawyers)\b/u;
const ANALYSIS_ACTION = /\b(?:analiz(?:ar|a|ando|is)|analic(?:e|es|emos|en)|estudi(?:ar|a|ando|o)|examinar|interpretar|identificar|explorar|comprender|comparar|uso|significado|meaning|analy[sz](?:e|ing|is))\b/gu;
const ANALYSIS_NEGATION = /\b(?:no|nunca|never|not|don't|do not|sin|without|avoid)\b(?:\s+[a-z0-9]+){0,3}\s*$/u;
const LITERARY_LINGUISTIC_CONTEXT = /\b(?:literari[oa]s?|literatura|poema(?:s)?|poesi(?:a|as)|metafora(?:s)?|figura(?:s)? retorica(?:s)?|linguistic[oa]s?|linguistic|palabra(?:s)?|lenguaje|language|literary|poem(?:s)?|metaphor(?:s)?|novela(?:s)?|cuento(?:s)?|relato(?:s)?|texto(?:s)?|verso(?:s)?|semantica(?:s)?|gramatica(?:s)?|retorica(?:s)?)\b/gu;
const HEALTH_ADVICE_CONTEXT = /\b(?:salud|health|medic(?:a|o|al)(?:s|es)?|medical|medicine|medication|recomendacion(?:es)?|consejo(?:s)?|orientacion(?:es)?|asesoria(?:s)?|advice|recommendation(?:s)?)\b/u;
const HEALTH_ADVICE_EXCLUSION = /(?:\b(?:sin|no|nunca|evitar|evitando|excluir|excluyendo|exclude|without|avoid|excluding)\b(?:\s+[a-z0-9]+){0,2}\s+(?:recomendacion(?:es)?|consejo(?:s)?|orientacion(?:es)?|asesoria(?:s)?|advice|recommendation(?:s)?)(?:\s+[a-z0-9]+){0,3}\s+(?:salud|health|medic(?:a|o|al)(?:s|es)?|medical|medicine|medication)\b)|(?:\b(?:sin|no|nunca|evitar|evitando|excluir|excluyendo|exclude|without|avoid|excluding)\b(?:\s+[a-z0-9]+){0,2}\s+(?:salud|health|medic(?:a|o|al)(?:s|es)?|medical|medicine|medication)(?:\s+[a-z0-9]+){0,3}\s+(?:recomendacion(?:es)?|consejo(?:s)?|orientacion(?:es)?|asesoria(?:s)?|advice|recommendation(?:s)?)\b)/u;
const HEALTH_ADVICE_EXCLUSION_GLOBAL = new RegExp(HEALTH_ADVICE_EXCLUSION.source, 'gu');
const CREATIVE_ACTION = /\b(?:ficcion|fictici[oa]s?|fiction|creative|escrib(?:ir|e|iendo)|crear|crea|creando|redactar|narrar|imagina|cuento|relato|novela|story|write|writing|create)\b/u;
const FICTION_TARGET = /\b(?:personaje(?:s)?|escena(?:s)?|dialogo(?:s)?|narrativ[oa]s?|character(?:s)?|scene(?:s)?|dialogue(?:s)?|narrative(?:s)?|historia(?:s)?|story(?:line|lines)?|capitulo(?:s)?)\b/u;

function directAdviceRequest(normalized: string): boolean {
  const requestCues = [...normalized.matchAll(DIRECT_REQUEST_CUE_GLOBAL)];
  const actionCues = [...normalized.matchAll(DIRECT_DOMAIN_ACTION_CUE_GLOBAL)];
  return requestCues.length > 0 && actionCues.length > 0;
}

function literaryAnalysisContext(normalized: string): boolean {
  const literaryTerms = [...normalized.matchAll(LITERARY_LINGUISTIC_CONTEXT)];
  return [...normalized.matchAll(ANALYSIS_ACTION)].some((action) => {
    const actionStart = action.index ?? 0;
    const beforeAction = normalized.slice(Math.max(0, actionStart - 64), actionStart);
    return !ANALYSIS_NEGATION.test(beforeAction) && literaryTerms.some((term) =>
      Math.abs(actionStart - (term.index ?? 0)) <= 120,
    );
  });
}

function explicitHealthExclusion(normalized: string): boolean {
  return HEALTH_ADVICE_EXCLUSION.test(normalized);
}

function explicitlyExcludedHealthTerm(normalized: string, match: RegExpMatchArray): boolean {
  const matchStart = match.index ?? -1;
  return HEALTH_ADVICE_CONTEXT.test(match[0]) &&
    [...normalized.matchAll(HEALTH_ADVICE_EXCLUSION_GLOBAL)].some((exclusion) => {
      const exclusionStart = exclusion.index ?? -1;
      return exclusionStart <= matchStart && matchStart + match[0].length <= exclusionStart + exclusion[0].length;
    });
}

function restrictedRequest(request: string): boolean {
  const normalized = request
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  const matches = [...normalized.matchAll(RESTRICTED_REQUEST_GLOBAL)];
  if (matches.length === 0) return false;
  if (directAdviceRequest(normalized)) return true;

  const dosageContext = DOSAGE_MATCH.test(normalized) &&
    literaryAnalysisContext(normalized) && explicitHealthExclusion(normalized);
  const fictionContext = CREATIVE_ACTION.test(normalized) && FICTION_TARGET.test(normalized);
  for (const match of matches) {
    if (DOSAGE_MATCH.test(match[0]) && dosageContext) continue;
    if (dosageContext && explicitlyExcludedHealthTerm(normalized, match)) continue;
    if (LAWYER_MATCH.test(match[0]) && fictionContext) continue;
    return true;
  }
  return false;
}

export function scopeIntent(language: Language = DEFAULT_LANGUAGE): Intent {
  const routine = copyFor(language).routine;
  return {
    title: routine.scopeTitle,
    goal: routine.scopeGoal,
    domain: 'general',
    steps: [
      {
        title: routine.scopeStepTitle,
        instructions: routine.scopeStepInstructions,
      },
    ],
  };
}

function domainFor(request: string): Intent['domain'] {
  if (/(?:aprender|estudiar|idioma|inglés|ingles|curso|lectura|leer|programar|programación|programacion|learn|study|language|course|read|code)/iu.test(request)) {
    return 'learning';
  }
  if (/(?:dibujar|pintar|acuarela|escribir|música|musica|diseño|diseno|fotografía|fotografia|crear|draw|paint|write|music|design|create)/iu.test(request)) {
    return 'creative';
  }
  return 'general';
}

function allocateMinutes(total: number, weights: number[]): number[] {
  const chosen = weights.slice(0, Math.min(total, weights.length));
  const remaining = total - chosen.length;
  const weightTotal = chosen.reduce((sum, weight) => sum + weight, 0);
  const values = chosen.map((weight) => 1 + Math.floor((remaining * weight) / weightTotal));
  let missing = total - values.reduce((sum, value) => sum + value, 0);
  for (let index = 0; missing > 0; index = (index + 1) % values.length) {
    values[index] += 1;
    missing -= 1;
  }
  return values;
}

function demoBlocks(
  domain: Intent['domain'],
  minutes: number,
  label: string,
  sessionNumber: number,
  language: Language,
): RoutineBlock[] {
  const activities = language === 'en'
    ? domain === 'learning'
      ? [
          `Recall what you already know about “${label}” and set today’s goal.`,
          'Review one brief example or source and note the two ideas you need to apply.',
          'Solve or produce one concrete practice without copying the example step by step.',
          'Check the result, find the main error, and repeat the weakest part.',
          `Save evidence from session ${sessionNumber} and write the first next step.`,
        ]
      : domain === 'creative'
        ? [
            `Define one concrete creative decision for “${label}” and prepare the materials.`,
            'Run quick tests by changing one variable between versions.',
            'Produce one complete version without interrupting the flow to polish details.',
            'Compare the versions, choose one, and fix the most distracting point.',
            `Save the sample from session ${sessionNumber} and note what you will explore next.`,
          ]
        : [
            `Define today’s verifiable result for “${label}” and remove anything secondary.`,
            'Gather only the information or materials needed to start.',
            'Execute the main task until there is a usable result.',
            'Check the result against the goal and fix the most important blocker.',
            `Record evidence from session ${sessionNumber} and prepare the next step.`,
          ]
    : domain === 'learning'
      ? [
          `Recupera de memoria lo que ya sabes sobre «${label}» y fija el objetivo de hoy.`,
          'Revisa un ejemplo o fuente breve y anota las dos ideas que necesitas aplicar.',
          'Resuelve o produce una práctica concreta sin copiar el ejemplo paso a paso.',
          'Comprueba el resultado, localiza el error principal y repite la parte más débil.',
          `Guarda la evidencia de la sesión ${sessionNumber} y escribe el primer paso de la siguiente.`,
        ]
      : domain === 'creative'
        ? [
            `Define una decisión creativa concreta para «${label}» y prepara los materiales.`,
            'Haz pruebas rápidas cambiando una sola variable entre versiones.',
            'Produce una versión completa sin interrumpir el flujo para pulir detalles.',
            'Compara las versiones, elige una y corrige el punto que más distrae.',
            `Guarda la muestra de la sesión ${sessionNumber} y anota qué explorarás después.`,
          ]
        : [
            `Define el resultado verificable de hoy para «${label}» y elimina lo secundario.`,
            'Reúne únicamente la información o materiales necesarios para empezar.',
            'Ejecuta la tarea principal hasta dejar un resultado utilizable.',
            'Revisa el resultado contra el objetivo y corrige el bloqueo más importante.',
            `Registra la evidencia de la sesión ${sessionNumber} y deja preparado el siguiente paso.`,
          ];
  const allocated = allocateMinutes(minutes, [1, 2, 5, 1, 1]);
  return allocated.map((blockMinutes, index) => ({
    minutes: blockMinutes,
    activity: activities[index],
  }));
}

function demoSteps(
  domain: Intent['domain'],
  sessionMinutes: number,
  sessionCount: number,
  label: string,
  language: Language,
): Intent['steps'] {
  const titles = language === 'en'
    ? domain === 'learning'
      ? ['Map and diagnose', 'Guided practice', 'Practice unaided', 'Simulation', 'Test and correct', 'Transfer', 'Weekly close']
      : domain === 'creative'
        ? ['Direction and references', 'Exploration', 'First version', 'Variation', 'Editing', 'Final version', 'Weekly close']
        : ['Result and scope', 'Preparation', 'Execution', 'Unblock', 'Delivery', 'Follow-up', 'Weekly close']
    : domain === 'learning'
      ? ['Mapa y diagnóstico', 'Práctica guiada', 'Práctica sin apoyo', 'Simulación', 'Prueba y corrección', 'Transferencia', 'Cierre semanal']
      : domain === 'creative'
        ? ['Dirección y referencias', 'Exploración', 'Primera versión', 'Variación', 'Edición', 'Versión final', 'Cierre semanal']
        : ['Resultado y alcance', 'Preparación', 'Ejecución', 'Resolución de bloqueos', 'Entrega', 'Seguimiento', 'Cierre semanal'];
  return Array.from({ length: sessionCount }, (_, index) => {
    const routine = copyFor(language).routine;
    const blocks = demoBlocks(domain, sessionMinutes, label, index + 1, language);
    const deliverable = domain === 'learning'
      ? routine.learningDeliverable(index + 1)
      : domain === 'creative'
        ? routine.creativeDeliverable(index + 1)
        : routine.generalDeliverable(index + 1);
    return {
      title: titles[index] ?? (language === 'en' ? `Go deeper and verify ${index + 1}` : `Profundiza y comprueba ${index + 1}`),
      instructions: routine.sessionInstructions(index + 1, sessionCount),
      blocks,
      deliverable,
      doneWhen: routine.doneWhen(sessionMinutes),
    };
  });
}

function cloneInput(input: RoutineInput): RoutineInput {
  return { ...input, days: [...input.days] };
}

function cloneIntent(intent: Intent): Intent {
  return {
    ...intent,
    steps: intent.steps.map((step) => ({
      ...step,
      blocks: step.blocks?.map((block) => ({ ...block })),
    })),
  };
}

function cloneSession(session: Session): Session {
  return { ...session, blocks: session.blocks.map((block) => ({ ...block })) };
}

export function validateInput(input: unknown): RoutineInput {
  const value = dict(input);
  if (!value) invalid('input debe ser un objeto.');

  const language = normalizeLanguage(value.language);
  const request = text(value.request, 'request', MAX_REQUEST_CHARS);
  if (!Array.isArray(value.days) || value.days.length === 0 || value.days.length > 7) {
    invalid('days debe contener entre 1 y 7 días.');
  }
  const days = value.days.map((day, index) => integer(day, `days[${index}]`, 0, 6));
  if (new Set(days).size !== days.length) {
    invalid('days no puede contener días repetidos.');
  }

  const sessionMinutes = integer(value.sessionMinutes, 'sessionMinutes', 1, MAX_SESSION_MINUTES);
  const weeklyMinutes = integer(value.weeklyMinutes, 'weeklyMinutes', 1, MAX_WEEKLY_MINUTES);
  if (weeklyMinutes < sessionMinutes) {
    invalid('weeklyMinutes debe cubrir al menos una sesión completa.');
  }

  const startDate = isoDate(value.startDate, 'startDate');
  if (mondayIndex(startDate) !== 0) {
    invalid('startDate debe ser lunes.');
  }
  const time = timeValue(value.time);
  if (timeMinutes(time) + sessionMinutes >= 1_440) {
    invalid('La sesión debe terminar antes de cambiar de día.');
  }

  return {
    request,
    days: [...days],
    sessionMinutes,
    weeklyMinutes,
    startDate,
    time,
    language,
  };
}

export function validateIntent(
  input: unknown,
  requirements?: IntentRequirements,
): Intent {
  const value = dict(input);
  if (!value) invalid('intent debe ser un objeto.');
  const title = text(value.title, 'intent.title', MAX_TITLE_CHARS);
  const goal = text(value.goal, 'intent.goal', MAX_GOAL_CHARS);
  if (value.domain !== 'learning' && value.domain !== 'creative' && value.domain !== 'general') {
    invalid('intent.domain no es válido.');
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > MAX_INTENT_STEPS) {
    invalid('intent.steps debe contener entre 1 y 12 pasos.');
  }
  if (requirements) {
    integer(requirements.sessionCount, 'requirements.sessionCount', 1, MAX_INTENT_STEPS);
    integer(requirements.sessionMinutes, 'requirements.sessionMinutes', 1, MAX_SESSION_MINUTES);
    if (value.steps.length !== requirements.sessionCount) {
      invalid(`intent.steps debe contener exactamente ${requirements.sessionCount} sesiones.`);
    }
  }
  const steps = value.steps.map((step, index) => {
    const item = dict(step);
    if (!item) invalid(`intent.steps[${index}] debe ser un objeto.`);
    const base: IntentStep = {
      title: text(item.title, `intent.steps[${index}].title`, MAX_TITLE_CHARS),
      instructions: text(
        item.instructions,
        `intent.steps[${index}].instructions`,
        MAX_INSTRUCTIONS_CHARS,
      ),
    };
    const rawBlocks = item.blocks;
    const rawDeliverable = item.deliverable;
    const rawDoneWhen = item.doneWhen ?? item.done_when;
    const hasExecution = rawBlocks !== undefined || rawDeliverable !== undefined || rawDoneWhen !== undefined;
    if (!hasExecution && !requirements) return base;
    if (!Array.isArray(rawBlocks) || rawBlocks.length === 0 || rawBlocks.length > MAX_BLOCKS) {
      invalid(`intent.steps[${index}].blocks debe contener entre 1 y ${MAX_BLOCKS} bloques.`);
    }
    const blocks = rawBlocks.map((block, blockIndex) => {
      const current = dict(block);
      if (!current) invalid(`intent.steps[${index}].blocks[${blockIndex}] debe ser un objeto.`);
      return {
        minutes: integer(
          current.minutes,
          `intent.steps[${index}].blocks[${blockIndex}].minutes`,
          1,
          MAX_SESSION_MINUTES,
        ),
        activity: text(
          current.activity,
          `intent.steps[${index}].blocks[${blockIndex}].activity`,
          MAX_ACTIVITY_CHARS,
        ),
      };
    });
    const total = blocks.reduce((sum, block) => sum + block.minutes, 0);
    if (requirements && total !== requirements.sessionMinutes) {
      invalid(
        `intent.steps[${index}].blocks suma ${total}; debe sumar ${requirements.sessionMinutes} minutos.`,
      );
    }
    return {
      ...base,
      blocks,
      deliverable: text(
        rawDeliverable,
        `intent.steps[${index}].deliverable`,
        MAX_DELIVERABLE_CHARS,
      ),
      doneWhen: text(
        rawDoneWhen,
        `intent.steps[${index}].done_when`,
        MAX_DONE_WHEN_CHARS,
      ),
    };
  });
  return { title, goal, domain: value.domain, steps };
}

export function demoIntent(
  request: string,
  sessionMinutes = 30,
  sessionCount = 3,
  language: Language = DEFAULT_LANGUAGE,
): Intent {
  const safeRequest = text(request, 'request', MAX_REQUEST_CHARS);
  if (restrictedRequest(safeRequest)) return scopeIntent(language);
  integer(sessionMinutes, 'sessionMinutes', 1, MAX_SESSION_MINUTES);
  integer(sessionCount, 'sessionCount', 1, MAX_INTENT_STEPS);
  const label = compact(safeRequest).slice(0, 96);
  const domain = domainFor(safeRequest);
  const prefix = language === 'en'
    ? domain === 'learning'
      ? 'Learning'
      : domain === 'creative'
        ? 'Creative practice'
        : 'Personal work'
    : domain === 'learning'
      ? 'Aprendizaje'
      : domain === 'creative'
        ? 'Práctica creativa'
        : 'Trabajo personal';
  return {
    title: `${prefix}: ${label}`,
    goal: language === 'en'
      ? `Move “${label}” forward with small, verifiable steps.`
      : `Avanzar en «${label}» con pasos pequeños y comprobables.`,
    domain,
    steps: demoSteps(domain, sessionMinutes, sessionCount, label, language),
  };
}

function checksFor(input: RoutineInput, sessions: Session[]) {
  const english = input.language === 'en';
  const allowed = new Set(input.days);
  const dates = new Set<string>();
  const validDates = sessions.every((session) => {
    const offset = dayOffset(input.startDate, session.date);
    const dateMatchesIndex = offset === session.dayIndex;
    const inWeek = offset >= 0 && offset <= 6;
    dates.add(session.date);
    return inWeek && dateMatchesIndex && allowed.has(session.dayIndex);
  });
  const sameDuration = sessions.every((session) => session.minutes === input.sessionMinutes);
  const completeAgenda = sessions.every(
    (session) =>
      session.blocks.reduce((total, block) => total + block.minutes, 0) === session.minutes,
  );
  const activeMinutes = sessions
    .filter((session) => session.status !== 'missed')
    .reduce((total, session) => total + session.minutes, 0);
  return [
    {
      label: english ? 'Selected days' : 'Días elegidos',
      passed: validDates,
      detail: validDates
        ? english
          ? 'Every session falls on an allowed day in the selected week.'
          : 'Cada sesión cae en un día permitido de la semana seleccionada.'
        : english
          ? 'A session falls outside the selected days or week.'
          : 'Hay una sesión fuera de los días o de la semana seleccionada.',
    },
    {
      label: english ? 'Session duration' : 'Duración por sesión',
      passed: sameDuration,
      detail: english
        ? `${input.sessionMinutes} min per session.`
        : `${input.sessionMinutes} min por sesión.`,
    },
    {
      label: english ? 'Complete agenda' : 'Agenda completa',
      passed: completeAgenda,
      detail: completeAgenda
        ? english
          ? 'Each session’s blocks add up to its exact duration.'
          : 'Los bloques de cada sesión suman exactamente su duración.'
        : english
          ? 'An agenda does not cover the full session.'
          : 'Hay una agenda cuyos bloques no cubren la sesión completa.',
    },
    {
      label: english ? 'Weekly cap' : 'Tope semanal',
      passed: activeMinutes <= input.weeklyMinutes,
      detail: english
        ? `${activeMinutes} of ${input.weeklyMinutes} min in planned or completed sessions.`
        : `${activeMinutes} de ${input.weeklyMinutes} min en sesiones programadas o hechas.`,
    },
    {
      label: english ? 'No collisions' : 'Sin colisiones',
      passed: dates.size === sessions.length,
      detail: dates.size === sessions.length
        ? english ? 'At most one session per day.' : 'Una sesión como máximo por día.'
        : english ? 'Two sessions fall on the same day.' : 'Hay dos sesiones el mismo día.',
    },
  ];
}

function baseExplanation(input: RoutineInput, mode: RoutinePlan['mode'], sessions: Session[]): string {
  const activeMinutes = sessions
    .filter((session) => session.status !== 'missed')
    .reduce((total, session) => total + session.minutes, 0);
  const routine = copyFor(input.language).routine;
  const source = mode === 'demo' ? routine.demoSource : routine.liveSource;
  return `${source} ${routine.explanation(sessions.length, activeMinutes, input.weeklyMinutes)}`;
}

function planWithChecks(
  plan: RoutinePlan,
  warnings: string[] = plan.warnings,
  explanation = plan.explanation,
): RoutinePlan {
  return {
    input: cloneInput(plan.input),
    intent: cloneIntent(plan.intent),
    mode: plan.mode,
    sessions: plan.sessions.map(cloneSession),
    checks: checksFor(plan.input, plan.sessions),
    warnings: [...new Set(warnings)],
    explanation,
  };
}

export function buildPlan(
  rawInput: RoutineInput,
  rawIntent?: Intent,
  mode: RoutinePlan['mode'] = 'demo',
  scopeRefused?: boolean,
  sink?: PlannerEventSink,
): RoutinePlan {
  const input = validateInput(rawInput);
  if (mode !== 'demo' && mode !== 'deepseek') invalid('mode no es válido.');
  if (mode === 'deepseek' && typeof scopeRefused !== 'boolean') {
    invalid('scope_refused debe ser un booleano validado.');
  }
  const capacity = Math.floor(input.weeklyMinutes / input.sessionMinutes);
  const selectedDays = [...input.days].sort((a, b) => a - b);
  const sessionCount = scopeRefused === true ? 0 : Math.min(selectedDays.length, capacity);
  sink?.({
    type: 'constraints_normalized',
    days: [...selectedDays],
    weekStart: input.startDate,
    time: input.time,
    sessionMinutes: input.sessionMinutes,
    weeklyMinutes: input.weeklyMinutes,
  });
  const unsafe = mode === 'demo' ? restrictedRequest(input.request) : scopeRefused === true;
  if (mode === 'deepseek' && !unsafe && rawIntent === undefined) {
    invalid('intent es obligatorio para una rutina generada por IA.');
  }
  const candidate = rawIntent === undefined
    ? mode === 'demo'
      ? demoIntent(input.request, input.sessionMinutes, Math.max(1, sessionCount), input.language)
      : scopeIntent(input.language)
    : validateIntent(
        rawIntent,
        !unsafe
          ? { sessionCount, sessionMinutes: input.sessionMinutes }
          : undefined,
      );
  const warnings: string[] = [];
  const intent = unsafe ? scopeIntent(input.language) : candidate;
  sink?.({
    type: 'intent_validated',
    scopeRefused: unsafe,
    sessionCount: unsafe ? 0 : sessionCount,
    domain: intent.domain,
  });
  if (unsafe) {
    warnings.push(copyFor(input.language).routine.scopeWarning);
  }

  const scheduledCount = unsafe ? 0 : sessionCount;
  if (!unsafe && scheduledCount < selectedDays.length) {
    warnings.push(copyFor(input.language).routine.capacityWarning(scheduledCount, selectedDays.length));
  }
  sink?.({
    type: 'weekly_cap_applied',
    capacity,
    selectedDays: selectedDays.length,
    scheduledSessions: scheduledCount,
  });
  let placedBudgetUsed = 0;
  const sessions = selectedDays.slice(0, scheduledCount).map((dayIndex, index) => {
    const date = addDays(input.startDate, dayIndex);
    const step = intent.steps[index];
    const prefix = copyFor(input.language).routine.sessionPrefix(index + 1);
    const blocks = step.blocks?.map((block) => ({ ...block })) ?? [
      { minutes: input.sessionMinutes, activity: step.instructions },
    ];
    const blockMinutes = blocks.reduce((total, block) => total + block.minutes, 0);
    if (blockMinutes !== input.sessionMinutes) {
      invalid(`intent.steps[${index}].blocks debe sumar ${input.sessionMinutes} minutos.`);
    }
    const sessionId = `session-${date}`;
    const budgetBefore = input.weeklyMinutes - placedBudgetUsed;
    placedBudgetUsed += input.sessionMinutes;
    sink?.({
      type: 'session_placed',
      sessionId,
      activityId: `intent-step-${index + 1}`,
      date,
      dayIndex,
      minutes: input.sessionMinutes,
      budgetBefore,
      budgetAfter: budgetBefore - input.sessionMinutes,
    });
    return {
      id: sessionId,
      date,
      dayIndex,
      title: `${prefix}${step.title.slice(0, MAX_TITLE_CHARS - prefix.length)}`,
      minutes: input.sessionMinutes,
      instructions: step.instructions,
      blocks,
      deliverable: step.deliverable ?? (input.language === 'en'
        ? 'One concrete, dated piece of evidence from the session.'
        : 'Una evidencia concreta y fechada de lo realizado en la sesión.'),
      doneWhen: step.doneWhen ?? (input.language === 'en'
        ? 'The evidence exists and the next concrete step is written down.'
        : 'La evidencia existe y quedó escrito el siguiente paso concreto.'),
      status: 'planned' as const,
    };
  });
  const plan: RoutinePlan = {
    input: cloneInput(input),
    intent: cloneIntent(intent),
    mode,
    sessions,
    checks: [],
    warnings,
    explanation: baseExplanation(input, mode, sessions),
  };
  sink?.({
    type: 'schedule_completed',
    sessionCount: sessions.length,
    weeklyUsedMinutes: sessions.reduce((total, session) => total + session.minutes, 0),
  });
  return planWithChecks(plan);
}

function validateSession(input: RoutineInput, value: unknown, index: number): Session {
  const item = dict(value);
  if (!item) invalid(`sessions[${index}] debe ser un objeto.`);
  const id = text(item.id, `sessions[${index}].id`, 160);
  if (!/^[A-Za-z0-9:_-]+$/u.test(id)) invalid(`sessions[${index}].id no es válido.`);
  const date = isoDate(item.date, `sessions[${index}].date`);
  const dayIndex = integer(item.dayIndex, `sessions[${index}].dayIndex`, 0, 6);
  if (dayOffset(input.startDate, date) !== dayIndex) {
    invalid(`sessions[${index}] no coincide con su día.`);
  }
  const minutes = integer(item.minutes, `sessions[${index}].minutes`, 1, MAX_SESSION_MINUTES);
  const title = text(item.title, `sessions[${index}].title`, MAX_TITLE_CHARS);
  const instructions = text(item.instructions, `sessions[${index}].instructions`, MAX_INSTRUCTIONS_CHARS);
  if (!Array.isArray(item.blocks) || item.blocks.length === 0 || item.blocks.length > MAX_BLOCKS) {
    invalid(`sessions[${index}].blocks no es válido.`);
  }
  const blocks = item.blocks.map((block, blockIndex) => {
    const current = dict(block);
    if (!current) invalid(`sessions[${index}].blocks[${blockIndex}] no es válido.`);
    return {
      minutes: integer(
        current.minutes,
        `sessions[${index}].blocks[${blockIndex}].minutes`,
        1,
        MAX_SESSION_MINUTES,
      ),
      activity: text(
        current.activity,
        `sessions[${index}].blocks[${blockIndex}].activity`,
        MAX_ACTIVITY_CHARS,
      ),
    };
  });
  if (blocks.reduce((total, block) => total + block.minutes, 0) !== minutes) {
    invalid(`sessions[${index}].blocks no suma la duración de la sesión.`);
  }
  const deliverable = text(
    item.deliverable,
    `sessions[${index}].deliverable`,
    MAX_DELIVERABLE_CHARS,
  );
  const doneWhen = text(
    item.doneWhen,
    `sessions[${index}].doneWhen`,
    MAX_DONE_WHEN_CHARS,
  );
  if (item.status !== 'planned' && item.status !== 'done' && item.status !== 'missed') {
    invalid(`sessions[${index}].status no es válido.`);
  }
  return {
    id,
    date,
    dayIndex,
    title,
    minutes,
    instructions,
    blocks,
    deliverable,
    doneWhen,
    status: item.status,
  };
}

function copyPlan(rawPlan: RoutinePlan): RoutinePlan {
  const source = dict(rawPlan);
  if (!source) invalid('plan debe ser un objeto.');
  const input = validateInput(source.input);
  const intent = validateIntent(source.intent);
  if (source.mode !== 'demo' && source.mode !== 'deepseek') invalid('plan.mode no es válido.');
  if (!Array.isArray(source.sessions)) invalid('plan.sessions debe ser una lista.');
  const sessions = source.sessions.map((session, index) => validateSession(input, session, index));
  const ids = new Set<string>();
  const dates = new Set<string>();
  for (const session of sessions) {
    if (ids.has(session.id)) invalid('plan contiene IDs repetidos.');
    if (dates.has(session.date)) invalid('plan contiene días ocupados repetidos.');
    ids.add(session.id);
    dates.add(session.date);
  }
  if (!Array.isArray(source.warnings) || source.warnings.some((warning) => typeof warning !== 'string')) {
    invalid('plan.warnings no es válido.');
  }
  if (typeof source.explanation !== 'string') invalid('plan.explanation no es válido.');
  if (!Array.isArray(source.checks)) invalid('plan.checks debe ser una lista.');
  return {
    input,
    intent,
    mode: source.mode,
    sessions,
    checks: source.checks.map((check, index) => {
      const item = dict(check);
      if (!item || typeof item.label !== 'string' || typeof item.passed !== 'boolean' || typeof item.detail !== 'string') {
        invalid(`plan.checks[${index}] no es válido.`);
      }
      return { label: item.label, passed: item.passed, detail: item.detail };
    }),
    warnings: [...source.warnings],
    explanation: source.explanation,
  };
}

function replacementId(date: string, sessions: Session[]): string {
  const ids = new Set(sessions.map((session) => session.id));
  const base = `session-${date}`;
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function replan(plan: RoutinePlan, missedId: string, sink?: PlannerEventSink): RoutinePlan {
  const next = copyPlan(plan);
  const routine = copyFor(next.input.language).routine;
  if (typeof missedId !== 'string' || missedId.trim() === '') invalid('missedId debe ser texto.');
  const index = next.sessions.findIndex((session) => session.id === missedId);
  if (index < 0) throw new Error(routine.notFound);
  const missed = next.sessions[index];
  if (missed.status === 'missed') throw new Error(routine.alreadyMissed);
  if (missed.status === 'done') throw new Error(routine.cannotReplanDone);

  next.sessions[index] = { ...missed, status: 'missed' };
  sink?.({ type: 'adaptation_missed_marked', sessionId: missed.id, date: missed.date });
  const occupied = new Set(next.sessions.map((session) => session.date));
  const activeMinutes = next.sessions
    .filter((session) => session.status !== 'missed')
    .reduce((total, session) => total + session.minutes, 0);
  const missedOffset = dayOffset(next.input.startDate, missed.date);
  const budgetAllowsReplacement = activeMinutes + missed.minutes <= next.input.weeklyMinutes;
  let replacement: Session | undefined;
  if (missedOffset >= 0 && missedOffset < 6 && budgetAllowsReplacement) {
    for (let offset = missedOffset + 1; offset <= 6; offset += 1) {
      if (!next.input.days.includes(offset)) continue;
      const date = addDays(next.input.startDate, offset);
      if (occupied.has(date)) continue;
      replacement = {
        ...missed,
        id: replacementId(date, next.sessions),
        date,
        dayIndex: offset,
        status: 'planned',
      };
      sink?.({
        type: 'adaptation_replacement_placed',
        fromSessionId: missed.id,
        fromDate: missed.date,
        replacementId: replacement.id,
        replacementDate: date,
        budgetBefore: next.input.weeklyMinutes - activeMinutes,
        budgetAfter: next.input.weeklyMinutes - activeMinutes - missed.minutes,
      });
      break;
    }
  }

  const warnings = [...next.warnings];
  const noSlotReason = budgetAllowsReplacement
    ? routine.noFreeDayWarning
    : routine.budgetWarning;
  const explanation = replacement
    ? `${next.explanation} ${routine.replanReplacement(missed.date, replacement.date)}`
    : `${next.explanation} ${routine.replanNoReplacement(missed.date, noSlotReason)}`;
  if (!replacement) {
    warnings.push(noSlotReason);
    sink?.({
      type: 'adaptation_infeasible',
      missedSessionId: missed.id,
      reason: budgetAllowsReplacement ? 'no_free_day' : 'budget_exhausted',
    });
  } else {
    next.sessions.push(replacement);
  }
  next.sessions.sort((a, b) => a.date.localeCompare(b.date));
  return planWithChecks(next, warnings, explanation);
}

export function markDone(plan: RoutinePlan, id: string): RoutinePlan {
  const next = copyPlan(plan);
  const routine = copyFor(next.input.language).routine;
  if (typeof id !== 'string' || id.trim() === '') invalid('id debe ser texto.');
  const index = next.sessions.findIndex((session) => session.id === id);
  if (index < 0) throw new Error(routine.notFound);
  if (next.sessions[index].status === 'missed') {
    throw new Error(routine.cannotCompleteMissed);
  }
  if (next.sessions[index].status === 'planned') {
    next.sessions[index] = { ...next.sessions[index], status: 'done' };
  }
  return planWithChecks(next);
}

function markdownText(value: string): string {
  return compact(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/([\\`*_{}[\]()#+.!|])/gu, '\\$1');
}

export function toMarkdown(plan: RoutinePlan): string {
  const current = copyPlan(plan);
  const copy = copyFor(current.input.language);
  const exportCopy = copy.export;
  const mode = current.mode === 'demo' ? exportCopy.modeDemo : exportCopy.modeLive;
  const lines = [
    `# ${markdownText(current.intent.title)}`,
    '',
    `**${current.input.language === 'en' ? 'Request' : 'Solicitud'}:** ${markdownText(current.input.request)}`,
    `**${exportCopy.objective}:** ${markdownText(current.intent.goal)}`,
    `**${current.input.language === 'en' ? 'Mode' : 'Modo'}:** ${mode}`,
    '',
    markdownText(current.explanation),
    '',
    `## ${exportCopy.sessions}`,
    '',
  ];
  for (const session of current.sessions) {
    const marker = session.status === 'done' ? 'x' : session.status === 'missed' ? '-' : ' ';
    lines.push(`- [${marker}] ${session.date} · ${markdownText(session.title)} · ${session.minutes} min (${exportCopy[session.status]})`);
    lines.push(`  ${markdownText(session.instructions)}`);
    session.blocks.forEach((block, index) => {
      lines.push(`  ${index + 1}. **${block.minutes} min:** ${markdownText(block.activity)}`);
    });
    lines.push(`  **${exportCopy.deliverable}:** ${markdownText(session.deliverable)}`);
    lines.push(`  **${exportCopy.doneWhen}:** ${markdownText(session.doneWhen)}`);
  }
  lines.push('', `## ${exportCopy.checks}`, '');
  for (const check of current.checks) {
    lines.push(`- [${check.passed ? 'x' : ' '}] ${markdownText(check.label)}: ${markdownText(check.detail)}`);
  }
  if (current.warnings.length > 0) {
    lines.push('', `## ${exportCopy.warnings}`, '');
    for (const warning of current.warnings) lines.push(`- ${markdownText(warning)}`);
  }
  return `${lines.join('\n')}\n`;
}

function icsText(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/\r\n|\r|\n/gu, '\\n')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,');
}

function sessionDescription(session: Session, language: Language): string {
  const exportCopy = copyFor(language).export;
  return [
    session.instructions,
    '',
    `${exportCopy.agenda}:`,
    ...session.blocks.map(
      (block, index) => `${index + 1}. ${block.minutes} min — ${block.activity}`,
    ),
    '',
    `${exportCopy.deliverable}: ${session.deliverable}`,
    `${exportCopy.doneWhen}: ${session.doneWhen}`,
  ].join('\n');
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function foldLine(line: string): string {
  if (byteLength(line) <= 75) return line;
  const chunks: string[] = [];
  let chunk = '';
  let limit = 75;
  for (const character of line) {
    if (chunk && byteLength(`${chunk}${character}`) > limit) {
      chunks.push(chunk);
      chunk = '';
      limit = 74;
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((part, index) => (index === 0 ? part : ` ${part}`)).join('\r\n');
}

function icsDateTime(date: string, time: string): string {
  return `${date.replace(/-/gu, '')}T${time.replace(':', '')}00`;
}

function icsEnd(date: string, time: string, minutes: number): string {
  const end = dateValue(date);
  end.setUTCMinutes(timeMinutes(time) + minutes);
  const hours = String(end.getUTCHours()).padStart(2, '0');
  const mins = String(end.getUTCMinutes()).padStart(2, '0');
  return `${dateString(end).replace(/-/gu, '')}T${hours}${mins}00`;
}

function routineFingerprint(input: RoutineInput): string {
  let hash = 2_166_136_261;
  const material = `${input.request}|${input.startDate}|${input.time}|${input.days.join(',')}`;
  for (const character of material) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function exportStamp(): string {
  return `${new Date().toISOString().slice(0, 19).replace(/[-:]/gu, '')}Z`;
}

export function toICS(plan: RoutinePlan): string {
  const current = copyPlan(plan);
  const exportCopy = copyFor(current.input.language).export;
  const routineId = routineFingerprint(current.input);
  const stamp = exportStamp();
  const weekStart = current.input.startDate;
  const events = current.sessions.filter((session) => {
    const offset = dayOffset(weekStart, session.date);
    return session.status !== 'missed' && offset >= 0 && offset <= 6;
  });
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Cadencia//${exportCopy.icsProductId}//${current.input.language.toUpperCase()}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const session of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:routine-${routineId}-${session.id}@cadencia.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDateTime(session.date, current.input.time)}`,
      `DTEND:${icsEnd(session.date, current.input.time, session.minutes)}`,
      `SUMMARY:${icsText(session.title)}`,
      `DESCRIPTION:${icsText(sessionDescription(session, current.input.language))}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
