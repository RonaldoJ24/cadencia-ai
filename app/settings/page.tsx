'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  deleteAccount,
  getQuota,
  LoopApiError,
  type QuotaStatus,
} from '@/components/loop-client';
import { DEFAULT_LANGUAGE, isLanguage, LANGUAGE_STORAGE_KEY, type Language } from '@/lib/i18n';

const COPY = {
  en: {
    title: 'Settings',
    subtitle: 'Language, quota, and your data.',
    language: 'Language',
    quotaTitle: 'Connected AI quota',
    quotaBody: (used: number, quota: number) => `${used} of ${quota} live generations used today.`,
    quotaUnavailable: 'Quota status is unavailable here.',
    dangerTitle: 'Delete my data',
    dangerBody: 'Removes routines, sessions, history, and feedback saved in this beta. This cannot be undone.',
    confirmLabel: 'Yes, delete everything',
    deleteAction: 'Delete all my data',
    deleting: 'Deleting…',
    deleted: 'All saved data was deleted.',
    deleteFailed: 'Deletion did not complete. Nothing may have changed.',
    unauthorized: 'Sign in through the private beta to manage settings.',
    failed: 'We could not load settings.',
    home: '← Cadencia home',
    today: 'Today →',
  },
  es: {
    title: 'Ajustes',
    subtitle: 'Idioma, cuota y tus datos.',
    language: 'Idioma',
    quotaTitle: 'Cuota de IA conectada',
    quotaBody: (used: number, quota: number) => `${used} de ${quota} generaciones en vivo usadas hoy.`,
    quotaUnavailable: 'La cuota no está disponible aquí.',
    dangerTitle: 'Borrar mis datos',
    dangerBody: 'Elimina rutinas, sesiones, historial y opiniones de esta beta. No se puede deshacer.',
    confirmLabel: 'Sí, borrar todo',
    deleteAction: 'Borrar todos mis datos',
    deleting: 'Borrando…',
    deleted: 'Todos los datos guardados fueron borrados.',
    deleteFailed: 'El borrado no se completó. Puede que nada haya cambiado.',
    unauthorized: 'Inicia sesión en la beta privada para gestionar ajustes.',
    failed: 'No pudimos cargar los ajustes.',
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

export default function SettingsPage() {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const copy = COPY[language];
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string>('');
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const { failed, unauthorized } = copy;

  useEffect(() => {
    let active = true;
    getQuota()
      .then((payload) => {
        if (!active) return;
        setQuota(payload);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof LoopApiError && error.status === 401) {
          setStatus('error');
          setMessage(unauthorized);
          return;
        }
        // Quota may be unconfigured while settings still render.
        setQuota(null);
        setStatus('ready');
      });
    return () => {
      active = false;
    };
  }, [unauthorized]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const changeLanguage = useCallback((next: Language) => {
    setLanguage(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Selection still applies for this visit.
    }
  }, []);

  const destroy = useCallback(async () => {
    if (!armed || deleting) return;
    setDeleting(true);
    setNotice(null);
    try {
      await deleteAccount();
      setNotice({ kind: 'ok', text: copy.deleted });
      setQuota(null);
      setArmed(false);
    } catch {
      setNotice({ kind: 'error', text: copy.deleteFailed });
    } finally {
      setDeleting(false);
    }
  }, [armed, deleting, copy.deleted, copy.deleteFailed]);

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
      <section aria-labelledby="settings-title">
        <h1 id="settings-title">{copy.title}</h1>
        <p>{copy.subtitle}</p>
        {status === 'error' ? <p role="alert">{message || failed}</p> : null}
        <section aria-label={copy.language}>
          <h2>{copy.language}</h2>
          <button type="button" aria-pressed={language === 'en'} onClick={() => changeLanguage('en')}>
            EN
          </button>
          <button type="button" aria-pressed={language === 'es'} onClick={() => changeLanguage('es')}>
            ES
          </button>
        </section>
        <section aria-label={copy.quotaTitle}>
          <h2>{copy.quotaTitle}</h2>
          {quota ? <p>{copy.quotaBody(quota.liveGenerations, quota.dailyQuota)}</p> : <p>{copy.quotaUnavailable}</p>}
        </section>
        <section aria-label={copy.dangerTitle}>
          <h2>{copy.dangerTitle}</h2>
          <p>{copy.dangerBody}</p>
          {notice ? <p role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p> : null}
          <label>
            <input type="checkbox" checked={armed} onChange={() => setArmed((value) => !value)} />
            {copy.confirmLabel}
          </label>
          <button
            type="button"
            disabled={!armed || deleting}
            onClick={() => {
              void destroy();
            }}
          >
            {deleting ? copy.deleting : copy.deleteAction}
          </button>
        </section>
      </section>
    </main>
  );
}
