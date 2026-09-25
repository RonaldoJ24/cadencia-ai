// Checks a proposed draft against the skeleton code offered. Structural
// problems are reported so a retry can say exactly what to fix; weeks over
// their numeric limits are reported too, and the scheduler trims them.

import { FITNESS_LOAD } from './load.ts';
import { hasControl } from './spec.ts';
import type { Draft, DraftPhase, GoalSpec, Intensity, Role, SessionType, Skeleton } from './types.ts';

export type DraftIssue = { code: string; path: string; message: string };

export const DRAFT_LIMITS = {
  maxPhases: 6,
  maxSessionTypes: 8,
  maxBlocks: 8,
  maxTitleChars: 80,
  maxTextChars: 300,
  maxIssues: 20,
  /** One session a day at most, so no week can use more than seven. */
  maxSessionsPerWeek: 7,
} as const;

const TYPE_ID = /^[a-z0-9][a-z0-9_]{1,31}$/u;
const INTENSITIES: readonly Intensity[] = ['easy', 'moderate', 'hard'];
const ROLES: readonly Role[] = ['key', 'support'];

export function draftWeekMinutes(draft: Draft): number[] {
  const minutes = new Map(draft.sessionTypes.map((type) => [type.id, type.minutes]));
  return draft.weeks.map((week) => week.sessions.reduce((total, id) => total + (minutes.get(id) ?? 0), 0));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function plainText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !hasControl(value);
}

/**
 * A structurally valid draft can be scheduled; `overLimits` lists the weeks
 * the scheduler will trim. Structural problems leave nothing to schedule.
 */
export type DraftValidation =
  | { ok: true; draft: Draft; overLimits: DraftIssue[] }
  | { ok: false; issues: DraftIssue[] };

export function validateDraft(raw: unknown, spec: GoalSpec, skeleton: Skeleton): DraftValidation {
  const issues: DraftIssue[] = [];
  const add = (code: string, path: string, message: string) => {
    if (issues.length < DRAFT_LIMITS.maxIssues) issues.push({ code, path, message });
  };
  const value = record(raw);
  if (!value) return { ok: false, issues: [{ code: 'shape', path: '', message: 'the draft must be an object' }] };
  const weekCount = skeleton.weeks.length;

  const phases: DraftPhase[] = [];
  if (!Array.isArray(value.phases) || value.phases.length === 0 || value.phases.length > DRAFT_LIMITS.maxPhases) {
    add('phases', 'phases', `phases must list 1 to ${DRAFT_LIMITS.maxPhases} phases`);
  } else {
    value.phases.forEach((item, index) => {
      const phase = record(item);
      const path = `phases[${index}]`;
      if (
        !phase ||
        !plainText(phase.title, DRAFT_LIMITS.maxTitleChars) ||
        !plainText(phase.focus, DRAFT_LIMITS.maxTextChars) ||
        !Number.isInteger(phase.fromWeek) ||
        !Number.isInteger(phase.toWeek) ||
        (phase.fromWeek as number) < 1 ||
        (phase.toWeek as number) > weekCount ||
        (phase.fromWeek as number) > (phase.toWeek as number)
      ) {
        add('phase', path, `each phase needs a title, a focus and weeks within 1 to ${weekCount}`);
        return;
      }
      phases.push({
        title: phase.title as string,
        focus: phase.focus as string,
        fromWeek: phase.fromWeek as number,
        toWeek: phase.toWeek as number,
      });
    });
  }

  const types: SessionType[] = [];
  // Ids declared with a valid name, even if the rest of the type is broken, so
  // weeks that use a broken type do not repeat its issue as "unknown id".
  const declared = new Set<string>();
  const { min, max } = skeleton.sessionMinutes;
  if (
    !Array.isArray(value.sessionTypes) ||
    value.sessionTypes.length === 0 ||
    value.sessionTypes.length > DRAFT_LIMITS.maxSessionTypes
  ) {
    add('session_types', 'sessionTypes', `sessionTypes must list 1 to ${DRAFT_LIMITS.maxSessionTypes} types`);
  } else {
    const seen = new Set<string>();
    value.sessionTypes.forEach((item, index) => {
      const type = record(item);
      const path = `sessionTypes[${index}]`;
      if (!type) {
        add('session_type', path, 'each session type must be an object');
        return;
      }
      const id = type.id;
      if (typeof id !== 'string' || !TYPE_ID.test(id) || seen.has(id)) {
        add('session_type_id', `${path}.id`, 'ids must be unique snake_case words');
        return;
      }
      seen.add(id);
      declared.add(id);
      const minutes = type.minutes;
      if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < min || minutes > max || minutes % 5 !== 0) {
        add('session_minutes', `${path}.minutes`, `minutes must be a multiple of 5 from ${min} to ${max}`);
        return;
      }
      if (!INTENSITIES.includes(type.intensity as Intensity)) {
        add('intensity', `${path}.intensity`, 'intensity must be easy, moderate or hard');
        return;
      }
      if (!ROLES.includes(type.role as Role)) {
        add('role', `${path}.role`, 'role must be key or support');
        return;
      }
      if (
        !plainText(type.title, DRAFT_LIMITS.maxTitleChars) ||
        !plainText(type.deliverable, DRAFT_LIMITS.maxTextChars) ||
        !plainText(type.doneWhen, DRAFT_LIMITS.maxTextChars)
      ) {
        add('session_text', path, 'title, deliverable and doneWhen must be short plain text');
        return;
      }
      if (!Array.isArray(type.blocks) || type.blocks.length === 0 || type.blocks.length > DRAFT_LIMITS.maxBlocks) {
        add('blocks', `${path}.blocks`, `blocks must list 1 to ${DRAFT_LIMITS.maxBlocks} blocks`);
        return;
      }
      const blocks = type.blocks.map((entry) => record(entry));
      if (
        blocks.some((block) =>
          !block ||
          typeof block.minutes !== 'number' ||
          !Number.isInteger(block.minutes) ||
          block.minutes < 1 ||
          !plainText(block.activity, DRAFT_LIMITS.maxTextChars))
      ) {
        add('blocks', `${path}.blocks`, 'each block needs whole minutes and a short activity');
        return;
      }
      const total = blocks.reduce((sum, block) => sum + (block?.minutes as number), 0);
      if (total !== minutes) {
        add('blocks_sum', `${path}.blocks`, `blocks add up to ${total} minutes; they must add up to ${minutes}`);
        return;
      }
      types.push({
        id,
        title: type.title as string,
        minutes,
        intensity: type.intensity as Intensity,
        role: type.role as Role,
        blocks: blocks.map((block) => ({ minutes: block?.minutes as number, activity: block?.activity as string })),
        deliverable: type.deliverable as string,
        doneWhen: type.doneWhen as string,
      });
    });
  }

  const weeks: Draft['weeks'] = [];
  if (!Array.isArray(value.weeks) || value.weeks.length !== weekCount) {
    add('weeks', 'weeks', `weeks must list exactly ${weekCount} weeks`);
  } else {
    value.weeks.forEach((item, index) => {
      const week = record(item);
      const path = `weeks[${index}]`;
      if (!week || week.week !== index + 1 || !Array.isArray(week.sessions)) {
        add('week', path, `weeks[${index}] must be week ${index + 1} with a sessions list`);
        return;
      }
      if (week.sessions.length > DRAFT_LIMITS.maxSessionsPerWeek) {
        add('week_length', `${path}.sessions`, `a week lists at most ${DRAFT_LIMITS.maxSessionsPerWeek} sessions, one a day`);
        return;
      }
      if (week.sessions.some((id) => typeof id !== 'string' || !declared.has(id))) {
        add('week_session', `${path}.sessions`, 'sessions must use ids from sessionTypes');
        return;
      }
      weeks.push({ week: index + 1, sessions: [...(week.sessions as string[])] });
    });
  }

  if (value.templateId !== null && (typeof value.templateId !== 'string' || !TYPE_ID.test(value.templateId))) {
    add('template', 'templateId', 'templateId must be a template id or null');
  }

  if (issues.length > 0) return { ok: false, issues };
  const draft: Draft = {
    phases,
    sessionTypes: types,
    weeks,
    templateId: typeof value.templateId === 'string' ? value.templateId : null,
  };
  return { ok: true, draft, overLimits: ruleIssues(draft, spec, skeleton) };
}

/** Weeks that ask for more than their room, ceiling, cap or hard-session limit. */
export function ruleIssues(draft: Draft, spec: GoalSpec, skeleton: Skeleton): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const typeById = new Map(draft.sessionTypes.map((type) => [type.id, type]));
  const totals = draftWeekMinutes(draft);
  draft.weeks.forEach((week, index) => {
    const path = `weeks[${index}].sessions`;
    const room = skeleton.weeks[index];
    if (week.sessions.length > room.maxSessions) {
      issues.push({ code: 'week_count', path, message: `week ${index + 1} has room for at most ${room.maxSessions} sessions` });
    }
    if (totals[index] > spec.weeklyCapMinutes) {
      issues.push({ code: 'week_cap', path, message: `week ${index + 1} totals ${totals[index]} minutes; the cap is ${spec.weeklyCapMinutes}` });
    } else if (totals[index] > room.maxMinutes) {
      issues.push({ code: 'week_minutes', path, message: `week ${index + 1} totals ${totals[index]} minutes; at most ${room.maxMinutes} this week` });
    }
    if (spec.domain !== 'fitness') return;
    const hard = week.sessions.filter((id) => typeById.get(id)?.intensity === 'hard').length;
    if (hard > FITNESS_LOAD.maxHardPerWeek) {
      issues.push({ code: 'hard_sessions', path, message: `week ${index + 1} has ${hard} hard sessions; at most ${FITNESS_LOAD.maxHardPerWeek}` });
    }
  });
  return issues.slice(0, DRAFT_LIMITS.maxIssues);
}
