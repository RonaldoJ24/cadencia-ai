'use client';

import {
  ArrowUpRight,
  CalendarPlus,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  LoaderCircle,
  RotateCcw,
  Share2,
  WandSparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import {
  ProductFooter,
  ProductNotes,
  ProductStory,
} from '@/components/product-story';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { googleCalendarUrl, routineShareText } from '@/lib/calendar';
import { buildInsights } from '@/lib/insights';
import {
  buildPlan,
  markDone,
  replan,
  toICS,
  toMarkdown,
  type RoutineInput,
  type RoutinePlan,
  type Session,
} from '@/lib/routine';

const DAY_NAMES = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];
const DAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DEFAULT_START_DATE = '2026-08-31';

function subscribeToWeekStart() {
  return () => {};
}

function getServerWeekStart() {
  return DEFAULT_START_DATE;
}

function getLocalWeekStart() {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return [
    monday.getFullYear(),
    String(monday.getMonth() + 1).padStart(2, '0'),
    String(monday.getDate()).padStart(2, '0'),
  ].join('-');
}

const EXAMPLES: Array<{ label: string; input: RoutineInput }> = [
  {
    label: 'Inglés para entrevistas',
    input: {
      request:
        'Practicar inglés para entrevistas de trabajo, con foco en responder con más seguridad.',
      days: [0, 1, 2, 3, 4],
      sessionMinutes: 30,
      weeklyMinutes: 90,
      startDate: DEFAULT_START_DATE,
      time: '07:30',
    },
  },
  {
    label: 'Aprender TypeScript',
    input: {
      request:
        'Aprender TypeScript construyendo un pequeño proyecto lateral y entendiendo sus tipos.',
      days: [1, 3, 5],
      sessionMinutes: 45,
      weeklyMinutes: 135,
      startDate: DEFAULT_START_DATE,
      time: '19:00',
    },
  },
  {
    label: 'Escribir cada semana',
    input: {
      request:
        'Escribir una pieza breve cada semana, empezando por un esquema y una primera versión.',
      days: [0, 2, 5],
      sessionMinutes: 35,
      weeklyMinutes: 105,
      startDate: DEFAULT_START_DATE,
      time: '08:00',
    },
  },
];

type RequestState = 'idle' | 'loading' | 'error';

function sessionStatusLabel(status: Session['status']) {
  if (status === 'done') return 'Completada';
  if (status === 'missed') return 'Perdida';
  return 'Pendiente';
}

function domainLabel(domain: RoutinePlan['intent']['domain']) {
  if (domain === 'learning') return 'Aprendizaje';
  if (domain === 'creative') return 'Práctica creativa';
  return 'General';
}

function sameInput(left: RoutineInput, right: RoutineInput) {
  return (
    left.request === right.request &&
    left.days.join(',') === right.days.join(',') &&
    left.sessionMinutes === right.sessionMinutes &&
    left.weeklyMinutes === right.weeklyMinutes &&
    left.startDate === right.startDate &&
    left.time === right.time
  );
}

function formatSessionDate(date: string) {
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace('.', '');
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function RhythmMap({
  sessions,
  input,
}: {
  sessions: Session[];
  input: RoutineInput;
}) {
  return (
    <div className="rhythm-map" aria-label="Mapa semanal de sesiones">
      {DAY_NAMES.map((name, index) => {
        const session = sessions.find((item) => item.dayIndex === index);
        return (
          <div className="rhythm-day" key={name}>
            <span className="rhythm-day-label">{DAY_SHORT[index]}</span>
            <div className="rhythm-track" aria-hidden="true">
              <span
                className={`rhythm-bar ${session ? 'is-on' : ''} ${
                  session?.status === 'done' ? 'is-done' : ''
                }`}
                style={{
                  height: session
                    ? `${Math.min(82, 38 + session.minutes)}%`
                    : '16%',
                }}
              />
            </div>
            <span className="rhythm-day-name">{name.slice(0, 3)}</span>
          </div>
        );
      })}
      <span className="sr-only">
        {sessions.length} sesiones en {input.days.length} días disponibles.
      </span>
    </div>
  );
}

function RoutinePreview({
  plan,
  stale,
  controlsDisabled,
  selectedSessionId,
  onSelectSession,
  onMarkDone,
  onReplan,
  onReset,
  onDownloadMarkdown,
  onDownloadICS,
  onAddToGoogle,
  onShare,
  onRefine,
  shareStatus,
}: {
  plan: RoutinePlan;
  stale: boolean;
  controlsDisabled: boolean;
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onMarkDone: (id: string) => void;
  onReplan: (id: string) => void;
  onReset: () => void;
  onDownloadMarkdown: () => void;
  onDownloadICS: () => void;
  onAddToGoogle: (session: Session) => void;
  onShare: () => void;
  onRefine: () => void;
  shareStatus: string | null;
}) {
  const selectedSession =
    plan.sessions.find((session) => session.id === selectedSessionId) ??
    plan.sessions[0];
  const doneCount = plan.sessions.filter(
    (session) => session.status === 'done',
  ).length;
  const plannedCount = plan.sessions.filter(
    (session) => session.status !== 'missed',
  ).length;
  const totalMinutes = plan.sessions
    .filter((session) => session.status !== 'missed')
    .reduce((total, session) => total + session.minutes, 0);
  const noReplacementWarning = plan.warnings.some((warning) =>
    warning.startsWith('No hay un día permitido y libre después'),
  );
  const insights = buildInsights(plan);

  return (
    <div className={`preview-card routine-card${stale ? ' is-stale' : ''}`}>
      <div className="preview-card-header routine-header">
        <div>
          <span className="sample-kicker">
            <span className="sample-marker" aria-hidden="true" />
            {plan.mode === 'deepseek'
              ? 'IA real · servidor'
              : 'Demo local · sin modelo'}
          </span>
          <h2 id="preview-title">{plan.intent.title}</h2>
          <p>{plan.intent.goal}</p>
        </div>
        <button
          className="reset-button"
          type="button"
          onClick={onReset}
          disabled={controlsDisabled}
        >
          <RotateCcw size={14} aria-hidden="true" />
          <span className="sr-only">Volver al ejemplo</span>
        </button>
      </div>

      {stale ? (
        <output className="stale-banner">
          <span>
            Cambiaste una condición. Esta vista conserva el plan anterior hasta
            que lo regeneres.
          </span>
        </output>
      ) : null}

      <div className="rhythm-header">
        <span>Cadencia semanal</span>
        <span>
          {plannedCount} sesiones · {totalMinutes} min
        </span>
      </div>
      <RhythmMap input={plan.input} sessions={plan.sessions} />

      {plan.warnings.length > 0 ? (
        <output className="warning-box">
          <span className="warning-mark" aria-hidden="true">
            !
          </span>
          <div>
            <strong>Hay algo que revisar</strong>
            {plan.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </output>
      ) : null}

      <section className="insight-panel" aria-labelledby="insight-title">
        <div className="insight-heading">
          <div>
            <span className="decision-label">Lectura avanzada</span>
            <h3 id="insight-title">Lo que este ritmo permite</h3>
          </div>
          <span className="insight-horizon">4 semanas</span>
        </div>
        <div className="insight-metrics">
          <p>{insights.capacity}</p>
          <p>{insights.fourWeekProjection}</p>
        </div>
        <div className="insight-recommendation">
          <strong>Siguiente decisión</strong>
          <p>{insights.recommendation}</p>
        </div>
        <div className="insight-columns">
          {insights.clarifyingQuestions.length > 0 ? (
            <div>
              <strong>Para afinar el plan</strong>
              <ul>
                {insights.clarifyingQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
              <button
                className="refine-button"
                type="button"
                onClick={onRefine}
              >
                Responder en mi petición
              </button>
            </div>
          ) : null}
          <div>
            <strong>Señales de avance</strong>
            <ul>
              {insights.successSignals.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="plan-summary" aria-live="polite">
        <span>
          {doneCount} de {plan.sessions.length} completadas
        </span>
        <span className="plan-summary-line" aria-hidden="true" />
        <span>{plan.input.time} · hora local</span>
      </div>

      <div
        className="session-list dynamic-session-list"
        aria-label="Sesiones de la rutina"
      >
        {plan.sessions.map((session) => (
          <button
            className={`session-row session-button${
              selectedSession?.id === session.id ? ' is-current' : ''
            } ${session.status === 'done' ? ' is-complete' : ''} ${
              session.status === 'missed' ? ' is-missed' : ''
            }`}
            key={session.id}
            type="button"
            onClick={() => onSelectSession(session.id)}
            disabled={controlsDisabled}
            aria-pressed={selectedSession?.id === session.id}
          >
            <div className="session-tone tone-lime" aria-hidden="true" />
            <div className="session-main">
              <div className="session-meta">
                <span>{formatSessionDate(session.date)}</span>
                <span className="session-separator">/</span>
                <span>{sessionStatusLabel(session.status)}</span>
              </div>
              <h3>{session.title}</h3>
            </div>
            <span className="session-minutes">{session.minutes}m</span>
          </button>
        ))}
      </div>

      {selectedSession ? (
        <SessionDetail
          session={selectedSession}
          stale={stale}
          disabled={stale || controlsDisabled}
          noReplacementWarning={noReplacementWarning}
          onMarkDone={onMarkDone}
          onReplan={onReplan}
        />
      ) : (
        <div className="empty-plan">
          No hay sesiones compatibles con estos límites todavía.
        </div>
      )}

      <details className="decision-details">
        <summary>
          <span>Cómo se decidió</span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="decision-content">
          <div className="decision-block">
            <span className="decision-label">Intención entendida</span>
            <p>{plan.intent.goal}</p>
            <span className="intent-domain">
              {domainLabel(plan.intent.domain)}
            </span>
          </div>
          <div className="decision-block">
            <span className="decision-label">Comprobaciones deterministas</span>
            <ul className="check-list">
              {plan.checks.map((check) => (
                <li
                  key={check.label}
                  className={check.passed ? 'is-passed' : 'is-failed'}
                >
                  {check.passed ? (
                    <CheckCircle2 size={14} aria-hidden="true" />
                  ) : (
                    <X size={14} aria-hidden="true" />
                  )}
                  <span>
                    <strong>{check.label}</strong>
                    <small>{check.detail}</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="decision-explanation">{plan.explanation}</p>
          <p className="decision-honesty">
            {plan.mode === 'deepseek'
              ? 'La IA propuso la intención; Cadencia comprobó las fechas, los días y el tiempo antes de mostrarla.'
              : 'Esta salida se construyó localmente con reglas deterministas. No es una respuesta de IA.'}
          </p>
        </div>
      </details>

      <div className="export-row integration-row">
        <span>
          Calendario y acompañamiento
          <small>Copias puntuales; no sincronizan cambios.</small>
        </span>
        <div className="export-actions">
          <button
            type="button"
            onClick={() => selectedSession && onAddToGoogle(selectedSession)}
            title="Añadir la sesión seleccionada a Google Calendar"
            disabled={
              stale || !selectedSession || selectedSession.status === 'missed'
            }
          >
            <CalendarPlus size={13} aria-hidden="true" />
            Google · sesión
          </button>
          <button
            type="button"
            onClick={onDownloadMarkdown}
            disabled={stale}
            title="Descargar un resumen de la rutina"
          >
            <Download size={13} aria-hidden="true" />
            Resumen .md
          </button>
          <button
            type="button"
            onClick={onDownloadICS}
            disabled={stale}
            title="Descargar toda la rutina en formato ICS"
          >
            <Download size={13} aria-hidden="true" />
            Apple / Outlook · rutina
          </button>
          <button type="button" onClick={onShare} disabled={stale}>
            <Share2 size={13} aria-hidden="true" />
            Compartir
          </button>
        </div>
        {shareStatus ? (
          <output className="share-status">{shareStatus}</output>
        ) : null}
      </div>
    </div>
  );
}

function SessionDetail({
  session,
  stale,
  disabled,
  noReplacementWarning,
  onMarkDone,
  onReplan,
}: {
  session: Session;
  stale: boolean;
  disabled: boolean;
  noReplacementWarning: boolean;
  onMarkDone: (id: string) => void;
  onReplan: (id: string) => void;
}) {
  return (
    <div className="session-detail" aria-live="polite">
      <div className="detail-heading">
        <span className="detail-kicker">Sesión seleccionada</span>
        <span className={`detail-status status-${session.status}`}>
          {sessionStatusLabel(session.status)}
        </span>
      </div>
      <h3>{session.title}</h3>
      <p>{session.instructions}</p>
      <div className="detail-actions">
        {session.status === 'planned' ? (
          <>
            <Button
              className="done-button"
              size="sm"
              type="button"
              onClick={() => onMarkDone(session.id)}
              disabled={disabled}
            >
              <Check size={14} aria-hidden="true" />
              Marcar completada
            </Button>
            <button
              className="missed-button"
              type="button"
              onClick={() => onReplan(session.id)}
              disabled={disabled}
            >
              No pude, reajustar
            </button>
          </>
        ) : session.status === 'done' ? (
          <span className="done-copy">
            <CheckCircle2 size={14} aria-hidden="true" />
            Hecha. Tu objetivo sigue intacto.
          </span>
        ) : (
          <span className="missed-copy">
            {noReplacementWarning
              ? 'Marcada como perdida; revisa el aviso del plan.'
              : 'Se reajustó conservando las sesiones completadas.'}
          </span>
        )}
      </div>
      {stale ? (
        <p className="stale-detail-note">
          Regenera la rutina para editar una sesión con tus nuevos límites.
        </p>
      ) : null}
    </div>
  );
}

export default function Home() {
  // Keep the server snapshot stable; resolve the local week after hydration.
  const localWeekStart = useSyncExternalStore(
    subscribeToWeekStart,
    getLocalWeekStart,
    getServerWeekStart,
  );
  const [draftInput, setInput] = useState<
    Omit<RoutineInput, 'startDate'> & { startDate: string | null }
  >({ ...EXAMPLES[0].input, startDate: null });
  const input: RoutineInput = {
    ...draftInput,
    startDate: draftInput.startDate ?? localWeekStart,
  };
  const [plan, setPlan] = useState<RoutinePlan | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [availabilityKnown, setAvailabilityKnown] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/routine')
      .then(async (response) => {
        if (!response.ok) return { liveAvailable: false };
        return (await response.json()) as { liveAvailable?: boolean };
      })
      .then((payload) => {
        if (!active) return;
        setLiveAvailable(payload.liveAvailable === true);
        setAvailabilityKnown(true);
      })
      .catch(() => {
        if (!active) return;
        setLiveAvailable(false);
        setAvailabilityKnown(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const stale = plan !== null && !sameInput(plan.input, input);
  const selectedDaysCount = input.days.length;
  const configuredMinutes = selectedDaysCount * input.sessionMinutes;
  const availableModeLabel =
    mode === 'live' ? 'IA real · servidor' : 'Demo local · sin modelo';
  const controlsDisabled = requestState === 'loading';

  const updateInput = (patch: Partial<RoutineInput>) => {
    setInput((current) => ({ ...current, ...patch }));
  };

  const applyExample = (example: (typeof EXAMPLES)[number]) => {
    setInput((current) => ({
      ...example.input,
      startDate: current.startDate,
      days: [...example.input.days],
    }));
    setPlan(null);
    setSelectedSessionId(null);
    setError(null);
    setRequestState('idle');
    setShareStatus(null);
  };

  const resetSample = () => applyExample(EXAMPLES[0]);

  const handleGenerate = async () => {
    setError(null);
    setRequestState('loading');
    try {
      let nextPlan: RoutinePlan;
      if (mode === 'live') {
        const response = await fetch('/api/routine', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input, mode: 'deepseek' }),
        });
        const payload = (await response.json()) as {
          plan?: RoutinePlan;
          error?: string;
        };
        if (!response.ok || !payload.plan) {
          throw new Error(
            payload.error ?? 'No pudimos conectar con el proveedor de IA.',
          );
        }
        nextPlan = payload.plan;
      } else {
        nextPlan = buildPlan(input, undefined, 'demo');
      }
      setPlan(nextPlan);
      setSelectedSessionId(nextPlan.sessions[0]?.id ?? null);
      setRequestState('idle');
      setShareStatus(null);
    } catch (cause) {
      setRequestState('error');
      setError(
        cause instanceof Error
          ? cause.message
          : 'No pudimos crear esta rutina.',
      );
    }
  };

  const updatePlan = (updater: (current: RoutinePlan) => RoutinePlan) => {
    setShareStatus(null);
    setPlan((current) => {
      if (!current) return current;
      try {
        return updater(current);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'No pudimos actualizar esta rutina.',
        );
        return current;
      }
    });
  };

  const handleDownloadMarkdown = () => {
    if (!plan || stale) return;
    downloadText(
      'cadencia-rutina.md',
      toMarkdown(plan),
      'text/markdown;charset=utf-8',
    );
  };

  const handleDownloadICS = () => {
    if (!plan || stale) return;
    downloadText(
      'cadencia-rutina.ics',
      toICS(plan),
      'text/calendar;charset=utf-8',
    );
  };

  const handleAddToGoogle = (session: Session) => {
    if (!plan || stale) return;
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const link = document.createElement('a');
      link.href = googleCalendarUrl(plan, session, timeZone);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No pudimos preparar el evento de calendario.',
      );
    }
  };

  const handleShare = async () => {
    if (!plan || stale) return;
    const text = routineShareText(plan);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: plan.intent.title, text });
        setShareStatus('Rutina compartida.');
      } else {
        await navigator.clipboard.writeText(text);
        setShareStatus('Rutina copiada para compartir.');
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError('No pudimos compartir la rutina en este navegador.');
    }
  };

  const handleRefine = () => {
    const field = document.getElementById('goal');
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field?.focus();
  };

  const sampleCountLabel = useMemo(() => {
    if (selectedDaysCount === 0) return 'ningún día';
    return `${selectedDaysCount} ${selectedDaysCount === 1 ? 'día' : 'días'}`;
  }, [selectedDaysCount]);

  return (
    <main className="cadencia-shell" id="inicio">
      <a className="skip-link" href="#planificador">
        Ir al planificador
      </a>
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Cadencia, inicio">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-word">cadencia</span>
          <span className="brand-note">tu semana, a tu ritmo</span>
        </a>

        <nav className="product-nav" aria-label="Navegación principal">
          <a href="#planificador">Planificar</a>
          <a href="#como-funciona">Cómo funciona</a>
        </nav>
        <div className="topbar-meta">
          <span className="mode-pill">
            <span className="status-dot" aria-hidden="true" />
            {availableModeLabel}
          </span>
        </div>
      </header>

      <ProductStory />

      <div className="workspace" id="planificador" tabIndex={-1}>
        <section className="editor-column" aria-labelledby="editor-title">
          <div className="planner-heading">
            <p className="product-kicker">Ahora, con tu semana</p>
            <h2 id="editor-title">Haz espacio para lo que quieres sostener.</h2>
            <p className="intro-copy">
              Elige un objetivo y tus límites. Puedes probar, reajustar y
              llevarte una copia del plan.
            </p>
          </div>

          <div className="editor-form" aria-busy={requestState === 'loading'}>
            <div className="form-section form-section-goal">
              <div className="section-number" aria-hidden="true">
                01
              </div>
              <div className="section-body">
                <label className="field-label" htmlFor="goal">
                  ¿Qué quieres volver constante?
                </label>
                <Textarea
                  id="goal"
                  name="goal"
                  rows={3}
                  value={input.request}
                  onChange={(event) =>
                    updateInput({ request: event.target.value })
                  }
                  disabled={controlsDisabled}
                  aria-describedby="goal-help"
                  className="goal-input"
                />
                <p className="field-help" id="goal-help">
                  Puedes escribirlo como se lo contarías a una persona.
                </p>
                <div className="example-row" aria-label="Ejemplos de intención">
                  <span className="example-label">Prueba con</span>
                  {EXAMPLES.slice(1).map((example) => (
                    <button
                      className="example-chip"
                      key={example.label}
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => applyExample(example)}
                    >
                      {example.label}
                      <ArrowUpRight size={13} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="section-number" aria-hidden="true">
                02
              </div>
              <div className="section-body">
                <div className="section-heading">
                  <div>
                    <p className="field-label">Elige tus pulsos</p>
                    <p className="field-help">
                      Tus días tienen la última palabra.
                    </p>
                  </div>
                  <span className="constraint-value">{sampleCountLabel}</span>
                </div>
                <fieldset className="day-toggle-row">
                  <legend className="sr-only">Días disponibles</legend>
                  {DAY_NAMES.map((name, index) => {
                    const selected = input.days.includes(index);
                    return (
                      <button
                        aria-pressed={selected}
                        className={`day-toggle${selected ? ' is-selected' : ''}`}
                        key={name}
                        type="button"
                        disabled={controlsDisabled}
                        onClick={() =>
                          updateInput({
                            days: selected
                              ? input.days.filter((day) => day !== index)
                              : [...input.days, index].sort((a, b) => a - b),
                          })
                        }
                      >
                        <span className="day-short">{DAY_SHORT[index]}</span>
                        <span className="day-name">{name}</span>
                        {selected ? (
                          <Check size={12} aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })}
                </fieldset>
              </div>
            </div>

            <div className="form-section">
              <div className="section-number" aria-hidden="true">
                03
              </div>
              <div className="section-body">
                <div className="field-grid">
                  <label className="control-field" htmlFor="session-minutes">
                    <span className="field-label">Minutos por sesión</span>
                    <span className="input-with-suffix">
                      <Input
                        id="session-minutes"
                        type="number"
                        value={input.sessionMinutes}
                        min={5}
                        max={240}
                        onChange={(event) =>
                          updateInput({
                            sessionMinutes: Number(event.target.value) || 0,
                          })
                        }
                        disabled={controlsDisabled}
                      />
                      <span>min</span>
                    </span>
                  </label>
                  <label className="control-field" htmlFor="weekly-minutes">
                    <span className="field-label">Tope semanal</span>
                    <span className="input-with-suffix">
                      <Input
                        id="weekly-minutes"
                        type="number"
                        value={input.weeklyMinutes}
                        min={10}
                        max={10080}
                        onChange={(event) =>
                          updateInput({
                            weeklyMinutes: Number(event.target.value) || 0,
                          })
                        }
                        disabled={controlsDisabled}
                      />
                      <span>min</span>
                    </span>
                  </label>
                </div>
                <div className="field-grid field-grid-second">
                  <label className="control-field" htmlFor="start-date">
                    <span className="field-label">
                      Semana que empieza (lunes)
                    </span>
                    <span className="input-with-icon">
                      <CalendarDays size={15} aria-hidden="true" />
                      <Input
                        id="start-date"
                        type="date"
                        value={input.startDate}
                        onChange={(event) =>
                          updateInput({ startDate: event.target.value })
                        }
                        disabled={controlsDisabled}
                      />
                    </span>
                  </label>
                  <label className="control-field" htmlFor="start-time">
                    <span className="field-label">Hora local</span>
                    <span className="input-with-icon">
                      <Clock3 size={15} aria-hidden="true" />
                      <Input
                        id="start-time"
                        type="time"
                        value={input.time}
                        onChange={(event) =>
                          updateInput({ time: event.target.value })
                        }
                        disabled={controlsDisabled}
                      />
                    </span>
                  </label>
                </div>
                <p className="capacity-note">
                  {configuredMinutes > input.weeklyMinutes ? (
                    <>
                      Tus días configurarían {configuredMinutes} min; el tope
                      puede reducir sesiones.
                    </>
                  ) : (
                    <>
                      Hay espacio para {configuredMinutes} min con esta
                      selección.
                    </>
                  )}
                </p>
                <p className="authority-note">
                  Los días, minutos, hora y tope elegidos prevalecen sobre el
                  texto; la semana debe empezar en lunes.
                </p>
              </div>
            </div>

            <div className="mode-section">
              <div className="mode-section-heading">
                <div>
                  <p className="field-label">Quién propone el contenido</p>
                  <p className="field-help">
                    Los días y minutos que elegiste siguen mandando.
                  </p>
                </div>
                <span className="mode-selection-label">
                  {availableModeLabel}
                </span>
              </div>
              <fieldset className="mode-options">
                <legend className="sr-only">Modo de generación</legend>
                <button
                  className={`mode-option${mode === 'demo' ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={mode === 'demo'}
                  disabled={controlsDisabled}
                  onClick={() => setMode('demo')}
                >
                  <span className="mode-option-title">Demo local</span>
                  <span>Salida determinista, sin modelo.</span>
                </button>
                <button
                  className={`mode-option${mode === 'live' ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={mode === 'live'}
                  disabled={!liveAvailable || controlsDisabled}
                  onClick={() => setMode('live')}
                  title={
                    !liveAvailable
                      ? 'El modo conectado no está disponible en esta versión.'
                      : undefined
                  }
                >
                  <span className="mode-option-title">IA conectada</span>
                  <span>
                    {availabilityKnown && liveAvailable
                      ? 'DeepSeek opcional.'
                      : 'No disponible aquí.'}
                  </span>
                </button>
              </fieldset>
              {!liveAvailable ? (
                <p className="mode-help">
                  Puedes explorar todo el planificador con contenido de ejemplo,
                  sin llamadas a IA. El modo conectado se habilita por separado.
                </p>
              ) : null}
              {mode === 'live' && liveAvailable ? (
                <p className="live-warning">
                  Al crear, tu petición se enviará a DeepSeek; evita datos
                  sensibles y considera posibles costes.
                </p>
              ) : null}
            </div>

            <div className="form-actions">
              <Button
                className="create-button"
                size="lg"
                type="button"
                onClick={handleGenerate}
                disabled={
                  requestState === 'loading' ||
                  (mode === 'live' && !liveAvailable)
                }
              >
                {requestState === 'loading' ? (
                  <LoaderCircle className="spin" size={17} aria-hidden="true" />
                ) : (
                  <WandSparkles size={17} aria-hidden="true" />
                )}
                {requestState === 'loading' ? 'Creando…' : 'Crear mi rutina'}
              </Button>
            </div>
            {error ? (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label="Cerrar error"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="preview-column" aria-labelledby="preview-title">
          <div className="preview-label-row">
            <p className="eyebrow">Vista de la semana</p>
            <span className="preview-index">
              {plan ? 'TU PLAN' : 'POR CREAR'}
            </span>
          </div>
          {plan ? (
            <RoutinePreview
              onDownloadICS={handleDownloadICS}
              onDownloadMarkdown={handleDownloadMarkdown}
              onAddToGoogle={handleAddToGoogle}
              onShare={handleShare}
              onRefine={handleRefine}
              onMarkDone={(id) =>
                updatePlan((current) => markDone(current, id))
              }
              onReplan={(id) => updatePlan((current) => replan(current, id))}
              onReset={resetSample}
              onSelectSession={setSelectedSessionId}
              plan={plan}
              selectedSessionId={selectedSessionId}
              shareStatus={shareStatus}
              stale={stale}
              controlsDisabled={controlsDisabled}
            />
          ) : (
            <div className="preview-card planner-empty">
              <CalendarDays size={30} aria-hidden="true" />
              <h2 id="preview-title">Tu semana empieza aquí.</h2>
              <p>
                Al crear tu rutina verás las sesiones, el tiempo que ocupan y
                las comprobaciones del plan.
              </p>
              <ol>
                <li>Un objetivo que quieras sostener.</li>
                <li>Los días y minutos que tienes.</li>
                <li>Un plan que puedes ajustar.</li>
              </ol>
              <p className="planner-empty-note">
                La demo usa contenido de ejemplo y se reinicia al recargar.
                Puedes descargar el resultado.
              </p>
            </div>
          )}
        </aside>
      </div>
      <ProductNotes />
      <ProductFooter />
    </main>
  );
}
