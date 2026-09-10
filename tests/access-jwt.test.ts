// Phase 1: Access JWT verification and private/public boundary tests.
// All provider/JWKS interactions are in-memory; no network calls are made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hashEmailHex, resetAccessKeyCache, resolveIdentity } from '../lib/server/identity.ts';
import type { Db, DbStatement } from '../lib/server/db.ts';
import { createRoutineWithVersion, ensureUser } from '../lib/server/db.ts';
import { handleCreateRoutine, handleGetRoutine } from '../lib/server/routines.ts';

const TEAM = 'https://team.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const NOW_SEC = 1_787_000_000;
const NOW_ISO = '2026-09-04T00:00:00.000Z';
const ACCESS_ENV = { CADENCIA_ACCESS_TEAM_DOMAIN: TEAM, CADENCIA_ACCESS_AUD: AUD };

async function rsaPair() {
  return crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
}

async function signJwt(
  key: CryptoKey,
  kid: string,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid, ...header })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${Buffer.from(signature).toString('base64url')}`;
}

function payloadFor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: TEAM,
    aud: AUD,
    sub: 'user-a',
    email: 'a@example.com',
    exp: NOW_SEC + 300,
    iat: NOW_SEC,
    ...overrides,
  };
}

function jwksResponder(keys: unknown[], calls: { n: number }) {
  return async () => {
    calls.n += 1;
    return new Response(JSON.stringify({ keys }), {
      headers: { 'content-type': 'application/json' },
    });
  };
}

function bearerRequest(token: string | null, extra: Record<string, string> = {}): Request {
  const headers: Record<string, string> = { ...extra };
  if (token !== null) headers['cf-access-jwt-assertion'] = token;
  return new Request('http://localhost/api/routines', { headers });
}

void test('valid JWT derives identity only from verified claims', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const calls = { n: 0 };
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor());
  const result = await resolveIdentity(bearerRequest(token), ACCESS_ENV, {
    fetchJwks: jwksResponder([publicJwk], calls),
    nowSec: () => NOW_SEC,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.user.accessSubject, 'access:user-a');
  assert.equal(result.ok && result.user.emailHash, await hashEmailHex('a@example.com'));
  assert.equal(calls.n, 1);
});

void test('missing JWT fails closed without fetching keys', async () => {
  resetAccessKeyCache();
  const calls = { n: 0 };
  const result = await resolveIdentity(bearerRequest(null), ACCESS_ENV, {
    fetchJwks: jwksResponder([], calls),
    nowSec: () => NOW_SEC,
  });
  assert.deepEqual(result, { ok: false, reason: 'missing_credentials' });
  assert.equal(calls.n, 0);
});

void test('invalid signature is rejected', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const other = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const token = await signJwt(other.privateKey, 'key-1', payloadFor());
  const result = await resolveIdentity(bearerRequest(token), ACCESS_ENV, {
    fetchJwks: jwksResponder([publicJwk], { n: 0 }),
    nowSec: () => NOW_SEC,
  });
  assert.deepEqual(result, { ok: false, reason: 'needs_verification' });
});

void test('expired JWT is rejected', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor({ exp: NOW_SEC - 120 }));
  const result = await resolveIdentity(bearerRequest(token), ACCESS_ENV, {
    fetchJwks: jwksResponder([publicJwk], { n: 0 }),
    nowSec: () => NOW_SEC,
  });
  assert.deepEqual(result, { ok: false, reason: 'needs_verification' });
});

void test('wrong issuer is rejected', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor({ iss: 'https://evil.example' }));
  const result = await resolveIdentity(bearerRequest(token), ACCESS_ENV, {
    fetchJwks: jwksResponder([publicJwk], { n: 0 }),
    nowSec: () => NOW_SEC,
  });
  assert.deepEqual(result, { ok: false, reason: 'needs_verification' });
});

void test('wrong audience is rejected', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor({ aud: 'other-app' }));
  const result = await resolveIdentity(bearerRequest(token), ACCESS_ENV, {
    fetchJwks: jwksResponder([publicJwk], { n: 0 }),
    nowSec: () => NOW_SEC,
  });
  assert.deepEqual(result, { ok: false, reason: 'needs_verification' });
});

void test('non-RS256 algorithm is rejected', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor(), { alg: 'none' });
  const result = await resolveIdentity(bearerRequest(token), ACCESS_ENV, {
    fetchJwks: jwksResponder([publicJwk], { n: 0 }),
    nowSec: () => NOW_SEC,
  });
  assert.deepEqual(result, { ok: false, reason: 'needs_verification' });
});

void test('true old-to-new rotation resolves after one refresh', async () => {
  resetAccessKeyCache();
  const oldPair = await rsaPair();
  const newPair = await rsaPair();
  const oldJwk = { ...(await crypto.subtle.exportKey('jwk', oldPair.publicKey)), kid: 'key-old' };
  const newJwk = { ...(await crypto.subtle.exportKey('jwk', newPair.publicKey)), kid: 'key-new' };
  const calls = { n: 0 };
  let rotated = false;
  const fetchJwks = async () => {
    calls.n += 1;
    const keys = rotated ? [newJwk] : [oldJwk];
    return new Response(JSON.stringify({ keys }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const deps = { fetchJwks, nowSec: () => NOW_SEC };
  const oldToken = await signJwt(oldPair.privateKey, 'key-old', payloadFor());
  assert.equal((await resolveIdentity(bearerRequest(oldToken), ACCESS_ENV, deps)).ok, true);
  assert.equal(calls.n, 1);

  rotated = true;
  // Rotation is picked up only after the documented refresh cooldown.
  const afterCooldown = { fetchJwks, nowSec: () => NOW_SEC + 31 };
  const newToken = await signJwt(newPair.privateKey, 'key-new', payloadFor());
  const rotatedResult = await resolveIdentity(bearerRequest(newToken), ACCESS_ENV, afterCooldown);
  assert.equal(rotatedResult.ok, true);
  assert.equal(calls.n, 2);
});

void test('sequential distinct unknown kids after warm cache add no fetch', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const calls = { n: 0 };
  const deps = { fetchJwks: jwksResponder([publicJwk], calls), nowSec: () => NOW_SEC };
  const warm = await signJwt(pair.privateKey, 'key-1', payloadFor());
  assert.equal((await resolveIdentity(bearerRequest(warm), ACCESS_ENV, deps)).ok, true);
  assert.equal(calls.n, 1);
  for (const kid of ['ghost-1', 'ghost-2', 'ghost-3']) {
    const token = await signJwt(pair.privateKey, kid, payloadFor());
    assert.deepEqual(await resolveIdentity(bearerRequest(token), ACCESS_ENV, deps), {
      ok: false,
      reason: 'needs_verification',
    });
  }
  // Warm-up fetch claimed the per-issuer refresh slot; ghosts fetch nothing.
  assert.equal(calls.n, 1);
});

void test('alternating unknown kids do not each trigger a fetch', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const calls = { n: 0 };
  const deps = { fetchJwks: jwksResponder([], calls), nowSec: () => NOW_SEC };
  for (const kid of ['ghost-a', 'ghost-b', 'ghost-a', 'ghost-b']) {
    const token = await signJwt(pair.privateKey, kid, payloadFor());
    assert.deepEqual(await resolveIdentity(bearerRequest(token), ACCESS_ENV, deps), {
      ok: false,
      reason: 'needs_verification',
    });
  }
  assert.equal(calls.n, 1);
});

void test('sequential failed cold fetches attempt once inside cooldown', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const calls = { n: 0 };
  const failing = async (): Promise<Response> => {
    calls.n += 1;
    throw new Error('network down');
  };
  const deps = { fetchJwks: failing, nowSec: () => NOW_SEC };
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor());
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(await resolveIdentity(bearerRequest(token), ACCESS_ENV, deps), {
      ok: false,
      reason: 'needs_verification',
    });
  }
  assert.equal(calls.n, 1);
});

void test('concurrent distinct unknown kids share a single fetch', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const calls = { n: 0 };
  const deps = { fetchJwks: jwksResponder([], calls), nowSec: () => NOW_SEC };
  const tokenA = await signJwt(pair.privateKey, 'ghost-a', payloadFor());
  const tokenB = await signJwt(pair.privateKey, 'ghost-b', payloadFor());
  const [first, second] = await Promise.all([
    resolveIdentity(bearerRequest(tokenA), ACCESS_ENV, deps),
    resolveIdentity(bearerRequest(tokenB), ACCESS_ENV, deps),
  ]);
  assert.deepEqual(first, { ok: false, reason: 'needs_verification' });
  assert.deepEqual(second, { ok: false, reason: 'needs_verification' });
  assert.equal(calls.n, 1);
});

void test('concurrent valid requests both authenticate on one shared fetch', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const calls = { n: 0 };
  const control: { release: (() => void) | null } = { release: null };
  const started = new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (calls.n > 0) {
        clearInterval(timer);
        resolve();
      }
    }, 5);
  });
  const fetchJwks = async () => {
    calls.n += 1;
    await new Promise<void>((resolve) => {
      control.release = resolve;
    });
    return new Response(JSON.stringify({ keys: [publicJwk] }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const deps = { fetchJwks, nowSec: () => NOW_SEC };
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor());
  const first = resolveIdentity(bearerRequest(token), ACCESS_ENV, deps);
  await started;
  const second = resolveIdentity(bearerRequest(token), ACCESS_ENV, deps);
  control.release?.();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.equal(calls.n, 1);
});

void test('concurrent requests fail closed when the shared fetch fails', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const calls = { n: 0 };
  const control: { release: (() => void) | null } = { release: null };
  const started = new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (calls.n > 0) {
        clearInterval(timer);
        resolve();
      }
    }, 5);
  });
  const fetchJwks = async (): Promise<Response> => {
    calls.n += 1;
    await new Promise<void>((resolve) => {
      control.release = resolve;
    });
    throw new Error('network down');
  };
  const deps = { fetchJwks, nowSec: () => NOW_SEC };
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor());
  const first = resolveIdentity(bearerRequest(token), ACCESS_ENV, deps);
  await started;
  const second = resolveIdentity(bearerRequest(token), ACCESS_ENV, deps);
  control.release?.();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult, { ok: false, reason: 'needs_verification' });
  assert.deepEqual(secondResult, { ok: false, reason: 'needs_verification' });
  assert.equal(calls.n, 1);
});

void test('warm cache is reused across requests', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const calls = { n: 0 };
  const deps = { fetchJwks: jwksResponder([publicJwk], calls), nowSec: () => NOW_SEC };
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor());
  assert.equal((await resolveIdentity(bearerRequest(token), ACCESS_ENV, deps)).ok, true);
  assert.equal((await resolveIdentity(bearerRequest(token), ACCESS_ENV, deps)).ok, true);
  assert.equal(calls.n, 1);
});

void test('repeated unknown kid fetches once inside cooldown', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const calls = { n: 0 };
  const deps = { fetchJwks: jwksResponder([], calls), nowSec: () => NOW_SEC };
  const token = await signJwt(pair.privateKey, 'ghost-kid', payloadFor());
  assert.deepEqual(await resolveIdentity(bearerRequest(token), ACCESS_ENV, deps), {
    ok: false,
    reason: 'needs_verification',
  });
  assert.deepEqual(await resolveIdentity(bearerRequest(token), ACCESS_ENV, deps), {
    ok: false,
    reason: 'needs_verification',
  });
  assert.equal(calls.n, 1);
});

void test('concurrent unknown kids share a single fetch', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const calls = { n: 0 };
  const deps = { fetchJwks: jwksResponder([], calls), nowSec: () => NOW_SEC };
  const token = await signJwt(pair.privateKey, 'ghost-kid', payloadFor());
  const [first, second] = await Promise.all([
    resolveIdentity(bearerRequest(token), ACCESS_ENV, deps),
    resolveIdentity(bearerRequest(token), ACCESS_ENV, deps),
  ]);
  assert.deepEqual(first, { ok: false, reason: 'needs_verification' });
  assert.deepEqual(second, { ok: false, reason: 'needs_verification' });
  assert.equal(calls.n, 1);
});

void test('JWKS fetch failure fails closed', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor());
  const failing = async (): Promise<Response> => {
    throw new Error('network down');
  };
  assert.deepEqual(
    await resolveIdentity(bearerRequest(token), ACCESS_ENV, { fetchJwks: failing, nowSec: () => NOW_SEC }),
    { ok: false, reason: 'needs_verification' },
  );
});

void test('malformed JWKS body fails closed', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor());
  const malformed = async () => new Response('not json{{{', { status: 200 });
  assert.deepEqual(
    await resolveIdentity(bearerRequest(token), ACCESS_ENV, { fetchJwks: malformed, nowSec: () => NOW_SEC }),
    { ok: false, reason: 'needs_verification' },
  );
});

void test('oversized JWKS body fails closed without full allocation', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor());
  const oversized = async () =>
    new Response(`{"keys":[${JSON.stringify({ kid: 'x' }).repeat(1)},"${'p'.repeat(100_000)}]}`, { status: 200 });
  assert.deepEqual(
    await resolveIdentity(bearerRequest(token), ACCESS_ENV, { fetchJwks: oversized, nowSec: () => NOW_SEC }),
    { ok: false, reason: 'needs_verification' },
  );
});

void test('JWKS redirect is rejected', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor());
  const redirect = async () => new Response(null, { status: 301, headers: { location: 'https://evil.example/keys' } });
  assert.deepEqual(
    await resolveIdentity(bearerRequest(token), ACCESS_ENV, { fetchJwks: redirect, nowSec: () => NOW_SEC }),
    { ok: false, reason: 'needs_verification' },
  );
});

void test('missing sub claim is rejected', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const { sub: _dropped, ...withoutSub } = payloadFor();
  void _dropped;
  const token = await signJwt(pair.privateKey, 'key-1', withoutSub);
  assert.deepEqual(
    await resolveIdentity(bearerRequest(token), ACCESS_ENV, {
      fetchJwks: jwksResponder([publicJwk], { n: 0 }),
      nowSec: () => NOW_SEC,
    }),
    { ok: false, reason: 'needs_verification' },
  );
});

void test('missing email claim is rejected', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const { email: _dropped, ...withoutEmail } = payloadFor();
  void _dropped;
  const token = await signJwt(pair.privateKey, 'key-1', withoutEmail);
  assert.deepEqual(
    await resolveIdentity(bearerRequest(token), ACCESS_ENV, {
      fetchJwks: jwksResponder([publicJwk], { n: 0 }),
      nowSec: () => NOW_SEC,
    }),
    { ok: false, reason: 'needs_verification' },
  );
});

void test('non-numeric exp is rejected', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor({ exp: 'tomorrow' }));
  assert.deepEqual(
    await resolveIdentity(bearerRequest(token), ACCESS_ENV, {
      fetchJwks: jwksResponder([publicJwk], { n: 0 }),
      nowSec: () => NOW_SEC,
    }),
    { ok: false, reason: 'needs_verification' },
  );
});

void test('future nbf beyond skew is rejected', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor({ nbf: NOW_SEC + 600 }));
  assert.deepEqual(
    await resolveIdentity(bearerRequest(token), ACCESS_ENV, {
      fetchJwks: jwksResponder([publicJwk], { n: 0 }),
      nowSec: () => NOW_SEC,
    }),
    { ok: false, reason: 'needs_verification' },
  );
});

void test('test headers on a production host cannot forge identity even with the flag', async () => {
  resetAccessKeyCache();
  const env = { ...ACCESS_ENV, CADENCIA_ALLOW_TEST_IDENTITY: 'true' };
  const forged = new Request('https://cadencia.example/api/routines', {
    headers: { 'x-test-user-sub': 'mallory', 'x-test-user-email': 'mallory@example.com' },
  });
  assert.deepEqual(await resolveIdentity(forged, env), {
    ok: false,
    reason: 'test_identity_disabled',
  });
});

void test('forged authenticated-user email header cannot alter verified identity', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const deps = { fetchJwks: jwksResponder([publicJwk], { n: 0 }), nowSec: () => NOW_SEC };
  const emailOnly = new Request('http://localhost/api/routines', {
    headers: { 'cf-access-authenticated-user-email': 'mallory@example.com' },
  });
  assert.deepEqual(await resolveIdentity(emailOnly, ACCESS_ENV, deps), {
    ok: false,
    reason: 'missing_credentials',
  });

  const token = await signJwt(pair.privateKey, 'key-1', payloadFor());
  const withForgedEmail = new Request('http://localhost/api/routines', {
    headers: {
      'cf-access-jwt-assertion': token,
      'cf-access-authenticated-user-email': 'mallory@example.com',
    },
  });
  const result = await resolveIdentity(withForgedEmail, ACCESS_ENV, deps);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.user.accessSubject, 'access:user-a');
  assert.equal(result.ok && result.user.emailHash, await hashEmailHex('a@example.com'));
});

void test('forged test identity headers fail without the explicit flag', async () => {
  resetAccessKeyCache();
  const request = new Request('http://localhost/api/routines', {
    headers: { 'x-test-user-sub': 'mallory', 'x-test-user-email': 'mallory@example.com' },
  });
  assert.deepEqual(await resolveIdentity(request, ACCESS_ENV), {
    ok: false,
    reason: 'test_identity_disabled',
  });
  assert.deepEqual(await resolveIdentity(request, undefined), {
    ok: false,
    reason: 'test_identity_disabled',
  });
});

void test('missing Access configuration fails closed', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor());
  const calls = { n: 0 };
  assert.deepEqual(
    await resolveIdentity(bearerRequest(token), {}, {
      fetchJwks: jwksResponder([], calls),
      nowSec: () => NOW_SEC,
    }),
    { ok: false, reason: 'needs_verification' },
  );
  assert.equal(calls.n, 0);
});

void test('audience list containing the AUD tag is accepted', async () => {
  resetAccessKeyCache();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const token = await signJwt(pair.privateKey, 'key-1', payloadFor({ aud: ['other', AUD] }));
  const result = await resolveIdentity(bearerRequest(token), ACCESS_ENV, {
    fetchJwks: jwksResponder([publicJwk], { n: 0 }),
    nowSec: () => NOW_SEC,
  });
  assert.equal(result.ok, true);
});

// Handler-level boundary: JWT-authenticated ownership and origin checks.

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
        raw.prepare(sql).run(...(params as unknown as []));
        return { success: true };
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

function counterIds(prefix = 'jwt-id') {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

const demoBody = {
  input: {
    request: 'aprender TypeScript',
    days: [0, 2],
    sessionMinutes: 30,
    weeklyMinutes: 90,
    startDate: '2026-08-31',
    time: '18:00',
    language: 'es',
  },
  mode: 'demo',
};

void test('JWT user cannot read another owner routine; owner can', async () => {
  resetAccessKeyCache();
  const db = await migrated();
  const pair = await rsaPair();
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ keys: [publicJwk] }), {
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  try {
    await ensureUser(db, {
      id: 'user-a',
      accessSubject: 'access:sub-a',
      emailHash: await hashEmailHex('a@example.com'),
      nowIso: NOW_ISO,
    });
    const liveExp = Math.floor(Date.now() / 1000) + 3600;
    const tokenA = await signJwt(
      pair.privateKey,
      'key-1',
      payloadFor({ sub: 'sub-a', email: 'a@example.com', exp: liveExp, iat: liveExp - 3600 }),
    );
    const tokenB = await signJwt(
      pair.privateKey,
      'key-1',
      payloadFor({ sub: 'sub-b', email: 'b@example.com', exp: liveExp, iat: liveExp - 3600 }),
    );
    const deps = { db, env: ACCESS_ENV, nowIso: () => NOW_ISO, newId: counterIds() };
    const created = await handleCreateRoutine(
      new Request('http://localhost/api/routines', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-access-jwt-assertion': tokenA,
          'idempotency-key': 'jwt-create-1',
        },
        body: JSON.stringify(demoBody),
      }),
      deps,
    );
    assert.equal(created.status, 201);
    const createdPayload = (await created.json()) as { routine: { id: string } };
    const routineId = createdPayload.routine.id;

    const foreign = await handleGetRoutine(
      new Request(`http://localhost/api/routines/${routineId}`, {
        headers: { 'cf-access-jwt-assertion': tokenB },
      }),
      routineId,
      { ...deps, newId: counterIds('f') },
    );
    assert.equal(foreign.status, 404);

    const own = await handleGetRoutine(
      new Request(`http://localhost/api/routines/${routineId}`, {
        headers: { 'cf-access-jwt-assertion': tokenA },
      }),
      routineId,
      { ...deps, newId: counterIds('o') },
    );
    assert.equal(own.status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
});

void test('alternate origin is rejected before authentication', async () => {
  const db = await migrated();
  const response = await handleCreateRoutine(
    new Request('http://localhost/api/routines', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
        'idempotency-key': 'origin-key',
      },
      body: JSON.stringify(demoBody),
    }),
    { db, env: ACCESS_ENV, nowIso: () => NOW_ISO, newId: counterIds('origin') },
  );
  assert.equal(response.status, 403);
  const payload = (await handleCreateRoutine(
    new Request('http://localhost/api/routines', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
        'idempotency-key': 'origin-key-2',
      },
      body: JSON.stringify(demoBody),
    }),
    { db, env: ACCESS_ENV, nowIso: () => NOW_ISO, newId: counterIds('origin2') },
  ).then((res) => res.json()) as { error: string });
  assert.equal(payload.error, 'Origin not allowed.');
});

void test('direct routine persistence helpers keep ownership checks', async () => {
  const db = await migrated();
  await ensureUser(db, {
    id: 'user-a',
    accessSubject: 'access:sub-a',
    emailHash: await hashEmailHex('a@example.com'),
    nowIso: NOW_ISO,
  });
  await ensureUser(db, {
    id: 'user-b',
    accessSubject: 'access:sub-b',
    emailHash: await hashEmailHex('b@example.com'),
    nowIso: NOW_ISO,
  });
  await createRoutineWithVersion(db, {
    routineId: 'routine-a',
    userId: 'user-a',
    title: 'owned routine',
    language: 'es',
    sourceMode: 'demo',
    nowIso: NOW_ISO,
    versionId: 'version-a',
    weekStart: '2026-08-31',
    timezone: 'UTC',
    inputJson: '{}',
    planJson: '{}',
    generatedBy: 'demo',
    sessions: [],
  });
  const { getRoutineDetail } = await import('../lib/server/db.ts');
  assert.equal(await getRoutineDetail(db, 'user-b', 'routine-a'), null);
  assert.notEqual(await getRoutineDetail(db, 'user-a', 'routine-a'), null);
});
