'use client';

import { CalendarPlus, LoaderCircle, X } from 'lucide-react';
import { useRef, useState } from 'react';

import type { CalendarSummary } from '@/lib/calendar-import';
import type { GoalCopy } from '@/lib/goal-copy';
import type { Language } from '@/lib/i18n';
import { deadlineRange } from '@/lib/planner/goal-input';
import type { BusyInterval } from '@/lib/planner/types';

export type ImportedCalendar = { fileName: string; busy: BusyInterval[]; summary: CalendarSummary };

type ErrorKey = keyof GoalCopy['calendar']['errors'];

function longDate(date: string, language: Language): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(language === 'es' ? 'es-MX' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Busy times from a calendar file. The file is read here, in the browser;
 * only the start and end of each busy time are kept and sent with a plan.
 */
export function CalendarImport({
  calendar,
  onChange,
  today,
  language,
  copy,
  disabled,
}: {
  calendar: ImportedCalendar | null;
  onChange: (calendar: ImportedCalendar | null) => void;
  today: string;
  language: Language;
  copy: GoalCopy;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const text = copy.calendar;
  const last = today ? deadlineRange(today).last : null;

  const load = async (file: File) => {
    if (!today || !last) return;
    setError(null);
    setReading(true);
    try {
      // Loaded on first use, so the page itself stays small.
      const reader = await import('@/lib/calendar-import');
      if (file.size > reader.CALENDAR_LIMITS.maxBytes) throw new reader.CalendarError('too_large');
      const content = await file.text();
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = reader.readBusyTimes(content, { zone, from: today, to: last });
      onChange({ fileName: file.name.slice(0, 80), ...result });
    } catch (cause) {
      const reason = (cause as { reason?: unknown } | null)?.reason;
      setError(typeof reason === 'string' && reason in text.errors ? (reason as ErrorKey) : 'unreadable');
    } finally {
      setReading(false);
    }
  };

  // Busy times already past no longer count.
  const upcoming = calendar && today ? calendar.busy.filter((interval) => interval.end > `${today}T00:00`).length : 0;
  const until = last ? longDate(last, language) : '';
  const warnings = calendar
    ? [
      calendar.summary.repeatsReadOnce > 0 ? text.repeatsReadOnce(calendar.summary.repeatsReadOnce) : null,
      calendar.summary.unknownZones.length > 0 ? text.unknownZones(calendar.summary.unknownZones.join(', ')) : null,
      calendar.summary.truncated ? text.truncated : null,
    ].filter((warning): warning is string => warning !== null)
    : [];

  return (
    <div className="calendar-import">
      <span className="field-label">{text.label}</span>
      <div className="calendar-import-body">
        <div className="calendar-import-actions">
          <button
            type="button"
            className="example-chip"
            onClick={() => input.current?.click()}
            disabled={disabled || reading || !today}
          >
            {reading ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : <CalendarPlus size={13} aria-hidden="true" />}
            {reading ? text.reading : calendar ? text.replace : text.import}
          </button>
          {calendar ? (
            <button type="button" className="example-chip" onClick={() => onChange(null)} disabled={disabled || reading}>
              <X size={13} aria-hidden="true" />
              {text.remove}
            </button>
          ) : null}
          <input
            ref={input}
            type="file"
            accept=".ics,text/calendar"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void load(file);
            }}
          />
        </div>
        {calendar ? (
          <output className="calendar-status">
            {upcoming > 0 ? text.loaded(upcoming, until, calendar.fileName) : text.none(until, calendar.fileName)}
          </output>
        ) : null}
        {warnings.map((warning) => <p key={warning} className="calendar-warning">{warning}</p>)}
        {error ? <p className="calendar-error" role="alert">{text.errors[error]}</p> : null}
        <p className="field-help">{text.privacy}</p>
      </div>
    </div>
  );
}
