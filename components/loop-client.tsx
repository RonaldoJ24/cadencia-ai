'use client';
// Shared client for the beta loop: library + today. Server is the source of
// truth; every mutation reconciles against the POST response and refetches
// on failure, so a refresh always shows persisted state.

export type LoopSession = {
  id: string;
  routineId: string;
  versionId: string;
  ordinal: number;
  startsAt: string;
  minutes: number;
  title: string;
  status: 'scheduled' | 'done' | 'skipped' | 'missed';
  completedAt: string | null;
  note: string | null;
};

export type LoopRoutineMeta = {
  id: string;
  title: string;
  language: 'en' | 'es';
  sourceMode: 'demo' | 'deepseek';
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type LoopDetail = {
  routine: LoopRoutineMeta;
  version: {
    id: string;
    versionNumber: number;
    weekStart: string;
    timezone: string;
    generatedBy: string;
    createdAt: string;
  };
  sessions: LoopSession[];
  plan: unknown;
};

export class LoopApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'LoopApiError';
    this.status = status;
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const payload = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    throw new LoopApiError(response.status, `loop-request-failed:${response.status}`);
  }
  return payload;
}

export async function listRoutines(): Promise<{ routines: LoopRoutineMeta[]; nextCursor: string | null }> {
  const payload = (await request('/api/routines')) as {
    routines: LoopRoutineMeta[];
    nextCursor: string | null;
  };
  return { routines: payload.routines ?? [], nextCursor: payload.nextCursor ?? null };
}

export async function getRoutine(id: string): Promise<LoopDetail> {
  return (await request(`/api/routines/${encodeURIComponent(id)}`)) as LoopDetail;
}

export async function completeSession(id: string, note?: string): Promise<{ session: LoopSession }> {
  return (await request(`/api/sessions/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(note === undefined ? {} : { note }),
  })) as { session: LoopSession };
}

export async function skipSession(id: string, note?: string): Promise<{ session: LoopSession }> {
  return (await request(`/api/sessions/${encodeURIComponent(id)}/skip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(note === undefined ? {} : { note }),
  })) as { session: LoopSession };
}

export function localDay(timezone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(timezone ? { timeZone: timezone } : {}),
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export type VersionSummary = {
  id: string;
  versionNumber: number;
  weekStart: string;
  timezone: string;
  generatedBy: string;
  createdAt: string;
};

export async function listVersions(routineId: string): Promise<{ versions: VersionSummary[] }> {
  return (await request(`/api/routines/${encodeURIComponent(routineId)}/versions`)) as {
    versions: VersionSummary[];
  };
}

export async function getVersion(routineId: string, versionNumber: number): Promise<LoopDetail> {
  return (await request(
    `/api/routines/${encodeURIComponent(routineId)}/versions/${encodeURIComponent(String(versionNumber))}`,
  )) as LoopDetail;
}

export async function replanRoutine(
  routineId: string,
  markMissed: string[],
  timezone?: string,
): Promise<LoopDetail & { applied: { missedSessionIds: string[]; replacementPlanIds: string[] } }> {
  return (await request(`/api/routines/${encodeURIComponent(routineId)}/replan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(timezone === undefined ? { markMissed } : { markMissed, timezone }),
  })) as LoopDetail & { applied: { missedSessionIds: string[]; replacementPlanIds: string[] } };
}

export type ReviewMetrics = {
  plannedSessions: number;
  plannedMinutes: number;
  completedSessions: number;
  completedMinutes: number;
  skippedSessions: number;
  missedSessions: number;
  completionRatio: number;
};

export { reviewMetrics } from '@/lib/review';

export type QuotaStatus = { windowStart: string; liveGenerations: number; dailyQuota: number };

export async function getQuota(): Promise<QuotaStatus> {
  return (await request('/api/quota')) as QuotaStatus;
}

export async function submitFeedback(input: {
  score: 1 | -1;
  category?: string;
  routineVersionId?: string;
}): Promise<{ submitted: boolean }> {
  return (await request('/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })) as { submitted: boolean };
}

export async function deleteAccount(): Promise<{ deleted: boolean }> {
  return (await request('/api/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: 'delete' }),
  })) as { deleted: boolean };
}
