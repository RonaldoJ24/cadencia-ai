'use client';

import { CalendarPlus, Check, Download, RotateCcw, X } from 'lucide-react';

import type { GoalCopy } from '@/lib/goal-copy';
import type { GoalOutcome } from '@/lib/goal-stream';
import type { Language } from '@/lib/i18n';
import { weeklyCeilings } from '@/lib/planner/load';
import type { Provenance } from '@/lib/planner/goal-input';
import type { GoalPlan, PlannedSession, ScheduleNote } from '@/lib/planner/types';
import { stepsCopyFor } from '@/lib/steps-copy';

type Ready = Extract<GoalOutcome, { outcome: 'ready' }>;
export type SessionStatus = PlannedSession['status'];

function formatDay(date: string, language: Language): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(language === 'es' ? 'es-MX' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function weekMinutes(sessions: PlannedSession[]): number {
  return sessions.reduce((total, session) => total + session.minutes, 0);
}

function ProvenanceList({ plan, provenance, copy, language }: {
  plan: GoalPlan;
  provenance: Provenance;
  copy: GoalCopy;
  language: Language;
}) {
  const { spec } = plan;
  const dayNames = language === 'es'
    ? ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const deadlineSource = provenance.deadline.note === 'past'
    ? `${copy.plan.sources.default} · ${copy.plan.past}`
    : provenance.deadline.note === 'too_far'
      ? `${copy.plan.sources.adjusted} · ${copy.plan.tooFar}`
      : provenance.deadline.basis === 'inferred'
        ? copy.plan.inferred
        : copy.plan.sources[provenance.deadline.source];
  const rows: Array<[string, string, string]> = [
    [copy.fields.deadline, formatDay(spec.deadline, language), deadlineSource],
    [copy.fields.days, spec.days.map((day) => dayNames[day]).join(', '), copy.plan.sources[provenance.days.source]],
    [copy.fields.window, `${spec.window.start}–${spec.window.end}`, copy.plan.sources[provenance.window.source]],
    [copy.fields.weeklyMinutes, copy.plan.upTo(spec.weeklyCapMinutes), copy.plan.sources[provenance.weeklyMinutes.source]],
    [
      copy.fields.sessionMinutes,
      spec.maxSessionMinutes === undefined ? copy.plan.noCap : copy.plan.upTo(spec.maxSessionMinutes),
      copy.plan.sources[provenance.sessionMinutes.source],
    ],
    [
      copy.fields.level,
      spec.level === 'unknown' ? copy.plan.notStated : copy.levels[spec.level],
      copy.plan.sources[provenance.level.source],
    ],
  ];
  return (
    <section className="goal-block" aria-labelledby="provenance-title">
      <h3 id="provenance-title" className="goal-block-title">{copy.plan.provenanceTitle}</h3>
      <dl className="provenance-list">
        {rows.map(([label, value, source]) => (
          <div key={label} className="provenance-row">
            <dt>{label}</dt>
            <dd>
              <span className="provenance-value">{value}</span>
              <span className="provenance-source">{source}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LoadChart({ plan, copy }: { plan: GoalPlan; copy: GoalCopy }) {
  const limits = weeklyCeilings(plan.spec, plan.weeks.length);
  const totals = plan.weeks.map((week) => weekMinutes(week.sessions));
  const top = Math.max(1, ...limits, ...totals);
  return (
    <section className="goal-block" aria-labelledby="load-title">
      <div className="goal-block-heading">
        <h3 id="load-title" className="goal-block-title">{copy.plan.loadTitle}</h3>
        <span className="load-legend">
          <span className="legend-bar" aria-hidden="true" />
          {copy.plan.loadLegendPlanned}
          <span className="legend-limit" aria-hidden="true" />
          {copy.plan.loadLegendLimit}
        </span>
      </div>
      <ol className="load-chart">
        {plan.weeks.map((week, index) => (
          <li
            key={week.week}
            className="load-week"
            aria-label={copy.plan.loadAria(week.week, totals[index], limits[index])}
            title={copy.plan.loadAria(week.week, totals[index], limits[index])}
          >
            <div className="load-track">
              <span className="load-limit" style={{ bottom: `${(limits[index] / top) * 100}%` }} />
              <span className="load-bar" style={{ height: `${(totals[index] / top) * 100}%` }} />
            </div>
            <span className="load-label">{week.week}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PhaseList({ plan, copy }: { plan: GoalPlan; copy: GoalCopy }) {
  return (
    <section className="goal-block" aria-labelledby="phases-title">
      <h3 id="phases-title" className="goal-block-title">{copy.plan.phasesTitle}</h3>
      <ol className="phase-list">
        {plan.draft.phases.map((phase) => (
          <li key={`${phase.fromWeek}-${phase.title}`} className="phase-row">
            <span className="phase-weeks">{copy.plan.weeksRange(phase.fromWeek, phase.toWeek)}</span>
            <span className="phase-title">{phase.title}</span>
            <span className="phase-focus">{phase.focus}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SessionRow({ session, role, copy, language, onStatus }: {
  session: PlannedSession;
  role: 'key' | 'support';
  copy: GoalCopy;
  language: Language;
  onStatus: (id: string, status: SessionStatus) => void;
}) {
  return (
    <li className={`goal-session is-${session.status} role-${role}`}>
      <div className="goal-session-head">
        <span className="goal-session-when">
          {formatDay(session.date, language)} · {session.start}
        </span>
        <span className="goal-session-title">{session.title}</span>
        <span className="goal-session-tags">
          <span className={`tag tag-${session.intensity}`}>{copy.plan.intensities[session.intensity]}</span>
          <span className={`tag tag-${role}`}>{copy.plan.roles[role]}</span>
          <span className="goal-session-minutes">{session.minutes} min</span>
        </span>
      </div>
      <ol className="goal-session-blocks">
        {session.blocks.map((block, index) => (
          <li key={index}>
            <span className="block-minutes">{block.minutes} min</span>
            {block.activity}
          </li>
        ))}
      </ol>
      <p className="goal-session-proof">
        <strong>{copy.plan.deliverable}:</strong> {session.deliverable}{' '}
        <strong>{copy.plan.doneWhen}:</strong> {session.doneWhen}
      </p>
      <div className="goal-session-actions">
        <span className={`status-chip status-${session.status}`}>{copy.plan.statuses[session.status]}</span>
        {session.status === 'planned' ? (
          <>
            <button type="button" className="done-button" onClick={() => onStatus(session.id, 'done')}>
              <Check size={13} aria-hidden="true" />
              {copy.plan.markDone}
            </button>
            <button type="button" className="missed-button" onClick={() => onStatus(session.id, 'missed')}>
              <X size={13} aria-hidden="true" />
              {copy.plan.markMissed}
            </button>
          </>
        ) : (
          <button type="button" className="missed-button" onClick={() => onStatus(session.id, 'planned')}>
            <RotateCcw size={13} aria-hidden="true" />
            {copy.plan.undo}
          </button>
        )}
      </div>
    </li>
  );
}

function WeekList({ plan, copy, language, onStatus }: {
  plan: GoalPlan;
  copy: GoalCopy;
  language: Language;
  onStatus: (id: string, status: SessionStatus) => void;
}) {
  const roles = new Map(plan.draft.sessionTypes.map((type) => [type.id, type.role]));
  const firstWithSessions = plan.weeks.find((week) => week.sessions.length > 0)?.week;
  return (
    <section className="goal-block" aria-labelledby="weeks-title">
      <h3 id="weeks-title" className="goal-block-title">{copy.plan.weeksTitle}</h3>
      <div className="week-list">
        {plan.weeks.map((week) => (
          <details key={week.week} className="week-item" open={week.week === firstWithSessions}>
            <summary>
              <span className="week-name">{copy.plan.week(week.week)}</span>
              <span className="week-dates">{formatDay(week.start, language)} – {formatDay(week.end, language)}</span>
              <span className="week-summary">{copy.plan.weekSummary(week.sessions.length, weekMinutes(week.sessions))}</span>
            </summary>
            {week.sessions.length === 0 ? (
              <p className="week-empty">{copy.plan.emptyWeek}</p>
            ) : (
              <ol className="goal-session-list">
                {week.sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    role={roles.get(session.typeId) ?? 'support'}
                    copy={copy}
                    language={language}
                    onStatus={onStatus}
                  />
                ))}
              </ol>
            )}
          </details>
        ))}
      </div>
    </section>
  );
}

function noteText(note: ScheduleNote, plan: GoalPlan, copy: GoalCopy, language: Language): string {
  const title = plan.draft.sessionTypes.find((type) => type.id === note.typeId)?.title ?? note.typeId;
  if (note.kind === 'moved') {
    return copy.plan.moved(
      note.week,
      title,
      `${formatDay(note.from.date, language)} ${note.from.start}`,
      `${formatDay(note.to.date, language)} ${note.to.start}`,
      copy.plan.moveReasons[note.reason],
    );
  }
  return copy.plan.dropped(note.week, title, copy.plan.dropReasons[note.reason]);
}

function ChangeList({ plan, copy, language }: { plan: GoalPlan; copy: GoalCopy; language: Language }) {
  return (
    <section className="goal-block" aria-labelledby="changes-title">
      <h3 id="changes-title" className="goal-block-title">{copy.plan.changesTitle}</h3>
      {plan.notes.length === 0 ? (
        <p className="goal-muted">{copy.plan.noChanges}</p>
      ) : (
        <ul className="change-list">
          {plan.notes.map((note, index) => (
            <li key={index} className={`change-${note.kind}`}>{noteText(note, plan, copy, language)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A ready plan: summary, sources, load, phases, weeks, changes and exports. */
export function GoalPlanView({
  outcome,
  mode,
  demoRecord,
  copy,
  language,
  onStatus,
  onDownloadIcs,
  onAddToGoogle,
}: {
  outcome: Ready;
  mode: 'demo' | 'live';
  demoRecord: { model: string; date: string } | null;
  copy: GoalCopy;
  language: Language;
  onStatus: (id: string, status: SessionStatus) => void;
  onDownloadIcs: () => void;
  onAddToGoogle: () => void;
}) {
  const { plan, reading } = outcome;
  const sessions = plan.weeks.flatMap((week) => week.sessions);
  const hours = (weekMinutes(sessions) / 60).toFixed(1).replace(/\.0$/u, '');
  return (
    <article className="preview-card goal-plan" aria-labelledby="goal-plan-title">
      <header className="goal-plan-header">
        <div className="goal-plan-kicker">
          <span className="sample-kicker">{copy.plan.eyebrow}</span>
          <span className="demo-tag">{mode === 'live' ? copy.plan.liveBadge : copy.plan.demoBadge}</span>
        </div>
        <h2 id="goal-plan-title">{reading.title}</h2>
        <p className="goal-plan-summary">{reading.summary}</p>
        <p className="goal-plan-stats">{copy.plan.stats(plan.weeks.length, sessions.length, hours)}</p>
        {demoRecord ? (
          <p className="goal-muted">
            {copy.plan.demoProvenance(
              demoRecord.model,
              new Date(`${demoRecord.date}T00:00:00Z`).toLocaleDateString(language === 'es' ? 'es-MX' : 'en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              }),
            )}
          </p>
        ) : null}
      </header>
      <ProvenanceList plan={plan} provenance={outcome.provenance} copy={copy} language={language} />
      <LoadChart plan={plan} copy={copy} />
      <PhaseList plan={plan} copy={copy} />
      <WeekList plan={plan} copy={copy} language={language} onStatus={onStatus} />
      <ChangeList plan={plan} copy={copy} language={language} />
      <footer className="export-actions goal-exports">
        <button type="button" onClick={onDownloadIcs}>
          <Download size={15} aria-hidden="true" />
          {copy.plan.exportIcs}
        </button>
        <button type="button" onClick={onAddToGoogle} disabled={sessions.length === 0}>
          <CalendarPlus size={15} aria-hidden="true" />
          {copy.plan.exportGoogle}
        </button>
      </footer>
    </article>
  );
}

/** One clarifying question, answered in place. */
export function QuestionCard({
  question,
  answer,
  onAnswer,
  onSubmit,
  mode,
  copy,
  disabled,
}: {
  question: string;
  answer: string;
  onAnswer: (value: string) => void;
  onSubmit: () => void;
  mode: 'demo' | 'live';
  copy: GoalCopy;
  disabled: boolean;
}) {
  return (
    <article className="preview-card goal-outcome" aria-labelledby="question-title">
      <p className="sample-kicker">{copy.question.title}</p>
      <h2 id="question-title">{question}</h2>
      <label className="field-label" htmlFor="clarify-answer">{copy.question.answerLabel}</label>
      <textarea
        id="clarify-answer"
        className="goal-input clarify-input"
        rows={3}
        maxLength={500}
        value={answer}
        onChange={(event) => onAnswer(event.target.value)}
        disabled={disabled || mode === 'demo'}
      />
      <p className="goal-muted">{mode === 'live' ? copy.question.liveNote : copy.question.demoNote}</p>
      <button
        type="button"
        className="create-button"
        onClick={onSubmit}
        disabled={disabled || mode === 'demo' || answer.trim().length === 0}
      >
        {copy.question.submit}
      </button>
    </article>
  );
}

/** Why a goal was declined, and who declined it. */
export function DeclineCard({
  outcome,
  copy,
  language,
}: {
  outcome: Extract<GoalOutcome, { outcome: 'cannot_plan' }>;
  copy: GoalCopy;
  language: Language;
}) {
  const decline = stepsCopyFor(language).goal.declines[outcome.category];
  return (
    <article className="preview-card goal-outcome is-declined" aria-labelledby="decline-title">
      <p className="sample-kicker">{copy.decline.title}</p>
      <h2 id="decline-title">{decline.charAt(0).toUpperCase() + decline.slice(1)}</h2>
      <p>{outcome.reason}</p>
      <p className="goal-muted">{outcome.byGuard ? copy.decline.byGuard : copy.decline.byModel}</p>
      <p className="goal-muted">{copy.decline.tryAgain}</p>
    </article>
  );
}
