'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listRoutines, LoopApiError, type LoopRoutineMeta } from '@/components/loop-client';
import { DEFAULT_LANGUAGE, isLanguage, LANGUAGE_STORAGE_KEY, type Language } from '@/lib/i18n';

const COPY = {
  en: {
    title: 'Library',
    subtitle: 'Saved routines. Open one to work it today.',
    loading: 'Loading saved routines…',
    empty: 'No saved routines yet. Create one on the home page first.',
    unauthorized: 'Sign in through the private beta to see saved routines.',
    unavailable: 'Routine storage is not configured here.',
    failed: 'We could not load saved routines.',
    open: 'Open in Today',
    home: '← Cadencia home',
    today: 'Today →',
  },
  es: {
    title: 'Biblioteca',
    subtitle: 'Rutinas guardadas. Abre una para trabajarla hoy.',
    loading: 'Cargando rutinas guardadas…',
    empty: 'Aún no hay rutinas guardadas. Crea una en el inicio primero.',
    unauthorized: 'Inicia sesión en la beta privada para ver rutinas guardadas.',
    unavailable: 'El almacenamiento de rutinas no está configurado aquí.',
    failed: 'No pudimos cargar las rutinas guardadas.',
    open: 'Abrir en Hoy',
    home: '← Inicio Cadencia',
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

export default function LibraryPage() {
  const [language] = useState<Language>(initialLanguage);
  const copy = COPY[language];
  const [routines, setRoutines] = useState<LoopRoutineMeta[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string>(copy.loading);
  const { failed, unauthorized, unavailable } = copy;

  useEffect(() => {
    let active = true;
    listRoutines()
      .then((payload) => {
        if (!active) return;
        setRoutines(payload.routines);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus('error');
        const code = error instanceof LoopApiError ? error.status : 0;
        setMessage(code === 401 ? unauthorized : code === 503 ? unavailable : failed);
      });
    return () => {
      active = false;
    };
  }, [failed, unauthorized, unavailable]);

  return (
    <main className="cadencia-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-word">cadencia</span>
          <span className="brand-note">loop</span>
        </Link>
        <nav aria-label="Loop">
          <Link href="/">{copy.home}</Link>
          <Link href="/today">{copy.today}</Link>
        </nav>
      </header>
      <section aria-labelledby="library-title">
        <h1 id="library-title">{copy.title}</h1>
        <p>{copy.subtitle}</p>
        {status === 'loading' ? <p aria-live="polite">{message}</p> : null}
        {status === 'error' ? <p role="alert">{message}</p> : null}
        {status === 'ready' && (!routines || routines.length === 0) ? <p>{copy.empty}</p> : null}
        {status === 'ready' && routines && routines.length > 0 ? (
          <ul>
            {routines.map((routine) => (
              <li key={routine.id}>
                <div>
                  <strong>{routine.title}</strong>
                  <small>
                    {routine.updatedAt.slice(0, 10)} · {routine.sourceMode} · {routine.language}
                  </small>
                </div>
                <Link href={`/today?routine=${encodeURIComponent(routine.id)}`}>{copy.open}</Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
