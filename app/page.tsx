'use client';

import { ArrowUpRight, LoaderCircle, PenLine, Sparkles, WandSparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { DeclineCard, GoalPlanView, QuestionCard, type SessionStatus } from '@/components/goal-plan';
import { GoalSettings } from '@/components/goal-settings';
import { PlanSteps } from '@/components/plan-steps';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { GoalRunError, IDLE_TIMEOUT_MS, runGoalDemo, streamGoalRun, type GoalRunInput } from '@/lib/goal-client';
import { goalCopyFor } from '@/lib/goal-copy';
import { findSample, loadSamples, SAMPLE_IDS, type GoalSample, type SampleId } from '@/lib/goal-demo';
import { plannedGoalSteps, type GoalOutcome } from '@/lib/goal-stream';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  copyFor,
  isLanguage,
  isCurrentRequestGeneration,
  type Language,
} from '@/lib/i18n';
import { applyStageEvent, skipRemainingSteps, type StageEvent, type StepView } from '@/lib/plan-stream';
import { googleCalendarLink, toGoalICS } from '@/lib/planner/export';
import type { GoalControls } from '@/lib/planner/goal-input';
import { stepsCopyFor } from '@/lib/steps-copy';

type Mode = 'demo' | 'live';
type RequestState = 'idle' | 'loading' | 'error';
type LiveStatus = 'available' | 'paused' | 'daily_cap' | 'monthly_cap';
type ActiveRequest = { controller: AbortController; generation: number; language: Language };
type Result = { outcome: GoalOutcome; mode: Mode; demoRecord: { model: string; date: string } | null };

const PLAN_STORAGE_KEY = 'cadencia-goal-plan-v1';

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
    clientLanguageSnapshot = isLanguage(event.newValue) ? event.newValue : DEFAULT_LANGUAGE;
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
    // The selection still applies when storage is unavailable.
  }
  languageSubscribers.forEach((listener) => listener());
}

// The server renders with its UTC date; after hydration the page uses the
// visitor's own local date, which is what the plan is scheduled from.
function localDate(date: Date, zone: 'local' | 'utc'): string {
  const [year, month, day] = zone === 'local'
    ? [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    : [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function subscribeToToday() {
  return () => undefined;
}

function getTodaySnapshot() {
  return localDate(new Date(), 'local');
}

function getServerTodaySnapshot() {
  return localDate(new Date(), 'utc');
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

function readSavedResult(): Result | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY) ?? 'null') as Result | null;
    return saved && typeof saved === 'object' && saved.outcome?.outcome === 'ready' ? saved : null;
  } catch {
    return null;
  }
}

function saveResult(result: Result | null) {
  try {
    if (result && result.outcome.outcome === 'ready') window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(result));
    else window.localStorage.removeItem(PLAN_STORAGE_KEY);
  } catch {
    // A plan that cannot be saved still shows until the page is closed.
  }
}

export default function Home() {
  const language = useSyncExternalStore(subscribeToLanguage, getLanguageSnapshot, getServerLanguageSnapshot);
  const today = useSyncExternalStore(subscribeToToday, getTodaySnapshot, getServerTodaySnapshot);
  const copy = goalCopyFor(language);
  const baseCopy = copyFor(language);
  const stepsCopy = stepsCopyFor(language);

  const [mode, setMode] = useState<Mode>('demo');
  const [samples, setSamples] = useState<GoalSample[]>([]);
  const [sampleId, setSampleId] = useState<SampleId>('ten_k');
  const [text, setText] = useState('');
  const [controls, setControls] = useState<GoalControls>({});
  const [steps, setSteps] = useState<StepView[] | null>(null);
  const [stepsMode, setStepsMode] = useState<Mode>('demo');
  const [result, setResult] = useState<Result | null>(null);
  const [answer, setAnswer] = useState('');
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorReference, setErrorReference] = useState<string | null>(null);
  // The API stays authoritative for every live POST; start optimistic so an
  // Access-protected browser is not stuck in demo mode before its cookie.
  const [liveAvailable, setLiveAvailable] = useState(true);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const generationRef = useRef(0);
  const activeRef = useRef<ActiveRequest | null>(null);
  const latestLanguageRef = useRef(language);

  const sample = findSample(samples, sampleId, language);
  const goalText = mode === 'demo' ? sample?.text ?? '' : text;
  const busy = requestState === 'loading';

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    latestLanguageRef.current = language;
    return () => {
      generationRef.current += 1;
      activeRef.current?.controller.abort();
      activeRef.current = null;
    };
  }, [language]);

  useEffect(() => {
    let active = true;
    void loadSamples().then((loaded) => {
      if (!active) return;
      setSamples(loaded);
      // A plan saved in this browser comes back once the page is interactive.
      const saved = readSavedResult();
      if (saved) setResult(saved);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    // Returns only a coarse availability reason and carries no goal content.
    fetch(`/api/routine?readiness=${Date.now().toString(36)}`, { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => (response.ok ? ((await response.json()) as { liveAvailable?: boolean; liveStatus?: unknown }) : { liveAvailable: false }))
      .then((payload) => {
        if (!active) return;
        setLiveAvailable(payload.liveAvailable === true);
        const status = 'liveStatus' in payload ? payload.liveStatus : null;
        setLiveStatus(status === 'available' || status === 'paused' || status === 'daily_cap' || status === 'monthly_cap' ? status : null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const beginRequest = (): ActiveRequest => {
    activeRef.current?.controller.abort();
    const request = { controller: new AbortController(), generation: generationRef.current + 1, language };
    generationRef.current = request.generation;
    activeRef.current = request;
    return request;
  };

  const isCurrent = (request: ActiveRequest) =>
    activeRef.current === request &&
    isCurrentRequestGeneration(generationRef.current, request.generation) &&
    latestLanguageRef.current === request.language;

  const changeLanguage = (next: Language) => {
    generationRef.current += 1;
    activeRef.current?.controller.abort();
    activeRef.current = null;
    setLanguagePreference(next);
    setSteps(null);
    setError(null);
    setErrorReference(null);
    setRequestState('idle');
  };

  const pickExample = (id: SampleId) => {
    setSampleId(id);
    if (mode === 'live') setText(findSample(samples, id, language)?.text ?? '');
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    if (next === 'live' && !text) setText(sample?.text ?? '');
  };

  const run = async (clarification?: { question: string; answer: string }) => {
    const request = beginRequest();
    const runMode = mode;
    setError(null);
    setErrorReference(null);
    setRequestState('loading');
    setStepsMode(runMode);
    setSteps(plannedGoalSteps(runMode));
    const onStage = (event: StageEvent) => {
      if (isCurrent(request)) setSteps((current) => (current ? applyStageEvent(current, event) : current));
    };
    const input: GoalRunInput = {
      text: goalText,
      language: request.language,
      today,
      controls,
      ...(clarification ? { clarification } : {}),
    };
    let idle: number | undefined;
    let timedOut = false;
    const resetIdle = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        timedOut = true;
        request.controller.abort();
      }, IDLE_TIMEOUT_MS);
    };
    try {
      let outcome: GoalOutcome;
      if (runMode === 'demo') {
        outcome = await runGoalDemo(sampleId, input, onStage);
      } else {
        resetIdle();
        outcome = await streamGoalRun(input, {
          signal: request.controller.signal,
          onStage,
          onActivity: resetIdle,
          fallbackMessage: copy.errors.generic,
          streamEndedMessage: stepsCopy.failure.streamEnded,
        });
      }
      if (!isCurrent(request)) return;
      setSteps((current) => (current ? skipRemainingSteps(current) : current));
      const record = runMode === 'demo' && sample?.draftMeta
        ? { model: sample.draftMeta.model, date: sample.recordedOn }
        : null;
      const next: Result = { outcome, mode: runMode, demoRecord: record };
      setResult(next);
      saveResult(next);
      if (outcome.outcome !== 'needs_answer') setAnswer('');
      setRequestState('idle');
    } catch (cause) {
      if (!isCurrent(request)) return;
      setRequestState('error');
      if (timedOut) {
        setError(stepsCopy.failure.timeout);
        return;
      }
      if (cause instanceof GoalRunError) {
        const wait = cause.retryAfterSec ? ` (${copy.errors.wait(cause.retryAfterSec)})` : '';
        setError(`${cause.message}${wait}`);
        setErrorReference(cause.reference ?? null);
      } else {
        setError(copy.errors.generic);
      }
    } finally {
      window.clearTimeout(idle);
      if (activeRef.current === request) activeRef.current = null;
    }
  };

  const setStatus = (id: string, status: SessionStatus) => {
    setResult((current) => {
      if (!current || current.outcome.outcome !== 'ready') return current;
      const { plan } = current.outcome;
      const next: Result = {
        ...current,
        outcome: {
          ...current.outcome,
          plan: {
            ...plan,
            weeks: plan.weeks.map((week) => ({
              ...week,
              sessions: week.sessions.map((session) => (session.id === id ? { ...session, status } : session)),
            })),
          },
        },
      };
      saveResult(next);
      return next;
    });
  };

  const readyPlan = result?.outcome.outcome === 'ready' ? result.outcome.plan : null;

  const downloadIcs = () => {
    if (readyPlan) downloadText('cadencia-plan.ics', toGoalICS(readyPlan), 'text/calendar;charset=utf-8');
  };

  const addToGoogle = () => {
    const first = readyPlan?.weeks.flatMap((week) => week.sessions).find((session) => session.status === 'planned');
    if (!first) return;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    window.open(googleCalendarLink(first, language, timeZone), '_blank', 'noopener,noreferrer');
  };

  const liveHelp = liveAvailable
    ? copy.liveHelp
    : liveStatus === 'daily_cap'
      ? stepsCopy.spend.dailyCap
      : liveStatus === 'monthly_cap'
        ? stepsCopy.spend.monthlyCap
        : liveStatus === 'paused'
          ? stepsCopy.spend.disabled
          : copy.liveUnavailable;

  return (
    <main className="cadencia-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label={baseCopy.ui.homeAria}>
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-word">cadencia</span>
          <span className="brand-note">{copy.brandNote}</span>
        </a>
        <div className="topbar-meta">
          <fieldset className="language-switcher">
            <legend className="sr-only">{baseCopy.ui.languageSelector}</legend>
            {(['en', 'es'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`language-option${language === option ? ' is-selected' : ''}`}
                aria-pressed={language === option}
                onClick={() => changeLanguage(option)}
                title={option === 'en' ? baseCopy.ui.languageEnglish : baseCopy.ui.languageSpanish}
              >
                {option.toUpperCase()}
              </button>
            ))}
          </fieldset>
          <span className="mode-pill">
            <span className="status-dot" aria-hidden="true" />
            {copy.modePill[mode]}
          </span>
        </div>
      </header>

      <div className="workspace" id="inicio">
        <section className="editor-column" aria-labelledby="editor-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <Sparkles size={14} aria-hidden="true" />
              {copy.eyebrow}
            </p>
            <h1 id="editor-title">
              {baseCopy.ui.heroTitleFirst}
              <span>{baseCopy.ui.heroTitleSecond}</span>
            </h1>
            <p className="intro-copy">{copy.intro}</p>
          </div>

          <div className="editor-form" aria-busy={busy}>
            <div className="form-section form-section-goal">
              <div className="section-number" aria-hidden="true">01</div>
              <div className="section-body">
                <label className="field-label" htmlFor="goal">{copy.goalLabel}</label>
                <Textarea
                  id="goal"
                  name="goal"
                  rows={3}
                  maxLength={2000}
                  value={goalText}
                  readOnly={mode === 'demo'}
                  onChange={(event) => setText(event.target.value)}
                  disabled={busy}
                  aria-describedby="goal-help"
                  className="goal-input"
                />
                <p className="field-help" id="goal-help">
                  {mode === 'demo' ? copy.demoLocked : copy.goalHelp}
                </p>
                <div className="example-row" aria-label={copy.examplesLabel}>
                  <span className="example-label">{copy.examplesLabel}</span>
                  {SAMPLE_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`example-chip${mode === 'demo' && id === sampleId ? ' is-selected' : ''}`}
                      aria-pressed={mode === 'demo' ? id === sampleId : undefined}
                      disabled={busy}
                      onClick={() => pickExample(id)}
                    >
                      {copy.examples[id]}
                      <ArrowUpRight size={13} aria-hidden="true" />
                    </button>
                  ))}
                  {mode === 'demo' && liveAvailable ? (
                    <button type="button" className="example-chip write-own" disabled={busy} onClick={() => switchMode('live')}>
                      <PenLine size={13} aria-hidden="true" />
                      {copy.writeOwn}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="section-number" aria-hidden="true">02</div>
              <div className="section-body">
                <p className="field-label">{copy.settingsLabel}</p>
                <p className="field-help">{copy.settingsHelp}</p>
                <GoalSettings
                  controls={controls}
                  onChange={setControls}
                  today={today}
                  language={language}
                  copy={copy}
                  disabled={busy}
                />
              </div>
            </div>

            <div className="mode-section">
              <div className="mode-section-heading">
                <div>
                  <p className="field-label">{copy.modeLabel}</p>
                  <p className="field-help">{copy.modeHelp}</p>
                </div>
              </div>
              <fieldset className="mode-options">
                <legend className="sr-only">{copy.modeLabel}</legend>
                <button
                  className={`mode-option${mode === 'demo' ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={mode === 'demo'}
                  disabled={busy}
                  onClick={() => switchMode('demo')}
                >
                  <span className="mode-option-title">{copy.demo}</span>
                  <span>{copy.demoHelp}</span>
                </button>
                <button
                  className={`mode-option${mode === 'live' ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={mode === 'live'}
                  disabled={!liveAvailable || busy}
                  onClick={() => switchMode('live')}
                >
                  <span className="mode-option-title">{copy.live}</span>
                  <span>{liveHelp}</span>
                </button>
              </fieldset>
            </div>

            <div className="form-actions">
              <Button
                className="create-button"
                size="lg"
                type="button"
                onClick={() => void run()}
                disabled={busy || goalText.trim().length === 0 || (mode === 'live' && !liveAvailable)}
              >
                {busy ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <WandSparkles size={17} aria-hidden="true" />}
                {busy ? copy.planning : copy.submit}
              </Button>
            </div>
            {error ? (
              <div className="error-banner" role="alert">
                <span>
                  <span>{error}</span>
                  {errorReference ? (
                    <span style={{ display: 'block' }}>{copy.errors.reference}: {errorReference}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setErrorReference(null);
                  }}
                  aria-label={baseCopy.ui.closeError}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="preview-column" aria-labelledby="preview-title">
          <div className="preview-label-row">
            <p className="eyebrow" id="preview-title">{copy.resultLabel}</p>
          </div>
          {steps ? (
            <PlanSteps
              steps={steps}
              note={stepsMode === 'demo' ? copy.demoStepsNote : copy.liveStepsNote}
              language={language}
            />
          ) : null}
          {result?.outcome.outcome === 'ready' ? (
            <GoalPlanView
              outcome={result.outcome}
              mode={result.mode}
              demoRecord={result.demoRecord}
              copy={copy}
              language={language}
              onStatus={setStatus}
              onDownloadIcs={downloadIcs}
              onAddToGoogle={addToGoogle}
            />
          ) : result?.outcome.outcome === 'needs_answer' ? (
            <QuestionCard
              question={result.outcome.question}
              answer={answer}
              onAnswer={setAnswer}
              onSubmit={() => {
                if (result.outcome.outcome === 'needs_answer') {
                  void run({ question: result.outcome.question, answer });
                }
              }}
              mode={result.mode}
              copy={copy}
              disabled={busy || (result.mode === 'live' && !liveAvailable)}
            />
          ) : result?.outcome.outcome === 'cannot_plan' ? (
            <DeclineCard outcome={result.outcome} copy={copy} language={language} />
          ) : (
            <article className="preview-card goal-empty">
              <p className="sample-kicker">{copy.emptyTitle}</p>
              <p>{copy.emptyBody}</p>
            </article>
          )}
        </aside>
      </div>
    </main>
  );
}
