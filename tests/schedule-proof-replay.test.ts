// Phase 5 (correction 1): capability-scoped Reviewer Replay on the exact
// /api/routine path. Decisions record; settlement commits. Strict origin on
// writes; exact approval bindings; stored revision traces; factual hashes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Db, DbStatement } from '../lib/server/db.ts';
import { GET, PATCH, POST, replayMethodNotAllowed } from '../app/api/routine/route.ts';
import { handleGetRoutine } from '../lib/server/routines.ts';
import { fnv1aHex } from '../lib/server/ratelimit.ts';
import { scheduleHashSync } from '../lib/trace.ts';
import { REPLAY_COOKIE, hashCapability, revokeSandbox } from '../lib/server/sandbox.ts';

const NOW_ISO = '2026-09-01T12:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const LATER_ISO = '2026-09-01T12:10:00.000Z';
const ORIGIN = 'http://localhost';

function sqliteDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const wrap = (sql: string): DbStatement => {
    let params: unknown[] = [];
    const api: DbStatement = {
      bind(...values: unknown[]) {
        params = values;
        return api;
      },
      async first<T>() {
        const row = raw.prepare(sql).get(...(params as unknown as [])) as T | undefined;
        return (row ?? null) as T | null;
      },
      async all<T>() {
        const rows = raw.prepare(sql).all(...(params as unknown as [])) as T[];
        return { results: rows };
      },
      async run() {
        const info = raw.prepare(sql).run(...(params as unknown as []));
        return { success: true, meta: { changes: Number(info.changes) } };
      },
    };
    return api;
  };
  return {
    raw,
    prepare: (sql: string) => wrap(sql),
    batch: async (statements: DbStatement[]) => {
      raw.exec('BEGIN');
      try {
        const out: unknown[] = [];
        for (const statement of statements) out.push(await statement.run());
        raw.exec('COMMIT');
        return out;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    exec: async (sql: string) => {
      raw.exec(sql);
      return null;
    },
  };
}

async function migrated(): Promise<Db & { raw: DatabaseSync }> {
  const db = sqliteDb();
  db.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0004_schedule_proof.sql', '0005_schedule_proof_invariants.sql']) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  return db;
}

function postStart(db: Db, ip = '198.51.100.7', url = `${ORIGIN}/api/routine`, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cf-connecting-ip': ip };
  if (origin !== null) headers.origin = origin;
  return POST(
    new Request(url, { method: 'POST', headers, body: JSON.stringify({ replay: 'start' }) }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
}

function rawFromSetCookie(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  const match = header.match(new RegExp(`${REPLAY_COOKIE}=([^;]+)`));
  assert.ok(match, 'Set-Cookie must carry the replay cookie');
  return match[1];
}

function cookieHeader(raw: string): Record<string, string> {
  return { cookie: `${REPLAY_COOKIE}=${raw}` };
}

function patchRequest(raw: string, body: unknown, origin: string | null = ORIGIN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...cookieHeader(raw) };
  if (origin !== null) headers.origin = origin;
  return new Request(`${ORIGIN}/api/routine`, { method: 'PATCH', headers, body: JSON.stringify(body) });
}

async function startSandbox(db: Db, ip = '198.51.100.7') {
  const res = await postStart(db, ip);
  assert.equal(res.status, 201);
  const raw = rawFromSetCookie(res);
  const payload = (await res.json()) as {
    sandbox: { revision: number };
    hashes: { scheduleHash: string };
    trace: { inputHash: string };
  };
  return { raw, payload };
}

void test('schema-gated paths fail explicit 503 on a 0004-only database', async () => {
  const inner = sqliteDb();
  inner.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0004_schedule_proof.sql']) {
    inner.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const started = await postStart(inner);
  assert.equal(started.status, 503);
  assert.equal(((await started.json()) as { error?: string }).error, 'Replay storage is not ready.');
});

void test('replay start issues HttpOnly cookie and R1 fixture without leaking the capability', async () => {
  const db = await migrated();
  const res = await postStart(db);
  assert.equal(res.status, 201);
  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.ok(setCookie.includes('HttpOnly'), 'cookie must be HttpOnly');
  assert.ok(setCookie.includes('SameSite=Lax'), 'cookie must declare SameSite');
  assert.ok(setCookie.includes('Path=/'), 'cookie must scope a path');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const raw = rawFromSetCookie(res);
  const body = JSON.stringify(await res.clone().json());
  assert.ok(!body.includes(raw), 'response body must never carry the raw capability');
  assert.ok(!body.includes(hashCapability(raw)), 'response body must not carry the stored hash either');
  const payload = (await res.json()) as { sandbox: { revision: number }; routine: { sessions: unknown[] }; curl: string };
  assert.equal(payload.sandbox.revision, 1);
  assert.ok(Array.isArray(payload.routine.sessions) && payload.routine.sessions.length === 3);
  assert.ok(payload.curl.includes('<cookie-from-Set-Cookie>'), 'cURL example must use a placeholder');
  assert.ok(!payload.curl.includes(raw), 'cURL example must not embed the capability');
  assert.ok(payload.curl.includes('Origin:'), 'cURL example must show the required Origin header');
});

void test('replay start requires a present same-origin Origin', async () => {
  const db = await migrated();
  const missing = await postStart(db, '198.51.100.7', `${ORIGIN}/api/routine`, null);
  assert.equal(missing.status, 403);
  const forged = await postStart(db, '198.51.100.7', `${ORIGIN}/api/routine`, 'https://evil.example');
  assert.equal(forged.status, 403);
});

void test('cross-sandbox IDs cannot read or decide another sandbox', async () => {
  const db = await migrated();
  const first = await startSandbox(db, '198.51.100.11');
  const second = await startSandbox(db, '198.51.100.12');
  const own = await GET(
    new Request(`${ORIGIN}/api/routine`, { headers: { ...cookieHeader(second.raw) } }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(own.status, 200);
  const replay = await PATCH(
    patchRequest(second.raw, { action: 'replay-missed-tuesday' }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(replay.status, 202);
  const replayPayload = (await replay.json()) as { proposal: { id: string; candidateHash: string } };
  const cross = await PATCH(
    patchRequest(first.raw, { action: 'approve', proposalId: replayPayload.proposal.id, candidateHash: replayPayload.proposal.candidateHash }),
    { db, nowIso: () => LATER_ISO, nowMs: () => Date.parse(LATER_ISO) },
  );
  assert.equal(cross.status, 409);
  const state = (await (await GET(
    new Request(`${ORIGIN}/api/routine`, { headers: { ...cookieHeader(second.raw) } }),
    { db, nowIso: () => LATER_ISO, nowMs: () => Date.parse(LATER_ISO) },
  )).json()) as { proposalStatus: string; sandbox: { revision: number } };
  assert.equal(state.proposalStatus, 'awaiting_approval');
  assert.equal(state.sandbox.revision, 1);
});

void test('approval requires the exact proposalId and candidateHash', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  const headers = { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS };
  const replayed = await PATCH(patchRequest(raw, { action: 'replay-missed-tuesday' }), headers);
  assert.equal(replayed.status, 202);
  const active = (await replayed.json()) as { proposal: { id: string } };
  const missingHash = await PATCH(
    patchRequest(raw, { action: 'approve', proposalId: active.proposal.id }),
    headers,
  );
  assert.equal(missingHash.status, 409);
  const missingId = await PATCH(
    patchRequest(raw, { action: 'approve', candidateHash: 'x'.repeat(64) }),
    headers,
  );
  assert.equal(missingId.status, 404);
  const state = (await (await GET(
    new Request(`${ORIGIN}/api/routine`, { headers: { ...cookieHeader(raw) } }),
    headers,
  )).json()) as { proposalStatus: string; sandbox: { revision: number } };
  assert.equal(state.proposalStatus, 'awaiting_approval');
  assert.equal(state.sandbox.revision, 1);
});

void test('expired and revoked capabilities fail closed with cookie clearing', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  await db.prepare('UPDATE demo_sandboxes SET expires_at = ? WHERE capability_hash = ?')
    .bind('2026-09-01T11:00:00.000Z', hashCapability(raw)).run();
  const expired = await GET(
    new Request(`${ORIGIN}/api/routine`, { headers: { ...cookieHeader(raw) } }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(expired.status, 401);
  assert.ok((expired.headers.get('set-cookie') ?? '').includes('Max-Age=0'), 'expired cookie must be cleared');

  const db2 = await migrated();
  const second = await startSandbox(db2);
  await db2.prepare('UPDATE demo_sandboxes SET revoked = 1 WHERE capability_hash = ?').bind(hashCapability(second.raw)).run();
  const revoked = await PATCH(
    patchRequest(second.raw, { action: 'approve', proposalId: 'x', candidateHash: 'y' }),
    { db: db2, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(revoked.status, 401);
});

void test('revocation terminalizes active proposals and clears workflow references', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  const replayed = await PATCH(
    patchRequest(raw, { action: 'replay-missed-tuesday' }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(replayed.status, 202);
  const hash = hashCapability(raw);
  await revokeSandbox(db, hash, NOW_ISO);
  const proposal = await db.prepare('SELECT status FROM adaptation_proposals WHERE sandbox_hash = ? ORDER BY created_at DESC LIMIT 1')
    .bind(hash).first<{ status: string }>();
  assert.equal(proposal?.status, 'cancelled');
  const sandbox = await db.prepare('SELECT revoked, active_workflow_id AS workflow FROM demo_sandboxes WHERE capability_hash = ?')
    .bind(hash).first<{ revoked: number; workflow: string | null }>();
  assert.equal(sandbox?.revoked, 1);
  assert.equal(sandbox?.workflow, null);
  const audits = await db.prepare("SELECT action FROM adaptation_audit WHERE proposal_id = (SELECT id FROM adaptation_proposals WHERE sandbox_hash = ? ORDER BY created_at DESC LIMIT 1) AND action = 'revoked'")
    .bind(hash).all<{ action: string }>();
  assert.equal(audits.results.length, 1);
  const after = await PATCH(
    patchRequest(raw, { action: 'approve', proposalId: 'x', candidateHash: 'y' }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(after.status, 401);
});

void test('expiry sweep terminalizes proposals and clears workflow references', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  await PATCH(patchRequest(raw, { action: 'replay-missed-tuesday' }), { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS });
  const hash = hashCapability(raw);
  await db.prepare("UPDATE adaptation_proposals SET expires_at = ? WHERE sandbox_hash = ? AND status = 'awaiting_approval'")
    .bind('2026-09-01T11:00:00.000Z', hash).run();
  const swept = await GET(
    new Request(`${ORIGIN}/api/routine`, { headers: { ...cookieHeader(raw) } }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(swept.status, 200);
  const proposal = await db.prepare('SELECT status FROM adaptation_proposals WHERE sandbox_hash = ? ORDER BY created_at DESC LIMIT 1')
    .bind(hash).first<{ status: string }>();
  assert.equal(proposal?.status, 'expired');
  const sandbox = await db.prepare('SELECT active_workflow_id AS workflow FROM demo_sandboxes WHERE capability_hash = ?')
    .bind(hash).first<{ workflow: string | null }>();
  assert.equal(sandbox?.workflow, null);
});

void test('missing cookie falls back to availability; PATCH requires the cookie', async () => {
  const db = await migrated();
  const fallback = await GET(new Request(`${ORIGIN}/api/routine`), { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS });
  assert.deepEqual(await fallback.json(), { liveAvailable: false });
  const missing = await PATCH(
    new Request(`${ORIGIN}/api/routine`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ action: 'approve', proposalId: 'x', candidateHash: 'y' }),
    }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(missing.status, 401);
});

void test('CSRF origin checks reject cross-origin and originless replay writes', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  const forged = await PATCH(
    patchRequest(raw, { action: 'replay-missed-tuesday' }, 'https://evil.example'),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(forged.status, 403);
  const originless = await PATCH(
    patchRequest(raw, { action: 'replay-missed-tuesday' }, null),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(originless.status, 403);
});

void test('chunked oversized bodies fail closed without partial state', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`{"action":"replay-missed-tuesday","pad":"${'p'.repeat(40_000)}"}`));
      controller.close();
    },
  });
  const res = await PATCH(
    new Request(`${ORIGIN}/api/routine`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...cookieHeader(raw) },
      body: stream,
      duplex: 'half',
    } as RequestInit),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(res.status, 400);
  const state = (await (await GET(
    new Request(`${ORIGIN}/api/routine`, { headers: { ...cookieHeader(raw) } }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  )).json()) as { proposalStatus: string | null; sandbox: { revision: number } };
  assert.equal(state.proposalStatus, null);
  assert.equal(state.sandbox.revision, 1);
});

void test('trailing slash and normalized paths resolve the same sandbox', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  for (const url of [`${ORIGIN}/api/routine/`, `${ORIGIN}/api/routine?readiness=abc`, `${ORIGIN}/api/%72outine`]) {
    const res = await GET(new Request(url, { headers: { ...cookieHeader(raw) } }), {
      db,
      nowIso: () => NOW_ISO,
      nowMs: () => NOW_MS,
    });
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
  }
});

void test('unsupported methods are 405 and override headers are ignored', async () => {
  const notAllowed = replayMethodNotAllowed();
  assert.equal(notAllowed.status, 405);
  const db = await migrated();
  const res = await POST(
    new Request(`${ORIGIN}/api/routine`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        'cf-connecting-ip': '198.51.100.7',
        'x-http-method-override': 'PATCH',
      },
      body: JSON.stringify({ replay: 'start' }),
    }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(res.status, 201);
});

void test('method-override headers never change PATCH handling', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  const headers = {
    'content-type': 'application/json',
    origin: ORIGIN,
    'x-http-method-override': 'DELETE',
    ...cookieHeader(raw),
  };
  const replayed = await PATCH(
    new Request(`${ORIGIN}/api/routine`, { method: 'PATCH', headers, body: JSON.stringify({ action: 'replay-missed-tuesday' }) }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(replayed.status, 202);
});

void test('alternate hosts keep capability scope; owner APIs still demand JWT', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  const altHost = await GET(new Request('https://cadencia.example/api/routine', { headers: { ...cookieHeader(raw) } }), {
    db,
    nowIso: () => NOW_ISO,
    nowMs: () => NOW_MS,
  });
  assert.equal(altHost.status, 200);
  const owner = await handleGetRoutine(
    new Request('https://cadencia.example/api/routines/routine-1', {
      headers: { ...cookieHeader(raw) },
    }),
    'routine-1',
    { db, env: {}, nowIso: () => NOW_ISO, newId: (() => { let n = 0; return () => `id-${(n += 1)}`; })() },
  );
  assert.equal(owner.status, 401);
});

void test('full replay journey: R1 unchanged, candidate overlaid, R2 persists on refresh', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  const headers = { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS };

  const before = (await (await GET(new Request(`${ORIGIN}/api/routine`, { headers: { ...cookieHeader(raw) } }), headers)).json()) as {
    sandbox: { revision: number };
    routine: { sessions: Array<{ date: string }> };
    proposal: null;
    trace: { sessions: Array<{ sessionId: string; logicalId: string }> };
  };
  assert.equal(before.sandbox.revision, 1);
  assert.deepEqual(before.routine.sessions.map((s) => s.date), ['2026-08-31', '2026-09-01', '2026-09-02']);
  assert.deepEqual(before.trace.sessions.map((s) => s.logicalId), ['intent-step-1', 'intent-step-2', 'intent-step-3']);

  const replayed = await PATCH(
    patchRequest(raw, { action: 'replay-missed-tuesday' }),
    headers,
  );
  assert.equal(replayed.status, 202);
  const candidate = (await replayed.json()) as {
    sandbox: { revision: number };
    routine: { sessions: Array<{ date: string }> };
    proposal: {
      id: string;
      candidateHash: string;
      diff: { moved: Array<{ logicalId: string; from: { sessionId: string; date: string }; to: { sessionId: string; date: string } }> };
    };
  };
  // Canonical schedule unchanged while the candidate is overlaid.
  assert.equal(candidate.sandbox.revision, 1);
  assert.deepEqual(candidate.routine.sessions.map((s) => s.date), ['2026-08-31', '2026-09-01', '2026-09-02']);
  assert.equal(candidate.proposal.diff.moved.length, 1);
  assert.equal(candidate.proposal.diff.moved[0]?.logicalId, 'intent-step-2');
  assert.equal(candidate.proposal.diff.moved[0]?.from.sessionId, 'session-2026-09-01');
  assert.equal(candidate.proposal.diff.moved[0]?.to.date, '2026-09-03');
  assert.ok((candidate.proposal.diff.moved[0]?.to.date ?? '') > '2026-09-01', 'replacement must never land in the past');

  const approved = await PATCH(
    patchRequest(raw, { action: 'approve', proposalId: candidate.proposal.id, candidateHash: candidate.proposal.candidateHash }),
    { db, nowIso: () => LATER_ISO, nowMs: () => Date.parse(LATER_ISO) },
  );
  assert.equal(approved.status, 200);

  const after = (await (await GET(
    new Request(`${ORIGIN}/api/routine`, { headers: { ...cookieHeader(raw) } }),
    { db, nowIso: () => LATER_ISO, nowMs: () => Date.parse(LATER_ISO) },
  )).json()) as {
    sandbox: { revision: number };
    routine: { sessions: Array<{ date: string; status: string; minutes: number; logicalId: string }> };
    proposalStatus: string;
    hashes: { scheduleHash: string; candidateHash: string };
    trace: { sessions: Array<{ sessionId: string; logicalId: string }> };
  };
  assert.equal(after.sandbox.revision, 2);
  assert.ok(after.routine.sessions.some((s) => s.date === '2026-09-03'), 'R2 proves the move persisted');
  assert.equal(after.proposalStatus, 'committed');
  // R2 serves the stored R2 trace with stable logical identity...
  const traceById = new Map(after.trace.sessions.map((s) => [s.sessionId, s.logicalId]));
  assert.equal(traceById.get('session-2026-09-01'), 'intent-step-2');
  // ...and the canonical hash is content-derived, separate from the candidate hash.
  const routine = after.routine as unknown as {
    input: import('../lib/routine.ts').RoutineInput;
    sessions: import('../lib/routine.ts').Session[];
  };
  assert.equal(after.hashes.scheduleHash, scheduleHashSync({ input: routine.input, sessions: routine.sessions }, 'UTC'));
  assert.notEqual(after.hashes.scheduleHash, after.hashes.candidateHash);
  // Weekly usage computed from actual non-missed minutes: 90/90.
  const used = after.routine.sessions.filter((s) => s.status !== 'missed').reduce((t, s) => t + s.minutes, 0);
  assert.equal(used, 90);
});

void test('revision lifecycle stages and server telemetry come from backend state', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  const deps = { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS };
  const first = (await (await GET(new Request(`${ORIGIN}/api/routine`, { headers: { ...cookieHeader(raw) } }), deps)).json()) as {
    revisionStages: Array<{ stage: string; revision: number }>;
    meta: { responseId: string; serverMs: number };
  };
  assert.deepEqual(first.revisionStages, [{ stage: 'revision_persisted', revision: 1 }]);
  assert.equal(typeof first.meta.responseId, 'string');
  assert.equal(typeof first.meta.serverMs, 'number');

  const replayed = await PATCH(
    patchRequest(raw, { action: 'replay-missed-tuesday' }),
    deps,
  );
  const candidate = (await replayed.json()) as { proposal: { id: string; candidateHash: string } };
  await PATCH(
    patchRequest(raw, { action: 'approve', proposalId: candidate.proposal.id, candidateHash: candidate.proposal.candidateHash }),
    { db, nowIso: () => LATER_ISO, nowMs: () => Date.parse(LATER_ISO) },
  );
  const after = (await (await GET(
    new Request(`${ORIGIN}/api/routine`, { headers: { ...cookieHeader(raw) } }),
    { db, nowIso: () => LATER_ISO, nowMs: () => Date.parse(LATER_ISO) },
  )).json()) as { revisionStages: Array<{ stage: string; revision: number }> };
  assert.deepEqual(after.revisionStages, [
    { stage: 'revision_persisted', revision: 1 },
    { stage: 'revision_persisting', revision: 2 },
    { stage: 'revision_persisted', revision: 2 },
  ]);
});

void test('duplicate approval after commit is harmless with stable readback', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  const replayed = await PATCH(
    patchRequest(raw, { action: 'replay-missed-tuesday' }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  const candidate = (await replayed.json()) as { proposal: { id: string; candidateHash: string } };
  const body = { action: 'approve', proposalId: candidate.proposal.id, candidateHash: candidate.proposal.candidateHash };
  const later = { db, nowIso: () => LATER_ISO, nowMs: () => Date.parse(LATER_ISO) };
  assert.equal((await PATCH(patchRequest(raw, body), later)).status, 200);
  const retry = await PATCH(patchRequest(raw, body), later);
  assert.equal(retry.status, 409);
  const state = (await (await GET(new Request(`${ORIGIN}/api/routine`, { headers: { ...cookieHeader(raw) } }), later)).json()) as {
    sandbox: { revision: number };
    proposalStatus: string;
    routine: { sessions: Array<{ date: string }> };
  };
  assert.equal(state.sandbox.revision, 2);
  assert.equal(state.proposalStatus, 'committed');
  assert.ok(state.routine.sessions.some((s) => s.date === '2026-09-03'));
});

void test('concurrent approval commits once and stays idempotent', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  const replayed = await PATCH(
    patchRequest(raw, { action: 'replay-missed-tuesday' }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  const candidate = (await replayed.json()) as { proposal: { id: string; candidateHash: string } };
  const approveBody = JSON.stringify({ action: 'approve', proposalId: candidate.proposal.id, candidateHash: candidate.proposal.candidateHash });
  const later = { db, nowIso: () => LATER_ISO, nowMs: () => Date.parse(LATER_ISO) };
  const headers = { 'content-type': 'application/json', origin: ORIGIN, ...cookieHeader(raw) };
  const [first, second] = await Promise.all([
    PATCH(new Request(`${ORIGIN}/api/routine`, { method: 'PATCH', headers, body: approveBody }), later),
    PATCH(new Request(`${ORIGIN}/api/routine`, { method: 'PATCH', headers, body: approveBody }), later),
  ]);
  assert.ok([200, 202, 409].includes(first.status) && [200, 202, 409].includes(second.status));
  const state = (await (await GET(new Request(`${ORIGIN}/api/routine`, { headers: { ...cookieHeader(raw) } }), later)).json()) as {
    sandbox: { revision: number };
  };
  assert.equal(state.sandbox.revision, 2);
});

void test('workflow budget is consumed per replay and enforced at the cap', async () => {
  const db = await migrated();
  const first = await startSandbox(db, '198.51.100.21');
  const replayed = await PATCH(
    patchRequest(first.raw, { action: 'replay-missed-tuesday' }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(replayed.status, 202);
  const used = await db.prepare('SELECT count FROM public_daily_usage WHERE scope = ? AND day = ?')
    .bind('reviewer_workflow', NOW_ISO.slice(0, 10)).first<{ count: number }>();
  assert.equal(used?.count, 1);

  await db.prepare("INSERT INTO public_daily_usage (scope, day, count) VALUES (?, ?, ?) ON CONFLICT (scope, day) DO UPDATE SET count = ?")
    .bind('reviewer_workflow', NOW_ISO.slice(0, 10), 100, 100).run();
  const second = await startSandbox(db, '198.51.100.22');
  const refused = await PATCH(
    patchRequest(second.raw, { action: 'replay-missed-tuesday' }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.equal(refused.status, 429);
});

void test('global sandbox issuance and quotas fail closed', async () => {
  const db2 = await migrated();
  const ipHash = fnv1aHex('replay:198.51.100.77');
  await db2.prepare("INSERT INTO public_daily_usage (scope, day, count) VALUES (?, ?, ?) ON CONFLICT (scope, day) DO UPDATE SET count = ?")
    .bind(`reviewer_sandbox_ip:${ipHash}`, NOW_ISO.slice(0, 10), 10, 10).run();
  const limited = await postStart(db2, '198.51.100.77');
  assert.equal(limited.status, 429);

  const db3 = await migrated();
  const third = await startSandbox(db3);
  const badHeaders = { 'content-type': 'application/json', origin: ORIGIN, ...cookieHeader(third.raw) };
  let lastStatus = 0;
  for (let index = 0; index < 13; index += 1) {
    const res = await PATCH(
      new Request(`${ORIGIN}/api/routine`, { method: 'PATCH', headers: badHeaders, body: JSON.stringify({ action: 'nope' }) }),
      { db: db3, nowIso: () => NOW_ISO, nowMs: () => NOW_MS + index * 1000 },
    );
    lastStatus = res.status;
  }
  assert.equal(lastStatus, 429);
});

void test('replay errors and rate limits stay redacted and uncached', async () => {
  const db = await migrated();
  const { raw } = await startSandbox(db);
  const bad = await PATCH(
    patchRequest(raw, { action: 'approve', proposalId: 'proposal-ghost', candidateHash: 'x' }),
    { db, nowIso: () => NOW_ISO, nowMs: () => NOW_MS },
  );
  assert.ok([404, 409].includes(bad.status));
  assert.equal(bad.headers.get('cache-control'), 'private, no-store');
  const body = JSON.stringify(await bad.clone().json());
  assert.ok(!body.includes(raw), 'errors must not echo the capability');
});
