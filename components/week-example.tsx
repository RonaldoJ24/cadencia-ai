'use client';

import { ArrowRight, Check, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  createWeekExample,
  missExampleTuesday,
  type WeekExample,
} from '@/lib/week-example';

const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves'];

export function WeekExampleDemo() {
  const [example, setExample] = useState<WeekExample>('with-room');
  const [plan, setPlan] = useState(() => createWeekExample('with-room'));
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
    setPlan(createWeekExample(nextExample));
    setError(null);
  }

  function missTuesday() {
    try {
      setPlan(missExampleTuesday(plan));
      setError(null);
    } catch {
      setError(
        'No se pudo reajustar el ejemplo. Reinícialo para volver a probar.',
      );
    }
  }

  return (
    <section
      className="week-example"
      id="ejemplo"
      aria-labelledby="example-title"
    >
      <div className="week-example-topline">
        <span className="product-kicker">Una semana en acción</span>
        <span className="example-label-pill">Ejemplo interactivo</span>
      </div>
      <h2 id="example-title">¿Y si el martes no se pudo?</h2>
      <p className="week-example-intro">
        Tres prácticas de inglés, 90 minutos en total. El lunes ya está hecho;
        quedan el martes y el miércoles.
      </p>
      <fieldset className="example-options">
        <legend className="sr-only">Disponibilidad del ejemplo</legend>
        <Button
          variant="ghost"
          type="button"
          aria-pressed={example === 'with-room'}
          onClick={() => reset('with-room')}
        >
          Con otro hueco
        </Button>
        <Button
          variant="ghost"
          type="button"
          aria-pressed={example === 'full'}
          onClick={() => reset('full')}
        >
          Sin otro hueco
        </Button>
      </fieldset>
      <p className="example-availability">
        {example === 'with-room'
          ? 'Días disponibles: lunes a jueves'
          : 'Días disponibles: lunes a miércoles'}{' '}
        · 30 min por sesión
      </p>
      <ol className="example-week" aria-label="Sesiones de la semana">
        {weekdays.map((day, dayIndex) => {
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
                    ? session.title.replace(/^Paso \d+: /u, '')
                    : allowed
                      ? 'Espacio disponible'
                      : 'Fuera de tus días'}
                </span>
                <span className="example-day-status">
                  {session?.status === 'done' ? (
                    <>
                      <Check size={13} aria-hidden="true" /> Hecha
                    </>
                  ) : session?.status === 'missed' ? (
                    'No realizada'
                  ) : movedHere ? (
                    <>
                      <ArrowRight size={13} aria-hidden="true" /> Reubicada
                      desde el martes
                    </>
                  ) : session ? (
                    'Pendiente'
                  ) : allowed ? (
                    'Sin sesión asignada'
                  ) : (
                    'Se respeta tu disponibilidad'
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
        <span>Tiempo programado o completado</span>
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
          {missed ? 'Cambio revisado' : 'No pude el martes, reajustar'}
          {!missed && <ArrowRight size={16} aria-hidden="true" />}
        </Button>
        {(missed || error) && (
          <Button
            variant="ghost"
            type="button"
            onClick={() => reset()}
            aria-label="Reiniciar el ejemplo"
          >
            <RotateCcw size={15} aria-hidden="true" /> Reiniciar
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
              <strong>El jueves sí cabe.</strong> El miércoles ya tiene una
              sesión. Se conserva el lunes completado y el total sigue en{' '}
              {activeMinutes} minutos.
            </span>
          ) : (
            <span>
              <strong>Esta semana no tiene otro hueco.</strong> Se conservan el
              lunes y el miércoles. La sesión perdida queda registrada; no se
              añade tiempo fuera de tus días.
            </span>
          )
        ) : (
          <span>
            Prueba el cambio. Verás qué se mueve, qué se conserva y por qué.
          </span>
        )}
      </output>
      {error && (
        <p className="example-error" role="alert">
          {error}
        </p>
      )}
      <details className="example-checks">
        <summary>Ver las comprobaciones del plan</summary>
        <ul>
          {plan.checks.map((check) => (
            <li key={check.label}>
              <span>
                {check.passed ? 'Cumple' : 'Revisar'} ·{' '}
                <strong>{check.label}</strong>
              </span>
              <span>{check.detail}</span>
            </li>
          ))}
        </ul>
        <p>
          El cambio ejecuta el mismo planificador que la rutina de abajo.
          Contenido preparado, sin llamadas a IA. Ejemplo fijo: semana del 31 de
          agosto de 2026. Se reinicia al recargar.
        </p>
      </details>
    </section>
  );
}
