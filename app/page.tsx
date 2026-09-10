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
import {
  DAY_NAMES,
  DAY_SHORT,
  EXAMPLES,
  PAGE_COPY,
  getLocalWeekStart,
  getServerWeekStart,
  subscribeToWeekStart,
} from '@/lib/page-copy';
import { buildInsights } from '@/lib/insights';
import {
  buildPlan,
  markDone,
  replan,
  toICS,
  toMarkdown,
  type Locale,
  type RoutineInput,
  type RoutinePlan,
  type Session,
} from '@/lib/routine';

type RequestState = 'idle' | 'loading' | 'error';

function sessionStatusLabel(status: Session['status'], locale: Locale) {
  const copy = PAGE_COPY[locale];
  if (status === 'done') return copy.completed;
  if (status === 'missed') return copy.missed;
  return copy.planned;
}

function domainLabel(domain: RoutinePlan['intent']['domain'], locale: Locale) {
  const copy = PAGE_COPY[locale];
  if (domain === 'learning') return copy.learning;
  if (domain === 'creative') return copy.creative;
  return copy.general;
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

function formatSessionDate(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', {
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
  locale,
}: {
  sessions: Session[];
  input: RoutineInput;
  locale: Locale;
}) {
  const copy = PAGE_COPY[locale];
  return (
    <div className="rhythm-map" aria-label={copy.map}>
      {DAY_NAMES[locale].map((name, index) => {
        const session = sessions.find((item) => item.dayIndex === index);
        return (
          <div className="rhythm-day" key={name}>
            <span className="rhythm-day-label">{DAY_SHORT[locale][index]}</span>
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
        {sessions.length} {copy.sessionsIn} {input.days.length}{' '}
        {copy.availableDays}.
      </span>
    </div>
  );
}

function RoutinePreview({
  plan,
  locale,
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
  locale: Locale;
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
  const copy = PAGE_COPY[locale];
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
  const noReplacementWarning = plan.warnings.some(
    (warning) =>
      warning.startsWith('No hay un día permitido y libre después') ||
      warning.startsWith('There is no later allowed free day'),
  );
  const insights = buildInsights(plan, locale);

  return (
    <div className={`preview-card routine-card${stale ? ' is-stale' : ''}`}>
      <div className="preview-card-header routine-header">
        <div>
          <span className="sample-kicker">
            <span className="sample-marker" aria-hidden="true" />
            {plan.mode === 'deepseek' ? copy.live : copy.demo}
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
          <span className="sr-only">{copy.reset}</span>
        </button>
      </div>

      {stale ? (
        <output className="stale-banner">
          <span>{copy.stale}</span>
        </output>
      ) : null}

      <div className="rhythm-header">
        <span>{copy.weeklyCadence}</span>
        <span>
          {plannedCount} {copy.sessions} · {totalMinutes} min
        </span>
      </div>
      <RhythmMap input={plan.input} sessions={plan.sessions} locale={locale} />

      {plan.warnings.length > 0 ? (
        <output className="warning-box">
          <span className="warning-mark" aria-hidden="true">
            !
          </span>
          <div>
            <strong>{copy.review}</strong>
            {plan.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </output>
      ) : null}

      <section className="insight-panel" aria-labelledby="insight-title">
        <div className="insight-heading">
          <div>
            <span className="decision-label">{copy.advanced}</span>
            <h3 id="insight-title">{copy.allows}</h3>
          </div>
          <span className="insight-horizon">{copy.fourWeeks}</span>
        </div>
        <div className="insight-metrics">
          <p>{insights.capacity}</p>
          <p>{insights.fourWeekProjection}</p>
        </div>
        <div className="insight-recommendation">
          <strong>{copy.nextDecision}</strong>
          <p>{insights.recommendation}</p>
        </div>
        <div className="insight-columns">
          {insights.clarifyingQuestions.length > 0 ? (
            <div>
              <strong>{copy.refine}</strong>
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
                {copy.answer}
              </button>
            </div>
          ) : null}
          <div>
            <strong>{copy.signals}</strong>
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
          {doneCount} {locale === 'en' ? 'of' : 'de'} {plan.sessions.length}{' '}
          {copy.completedOf}
        </span>
        <span className="plan-summary-line" aria-hidden="true" />
        <span>
          {plan.input.time} · {copy.localTime}
        </span>
      </div>

      <div
        className="session-list dynamic-session-list"
        aria-label={copy.sessionList}
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
                <span>{formatSessionDate(session.date, locale)}</span>
                <span className="session-separator">/</span>
                <span>{sessionStatusLabel(session.status, locale)}</span>
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
          locale={locale}
        />
      ) : (
        <div className="empty-plan">{copy.emptySessions}</div>
      )}

      <details className="decision-details">
        <summary>
          <span>{copy.decided}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="decision-content">
          <div className="decision-block">
            <span className="decision-label">{copy.intent}</span>
            <p>{plan.intent.goal}</p>
            <span className="intent-domain">
              {domainLabel(plan.intent.domain, locale)}
            </span>
          </div>
          <div className="decision-block">
            <span className="decision-label">{copy.checks}</span>
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
            {plan.mode === 'deepseek' ? copy.deepseekHonesty : copy.demoHonesty}
          </p>
        </div>
      </details>

      <div className="export-row integration-row">
        <span>
          {copy.calendar}
          <small>{copy.copies}</small>
        </span>
        <div className="export-actions">
          <button
            type="button"
            onClick={() => selectedSession && onAddToGoogle(selectedSession)}
            title={copy.googleTitle}
            disabled={
              stale || !selectedSession || selectedSession.status === 'missed'
            }
          >
            <CalendarPlus size={13} aria-hidden="true" />
            {copy.google}
          </button>
          <button
            type="button"
            onClick={onDownloadMarkdown}
            disabled={stale}
            title={copy.summaryTitle}
          >
            <Download size={13} aria-hidden="true" />
            {copy.summary}
          </button>
          <button
            type="button"
            onClick={onDownloadICS}
            disabled={stale}
            title={copy.icsTitle}
          >
            <Download size={13} aria-hidden="true" />
            {copy.ics}
          </button>
          <button type="button" onClick={onShare} disabled={stale}>
            <Share2 size={13} aria-hidden="true" />
            {copy.share}
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
  locale,
  stale,
  disabled,
  noReplacementWarning,
  onMarkDone,
  onReplan,
}: {
  session: Session;
  locale: Locale;
  stale: boolean;
  disabled: boolean;
  noReplacementWarning: boolean;
  onMarkDone: (id: string) => void;
  onReplan: (id: string) => void;
}) {
  const copy = PAGE_COPY[locale];
  return (
    <div className="session-detail" aria-live="polite">
      <div className="detail-heading">
        <span className="detail-kicker">{copy.selected}</span>
        <span className={`detail-status status-${session.status}`}>
          {sessionStatusLabel(session.status, locale)}
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
              {copy.mark}
            </Button>
            <button
              className="missed-button"
              type="button"
              onClick={() => onReplan(session.id)}
              disabled={disabled}
            >
              {copy.replan}
            </button>
          </>
        ) : session.status === 'done' ? (
          <span className="done-copy">
            <CheckCircle2 size={14} aria-hidden="true" />
            {copy.doneCopy}
          </span>
        ) : (
          <span className="missed-copy">
            {noReplacementWarning ? copy.missedNoSlot : copy.missedMoved}
          </span>
        )}
      </div>
      {stale ? <p className="stale-detail-note">{copy.staleDetail}</p> : null}
    </div>
  );
}

export default function Home() {
  const [locale, setLocale] = useState<Locale>('en');
  const copy = PAGE_COPY[locale];
  // Keep the server snapshot stable; resolve the local week after hydration.
  const localWeekStart = useSyncExternalStore(
    subscribeToWeekStart,
    getLocalWeekStart,
    getServerWeekStart,
  );
  const [draftInput, setInput] = useState<
    Omit<RoutineInput, 'startDate'> & { startDate: string | null }
  >({ ...EXAMPLES.en[0].input, startDate: null });
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
  const availableModeLabel = mode === 'live' ? copy.live : copy.demo;
  const controlsDisabled = requestState === 'loading';

  const updateInput = (patch: Partial<RoutineInput>) => {
    setInput((current) => ({ ...current, ...patch }));
  };

  const applyExample = (example: (typeof EXAMPLES.en)[number]) => {
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

  const resetSample = () => applyExample(EXAMPLES[locale][0]);

  const changeLocale = (nextLocale: Locale) => {
    if (nextLocale === locale || controlsDisabled) return;
    const exampleIndex = EXAMPLES[locale].findIndex(
      (example) => example.input.request === input.request,
    );
    setLocale(nextLocale);
    document.documentElement.lang = nextLocale;
    document.title = PAGE_COPY[nextLocale].metaTitle;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', PAGE_COPY[nextLocale].metaDescription);
    if (exampleIndex >= 0) {
      setInput((current) => ({
        ...current,
        request: EXAMPLES[nextLocale][exampleIndex].input.request,
      }));
    }
    setError(null);
    setShareStatus(null);
  };

  const handleGenerate = async () => {
    setError(null);
    setRequestState('loading');
    try {
      let nextPlan: RoutinePlan;
      if (mode === 'live') {
        const response = await fetch('/api/routine', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input, mode: 'deepseek', locale }),
        });
        const payload = (await response.json()) as {
          plan?: RoutinePlan;
          error?: string;
        };
        if (!response.ok || !payload.plan) {
          throw new Error(
            locale === 'en'
              ? copy.providerError
              : (payload.error ?? copy.providerError),
          );
        }
        nextPlan = payload.plan;
      } else {
        nextPlan = buildPlan(input, undefined, 'demo', undefined, locale);
      }
      setPlan(nextPlan);
      setSelectedSessionId(nextPlan.sessions[0]?.id ?? null);
      setRequestState('idle');
      setShareStatus(null);
    } catch (cause) {
      setRequestState('error');
      setError(
        locale === 'es' && cause instanceof Error
          ? cause.message
          : copy.createError,
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
          locale === 'es' && cause instanceof Error
            ? cause.message
            : copy.updateError,
        );
        return current;
      }
    });
  };

  const handleDownloadMarkdown = () => {
    if (!plan || stale) return;
    downloadText(
      locale === 'en' ? 'cadencia-routine.md' : 'cadencia-rutina.md',
      toMarkdown(plan),
      'text/markdown;charset=utf-8',
    );
  };

  const handleDownloadICS = () => {
    if (!plan || stale) return;
    downloadText(
      locale === 'en' ? 'cadencia-routine.ics' : 'cadencia-rutina.ics',
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
        locale === 'es' && cause instanceof Error
          ? cause.message
          : copy.calendarError,
      );
    }
  };

  const handleShare = async () => {
    if (!plan || stale) return;
    const text = routineShareText(plan, locale);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: plan.intent.title, text });
        setShareStatus(copy.shareDone);
      } else {
        await navigator.clipboard.writeText(text);
        setShareStatus(copy.shareCopied);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(copy.shareError);
    }
  };

  const handleRefine = () => {
    const field = document.getElementById('goal');
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field?.focus();
  };

  const sampleCountLabel = useMemo(() => {
    if (selectedDaysCount === 0) return copy.none;
    return `${selectedDaysCount} ${selectedDaysCount === 1 ? copy.day : copy.days}`;
  }, [copy, selectedDaysCount]);

  return (
    <main className="cadencia-shell" id="home">
      <a className="skip-link" href="#planner">
        {copy.skip}
      </a>
      <header className="topbar">
        <a className="brand" href="#home" aria-label={copy.home}>
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-word">cadencia</span>
          <span className="brand-note">{copy.brand}</span>
        </a>

        <nav
          className="product-nav"
          aria-label={
            locale === 'en' ? 'Main navigation' : 'Navegación principal'
          }
        >
          <a href="#planner">{copy.navPlan}</a>
          <a href="#how-it-works">{copy.navHow}</a>
        </nav>
        <fieldset className="language-switch" disabled={controlsDisabled}>
          <legend className="sr-only">{copy.language}</legend>
          <button
            type="button"
            aria-pressed={locale === 'en'}
            onClick={() => changeLocale('en')}
          >
            EN
          </button>
          <button
            type="button"
            aria-pressed={locale === 'es'}
            onClick={() => changeLocale('es')}
          >
            ES
          </button>
        </fieldset>
        <div className="topbar-meta">
          <span className="mode-pill">
            <span className="status-dot" aria-hidden="true" />
            {availableModeLabel}
          </span>
        </div>
      </header>

      <ProductStory locale={locale} />

      <div className="workspace" id="planner" tabIndex={-1}>
        <section className="editor-column" aria-labelledby="editor-title">
          <div className="planner-heading">
            <p className="product-kicker">{copy.now}</p>
            <h2 id="editor-title">{copy.plannerTitle}</h2>
            <p className="intro-copy">{copy.plannerLead}</p>
          </div>

          <div className="editor-form" aria-busy={requestState === 'loading'}>
            <div className="form-section form-section-goal">
              <div className="section-number" aria-hidden="true">
                01
              </div>
              <div className="section-body">
                <label className="field-label" htmlFor="goal">
                  {copy.question}
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
                  {copy.questionHelp}
                </p>
                <div className="example-row" aria-label={copy.examples}>
                  <span className="example-label">{copy.try}</span>
                  {EXAMPLES[locale].slice(1).map((example) => (
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
                    <p className="field-label">{copy.pulses}</p>
                    <p className="field-help">{copy.daysRule}</p>
                  </div>
                  <span className="constraint-value">{sampleCountLabel}</span>
                </div>
                <fieldset className="day-toggle-row">
                  <legend className="sr-only">{copy.daysLegend}</legend>
                  {DAY_NAMES[locale].map((name, index) => {
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
                        <span className="day-short">
                          {DAY_SHORT[locale][index]}
                        </span>
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
                    <span className="field-label">{copy.perSession}</span>
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
                    <span className="field-label">{copy.weeklyLimit}</span>
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
                    <span className="field-label">{copy.weekStarts}</span>
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
                    <span className="field-label">{copy.localTime}</span>
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
                    <>{copy.capacityOver(configuredMinutes)}</>
                  ) : (
                    <>{copy.capacityFits(configuredMinutes)}</>
                  )}
                </p>
                <p className="authority-note">{copy.authority}</p>
              </div>
            </div>

            <div className="mode-section">
              <div className="mode-section-heading">
                <div>
                  <p className="field-label">{copy.who}</p>
                  <p className="field-help">{copy.rulesLead}</p>
                </div>
                <span className="mode-selection-label">
                  {availableModeLabel}
                </span>
              </div>
              <fieldset className="mode-options">
                <legend className="sr-only">{copy.generation}</legend>
                <button
                  className={`mode-option${mode === 'demo' ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={mode === 'demo'}
                  disabled={controlsDisabled}
                  onClick={() => setMode('demo')}
                >
                  <span className="mode-option-title">{copy.localDemo}</span>
                  <span>{copy.deterministic}</span>
                </button>
                <button
                  className={`mode-option${mode === 'live' ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={mode === 'live'}
                  disabled={!liveAvailable || controlsDisabled}
                  onClick={() => setMode('live')}
                  title={!liveAvailable ? copy.unavailableTitle : undefined}
                >
                  <span className="mode-option-title">{copy.connected}</span>
                  <span>
                    {availabilityKnown && liveAvailable
                      ? copy.optional
                      : copy.unavailable}
                  </span>
                </button>
              </fieldset>
              {!liveAvailable ? (
                <p className="mode-help">{copy.modeHelp}</p>
              ) : null}
              {mode === 'live' && liveAvailable ? (
                <p className="live-warning">{copy.liveWarning}</p>
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
                {requestState === 'loading' ? copy.creating : copy.create}
              </Button>
            </div>
            {error ? (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label={copy.closeError}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="preview-column" aria-labelledby="preview-title">
          <div className="preview-label-row">
            <p className="eyebrow">{copy.weekView}</p>
            <span className="preview-index">
              {plan ? copy.yourPlan : copy.toCreate}
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
              locale={locale}
              selectedSessionId={selectedSessionId}
              shareStatus={shareStatus}
              stale={stale}
              controlsDisabled={controlsDisabled}
            />
          ) : (
            <div className="preview-card planner-empty">
              <CalendarDays size={30} aria-hidden="true" />
              <h2 id="preview-title">{copy.emptyTitle}</h2>
              <p>{copy.emptyText}</p>
              <ol>
                <li>{copy.empty1}</li>
                <li>{copy.empty2}</li>
                <li>{copy.empty3}</li>
              </ol>
              <p className="planner-empty-note">{copy.emptyNote}</p>
            </div>
          )}
        </aside>
      </div>
      <ProductNotes locale={locale} />
      <ProductFooter locale={locale} />
    </main>
  );
}
