'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, isLanguage, type Language } from '@/lib/i18n';

type ReplaySession = {
  id: string;
  date: string;
  dayIndex?: number;
  startsAt?: string;
  minutes: number;
  title: string;
  status: string;
};

type ReplayTraceSession = {
  sessionId: string;
  activityId: string;
  logicalId?: string;
  date: string;
  time: string;
  durationMinutes: number;
  budgetBefore: number;
  budgetAfter: number;
  ruleIds: string[];
  ruleInputs: Record<string, string | number | number[]>;
  outcome: string;
  plannerVersion: string;
  policyVersion: string;
};

type ReplayState = {
  replay: boolean;
  sandbox: { revision: number; expiresAt: string; hasActiveProposal: boolean };
  routine: { input?: { time?: string; weeklyMinutes?: number; sessionMinutes?: number; days?: number[] }; sessions: ReplaySession[] };
  proposal: {
    id: string;
    status: string;
    baseRevision: number;
    candidateHash: string;
    evidenceWatermark: number;
    diff: {
      moved?: Array<{
        logicalId: string;
        from: { sessionId: string; date: string };
        to: { sessionId: string; date: string };
      }>;
      locked?: Record<string, unknown>;
    };
    candidate: { sessions?: ReplaySession[] };
    expiresAt: string;
  } | null;
  proposalStatus: string | null;
  trace: { sessions: ReplayTraceSession[]; stages: string[]; plannerVersion: string; policyVersion: string };
  revisionStages: Array<{ stage: 'revision_persisting' | 'revision_persisted'; revision: number }>;
  hashes: { inputHash: string; scheduleHash: string; candidateHash: string | null };
  meta: { modelUsed: boolean; provider: string; workflow?: string; simulatedEvidence?: boolean; responseId?: string; serverMs?: number };
  curl: string;
  decision?: { persisted: string; notified: boolean; workflow: string; settled?: string };
};

const COPY = {
  en: {
    home: 'Cadencia',
    replayLink: 'Reviewer Replay',
    badge: 'Seeded demo · model off · live backend',
    title: 'Schedule Proof',
    subtitle: 'A causal compiler trace: intention → constraints → deterministic schedule → evidence → adaptation → approval → revision.',
    begin: 'Begin Reviewer Replay',
    beginHelp: 'Seeds the fixed bilingual fixture and opens revision R1. No model is used.',
    compile: 'Compile routine',
    compileHelp: 'Runs the real backend compiler on the fixed fixture and persists revision R1. No model is used.',
    reload: 'Refresh from D1',
    reloadHelp: 'Reads the persisted revision back from D1 — the readback proof.',
    decisionPending: 'Decision recorded. The Workflow is settling — refresh to read the committed revision back from D1.',
    compiling: 'Compiling…',
    constraints: 'Explicit constraints',
    revision: 'Revision',
    days: 'Selected days',
    durations: 'Session durations',
    budget: 'Weekly budget used',
    fingerprint: 'Revision fingerprint',
    modelBoundary: 'Model boundary',
    modelOff: 'model off — deterministic planner only',
    pickSession: 'Select a session to inspect its compiler trace.',
    traceTitle: 'Compiler trace',
    normalizedInputs: 'Normalized planner inputs',
    rules: 'Planner rule IDs',
    capArithmetic: 'Weekly-cap arithmetic',
    dateDecision: 'Date and duration decision',
    versions: 'Planner and policy versions',
    hashes: 'Hashes',
    redactedJson: 'Redacted trace JSON',
    curlLabel: 'Safe cURL example (no secrets)',
    showAdvanced: 'Advanced: JSON and cURL',
    responseMeta: 'Server response',
    revisionStages: 'Revision stages reached',
    missed: 'Replay: Tuesday was missed',
    missedHelp: 'Labels a simulated fixture event and starts a real adaptation Workflow.',
    working: 'Working…',
    candidatePending: 'The Workflow is deriving the candidate. Refresh to read it back from D1 — nothing is shown before the backend reports it.',
    candidateTitle: 'Candidate adaptation (proposed, not canonical)',
    canonicalTitle: 'Canonical schedule (unchanged until approval)',
    moved: 'moved',
    locked: 'Constraints locked',
    approve: 'Approve adaptation',
    reject: 'Reject',
    approveHelp: 'Commits revision R2 only if the guarded write succeeds.',
    refresh: 'Refresh and prove R2 persisted',
    committed: 'Revision R2 persisted. Refresh read it back from D1.',
    awaiting: 'Awaiting approval — canonical schedule unchanged.',
    failed: 'Backend recorded a failure at this stage:',
    expired: 'Replay session expired or revoked. Start a new one.',
    fallback: 'Local fallback: no Workflow binding here, the same coordinator ran synchronously.',
    aiProposes: 'AI can propose content. The deterministic planner controls dates, times, and revisions.',
    candidateNotCanonical: 'The candidate is not canonical. Approval is the exact point where persistence changes.',
    back: '← Back',
    reference: 'Reference',
    closeError: 'Dismiss error',
    lang: 'Language',
  },
  es: {
    home: 'Cadencia',
    replayLink: 'Repetición para revisores',
    badge: 'Demo fija · modelo off · backend en vivo',
    title: 'Prueba de agenda',
    subtitle: 'Traza causal del compilador: intención → restricciones → agenda determinista → evidencia → adaptación → aprobación → revisión.',
    begin: 'Iniciar repetición',
    beginHelp: 'Fija el ejemplo bilingüe y abre la revisión R1. No se usa ningún modelo.',
    compile: 'Compilar rutina',
    compileHelp: 'Ejecuta el compilador real del backend sobre el ejemplo fijo y guarda la revisión R1. No se usa ningún modelo.',
    reload: 'Recargar desde D1',
    reloadHelp: 'Lee la revisión guardada desde D1 — la prueba de persistencia.',
    decisionPending: 'Decisión registrada. El Workflow está confirmando — recarga para leer la revisión desde D1.',
    compiling: 'Compilando…',
    constraints: 'Restricciones explícitas',
    revision: 'Revisión',
    days: 'Días elegidos',
    durations: 'Duraciones por sesión',
    budget: 'Presupuesto semanal usado',
    fingerprint: 'Huella de revisión',
    modelBoundary: 'Límite del modelo',
    modelOff: 'modelo off — solo planificador determinista',
    pickSession: 'Elige una sesión para ver su traza.',
    traceTitle: 'Traza del compilador',
    normalizedInputs: 'Entradas normalizadas',
    rules: 'IDs de reglas',
    capArithmetic: 'Aritmética del tope semanal',
    dateDecision: 'Decisión de fecha y duración',
    versions: 'Versiones del planificador y la política',
    hashes: 'Hashes',
    redactedJson: 'JSON de traza (redactado)',
    curlLabel: 'Ejemplo cURL seguro (sin secretos)',
    showAdvanced: 'Avanzado: JSON y cURL',
    responseMeta: 'Respuesta del servidor',
    revisionStages: 'Etapas de revisión alcanzadas',
    missed: 'Repetir: el martes faltó',
    missedHelp: 'Etiqueta un evento simulado e inicia un Workflow real de adaptación.',
    working: 'Trabajando…',
    candidatePending: 'El Workflow está derivando la candidata. Recarga para leerla desde D1 — nada se muestra antes de que el backend lo reporte.',
    candidateTitle: 'Adaptación candidata (propuesta, no canónica)',
    canonicalTitle: 'Agenda canónica (sin cambios hasta aprobar)',
    moved: 'movida',
    locked: 'Restricciones fijas',
    approve: 'Aprobar adaptación',
    reject: 'Rechazar',
    approveHelp: 'Crea la revisión R2 solo si la escritura guardada tiene éxito.',
    refresh: 'Recargar y probar que R2 persistió',
    committed: 'Revisión R2 guardada. La recarga la leyó desde D1.',
    awaiting: 'En espera de aprobación — la agenda canónica no cambió.',
    failed: 'El backend registró un fallo en esta etapa:',
    expired: 'Sesión expirada o revocada. Inicia una nueva.',
    fallback: 'Local: sin binding de Workflow aquí; el mismo coordinador corrió en local.',
    aiProposes: 'La IA puede proponer contenido. El planificador determinista controla fechas, horas y revisiones.',
    candidateNotCanonical: 'La candidata no es canónica. La aprobación es el punto exacto donde cambia la persistencia.',
    back: '← Volver',
    reference: 'Referencia',
    closeError: 'Cerrar error',
    lang: 'Idioma',
  },
} as const;

const RULE_DESCRIPTIONS: Record<Language, Record<string, string>> = {
  en: {
    intent_validated: 'Proposal content validated; refused scope yields an empty schedule.',
    constraints_normalized: 'Weekdays sorted, Monday week start and local time pinned.',
    weekly_cap_applied: 'Sessions fit the weekly minute budget before placement.',
    session_placed: 'Session set on its date with duration and budget accounted.',
  },
  es: {
    intent_validated: 'Contenido validado; alcance rechazado deja agenda vacía.',
    constraints_normalized: 'Días ordenados, lunes como inicio y hora local fijada.',
    weekly_cap_applied: 'Sesiones dentro del tope semanal antes de colocar.',
    session_placed: 'Sesión fijada en su fecha con duración y presupuesto.',
  },
};

function initialLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(saved) ? saved : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

type Phase = 'idle' | 'starting' | 'ready' | 'working' | 'error';

export default function ReplayPage() {
  const [language, setLanguage] = useState<Language>(() =>
    typeof window === 'undefined' ? DEFAULT_LANGUAGE : initialLanguage(),
  );
  const [phase, setPhase] = useState<Phase>('idle');
  const [state, setState] = useState<ReplayState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const copy = COPY[language];

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const changeLanguage = (next: Language) => {
    setLanguage(next);
    document.documentElement.lang = next;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Selection still applies without storage.
    }
  };

  const readError = useCallback(async (response: Response, fallback: string) => {
    let message = fallback;
    let ref: string | null = null;
    try {
      const payload = (await response.json()) as { error?: string; reference?: string; message?: string; status?: string };
      if (typeof payload.error === 'string') message = payload.error;
      else if (typeof payload.message === 'string') message = payload.message;
      else if (payload.status === 'expired') message = fallback;
      if (typeof payload.reference === 'string') ref = payload.reference;
    } catch {
      // Keep the fallback message.
    }
    setError(message);
    setReference(ref);
    setPhase('error');
  }, []);

  const load = useCallback(async () => {
    const response = await fetch('/api/routine', { credentials: 'same-origin', cache: 'no-store' });
    const payload = (await response.json().catch(() => null)) as (ReplayState & { liveAvailable?: boolean }) | null;
    if (payload && (payload as ReplayState).replay) {
      const replay = payload as ReplayState;
      setState(replay);
      setSelectedId((current) => current ?? replay.routine.sessions[0]?.id ?? null);
      setPhase('ready');
      return replay;
    }
    return null;
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/routine', { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => response.json().catch(() => null))
      .then((payload) => {
        if (!active) return;
        const replay = payload as (ReplayState & { liveAvailable?: boolean }) | null;
        if (replay && (replay as ReplayState).replay) {
          const current = replay as ReplayState;
          setState(current);
          setSelectedId((selected) => selected ?? current.routine.sessions[0]?.id ?? null);
          setPhase('ready');
        }
      })
      .catch(() => {
        if (!active) return;
        setPhase('idle');
      });
    return () => {
      active = false;
    };
  }, []);

  const begin = async () => {
    setPhase('starting');
    setError(null);
    setReference(null);
    try {
      const response = await fetch('/api/routine', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ replay: 'start' }),
      });
      if (!response.ok) {
        await readError(response, copy.expired);
        return;
      }
      await load();
    } catch {
      setError(copy.failed);
      setPhase('error');
    }
  };

  const compile = async () => {
    setPhase('working');
    try {
      await load();
    } catch {
      setError(copy.failed);
      setPhase('error');
    }
  };

  const act = async (action: string, extra?: Record<string, string>) => {
    if (!state?.proposal && action !== 'replay-missed-tuesday') return;
    setPhase('working');
    setError(null);
    setReference(null);
    try {
      const response = await fetch('/api/routine', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const payload = (await response.json().catch(() => null)) as (ReplayState & { error?: string; reference?: string }) | null;
      if (!response.ok || !payload || !payload.replay) {
        await readError(response, copy.failed);
        return;
      }
      setState(payload);
      setPhase('ready');
    } catch {
      setError(copy.failed);
      setPhase('error');
    }
  };

  const selected = state?.routine.sessions.find((session) => session.id === selectedId) ?? state?.routine.sessions[0] ?? null;
  const selectedTrace = state?.trace.sessions.find((entry) => entry.sessionId === selected?.id || entry.date === selected?.date) ?? null;
  const moved = state?.proposal?.diff.moved?.[0] ?? null;
  const routineInput = (state?.routine.input ?? {}) as {
    time?: string;
    weeklyMinutes?: number;
    sessionMinutes?: number;
    days?: number[];
  };
  const weeklyCap = Number(routineInput.weeklyMinutes ?? 0);
  const weeklyUsed = (state?.routine.sessions ?? [])
    .filter((session) => session.status !== 'missed')
    .reduce((total, session) => total + (Number(session.minutes) || 0), 0);
  const candidateSessions = state?.proposal?.candidate.sessions ?? [];
  const awaiting = state?.proposalStatus === 'awaiting_approval' || state?.proposalStatus === 'computing' || state?.proposalStatus === 'queued';
  const committed = state && state.sandbox.revision >= 2;
  const busy = phase === 'starting' || phase === 'working';

  return (
    <main className="cadencia-shell">
      <style>{`
        .replay-wrap { max-width: 1080px; margin: 0 auto; padding: 20px 16px 64px; }
        .replay-badge { display: inline-block; font-size: 12px; letter-spacing: .04em; border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; background: var(--card); }
        .replay-grid { display: grid; gap: 16px; grid-template-columns: 1fr; }
        @media (min-width: 960px) { .replay-grid { grid-template-columns: 1.1fr .9fr; } }
        .replay-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; box-shadow: var(--shadow); }
        .replay-kicker { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted-foreground); }
        .canon-block { background: #0d3028; color: #f5fbeb; border-radius: 8px; padding: 10px 12px; margin: 6px 0; }
        .canon-block small { color: #cfe3d4; }
        .missed-block { background: var(--secondary); color: var(--muted-foreground); border-radius: 8px; padding: 10px 12px; margin: 6px 0; }
        .candidate-block { background: transparent; color: var(--foreground); border: 2px dotted #0d3028; border-radius: 8px; padding: 10px 12px; margin: 6px 0; }
        .awaiting-box { border: 2px solid #b97f1f; border-radius: 8px; padding: 10px 12px; margin: 8px 0;
          background: repeating-linear-gradient(45deg, rgb(185 127 31 / 12%) 0 8px, transparent 8px 16px); }
        .superseded { color: var(--muted-foreground); }
        .ruler { height: 10px; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; background: var(--secondary); }
        .ruler > span { display: block; height: 100%; background: #0d3028; }
        .move-path { font-size: 13px; }
        .rev-badge { display: inline-block; min-width: 40px; text-align: center; font-weight: 700; border-radius: 999px; padding: 2px 10px; background: #0d3028; color: #f5fbeb; }
        .rev-badge.is-pending { background: transparent; color: var(--muted-foreground); border: 1px dashed var(--muted-foreground); }
        .replay-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .replay-btn { border-radius: 8px; border: 1px solid var(--primary); background: var(--primary); color: var(--primary-foreground); padding: 10px 16px; cursor: pointer; }
        .replay-btn[disabled] { opacity: .55; cursor: wait; }
        .replay-btn.secondary { background: transparent; color: var(--foreground); }
        .replay-list { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 6px; }
        .replay-list button { width: 100%; text-align: left; border: 1px solid var(--border); background: var(--card); border-radius: 8px; padding: 8px 10px; cursor: pointer; }
        .replay-list button[aria-pressed="true"] { outline: 3px solid rgb(110 154 118 / 50%); outline-offset: 2px; }
        .replay-list button[data-size] { border-left-width: 8px; }
        .trace-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .trace-table th, .trace-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
        details.replay-advanced { margin-top: 12px; }
        details.replay-advanced pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: var(--secondary); padding: 12px; border-radius: 8px; max-height: 320px; overflow: auto; }
        .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
        @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } * { transition: none !important; animation: none !important; } }
      `}</style>
      <header className="topbar">
        <Link className="brand" href="/" aria-label={copy.home}>
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span className="brand-word">cadencia</span>
          <span className="brand-note">{copy.replayLink}</span>
        </Link>
        <div className="topbar-meta">
          <fieldset className="language-switcher">
            <legend className="sr-only">{copy.lang}</legend>
            <button type="button" className={`language-option${language === 'en' ? ' is-selected' : ''}`} aria-pressed={language === 'en'} onClick={() => changeLanguage('en')}>EN</button>
            <button type="button" className={`language-option${language === 'es' ? ' is-selected' : ''}`} aria-pressed={language === 'es'} onClick={() => changeLanguage('es')}>ES</button>
          </fieldset>
          <Link className="loop-link" href="/">{copy.back}</Link>
        </div>
      </header>

      <div className="replay-wrap">
        <p><span className="replay-badge">{copy.badge}</span></p>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
        <p><small>{copy.aiProposes} {copy.candidateNotCanonical}</small></p>

        {error ? (
          <div className="error-banner" role="alert">
            <span>{error}{reference ? <span style={{ display: 'block' }}>{copy.reference}: {reference}</span> : null}</span>
            <button type="button" onClick={() => { setError(null); setReference(null); setPhase(state ? 'ready' : 'idle'); }} aria-label={copy.closeError}>×</button>
          </div>
        ) : null}

        {!state ? (
          <section className="replay-card" aria-labelledby="begin-title">
            <h2 id="begin-title">{copy.replayLink}</h2>
            <p>{copy.compileHelp}</p>
            <div className="replay-actions">
              <button className="replay-btn" type="button" onClick={begin} disabled={busy}>
                {busy ? copy.compiling : copy.compile}
              </button>
            </div>
          </section>
        ) : (
          <div className="replay-grid">
            <section className="replay-card" aria-labelledby="canon-title">
              <p className="replay-kicker">{copy.constraints} · {committed ? (
                <><span className="rev-badge is-pending">R1</span> <span className="rev-badge">R{state.sandbox.revision}</span></>
              ) : (
                <><span className="rev-badge">R{state.sandbox.revision}</span> <span className="rev-badge is-pending" aria-label="R2 pending">R2</span></>
              )}</p>
              <h2 id="canon-title">{copy.canonicalTitle}</h2>
              <ul>
                <li>{copy.days}: {Array.isArray(routineInput.days) ? routineInput.days.join(', ') : '—'}</li>
                <li>{copy.durations}: {routineInput.sessionMinutes != null ? `${routineInput.sessionMinutes} min` : '—'}</li>
                <li>{copy.budget}: {weeklyUsed} / {weeklyCap} min</li>
                <li>{copy.fingerprint}: <code>{state.hashes.scheduleHash.slice(0, 16)}…</code></li>
                <li>{copy.modelBoundary}: {copy.modelOff}</li>
              </ul>
              <div className="ruler" aria-hidden="true">
                <span style={{ width: `${weeklyCap > 0 ? Math.min(100, (weeklyUsed / weeklyCap) * 100) : 0}%` }} />
              </div>
              <span className="sr-only">{`${copy.budget}: ${weeklyUsed}/${weeklyCap}`}</span>
              <div className="replay-actions">
                <button className="replay-btn secondary" type="button" onClick={compile} disabled={busy}>{busy ? copy.compiling : copy.reload}</button>
              </div>
              <p><small>{copy.reloadHelp}</small></p>
              <h3>{copy.canonicalTitle}</h3>
              <ul className="replay-list" aria-label={copy.pickSession}>
                {state.routine.sessions.map((session) => (
                  <li key={session.id}>
                    <button
                      type="button"
                      data-size={session.minutes}
                      aria-pressed={selected?.id === session.id}
                      onClick={() => setSelectedId(session.id)}
                      style={{ borderLeftWidth: `${Math.min(16, 4 + session.minutes / 10)}px` }}
                    >
                      <span className={session.status === 'missed' ? 'missed-block' : 'canon-block'} style={{ margin: 0 }}>
                        <strong>{session.date}</strong> · {session.title} · {session.minutes}m
                        <br /><small>{session.id} · {session.status}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {awaiting && state.proposal ? (
                <output className="awaiting-box">
                  <strong>{copy.awaiting}</strong>
                  <h3>{copy.candidateTitle}</h3>
                  {candidateSessions.map((session) => (
                    <div className="candidate-block" key={String(session.id)}>
                      <strong>{String(session.date ?? (session as { startsAt?: string }).startsAt ?? '')}</strong> · {String(session.title)} · {String(session.minutes)}m
                    </div>
                  ))}
                  {moved ? <p className="move-path">{moved.logicalId}: {moved.from.date} ({moved.from.sessionId}) → {moved.to.date} ({moved.to.sessionId})</p> : null}
                  <p><small>{copy.locked}: {(Array.isArray(routineInput.days) ? routineInput.days.join(', ') : '—')}, {routineInput.time ?? '—'}, {routineInput.sessionMinutes ?? '—'} min, {weeklyCap} min cap</small></p>
                  {state.decision?.persisted === 'decision_recorded' ? (
                    <output><small>{copy.decisionPending}</small></output>
                  ) : null}
                  <div className="replay-actions">
                    <button className="replay-btn" type="button" disabled={busy} onClick={() => act('approve', { proposalId: state.proposal?.id ?? '', candidateHash: state.proposal?.candidateHash ?? '' })}>
                      {busy ? copy.working : copy.approve}
                    </button>
                    <button className="replay-btn secondary" type="button" disabled={busy} onClick={() => act('reject')}>{copy.reject}</button>
                  </div>
                  <p><small>{copy.approveHelp}</small></p>
                </output>
              ) : null}

              {awaiting && !state.proposal ? (
                <output>
                  <strong>{copy.working}</strong>
                  <p><small>{copy.candidatePending}</small></p>
                  <div className="replay-actions">
                    <button className="replay-btn secondary" type="button" disabled={busy} onClick={compile}>{copy.refresh}</button>
                  </div>
                </output>
              ) : null}

              {committed ? <output><strong>{copy.committed}</strong></output> : null}
              {state.decision?.workflow === 'local-fallback' ? <p><small>{copy.fallback}</small></p> : null}

              {!awaiting && !committed ? (
                <div className="replay-actions">
                  <button className="replay-btn" type="button" disabled={busy} onClick={() => act('replay-missed-tuesday')}>
                    {busy ? copy.working : copy.missed}
                  </button>
                </div>
              ) : null}
              {!awaiting && !committed ? <p><small>{copy.missedHelp}</small></p> : null}
              {committed ? (
                <div className="replay-actions">
                  <button className="replay-btn secondary" type="button" disabled={busy} onClick={compile}>{copy.refresh}</button>
                </div>
              ) : null}
            </section>

            <section className="replay-card" aria-labelledby="trace-title" aria-live="polite">
              <p className="replay-kicker">{copy.traceTitle}</p>
              <h2 id="trace-title">{selected?.title ?? ''}</h2>
              {!selectedTrace ? <p>{copy.pickSession}</p> : (
                <div>
                  <h3>{copy.normalizedInputs}</h3>
                  <table className="trace-table">
                    <tbody>
                      <tr><th>date</th><td>{selectedTrace.date}</td></tr>
                      <tr><th>time</th><td>{selectedTrace.time}</td></tr>
                      <tr><th>durationMinutes</th><td>{selectedTrace.durationMinutes}</td></tr>
                      <tr><th>activityId</th><td>{selectedTrace.activityId}</td></tr>
                      <tr><th>logicalId</th><td>{selectedTrace.logicalId ?? selectedTrace.activityId}</td></tr>
                      <tr><th>sessionId</th><td>{selectedTrace.sessionId}</td></tr>
                    </tbody>
                  </table>
                  <h3>{copy.rules}</h3>
                  <ul>{selectedTrace.ruleIds.map((rule) => <li key={rule}><code>{rule}</code> — {RULE_DESCRIPTIONS[language][rule] ?? ''}</li>)}</ul>
                  <h3>{copy.capArithmetic}</h3>
                  <p>{selectedTrace.budgetBefore} − {selectedTrace.durationMinutes} = {selectedTrace.budgetAfter} min</p>
                  <h3>{copy.dateDecision}</h3>
                  <p>{selectedTrace.date} · {selectedTrace.time} · {selectedTrace.durationMinutes} min · {selectedTrace.outcome}</p>
                  <h3>{copy.versions}</h3>
                  <p><code>{selectedTrace.plannerVersion}</code> · <code>{selectedTrace.policyVersion}</code></p>
                  <h3>{copy.hashes}</h3>
                  <p><small>input <code>{state.hashes.inputHash.slice(0, 20)}…</code><br />schedule <code>{state.hashes.scheduleHash.slice(0, 20)}…</code>{state.hashes.candidateHash ? <span><br />candidate <code>{state.hashes.candidateHash.slice(0, 20)}…</code></span> : null}</small></p>
                  <h3>{copy.responseMeta}</h3>
                  <p><small>{copy.reference}: <code>{state.meta.responseId ?? '—'}</code><br />server: {typeof state.meta.serverMs === 'number' ? `${state.meta.serverMs} ms` : '—'}</small></p>
                  <h3>{copy.revisionStages}</h3>
                  <ul>{(state.revisionStages ?? []).map((entry, index) => <li key={`${entry.stage}-${entry.revision}-${index}`}><code>{entry.stage}</code> · R{entry.revision}</li>)}</ul>
                  <details className="replay-advanced">
                    <summary>{copy.showAdvanced}</summary>
                    <h4>{copy.redactedJson}</h4>
                    <pre>{JSON.stringify({ session: selectedTrace, hashes: state.hashes, stages: state.trace.stages }, null, 2)}</pre>
                    <h4>{copy.curlLabel}</h4>
                    <pre>{state.curl}</pre>
                  </details>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
