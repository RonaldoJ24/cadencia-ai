'use client';

import { LoaderCircle, WandSparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PlanSteps } from '@/components/plan-steps';
import { GoalRunError, IDLE_TIMEOUT_MS, runReplanDemo, streamReplanRun } from '@/lib/goal-client';
import type { GoalCopy } from '@/lib/goal-copy';
import type { Language } from '@/lib/i18n';
import { applyStageEvent, type StageEvent, type StepView } from '@/lib/plan-stream';
import { replanOptions } from '@/lib/planner/replan';
import type { BusyInterval, GoalPlan, ReplanOptionId } from '@/lib/planner/types';
import { REPLAN_REASON_TEXT, REPLAN_REASONS, type ReplanReasonId } from '@/lib/replan-demo';
import { plannedReplanSteps, replanRequestFor, type ReplanOutcome, type ReplanRequest } from '@/lib/replan-stream';
import { stepsCopyFor } from '@/lib/steps-copy';

function longDay(date: string, language: Language): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(language === 'es' ? 'es-MX' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Builds the options once more, timed, so the build step shows a real duration. */
function timedBuild(plan: GoalPlan, busy: BusyInterval[], today: string): number {
  const started = performance.now();
  replanOptions(plan, busy, today);
  return performance.now() - started;
}

/**
 * After missed sessions: the options code built and checked, a suggestion
 * from the person's reason (the model, or a recorded pick in the demo), and a
 * button per option. Nothing changes until the person uses one.
 */
export function ReplanCard({
  plan,
  busy,
  today,
  mode,
  liveAvailable,
  language,
  copy,
  onApply,
}: {
  plan: GoalPlan;
  busy: BusyInterval[];
  /** Today, or the simulated day in the demo. */
  today: string;
  mode: 'demo' | 'live';
  liveAvailable: boolean;
  language: Language;
  copy: GoalCopy;
  onApply: (plan: GoalPlan, option: ReplanOptionId) => void;
}) {
  const text = copy.replan;
  const stepsText = stepsCopyFor(language);
  const replan = useMemo(() => (today ? replanOptions(plan, busy, today) : null), [plan, busy, today]);
  const [reason, setReason] = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepView[] | null>(null);
  const [outcome, setOutcome] = useState<ReplanOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!replan || replan.options.length === 0) return null;

  const names = stepsText.replan.optionNames;
  const request = (why: string): ReplanRequest => replanRequestFor(plan, replan, today, language, why);

  const run = async (work: (onStage: (event: StageEvent) => void) => Promise<ReplanOutcome>) => {
    // Building the options ran in code, in this browser.
    const built: StageEvent = {
      type: 'stage',
      stage: 'build_options',
      status: 'completed',
      actor: 'code',
      durationMs: timedBuild(plan, busy, today),
      detail: stepsText.replan.options(replan.options.length, replan.options.map((option) => names[option.summary.id])),
    };
    setSteps(applyStageEvent(plannedReplanSteps(mode), built));
    setRunning(true);
    setError(null);
    setOutcome(null);
    try {
      setOutcome(await work((event) => setSteps((current) => (current ? applyStageEvent(current, event) : current))));
    } catch (cause) {
      if (cause instanceof GoalRunError) {
        const wait = cause.retryAfterSec ? ` (${copy.errors.wait(cause.retryAfterSec)})` : '';
        setError(`${cause.message}${wait}`);
      } else {
        setError(copy.errors.generic);
      }
    } finally {
      setRunning(false);
    }
  };

  const suggestLive = () => run(async (onStage) => {
    const controller = new AbortController();
    let idle = window.setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    try {
      return await streamReplanRun(request(reason.trim()), {
        signal: controller.signal,
        onStage,
        onActivity: () => {
          window.clearTimeout(idle);
          idle = window.setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
        },
        fallbackMessage: copy.errors.generic,
        streamEndedMessage: stepsText.failure.streamEnded,
      });
    } finally {
      window.clearTimeout(idle);
    }
  });
  const suggestDemo = (preset: ReplanReasonId) => {
    setReason(REPLAN_REASON_TEXT[language][preset]);
    void run((onStage) => runReplanDemo(preset, request(REPLAN_REASON_TEXT[language][preset]), onStage));
  };
  const showOptions = () => {
    setSteps(null);
    setError(null);
    setOutcome({ outcome: 'open', requestIds: [] });
  };

  const suggested = outcome?.outcome === 'suggested' ? outcome.option : null;
  const ordered = [...replan.options].sort((a, b) => Number(b.summary.id === suggested) - Number(a.summary.id === suggested));
  const message = !outcome
    ? null
    : outcome.outcome === 'declined'
      ? outcome.category === 'medical' ? text.declinedMedical : text.declinedUnclear
      : outcome.outcome === 'open' ? text.open : null;

  return (
    <section className="replan-card" aria-labelledby="replan-title">
      <h3 id="replan-title" className="goal-block-title">{text.title}</h3>
      <p className="replan-intro">{text.intro(replan.situation.missedSessions)}</p>

      {mode === 'demo' ? (
        <div className="replan-presets">
          <p className="field-label">{text.presetsLabel}</p>
          <div className="example-row">
            {REPLAN_REASONS.map((preset) => (
              <button key={preset} type="button" className="example-chip" disabled={running} onClick={() => suggestDemo(preset)}>
                {text.presets[preset]}
              </button>
            ))}
          </div>
          {reason ? <p className="replan-reason">“{reason}”</p> : null}
        </div>
      ) : (
        <div className="replan-reason-form">
          <label className="field-label" htmlFor="replan-reason">{text.reasonLabel}</label>
          <textarea
            id="replan-reason"
            className="goal-input replan-reason-input"
            maxLength={500}
            placeholder={text.reasonPlaceholder}
            value={reason}
            disabled={running || !liveAvailable}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="field-help">{liveAvailable ? text.liveNote : text.liveUnavailable}</p>
        </div>
      )}

      <div className="replan-actions">
        {mode === 'live' ? (
          <button type="button" className="create-button" disabled={running || !liveAvailable || !reason.trim()} onClick={() => void suggestLive()}>
            {running ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <WandSparkles size={16} aria-hidden="true" />}
            {running ? text.suggesting : text.suggest}
          </button>
        ) : null}
        <button type="button" className="example-chip" disabled={running} onClick={showOptions}>{text.showOptions}</button>
      </div>

      {steps ? (
        <PlanSteps
          steps={steps}
          note={mode === 'live' ? text.stepsNote.live : text.stepsNote.demo}
          language={language}
          heading={text.stepsHeading}
          titleId="replan-steps-title"
        />
      ) : null}
      {error ? <p className="calendar-error" role="alert">{error}</p> : null}

      {outcome ? (
        <div className="replan-result">
          {message ? <p className="replan-message">{message}</p> : null}
          {outcome.outcome === 'declined' && outcome.category === 'medical' ? (
            <blockquote className="replan-why"><span>{text.modelSays}</span>{outcome.reason}</blockquote>
          ) : null}
          <ul className="replan-options">
            {ordered.map((option) => {
              const { id } = option.summary;
              const isSuggested = id === suggested;
              return (
                <li key={id} className={`replan-option${isSuggested ? ' is-suggested' : ''}`}>
                  <div className="replan-option-head">
                    <h4>{names[id]}</h4>
                    {isSuggested ? <span className="demo-tag">{text.suggested}</span> : null}
                  </div>
                  <p>{text.optionHelp[id]}</p>
                  {isSuggested && outcome.outcome === 'suggested' ? (
                    <blockquote className="replan-why"><span>{text.modelSays}</span>{outcome.why}</blockquote>
                  ) : null}
                  <dl className="replan-facts">
                    <div><dt>{text.facts.deadline}</dt><dd>{longDay(option.summary.deadline, language)}</dd></div>
                    <div><dt>{text.facts.sessionsLeft}</dt><dd>{option.summary.sessionsLeft}</dd></div>
                    <div><dt>{text.facts.timeLeft}</dt><dd>{text.hours(option.summary.minutesLeft)}</dd></div>
                    <div><dt>{text.facts.nextSevenDays}</dt><dd>{text.minutes(option.summary.nextSevenDaysMinutes)}</dd></div>
                    <div><dt>{text.facts.leftOut}</dt><dd>{option.summary.sessionsLeftOut}</dd></div>
                  </dl>
                  <button
                    type="button"
                    className={isSuggested ? 'create-button' : 'example-chip'}
                    onClick={() => onApply(option.plan, id)}
                  >
                    {text.apply}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
