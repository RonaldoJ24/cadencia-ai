'use client';

import { Check, LoaderCircle, X } from 'lucide-react';

import type { Language } from '@/lib/i18n';
import type { StepView } from '@/lib/plan-stream';
import { stepsCopyFor } from '@/lib/steps-copy';

/**
 * The stages of the latest run, as they were reported. A step only shows as
 * running after its `started` event and only shows a time after it ended.
 */
export function PlanSteps({
  steps,
  note,
  language,
  heading,
  titleId = 'plan-steps-title',
}: {
  steps: StepView[];
  note: string;
  language: Language;
  /** Defaults to the plan's heading; a replan names its own. */
  heading?: string;
  titleId?: string;
}) {
  const copy = stepsCopyFor(language);
  return (
    <section className="plan-steps" aria-labelledby={titleId}>
      <div className="plan-steps-header">
        <h2 id={titleId}>{heading ?? copy.heading}</h2>
        <p>{note}</p>
      </div>
      <ol className="plan-steps-list" aria-live="polite">
        {steps.map((step) => (
          <li key={`${step.stage}-${step.attempt ?? 1}`} className={`plan-step is-${step.status}`}>
            <span className="plan-step-state" aria-hidden="true">
              {step.status === 'done' ? (
                <Check size={12} strokeWidth={3} />
              ) : step.status === 'failed' ? (
                <X size={12} strokeWidth={3} />
              ) : step.status === 'running' ? (
                <LoaderCircle className="spin" size={14} />
              ) : null}
            </span>
            <span className="plan-step-title">
              {copy.labels[step.stage]}
              {step.attempt && step.attempt > 1 ? ` ${copy.attempt(step.attempt)}` : null}
              <span className={`plan-step-actor actor-${step.actor}`}>{copy.actors[step.actor]}</span>
            </span>
            <span className="plan-step-time">
              {step.status === 'running'
                ? copy.running
                : step.status === 'skipped'
                  ? copy.skipped
                  : step.durationMs !== undefined
                    ? copy.duration(step.durationMs)
                    : copy.waiting}
            </span>
            {step.detail ? <span className="plan-step-detail">{step.detail}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
