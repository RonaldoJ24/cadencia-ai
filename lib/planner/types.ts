// Types shared by the goal planner. Dates are local calendar dates
// (YYYY-MM-DD), times are local wall-clock times (HH:mm), and weekday 0 is
// Monday, matching the week compiler in lib/routine.ts.

import type { Language } from '../i18n.ts';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type LocalDate = string;
export type LocalTime = string;

export type Domain = 'fitness' | 'learning' | 'creative' | 'general';
export type Intensity = 'easy' | 'moderate' | 'hard';

/** A same-day window, start before end. */
export type TimeWindow = { start: LocalTime; end: LocalTime };

/** Everything code needs to schedule a goal; built from controls and the model's reading. */
export type GoalSpec = {
  title: string;
  domain: Domain;
  language: Language;
  /** First day the plan may use. */
  startDate: LocalDate;
  /** Last day the plan may use, inclusive. */
  deadline: LocalDate;
  /** Weekdays sessions may fall on. */
  days: Weekday[];
  /** Time window sessions must fit in, every allowed day. */
  window: TimeWindow;
  /** Upper bound on scheduled minutes in each calendar week. */
  weeklyCapMinutes: number;
};

/** A time the person is not available, local wall-clock, end exclusive. */
export type BusyInterval = { start: string; end: string };

export type Block = { minutes: number; activity: string };

export type SessionType = {
  id: string;
  title: string;
  minutes: number;
  intensity: Intensity;
  blocks: Block[];
  deliverable: string;
  doneWhen: string;
};

export type DraftPhase = { title: string; fromWeek: number; toWeek: number; focus: string };

/** The model's compact proposal: session types plus which ones each week holds. */
export type Draft = {
  phases: DraftPhase[];
  sessionTypes: SessionType[];
  weeks: Array<{ week: number; sessions: string[] }>;
  templateId: string | null;
};

export type PlannedSession = {
  id: string;
  week: number;
  date: LocalDate;
  start: LocalTime;
  minutes: number;
  typeId: string;
  title: string;
  intensity: Intensity;
  blocks: Block[];
  deliverable: string;
  doneWhen: string;
  status: 'planned' | 'done' | 'missed';
};

export type PlanWeek = {
  week: number;
  /** Monday of the calendar week. */
  start: LocalDate;
  /** Sunday of the calendar week. */
  end: LocalDate;
  sessions: PlannedSession[];
};

export type MoveReason = 'busy' | 'rest_spacing' | 'day_taken';
export type DropReason = 'no_free_slot' | 'weekly_cap';

export type ScheduleNote =
  | {
    kind: 'moved';
    week: number;
    typeId: string;
    from: { date: LocalDate; start: LocalTime };
    to: { date: LocalDate; start: LocalTime };
    reason: MoveReason;
    /** The busy time that blocked the preferred slot, when the reason is busy. */
    conflict?: BusyInterval;
  }
  | { kind: 'dropped'; week: number; typeId: string; reason: DropReason };

export type GoalPlan = {
  spec: GoalSpec;
  draft: Draft;
  weeks: PlanWeek[];
  notes: ScheduleNote[];
};

/** What code offers the model before it drafts: the room each week really has. */
export type Skeleton = {
  weeks: Array<{
    week: number;
    start: LocalDate;
    /** Allowed days inside the date range. */
    usableDays: number;
    /** Allowed days with a free stretch long enough for the shortest session. */
    freeDays: number;
    maxSessions: number;
  }>;
  weeklyCapMinutes: number;
  /** Allowed session lengths: every multiple of 5 from min to max. */
  sessionMinutes: { min: number; max: number };
};
