'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getRoutine,
  getVersion,
  listRoutines,
  listVersions,
  LoopApiError,
  replanRoutine,
  reviewMetrics,
  type LoopDetail,
  type LoopRoutineMeta,
  type VersionSummary,
} from '@/components/loop-client';
import { DEFAULT_LANGUAGE, isLanguage, LANGUAGE_STORAGE_KEY, type Language } from '@/lib/i18n';

const COPY = {
  en: {
    title: 'Review',
    subtitle: 'Honest numbers from saved sessions. Replan adapts without rewriting history.',
    loading: 'Loading review…',
    empty: 'No saved routines yet. Create one first.',
    unauthorized: 'Sign in through the private beta to review routines.',
    unavailable: 'Routine storage is not configured here.',
    failed: 'We could not load the review.',
    replanFailed: 'Replan did not save. Nothing changed.',
    replanned: 'New version saved. Completed work is untouched.',
    planned: 'Planned',
    completed: 'Completed',
    consistency: 'Consistency',
    blockers: 'Skipped or missed',
    minutes: 'min',
    sessions: 'Sessions',
    history: 'History',
    current: 'current',
    replanAction: 'Replan selected as missed',
    selectHint: 'Select scheduled sessions you could not do.',
    nothingSelected: 'Select at least one scheduled session.',
    saving: 'Saving…',
    version: 'Version',
    library: '← Library',
    today: 'Today →',
  },
  es: {
    title: 'Revisión',
    subtitle: 'Números honestos de sesiones guardadas. Replanificar adapta sin reescribir la historia.',
    loading: 'Cargando revisión…',
    empty: 'Aún no hay rutinas guardadas. Crea una primero.',
    unauthorized: 'Inicia sesión en la beta privada para revisar rutinas.',
    unavailable: 'El almacenamiento de rutinas no está configurado aquí.',
    failed: 'No pudimos cargar la revisión.',
    replanFailed: 'No se guardó la replanificación. Nada cambió.',
    replanned: 'Nueva versión guardada. Lo completado sigue intacto.',
    planned: 'Planificado',
    completed: 'Completado',
    consistency: 'Constancia',
    blockers: 'Omitidas o perdidas',
    minutes: 'min',
    sessions: 'Sesiones',
    history: 'Historial',
    current: 'actual',
    replanAction: 'Replanificar selección como perdidas',
    selectHint: 'Elige sesiones programadas que no pudiste hacer.',
    nothingSelected: 'Elige al menos una sesión programada.',
    saving: 'Guardando…',
    version: 'Versión',
    library: '← Biblioteca',
    today: 'Hoy →',
  },
} as const;

function initialLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(saved) ? saved : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export default function ReviewPage() {
  const [language] = useState<Language>(initialLanguage);
  const copy = COPY[language];
  const [routines, setRoutines] = useState<LoopRoutineMeta[] | null>(null);
  const [routineId, setRoutineId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LoopDetail | null>(null);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string>(copy.loading);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const { failed, unauthorized, unavailable } = copy;

  const load = useCallback(async (target: string) => {
    const [fresh, history] = await Promise.all([getRoutine(target), listVersions(target)]);
    setDetail(fresh);
    setVersions(history.versions);
    setViewVersion(fresh.version.versionNumber);
    setSelected({});
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await listRoutines();
        if (!active) return;
        setRoutines(list.routines);
        const params = new URLSearchParams(window.location.search);
        const target = params.get('routine') ?? list.routines[0]?.id ?? null;
        setRoutineId(target);
        if (target) await load(target);
        setStatus('ready');
      } catch (error) {
        if (!active) return;
        setStatus('error');
        const code = error instanceof LoopApiError ? error.status : 0;
        setMessage(code === 401 ? unauthorized : code === 503 ? unavailable : failed);
      }
    })();
    return () => {
      active = false;
    };
  }, [load, failed, unauthorized, unavailable]);

  const viewing = useMemo(() => {
    if (!detail) return null;
    if (viewVersion === null || viewVersion === detail.version.versionNumber) return detail;
    return null;
  }, [detail, viewVersion]);

  const latestNumber = versions && versions.length > 0
    ? versions[versions.length - 1]?.versionNumber ?? detail?.version.versionNumber ?? 1
    : (detail?.version.versionNumber ?? 1);

  const metrics = useMemo(
    () => (viewing ? reviewMetrics(viewing.sessions) : null),
    [viewing],
  );

  const switchRoutine = useCallback(
    async (target: string) => {
      setRoutineId(target);
      setStatus('loading');
      setNotice(null);
      try {
        await load(target);
        setStatus('ready');
      } catch (error) {
        const code = error instanceof LoopApiError ? error.status : 0;
        setMessage(code === 401 ? unauthorized : code === 503 ? unavailable : failed);
        setStatus('error');
      }
    },
    [load, failed, unauthorized, unavailable],
  );

  const switchVersion = useCallback(
    async (versionNumber: number) => {
      if (!routineId) return;
      setNotice(null);
      try {
        setDetail(await getVersion(routineId, versionNumber));
        setViewVersion(versionNumber);
        setSelected({});
      } catch (error) {
        const code = error instanceof LoopApiError ? error.status : 0;
        setNotice({
          kind: 'error',
          text: code === 401 ? unauthorized : code === 503 ? unavailable : failed,
        });
      }
    },
    [routineId, failed, unauthorized, unavailable],
  );

  const submitReplan = useCallback(async () => {
    if (!routineId || !detail) return;
    const ids = detail.sessions.filter((s) => selected[s.id] === true && s.status === 'scheduled').map((s) => s.id);
    if (ids.length === 0) {
      setNotice({ kind: 'error', text: copy.nothingSelected });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const next = await replanRoutine(routineId, ids);
      setDetail(next);
      setVersions((current) =>
        current
          ? [...current, {
            id: next.version.id,
            versionNumber: next.version.versionNumber,
            weekStart: next.version.weekStart,
            timezone: next.version.timezone,
            generatedBy: next.version.generatedBy,
            createdAt: next.version.createdAt,
          }]
          : current,
      );
      setViewVersion(next.version.versionNumber);
      setSelected({});
      setNotice({ kind: 'ok', text: copy.replanned });
    } catch {
      setNotice({ kind: 'error', text: copy.replanFailed });
    } finally {
      setSaving(false);
    }
  }, [routineId, detail, selected, copy.nothingSelected, copy.replanned, copy.replanFailed]);

  const toggle = useCallback((id: string) => {
    setSelected((current) => ({ ...current, [id]: current[id] !== true }));
  }, []);

  return (
    <main className="cadencia-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-word">cadencia</span>
          <span className="brand-note">loop</span>
        </Link>
        <nav aria-label="Loop">
          <Link href="/library">{copy.library}</Link>
          <Link href="/today">{copy.today}</Link>
        </nav>
      </header>
      <section aria-labelledby="review-title" aria-busy={status === 'loading'}>
        <h1 id="review-title">{copy.title}</h1>
        <p>{copy.subtitle}</p>
        {status === 'loading' ? <p aria-live="polite">{message}</p> : null}
        {status === 'error' ? <p role="alert">{message}</p> : null}
        {notice ? <p role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p> : null}
        {status === 'ready' && (!routines || routines.length === 0) ? <p>{copy.empty}</p> : null}
        {status === 'ready' && routines && routines.length > 0 && detail && metrics ? (
          <div>
            <label>
              {copy.sessions}
              <select
                value={routineId ?? ''}
                onChange={(event) => {
                  void switchRoutine(event.target.value);
                }}
              >
                {routines.map((routine) => (
                  <option key={routine.id} value={routine.id}>
                    {routine.title}
                  </option>
                ))}
              </select>
            </label>
            <dl>
              <div>
                <dt>{copy.planned}</dt>
                <dd>{metrics.plannedSessions} · {metrics.plannedMinutes} {copy.minutes}</dd>
              </div>
              <div>
                <dt>{copy.completed}</dt>
                <dd>{metrics.completedSessions} · {metrics.completedMinutes} {copy.minutes}</dd>
              </div>
              <div>
                <dt>{copy.consistency}</dt>
                <dd>{Math.round(metrics.completionRatio * 100)}%</dd>
              </div>
              <div>
                <dt>{copy.blockers}</dt>
                <dd>{metrics.skippedSessions + metrics.missedSessions}</dd>
              </div>
            </dl>
            <section aria-label={copy.history}>
              <h3>{copy.history}</h3>
              <ul>
                {(versions ?? []).map((version) => (
                  <li key={version.id}>
                    <button
                      type="button"
                      disabled={version.versionNumber === viewVersion}
                      onClick={() => {
                        void switchVersion(version.versionNumber);
                      }}
                    >
                      {copy.version} {version.versionNumber} · {version.generatedBy}
                      {version.versionNumber === latestNumber ? ` (${copy.current})` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            {viewVersion === latestNumber ? (
              <section aria-label={copy.replanAction}>
                <h3>{copy.replanAction}</h3>
                <p>{copy.selectHint}</p>
                <ul>
                  {detail.sessions.map((session) => (
                    <li key={session.id}>
                      <label>
                        <input
                          type="checkbox"
                          disabled={session.status !== 'scheduled' || saving}
                          checked={selected[session.id] === true}
                          onChange={() => toggle(session.id)}
                        />
                        {session.title} · {session.startsAt.slice(0, 10)} · {session.status}
                      </label>
                    </li>
                  ))}
                </ul>
                <button type="button" disabled={saving} onClick={() => {
                  void submitReplan();
                }}>
                  {saving ? copy.saving : copy.replanAction}
                </button>
              </section>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
