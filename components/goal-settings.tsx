'use client';

import { Check, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import type { GoalCopy } from '@/lib/goal-copy';
import { copyFor, type Language } from '@/lib/i18n';
import { deadlineRange, WINDOW_PRESETS, type ControlName, type GoalControls } from '@/lib/planner/goal-input';
import type { Level, Weekday } from '@/lib/planner/types';

/**
 * Optional settings. Each starts on Auto; changing it marks it as set by the
 * person, and only those are sent, so the model's reading fills the rest.
 */
export function GoalSettings({
  controls,
  onChange,
  today,
  language,
  copy,
  disabled,
}: {
  controls: GoalControls;
  onChange: (controls: GoalControls) => void;
  today: string;
  language: Language;
  copy: GoalCopy;
  disabled: boolean;
}) {
  const base = copyFor(language);
  const set = (patch: GoalControls) => onChange({ ...controls, ...patch });
  const clear = (name: ControlName) => {
    const next = { ...controls };
    delete next[name];
    onChange(next);
  };
  const { first, last } = today ? deadlineRange(today) : { first: undefined, last: undefined };
  const number = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const row = (name: ControlName, label: string, control: ReactNode) => (
    <div className={`setting-row${controls[name] !== undefined ? ' is-set' : ''}`}>
      <span className="field-label">{label}</span>
      <div className="setting-control">{control}</div>
      <span className="setting-source">
        {controls[name] !== undefined ? (
          <button
            type="button"
            className="setting-reset"
            onClick={() => clear(name)}
            disabled={disabled}
            title={copy.backToAuto}
          >
            {copy.setByYou}
            <RotateCcw size={12} aria-hidden="true" />
            <span className="sr-only">{copy.backToAuto}</span>
          </button>
        ) : (
          <span className="setting-auto">{copy.auto}</span>
        )}
      </span>
    </div>
  );

  return (
    <div className="goal-settings">
      {row('deadline', copy.fields.deadline, (
        <Input
          type="date"
          aria-label={copy.fields.deadline}
          value={controls.deadline ?? ''}
          min={first}
          max={last}
          disabled={disabled}
          onChange={(event) => (event.target.value ? set({ deadline: event.target.value }) : clear('deadline'))}
        />
      ))}
      {row('days', copy.fields.days, (
        <fieldset className="day-toggle-row compact">
          <legend className="sr-only">{copy.fields.days}</legend>
          {base.dayNames.map((name, index) => {
            const selected = controls.days?.includes(index as Weekday) ?? false;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={selected}
                aria-label={name}
                className={`day-toggle${selected ? ' is-selected' : ''}`}
                disabled={disabled}
                onClick={() => {
                  const current = controls.days ?? [];
                  const next = selected ? current.filter((day) => day !== index) : [...current, index as Weekday];
                  if (next.length === 0) clear('days');
                  else set({ days: [...next].sort((a, b) => a - b) });
                }}
              >
                <span className="day-short">{base.dayShort[index]}</span>
                {selected ? <Check size={11} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </fieldset>
      ))}
      {row('window', copy.fields.window, (
        <span className="window-inputs">
          <Input
            type="time"
            aria-label={copy.fields.from}
            value={controls.window?.start ?? ''}
            disabled={disabled}
            onChange={(event) => {
              if (!event.target.value) return clear('window');
              set({ window: { start: event.target.value, end: controls.window?.end ?? WINDOW_PRESETS.evening.end } });
            }}
          />
          <span aria-hidden="true">–</span>
          <Input
            type="time"
            aria-label={copy.fields.to}
            value={controls.window?.end ?? ''}
            disabled={disabled}
            onChange={(event) => {
              if (!event.target.value) return clear('window');
              set({ window: { start: controls.window?.start ?? WINDOW_PRESETS.evening.start, end: event.target.value } });
            }}
          />
        </span>
      ))}
      {row('weeklyMinutes', copy.fields.weeklyMinutes, (
        <span className="input-with-suffix">
          <Input
            type="number"
            aria-label={copy.fields.weeklyMinutes}
            min={15}
            max={1200}
            step={15}
            value={controls.weeklyMinutes ?? ''}
            placeholder={copy.auto}
            disabled={disabled}
            onChange={(event) => {
              const value = number(event.target.value);
              if (value === undefined) clear('weeklyMinutes');
              else set({ weeklyMinutes: value });
            }}
          />
          <span>min</span>
        </span>
      ))}
      {row('sessionMinutes', copy.fields.sessionMinutes, (
        <span className="input-with-suffix">
          <Input
            type="number"
            aria-label={copy.fields.sessionMinutes}
            min={15}
            max={240}
            step={5}
            value={controls.sessionMinutes ?? ''}
            placeholder={copy.auto}
            disabled={disabled}
            onChange={(event) => {
              const value = number(event.target.value);
              if (value === undefined) clear('sessionMinutes');
              else set({ sessionMinutes: value });
            }}
          />
          <span>min</span>
        </span>
      ))}
      {row('level', copy.fields.level, (
        <select
          className="setting-select"
          aria-label={copy.fields.level}
          value={controls.level ?? ''}
          disabled={disabled}
          onChange={(event) => (event.target.value ? set({ level: event.target.value as Level }) : clear('level'))}
        >
          <option value="">{copy.auto}</option>
          {(Object.keys(copy.levels) as Array<keyof GoalCopy['levels']>).map((level) => (
            <option key={level} value={level}>{copy.levels[level]}</option>
          ))}
        </select>
      ))}
    </div>
  );
}
