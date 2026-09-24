'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  completeSession,
  getRoutine,
  listRoutines,
  localDay,
  LoopApiError,
  skipSession,
  type LoopDetail,
  type LoopSession,
} from '@/components/loop-client';
import { DEFAULT_LANGUAGE, isLanguage, LANGUAGE_STORAGE_KEY, type Language } from '@/lib/i18n';

const COPY = {
  en: {
    title: 'Today',
    subtitle: 'One tap per session. State is saved on the server.',
    loading: 'Loading today…',
    empty: 'No saved sessions yet. Create a routine first.',
    unauthorized: 'Sign in through the private beta to track sessions.',
    unavailable: 'Routine storage is not configured here.',
    failed: 'We could not load today.',
    syncFailed: 'Change not saved; refreshed from server.',
    dueToday: 'Due today',
    upcoming: 'Upcoming',
    finished: 'Finished',
    overdue: 'Overdue — still counts if you do it',
    done: 'Mark done',
    skip: 'Skip',
    saving: 'Saving…',
    library: '← Library',
    home: 'Home',
  },
  es: {
    title: 'Hoy',
    subtitle: 'Un toque por sesión. El estado se guarda en el servidor.',
    loading: 'Cargando el día…',
    empty: 'Aún no hay sesiones guardadas. Crea una rutina primero.',
    unauthorized: 'Inicia sesión en la beta privada para registrar sesiones.',
    unavailable: 'El almacenamiento de rutinas no está configurado aquí.',
    failed: 'No pudimos cargar el día.',
    syncFailed: 'Cambio no guardado; actualizado desde el servidor.',
    dueToday: 'Para hoy',
    upcoming: 'Próximas',
    finished: 'Terminadas',
    overdue: 'Atrasada — aún cuenta si la haces',
    done: 'Marcar hecha',
    skip: 'Omitir',
    saving: 'Guardando…',
    library: '← Biblioteca',
    home: 'Inicio',
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

function errorMessage(
  error: unknown,
  copy: { failed: string; unauthorized: string; unavailable: string },
): string {
  const code = error instanceof LoopApiError ? error.status : 0;
  if (code === 401) return copy.unauthorized;
  if (code === 503) return copy.unavailable;
  return copy.failed;
}

export default function TodayPage() {
  const [language] = useState<Language>(initialLanguage);
  const copy = COPY[language];
  const [detail, setDetail] = useState<LoopDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string>(copy.loading);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const { failed, unauthorized, unavailable, syncFailed } = copy;

  const refresh = useCallback(async (routineId?: string) => {
    const params = new URLSearchParams(window.location.search);
    const requested = routineId ?? params.get('routine') ?? undefined;
    const list = await listRoutines();
    const target = requested ?? list.routines[0]?.id;
    if (!target) {
      setDetail(null);
      setStatus('ready');
      return;
    }
    setDetail(await getRoutine(target));
    setStatus('ready');
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await refresh();
        if (!active) return;
      } catch (error) {
        if (!active) return;
        setStatus('error');
        setMessage(errorMessage(error, { failed, unauthorized, unavailable }));
      }
    })();
    return () => {
      active = false;
    };
  }, [refresh, failed, unauthorized, unavailable]);

  const groups = useMemo(() => {
    if (!detail) return null;
    const today = localDay(detail.version.timezone);
    const due: LoopSession[] = [];
    const upcoming: LoopSession[] = [];
    const finished: LoopSession[] = [];
    for (const session of detail.sessions) {
      if (session.status !== 'scheduled') {
        finished.push(session);
      } else if (session.startsAt.slice(0, 10) <= today) {
        due.push(session);
      } else {
        upcoming.push(session);
      }
    }
    return { due, upcoming, finished, today };
  }, [detail]);

  const transition = useCallback(
    async (session: LoopSession, action: 'done' | 'skipped') => {
      if (!detail) return;
      setNotice(null);
      setPending((current) => ({ ...current, [session.id]: true }));
      // Optimistic update; server reconciles below.
      const optimistic: LoopSession = {
        ...session,
        status: action === 'done' ? 'done' : 'skipped',
      };
      setDetail({
        ...detail,
        sessions: detail.sessions.map((item) => (item.id === session.id ? optimistic : item)),
      });
      try {
        const result = action === 'done'
          ? await completeSession(session.id)
          : await skipSession(session.id);
        setDetail((current) =>
          current
            ? {
              ...current,
              sessions: current.sessions.map((item) =>
                item.id === session.id ? { ...item, ...result.session } : item,
              ),
            }
            : current,
        );
      } catch {
        // Revert to server truth: refresh the persisted version.
        try {
          await refresh(detail.routine.id);
        } catch {
          // Refresh failure keeps the optimistic row flagged below.
        }
        setNotice(syncFailed);
      } finally {
        setPending((current) => {
          const next = { ...current };
          delete next[session.id];
          return next;
        });
      }
    },
    [detail, refresh, syncFailed],
  );

  return (
    <main className="cadencia-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-word">cadencia</span>
          <span className="brand-note">loop</span>
        </Link>
        <nav aria-label="Loop">
          <Link href="/library">{copy.library}</Link>
          <Link href="/">{copy.home}</Link>
        </nav>
      </header>
      <section aria-labelledby="today-title" aria-busy={status === 'loading'}>
        <h1 id="today-title">{copy.title}</h1>
        <p>{copy.subtitle}</p>
        {status === 'loading' ? <p aria-live="polite">{message}</p> : null}
        {status === 'error' ? <p role="alert">{message}</p> : null}
        {notice ? <p role="alert">{notice}</p> : null}
        {status === 'ready' && !detail ? <p>{copy.empty}</p> : null}
        {status === 'ready' && detail && groups ? (
          <div>
            <h2>{detail.routine.title}</h2>
            <section aria-label={copy.dueToday}>
              <h3>{copy.dueToday}</h3>
              {groups.due.length === 0 ? <p>—</p> : null}
              {groups.due.map((session) => (
                <article key={session.id}>
                  <div>
                    <strong>{session.title}</strong>
                    <small>
                      {session.startsAt.slice(0, 10)} · {session.minutes} min
                      {session.startsAt.slice(0, 10) < groups.today ? ` · ${copy.overdue}` : ''}
                    </small>
                  </div>
                  <div>
                    <button
                      type="button"
                      disabled={pending[session.id] === true}
                      onClick={() => {
                        void transition(session, 'done');
                      }}
                    >
                      {pending[session.id] === true ? copy.saving : copy.done}
                    </button>
                    <button
                      type="button"
                      disabled={pending[session.id] === true}
                      onClick={() => {
                        void transition(session, 'skipped');
                      }}
                    >
                      {copy.skip}
                    </button>
                  </div>
                </article>
              ))}
            </section>
            <section aria-label={copy.upcoming}>
              <h3>{copy.upcoming}</h3>
              {groups.upcoming.length === 0 ? <p>—</p> : null}
              {groups.upcoming.map((session) => (
                <article key={session.id}>
                  <div>
                    <strong>{session.title}</strong>
                    <small>{session.startsAt.slice(0, 10)} · {session.minutes} min</small>
                  </div>
                </article>
              ))}
            </section>
            <section aria-label={copy.finished}>
              <h3>{copy.finished}</h3>
              {groups.finished.length === 0 ? <p>—</p> : null}
              {groups.finished.map((session) => (
                <article key={session.id}>
                  <div>
                    <strong>{session.title}</strong>
                    <small>
                      {session.startsAt.slice(0, 10)} · {session.status}
                    </small>
                  </div>
                </article>
              ))}
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
