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
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { googleCalendarUrl, routineShareText } from '@/lib/calendar';
import { buildInsights } from '@/lib/insights';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  copyFor,
  isLanguage,
  isCurrentRequestGeneration,
  type Language,
} from '@/lib/i18n';
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

const DEFAULT_START_DATE = '2026-08-31';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type Example = { label: string; input: RoutineInput };

const EXAMPLES: Readonly<Record<Language, Example[]>> = {
  en: [
    {
      label: 'English for interviews',
      input: {
        request: 'Practice English for job interviews, focusing on answering with more confidence.',
        days: [0, 1, 2, 3, 4],
        sessionMinutes: 30,
        weeklyMinutes: 90,
        startDate: DEFAULT_START_DATE,
        time: '07:30',
        language: 'en',
      },
    },
    {
      label: 'Learn TypeScript',
      input: {
        request: 'Learn TypeScript by building a small side project and understanding its types.',
        days: [1, 3, 5],
        sessionMinutes: 45,
        weeklyMinutes: 135,
        startDate: DEFAULT_START_DATE,
        time: '19:00',
        language: 'en',
      },
    },
    {
      label: 'Write each week',
      input: {
        request: 'Write one short piece each week, starting with an outline and a first draft.',
        days: [0, 2, 5],
        sessionMinutes: 35,
        weeklyMinutes: 105,
        startDate: DEFAULT_START_DATE,
        time: '08:00',
        language: 'en',
      },
    },
  ],
  es: [
    {
      label: 'Inglés para entrevistas',
      input: {
        request: 'Practicar inglés para entrevistas de trabajo, con foco en responder con más seguridad.',
        days: [0, 1, 2, 3, 4],
        sessionMinutes: 30,
        weeklyMinutes: 90,
        startDate: DEFAULT_START_DATE,
        time: '07:30',
        language: 'es',
      },
    },
    {
      label: 'Aprender TypeScript',
      input: {
        request: 'Aprender TypeScript construyendo un pequeño proyecto lateral y entendiendo sus tipos.',
        days: [1, 3, 5],
        sessionMinutes: 45,
        weeklyMinutes: 135,
        startDate: DEFAULT_START_DATE,
        time: '19:00',
        language: 'es',
      },
    },
    {
      label: 'Escribir cada semana',
      input: {
        request: 'Escribir una pieza breve cada semana, empezando por un esquema y una primera versión.',
        days: [0, 2, 5],
        sessionMinutes: 35,
        weeklyMinutes: 105,
        startDate: DEFAULT_START_DATE,
        time: '08:00',
        language: 'es',
      },
    },
  ],
};

const SAMPLE_SESSIONS: Readonly<Record<Language, Array<{
  day: string;
  kind: string;
  title: string;
  minutes: number;
  tone: string;
}>>> = {
  en: [
    { day: 'Mon 31', kind: 'Warm-up', title: 'Introduce yourself clearly', minutes: 25, tone: 'lime' },
    { day: 'Tue 01', kind: 'Practice', title: 'Stories with the STAR method', minutes: 30, tone: 'cream' },
    { day: 'Thu 03', kind: 'Review', title: 'Listening: difficult questions', minutes: 25, tone: 'mint' },
    { day: 'Sat 05', kind: 'Simulation', title: 'A complete interview', minutes: 40, tone: 'blue' },
  ],
  es: [
    { day: 'Lun 31', kind: 'Calentamiento', title: 'Presentarte con claridad', minutes: 25, tone: 'lime' },
    { day: 'Mar 01', kind: 'Práctica', title: 'Historias con método STAR', minutes: 30, tone: 'cream' },
    { day: 'Jue 03', kind: 'Revisión', title: 'Escucha: preguntas difíciles', minutes: 25, tone: 'mint' },
    { day: 'Sáb 05', kind: 'Simulación', title: 'Una entrevista completa', minutes: 40, tone: 'blue' },
  ],
};

type RequestState = 'idle' | 'loading' | 'error';

type ActiveRequest = {
  controller: AbortController;
  generation: number;
  language: Language;
};

let clientLanguageSnapshot: Language | undefined;
const languageSubscribers = new Set<() => void>();

function getLanguageSnapshot(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  if (clientLanguageSnapshot) return clientLanguageSnapshot;
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    clientLanguageSnapshot = isLanguage(saved) ? saved : DEFAULT_LANGUAGE;
  } catch {
    clientLanguageSnapshot = DEFAULT_LANGUAGE;
  }
  return clientLanguageSnapshot;
}

function getServerLanguageSnapshot() {
  return DEFAULT_LANGUAGE;
}

function subscribeToLanguage(listener: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  languageSubscribers.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== LANGUAGE_STORAGE_KEY) return;
    clientLanguageSnapshot = isLanguage(event.newValue)
      ? event.newValue
      : DEFAULT_LANGUAGE;
    listener();
  };
  window.addEventListener('storage', handleStorage);
  return () => {
    languageSubscribers.delete(listener);
    window.removeEventListener('storage', handleStorage);
  };
}

function setLanguagePreference(language: Language) {
  clientLanguageSnapshot = language;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The live selection still applies when storage is unavailable.
  }
  languageSubscribers.forEach((listener) => listener());
}

function sessionStatusLabel(status: Session['status'], language: Language) {
  return copyFor(language).status[status];
}

function domainLabel(domain: RoutinePlan['intent']['domain'], language: Language) {
  return copyFor(language).domain[domain];
}

function sameInput(left: RoutineInput, right: RoutineInput) {
  return (
    left.request === right.request &&
    left.days.join(',') === right.days.join(',') &&
    left.sessionMinutes === right.sessionMinutes &&
    left.weeklyMinutes === right.weeklyMinutes &&
    left.startDate === right.startDate &&
    left.time === right.time &&
    left.language === right.language
  );
}

function formatSessionDate(date: string, language: Language) {
  return new Intl.DateTimeFormat(copyFor(language).dateLocale, {
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
  const copy = copyFor(input.language);
  return (
    <div className="rhythm-map" aria-label={copy.ui.rhythmMap}>
      {copy.dayNames.map((name, index) => {
        const session = sessions.find((item) => item.dayIndex === index);
        return (
          <div className="rhythm-day" key={name}>
            <span className="rhythm-day-label">{copy.dayShort[index]}</span>
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
        {copy.ui.sessionsInDays(sessions.length, input.days.length)}
      </span>
    </div>
  );
}

function SamplePreview({ language }: { language: Language }) {
  const copy = copyFor(language);
  const selectedDays = [0, 1, 3, 5];
  const sampleSessions = SAMPLE_SESSIONS[language];
  return (
    <div className="preview-card">
      <div className="preview-card-header">
        <div>
          <span className="sample-kicker">
            <span className="sample-marker" aria-hidden="true" />
            {copy.ui.sampleKicker}
          </span>
          <h2 id="preview-title">{copy.ui.sampleTitle}</h2>
          <p>{copy.ui.sampleGoal}</p>
        </div>
        <span className="demo-tag">{copy.ui.demoTag}</span>
      </div>

      <div className="rhythm-header">
        <span>{copy.ui.weeklyRhythm}</span>
        <span>{copy.ui.sessionCount(4, 120)}</span>
      </div>
      <div
        className="rhythm-map"
        aria-label={copy.ui.sampleRhythmMap}
      >
        {copy.dayNames.map((name, index) => (
          <div className="rhythm-day" key={name}>
            <span className="rhythm-day-label">{copy.dayShort[index]}</span>
            <div className="rhythm-track" aria-hidden="true">
              <span
                className={`rhythm-bar ${selectedDays.includes(index) ? 'is-on' : ''}`}
                style={{ height: `${32 + ((index * 13) % 35)}%` }}
              />
            </div>
            <span className="rhythm-day-name">{name.slice(0, 3)}</span>
          </div>
        ))}
      </div>

      <div className="sample-disclaimer">
        <span className="sample-disclaimer-mark" aria-hidden="true" />
        <span>
          {copy.ui.sampleDisclaimer}
        </span>
      </div>

      <div className="session-list" aria-label={copy.ui.sampleSessions}>
        {sampleSessions.map((session) => (
          <article className="session-row" key={session.title}>
            <div
              className={`session-tone tone-${session.tone}`}
              aria-hidden="true"
            />
            <div className="session-main">
              <div className="session-meta">
                <span>{session.day}</span>
                <span className="session-separator">/</span>
                <span>{session.kind}</span>
              </div>
              <h3>{session.title}</h3>
            </div>
            <span className="session-minutes">{session.minutes}m</span>
          </article>
        ))}
      </div>

      <div className="preview-card-footer">
        <span>{copy.ui.sampleFooter}</span>
        <span className="footer-line" aria-hidden="true" />
      </div>
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
  const language = plan.input.language;
  const copy = copyFor(language);
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
    warning === copy.routine.noFreeDayWarning,
  );
  const insights = buildInsights(plan);

  return (
    <div className={`preview-card routine-card${stale ? ' is-stale' : ''}`}>
      <div className="preview-card-header routine-header">
        <div>
            <span className="sample-kicker">
              <span className="sample-marker" aria-hidden="true" />
            {plan.mode === 'deepseek'
              ? copy.ui.liveMode
              : copy.ui.demoMode}
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
          <span className="sr-only">{copy.ui.reset}</span>
        </button>
      </div>

      {stale ? (
        <output className="stale-banner">
          <span>{copy.ui.stale}</span>
        </output>
      ) : null}

      <div className="rhythm-header">
        <span>{copy.ui.weeklyRhythm}</span>
        <span>{copy.ui.sessionCount(plannedCount, totalMinutes)}</span>
      </div>
      <RhythmMap input={plan.input} sessions={plan.sessions} />

      {plan.warnings.length > 0 ? (
        <output className="warning-box">
          <span className="warning-mark" aria-hidden="true">
            !
          </span>
          <div>
            <strong>{copy.ui.warningHeading}</strong>
            {plan.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </output>
      ) : null}

      <section className="insight-panel" aria-labelledby="insight-title">
        <div className="insight-heading">
          <div>
            <span className="decision-label">{copy.ui.insightLabel}</span>
            <h3 id="insight-title">{copy.ui.insightTitle}</h3>
          </div>
          <span className="insight-horizon">{copy.ui.insightHorizon}</span>
        </div>
        <div className="insight-metrics">
          <p>{insights.capacity}</p>
          <p>{insights.fourWeekProjection}</p>
        </div>
        <div className="insight-recommendation">
            <strong>{copy.ui.nextDecision}</strong>
          <p>{insights.recommendation}</p>
        </div>
        <div className="insight-columns">
          {insights.clarifyingQuestions.length > 0 ? (
            <div>
                <strong>{copy.ui.refinePlan}</strong>
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
                {copy.ui.refinePlan}
              </button>
            </div>
          ) : null}
          <div>
            <strong>{copy.ui.successSignals}</strong>
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
          {copy.ui.planProgress(doneCount, plan.sessions.length)}
        </span>
        <span className="plan-summary-line" aria-hidden="true" />
        <span>{plan.input.time} · {copy.ui.localTime}</span>
      </div>

      <div
        className="session-list dynamic-session-list"
        aria-label={copy.ui.routineSessions}
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
                <span>{formatSessionDate(session.date, language)}</span>
                <span className="session-separator">/</span>
                <span>{sessionStatusLabel(session.status, language)}</span>
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
          language={language}
          stale={stale}
          disabled={stale || controlsDisabled}
          noReplacementWarning={noReplacementWarning}
          onMarkDone={onMarkDone}
          onReplan={onReplan}
        />
      ) : (
        <div className="empty-plan">
          {copy.ui.emptyPlan}
        </div>
      )}

      <details className="decision-details">
        <summary>
          <span>{copy.ui.decisionSummary}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="decision-content">
          <div className="decision-block">
            <span className="decision-label">{copy.ui.understoodIntent}</span>
            <p>{plan.intent.goal}</p>
            <span className="intent-domain">
              {domainLabel(plan.intent.domain, language)}
            </span>
          </div>
          <div className="decision-block">
            <span className="decision-label">{copy.ui.deterministicChecks}</span>
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
            {plan.mode === 'deepseek' ? copy.ui.liveHonesty : copy.ui.demoHonesty}
          </p>
        </div>
      </details>

      <div className="export-row integration-row">
        <span>
          {copy.ui.calendarCompanion}
          <small>{copy.ui.calendarCompanionHelp}</small>
        </span>
        <div className="export-actions">
          <button
            type="button"
            onClick={() => selectedSession && onAddToGoogle(selectedSession)}
            title={copy.ui.addGoogleTitle}
            disabled={
              stale || !selectedSession || selectedSession.status === 'missed'
            }
          >
            <CalendarPlus size={13} aria-hidden="true" />
            {copy.ui.addGoogle}
          </button>
          <button
            type="button"
            onClick={onDownloadMarkdown}
            disabled={stale}
            title={copy.ui.downloadMarkdownTitle}
          >
            <Download size={13} aria-hidden="true" />
            {copy.ui.downloadMarkdown}
          </button>
          <button
            type="button"
            onClick={onDownloadICS}
            disabled={stale}
            title={copy.ui.downloadIcsTitle}
          >
            <Download size={13} aria-hidden="true" />
            {copy.ui.downloadIcs}
          </button>
          <button type="button" onClick={onShare} disabled={stale}>
            <Share2 size={13} aria-hidden="true" />
            {copy.ui.share}
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
  language,
  stale,
  disabled,
  noReplacementWarning,
  onMarkDone,
  onReplan,
}: {
  session: Session;
  language: Language;
  stale: boolean;
  disabled: boolean;
  noReplacementWarning: boolean;
  onMarkDone: (id: string) => void;
  onReplan: (id: string) => void;
}) {
  const copy = copyFor(language);
  return (
    <div className="session-detail" aria-live="polite">
      <div className="detail-heading">
        <span className="detail-kicker">{copy.ui.selectedSession}</span>
        <span className={`detail-status status-${session.status}`}>
          {sessionStatusLabel(session.status, language)}
        </span>
      </div>
      <h3>{session.title}</h3>
      <p className="session-objective">{session.instructions}</p>
      <ol className="session-agenda" aria-label={copy.ui.timedAgenda}>
        {session.blocks.map((block, index) => (
          <li key={`${session.id}-block-${index}`}>
            <span>{block.minutes} min</span>
            <p>{block.activity}</p>
          </li>
        ))}
      </ol>
      <div className="session-proof-grid">
        <div>
          <span>{copy.ui.deliverable}</span>
          <p>{session.deliverable}</p>
        </div>
        <div>
          <span>{copy.ui.doneWhen}</span>
          <p>{session.doneWhen}</p>
        </div>
      </div>
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
              {copy.ui.markDone}
            </Button>
            <button
              className="missed-button"
              type="button"
              onClick={() => onReplan(session.id)}
              disabled={disabled}
            >
              {copy.ui.replan}
            </button>
          </>
        ) : session.status === 'done' ? (
          <span className="done-copy">
            <CheckCircle2 size={14} aria-hidden="true" />
            {copy.ui.doneCopy}
          </span>
        ) : (
          <span className="missed-copy">
            {noReplacementWarning
              ? copy.ui.missedWithWarning
              : copy.ui.missedReplanned}
          </span>
        )}
      </div>
      {stale ? (
        <p className="stale-detail-note">
          {copy.ui.staleDetail}
        </p>
      ) : null}
    </div>
  );
}

export default function Home() {
  const language = useSyncExternalStore(
    subscribeToLanguage,
    getLanguageSnapshot,
    getServerLanguageSnapshot,
  );
  const [draftInput, setDraftInput] = useState<RoutineInput>(
    EXAMPLES[DEFAULT_LANGUAGE][0].input,
  );
  const [usingDefaultSample, setUsingDefaultSample] = useState(true);
  const [plan, setPlan] = useState<RoutinePlan | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorReference, setErrorReference] = useState<string | null>(null);
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  // The API remains authoritative for every live POST. Start optimistically so
  // an Access-protected browser is not locked into demo mode when its optional
  // readiness fetch is redirected before the application cookie is available.
  const [liveAvailable, setLiveAvailable] = useState(true);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const latestLanguageRef = useRef(language);

  const copy = copyFor(language);

  const input = useMemo(
    () => usingDefaultSample
      ? { ...EXAMPLES[language][0].input, days: [...EXAMPLES[language][0].input.days] }
      : { ...draftInput, language },
    [draftInput, language, usingDefaultSample],
  );

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    latestLanguageRef.current = language;
    return () => {
      requestGenerationRef.current += 1;
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
    };
  }, [language]);

  const invalidateRequest = () => {
    requestGenerationRef.current += 1;
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
  };

  const beginRequest = () => {
    activeRequestRef.current?.controller.abort();
    const request: ActiveRequest = {
      controller: new AbortController(),
      generation: requestGenerationRef.current + 1,
      language,
    };
    requestGenerationRef.current = request.generation;
    activeRequestRef.current = request;
    return request;
  };

  const isCurrentRequest = (request: ActiveRequest) =>
    activeRequestRef.current === request &&
    isCurrentRequestGeneration(
      requestGenerationRef.current,
      request.generation,
    ) &&
    latestLanguageRef.current === request.language;

  const changeLanguage = (next: Language) => {
    invalidateRequest();
    setLanguagePreference(next);
    setPlan(null);
    setSelectedSessionId(null);
    setError(null);
    setErrorReference(null);
    setRequestState('idle');
    setShareStatus(null);
  };

  useEffect(() => {
    let active = true;
    // Cloudflare Access may cache a prior readiness redirect in Safari. This
    // request is safe to make fresh: it returns only a boolean and carries no
    // user routine content.
    fetch(`/api/routine?readiness=${Date.now().toString(36)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) return { liveAvailable: false };
        return (await response.json()) as { liveAvailable?: boolean };
      })
      .then((payload) => {
        if (!active) return;
        setLiveAvailable(payload.liveAvailable === true);
      })
      .catch(() => {
        if (!active) return;
        // Keep the optimistic UI state. The server still rejects an unconfigured
        // live request without exposing configuration or credential details.
      });
    return () => {
      active = false;
    };
  }, []);

  const stale = plan !== null && !sameInput(plan.input, input);
  const selectedDaysCount = input.days.length;
  const configuredMinutes = selectedDaysCount * input.sessionMinutes;
  const availableModeLabel =
    mode === 'live' ? copy.ui.liveMode : copy.ui.demoMode;
  const controlsDisabled = requestState === 'loading';

  const updateInput = (patch: Partial<RoutineInput>) => {
    setUsingDefaultSample(false);
    setDraftInput({ ...input, ...patch, language: input.language });
  };

  const applyExample = (example: Example) => {
    setUsingDefaultSample(example.input.request === EXAMPLES[language][0].input.request);
    setDraftInput({ ...example.input, days: [...example.input.days] });
    setPlan(null);
    setSelectedSessionId(null);
    setError(null);
    setErrorReference(null);
    setRequestState('idle');
    setShareStatus(null);
  };

  const resetSample = () => applyExample(EXAMPLES[language][0]);

  const handleGenerate = async () => {
    const request = beginRequest();
    setError(null);
    setErrorReference(null);
    setRequestState('loading');
    setShareStatus(null);
    try {
      let nextPlan: RoutinePlan;
      if (mode === 'live') {
        const response = await fetch('/api/routine', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input, mode: 'deepseek' }),
          signal: request.controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          plan?: RoutinePlan;
          reference?: string;
          error?: string;
        };
        if (!response.ok || !payload.plan) {
          const ref =
            typeof payload.reference === 'string' &&
            UUID_PATTERN.test(payload.reference.trim())
              ? payload.reference.trim()
              : undefined;
          const retryAfter = response.headers.get('retry-after');
          const failure = new Error(payload.error || 'routine-request-failed');
          (failure as unknown as { reference?: string }).reference = ref;
          (failure as unknown as { serverMessage?: string }).serverMessage =
            typeof payload.error === 'string' ? payload.error : undefined;
          (failure as unknown as { retryAfter?: string | null }).retryAfter = retryAfter;
          (failure as unknown as { status?: number }).status = response.status;
          throw failure;
        }
        nextPlan = payload.plan;
      } else {
        nextPlan = buildPlan(input, undefined, 'demo');
      }
      if (!isCurrentRequest(request)) return;
      setPlan(nextPlan);
      setSelectedSessionId(nextPlan.sessions[0]?.id ?? null);
      setRequestState('idle');
    } catch (cause) {
      if (!isCurrentRequest(request)) return;
      setRequestState('error');
      const err = cause as {
        reference?: string;
        serverMessage?: string;
        retryAfter?: string | null;
        status?: number;
      };
      const activeCopy = copyFor(request.language);
      if (err.serverMessage) {
        let msg = err.serverMessage;
        if (err.retryAfter && !msg.includes(err.retryAfter) && activeCopy.ui.waitSeconds) {
          msg += ` (${activeCopy.ui.waitSeconds(err.retryAfter)})`;
        }
        setError(msg);
      } else if (err.status === 429) {
        setError(activeCopy.api.rateLimited(err.retryAfter ? Number(err.retryAfter) : undefined));
      } else {
        setError(activeCopy.ui.createError);
      }
      const ref = (cause as { reference?: string })?.reference;
      setErrorReference(ref ?? null);
    } finally {
      if (activeRequestRef.current === request) {
        activeRequestRef.current = null;
      }
    }
  };

  const updatePlan = (updater: (current: RoutinePlan) => RoutinePlan) => {
    setShareStatus(null);
    setPlan((current) => {
      if (!current) return current;
      try {
        return updater(current);
      } catch {
        setError(copyFor(language).ui.updateError);
        setErrorReference(null);
        return current;
      }
    });
  };

  const handleDownloadMarkdown = () => {
    if (!plan || stale) return;
    downloadText(
      copy.ui.downloadMarkdownFilename,
      toMarkdown(plan),
      'text/markdown;charset=utf-8',
    );
  };

  const handleDownloadICS = () => {
    if (!plan || stale) return;
    downloadText(
      copy.ui.downloadIcsFilename,
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
    } catch {
      setError(copyFor(language).ui.calendarError);
      setErrorReference(null);
    }
  };

  const handleShare = async () => {
    if (!plan || stale) return;
    const text = routineShareText(plan);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: plan.intent.title, text });
        setShareStatus(copy.ui.shareSuccess);
      } else {
        await navigator.clipboard.writeText(text);
        setShareStatus(copy.ui.copySuccess);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(copy.ui.shareError);
      setErrorReference(null);
    }
  };

  const handleRefine = () => {
    const field = document.getElementById('goal');
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field?.focus();
  };

  const sampleCountLabel = useMemo(() => {
    if (selectedDaysCount === 0) return language === 'en' ? 'no days' : 'ningún día';
    return `${selectedDaysCount} ${selectedDaysCount === 1 ? (language === 'en' ? 'day' : 'día') : (language === 'en' ? 'days' : 'días')}`;
  }, [language, selectedDaysCount]);

  return (
    <main className="cadencia-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label={copy.ui.homeAria}>
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-word">cadencia</span>
          <span className="brand-note">{copy.ui.brandNote}</span>
        </a>

        <div className="topbar-meta">
          <fieldset className="language-switcher">
            <legend className="sr-only">{copy.ui.languageSelector}</legend>
            <button
              type="button"
              className={`language-option${language === 'en' ? ' is-selected' : ''}`}
              aria-pressed={language === 'en'}
              onClick={() => changeLanguage('en')}
              title={copy.ui.languageEnglish}
            >
              EN
            </button>
            <button
              type="button"
              className={`language-option${language === 'es' ? ' is-selected' : ''}`}
              aria-pressed={language === 'es'}
              onClick={() => changeLanguage('es')}
              title={copy.ui.languageSpanish}
            >
              ES
            </button>
          </fieldset>
          <span className="mode-pill">
            <span className="status-dot" aria-hidden="true" />
            {availableModeLabel}
          </span>
        </div>
      </header>

      <div className="workspace" id="inicio">
        <section className="editor-column" aria-labelledby="editor-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <Sparkles size={14} aria-hidden="true" />
              {copy.ui.heroEyebrow}
            </p>
            <h1 id="editor-title">
              {copy.ui.heroTitleFirst}
              <span>{copy.ui.heroTitleSecond}</span>
            </h1>
            <p className="intro-copy">
              {copy.ui.intro}
            </p>
          </div>

          <div className="editor-form" aria-busy={requestState === 'loading'}>
            <div className="form-section form-section-goal">
              <div className="section-number" aria-hidden="true">
                01
              </div>
              <div className="section-body">
                <label className="field-label" htmlFor="goal">
                  {copy.ui.goalLabel}
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
                  {copy.ui.goalHelp}
                </p>
                <div className="example-row" aria-label={copy.ui.examples}>
                  <span className="example-label">{copy.ui.examples}</span>
                  {EXAMPLES[language].slice(1).map((example) => (
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
                    <p className="field-label">{copy.ui.daySectionLabel}</p>
                    <p className="field-help">
                      {copy.ui.daySectionHelp}
                    </p>
                  </div>
                  <span className="constraint-value">{sampleCountLabel}</span>
                </div>
                <fieldset className="day-toggle-row">
                  <legend className="sr-only">{copy.ui.availableDays}</legend>
                  {copy.dayNames.map((name, index) => {
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
                        <span className="day-short">{copy.dayShort[index]}</span>
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
                    <span className="field-label">{copy.ui.sessionMinutes}</span>
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
                    <span className="field-label">{copy.ui.weeklyCap}</span>
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
                      {copy.ui.weekStart}
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
                    <span className="field-label">{copy.ui.localTimeField}</span>
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
                      {copy.ui.capacityOver(configuredMinutes)}
                    </>
                  ) : (
                    <>
                      {copy.ui.capacityWithin(configuredMinutes)}
                    </>
                  )}
                </p>
                <p className="authority-note">
                  {copy.ui.authority}
                </p>
              </div>
            </div>

            <div className="mode-section">
              <div className="mode-section-heading">
                <div>
                  <p className="field-label">{copy.ui.contentProposer}</p>
                  <p className="field-help">
                    {copy.ui.deterministicLimits}
                  </p>
                </div>
                <span className="mode-selection-label">
                  {availableModeLabel}
                </span>
              </div>
              <fieldset className="mode-options">
                  <legend className="sr-only">{copy.ui.contentProposer}</legend>
                <button
                  className={`mode-option${mode === 'demo' ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={mode === 'demo'}
                  disabled={controlsDisabled}
                  onClick={() => setMode('demo')}
                >
                  <span className="mode-option-title">{copy.ui.localDemo}</span>
                  <span>{copy.ui.localDemoHelp}</span>
                </button>
                <button
                  className={`mode-option${mode === 'live' ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={mode === 'live'}
                  disabled={!liveAvailable || controlsDisabled}
                  onClick={() => setMode('live')}
                  title={
                    !liveAvailable
                      ? copy.ui.enableLiveTitle
                      : undefined
                  }
                >
                  <span className="mode-option-title">{copy.ui.connectedAi}</span>
                  <span>
                    {liveAvailable
                      ? copy.ui.deepseekOptional
                      : copy.ui.providerDisabled}
                  </span>
                </button>
              </fieldset>
              {!liveAvailable ? (
                <p className="mode-help">
                  {copy.ui.liveDisabledHelp}
                </p>
              ) : null}
              {mode === 'live' && liveAvailable ? (
                <p className="live-warning">
                  {copy.ui.liveWarning}
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
                {requestState === 'loading' ? copy.ui.creating : copy.ui.createRoutine}
              </Button>
            </div>
            {error ? (
              <div className="error-banner" role="alert">
                <span>
                  <span>{error}</span>
                  {errorReference ? (
                    <span style={{ display: 'block' }}>
                      {copy.ui.failureReference}: {errorReference}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setErrorReference(null);
                  }}
                  aria-label={copy.ui.closeError}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="preview-column" aria-labelledby="preview-title">
          <div className="preview-label-row">
            <p className="eyebrow">{copy.ui.weekView}</p>
            <span className="preview-index">
              {plan ? copy.ui.planIndex : copy.ui.sampleIndex}
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
            <SamplePreview language={language} />
          )}
        </aside>
      </div>
    </main>
  );
}
