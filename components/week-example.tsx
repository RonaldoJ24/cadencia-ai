'use client';

import { ArrowRight, Check, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  createWeekExample,
  missExampleTuesday,
  type WeekExample,
} from '@/lib/week-example';
import type { Locale } from '@/lib/routine';

const COPY = {
  en: {
    weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
    kicker: 'A week in action',
    label: 'Interactive example',
    title: 'What if Tuesday did not work out?',
    intro:
      'Three English practice sessions, 90 minutes total. Monday is complete; Tuesday and Wednesday remain.',
    legend: 'Example availability',
    withRoom: 'With another opening',
    full: 'Without another opening',
    availableRoom: 'Available days: Monday through Thursday',
    availableFull: 'Available days: Monday through Wednesday',
    perSession: '30 min per session',
    ariaWeek: 'Sessions in the week',
    available: 'Available opening',
    outside: 'Outside your days',
    done: 'Done',
    missed: 'Missed',
    moved: 'Moved from Tuesday',
    pending: 'Pending',
    unassigned: 'No session assigned',
    respected: 'Your availability is respected',
    budget: 'Scheduled or completed time',
    changed: 'Change reviewed',
    action: 'I missed Tuesday, replan',
    resetAria: 'Reset the example',
    reset: 'Reset',
    fitTitle: 'Thursday works.',
    fitText:
      'Wednesday already has a session. Monday stays completed and the total remains',
    noFitTitle: 'There is no other opening this week.',
    noFitText:
      'Monday and Wednesday remain. The missed session is recorded; no time is added outside your days.',
    prompt: 'Try the change. You will see what moves, what stays, and why.',
    checks: 'View plan checks',
    pass: 'Pass',
    review: 'Review',
    provenance:
      'The change runs through the same planner as the routine below. Authored content, with no AI calls. Fixed example: week of August 31, 2026. It resets when you reload.',
    error: 'The example could not be replanned. Reset it to try again.',
    strip: /^Step \d+: /u,
  },
  es: {
    weekdays: ['Lunes', 'Martes', 'Miércoles', 'Jueves'],
    kicker: 'Una semana en acción',
    label: 'Ejemplo interactivo',
    title: '¿Y si el martes no se pudo?',
    intro:
      'Tres prácticas de inglés, 90 minutos en total. El lunes ya está hecho; quedan el martes y el miércoles.',
    legend: 'Disponibilidad del ejemplo',
    withRoom: 'Con otro hueco',
    full: 'Sin otro hueco',
    availableRoom: 'Días disponibles: lunes a jueves',
    availableFull: 'Días disponibles: lunes a miércoles',
    perSession: '30 min por sesión',
    ariaWeek: 'Sesiones de la semana',
    available: 'Espacio disponible',
    outside: 'Fuera de tus días',
    done: 'Hecha',
    missed: 'No realizada',
    moved: 'Reubicada desde el martes',
    pending: 'Pendiente',
    unassigned: 'Sin sesión asignada',
    respected: 'Se respeta tu disponibilidad',
    budget: 'Tiempo programado o completado',
    changed: 'Cambio revisado',
    action: 'No pude el martes, reajustar',
    resetAria: 'Reiniciar el ejemplo',
    reset: 'Reiniciar',
    fitTitle: 'El jueves sí cabe.',
    fitText:
      'El miércoles ya tiene una sesión. Se conserva el lunes completado y el total sigue en',
    noFitTitle: 'Esta semana no tiene otro hueco.',
    noFitText:
      'Se conservan el lunes y el miércoles. La sesión perdida queda registrada; no se añade tiempo fuera de tus días.',
    prompt: 'Prueba el cambio. Verás qué se mueve, qué se conserva y por qué.',
    checks: 'Ver las comprobaciones del plan',
    pass: 'Cumple',
    review: 'Revisar',
    provenance:
      'El cambio ejecuta el mismo planificador que la rutina de abajo. Contenido preparado, sin llamadas a IA. Ejemplo fijo: semana del 31 de agosto de 2026. Se reinicia al recargar.',
    error: 'No se pudo reajustar el ejemplo. Reinícialo para volver a probar.',
    strip: /^Paso \d+: /u,
  },
} as const;

export function WeekExampleDemo({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const [example, setExample] = useState<WeekExample>('with-room');
  const [plan, setPlan] = useState(() =>
    createWeekExample('with-room', locale),
  );
  const [error, setError] = useState<string | null>(null);
  const missed = plan.sessions.find((session) => session.status === 'missed');
  const replacement =
    missed &&
    plan.sessions.find(
      (session) =>
        session.status === 'planned' && session.title === missed.title,
    );
  const activeMinutes = plan.sessions
    .filter((session) => session.status !== 'missed')
    .reduce((total, session) => total + session.minutes, 0);

  function reset(nextExample = example) {
    setExample(nextExample);
    setPlan(createWeekExample(nextExample, locale));
    setError(null);
  }

  function missTuesday() {
    try {
      setPlan(missExampleTuesday(plan));
      setError(null);
    } catch {
      setError(copy.error);
    }
  }

  return (
    <section
      className="week-example"
      id="example"
      aria-labelledby="example-title"
    >
      <div className="week-example-topline">
        <span className="product-kicker">{copy.kicker}</span>
        <span className="example-label-pill">{copy.label}</span>
      </div>
      <h2 id="example-title">{copy.title}</h2>
      <p className="week-example-intro">{copy.intro}</p>
      <fieldset className="example-options">
        <legend className="sr-only">{copy.legend}</legend>
        <Button
          variant="ghost"
          type="button"
          aria-pressed={example === 'with-room'}
          onClick={() => reset('with-room')}
        >
          {copy.withRoom}
        </Button>
        <Button
          variant="ghost"
          type="button"
          aria-pressed={example === 'full'}
          onClick={() => reset('full')}
        >
          {copy.full}
        </Button>
      </fieldset>
      <p className="example-availability">
        {example === 'with-room' ? copy.availableRoom : copy.availableFull} ·{' '}
        {copy.perSession}
      </p>
      <ol className="example-week" aria-label={copy.ariaWeek}>
        {copy.weekdays.map((day, dayIndex) => {
          const session = plan.sessions.find(
            (item) => item.dayIndex === dayIndex,
          );
          const movedHere = replacement && session?.id === replacement.id;
          const allowed = plan.input.days.includes(dayIndex);
          const status =
            session?.status ?? (allowed ? 'available' : 'unavailable');
          return (
            <li
              className={`example-day example-day-${status}${movedHere ? ' example-day-moved' : ''}`}
              key={day}
            >
              <span className="example-day-name">{day}</span>
              <div className="example-day-content">
                <span>
                  {session
                    ? session.title.replace(copy.strip, '')
                    : allowed
                      ? copy.available
                      : copy.outside}
                </span>
                <span className="example-day-status">
                  {session?.status === 'done' ? (
                    <>
                      <Check size={13} aria-hidden="true" /> {copy.done}
                    </>
                  ) : session?.status === 'missed' ? (
                    copy.missed
                  ) : movedHere ? (
                    <>
                      <ArrowRight size={13} aria-hidden="true" /> {copy.moved}
                    </>
                  ) : session ? (
                    copy.pending
                  ) : allowed ? (
                    copy.unassigned
                  ) : (
                    copy.respected
                  )}
                </span>
              </div>
              <span className="example-day-duration">
                {session ? `${session.minutes} min` : '—'}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="example-budget">
        <span>{copy.budget}</span>
        <strong>
          {activeMinutes} <span>/ {plan.input.weeklyMinutes} min</span>
        </strong>
      </div>
      <div className="example-action">
        <Button
          className="product-primary"
          type="button"
          onClick={missTuesday}
          disabled={Boolean(missed)}
        >
          {missed ? copy.changed : copy.action}
          {!missed && <ArrowRight size={16} aria-hidden="true" />}
        </Button>
        {(missed || error) && (
          <Button
            variant="ghost"
            type="button"
            onClick={() => reset()}
            aria-label={copy.resetAria}
          >
            <RotateCcw size={15} aria-hidden="true" /> {copy.reset}
          </Button>
        )}
      </div>
      <output
        className={`example-result${missed ? ' is-changed' : ''}`}
        aria-atomic="true"
      >
        {missed ? (
          replacement ? (
            <span>
              <strong>{copy.fitTitle}</strong> {copy.fitText} {activeMinutes}{' '}
              {locale === 'en' ? 'minutes' : 'minutos'}.
            </span>
          ) : (
            <span>
              <strong>{copy.noFitTitle}</strong> {copy.noFitText}
            </span>
          )
        ) : (
          <span>{copy.prompt}</span>
        )}
      </output>
      {error && (
        <p className="example-error" role="alert">
          {error}
        </p>
      )}
      <details className="example-checks">
        <summary>{copy.checks}</summary>
        <ul>
          {plan.checks.map((check) => (
            <li key={check.label}>
              <span>
                {check.passed ? copy.pass : copy.review} ·{' '}
                <strong>{check.label}</strong>
              </span>
              <span>{check.detail}</span>
            </li>
          ))}
        </ul>
        <p>{copy.provenance}</p>
      </details>
    </section>
  );
}
