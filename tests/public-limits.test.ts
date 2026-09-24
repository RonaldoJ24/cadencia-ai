 import test from 'node:test';
 import assert from 'node:assert/strict';
 import { readFileSync } from 'node:fs';
 import { DatabaseSync } from 'node:sqlite';
 import type { Db, DbStatement } from '../lib/server/db.ts';
  import { POST } from '../app/api/routine/route.ts';
  import { checkRateLimit } from '../lib/server/ratelimit.ts';
  import {
    hmacIpHash,
    secondsUntilUtcMidnight,
  } from '../lib/server/public_limits.ts';
 
 const NOW_ISO = '2026-09-06T12:00:00.000Z';
 const NOW_MS = Date.parse(NOW_ISO);
 
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
       runSync() {
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
         for (const statement of statements) {
           const syncApi = statement as unknown as { runSync?: () => unknown; run: () => Promise<unknown> };
           out.push(typeof syncApi.runSync === 'function' ? syncApi.runSync() : await syncApi.run());
         }
         raw.exec('COMMIT');
         return out;
       } catch (error) {
         raw.exec('ROLLBACK');
         throw error;
       }
     },
   };
 }
 
 async function migrated(): Promise<Db & { raw: DatabaseSync }> {
   const db = sqliteDb();
   db.raw.exec('PRAGMA foreign_keys = ON');
   for (const file of ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql']) {
     db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
   }
   // Dollar caps are tested in spend.test.ts; here they must never be the
   // limit that decides, so request limits are tested on their own.
   db.raw.exec("UPDATE app_settings SET value = '1000000000' WHERE key IN ('daily_cap_microusd', 'monthly_cap_microusd')");
   return db;
 }
 
 // Goal runs through the public route. A clarifying question ends a run after
 // one quick service call, which is all these limit tests need.
 const baseInput = { text: 'aprender TypeScript', language: 'es', today: NOW_ISO.slice(0, 10) };

 const questionAnswer = {
   reading: {
     decision: 'clarify',
     title: 'Aprender TypeScript',
     summary: 'Quiere aprender TypeScript.',
     domain: 'learning',
     level: 'unknown',
     deadline: null,
     deadline_basis: 'none',
     days: null,
     window: null,
     weekly_minutes: null,
     session_minutes: null,
     question: '¿Qué quieres construir con TypeScript?',
     abstain: null,
   },
   scopeRefused: false,
   usage: { promptTokens: 400, completionTokens: 90, attempts: 1 },
 };
 
 const mockLiveEnv = {
   CADENCIA_ENABLE_LIVE: 'true',
   CADENCIA_INTENT_SERVICE_URL: 'https://cadencia-intents.example.run.app',
   CADENCIA_SERVICE_TOKEN: 'super-secret-high-entropy-token-12345',
 };
 
 function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
   return new Request('http://localhost/api/routine', {
     method: 'POST',
     headers: {
       'content-type': 'application/json',
       origin: 'http://localhost',
       ...headers,
     },
     body: JSON.stringify(body),
   });
 }
 
 void test('atomic admission on checkRateLimit: simultaneous requests from same key cannot exceed limit', async () => {
   const db = await migrated();
   const key = 'ip:test-atomic-ratelimit:public_live';
   const limit = 2;
 
   // Fire 10 simultaneous calls on the exact same key at the exact same millisecond
   const results = await Promise.all(
     Array.from({ length: 10 }, () =>
       checkRateLimit(db, {
         key,
         scope: 'public_live',
         nowMs: NOW_MS,
         limitOverride: limit,
       }),
     ),
   );
 
   const allowedCount = results.filter((r) => r.allowed).length;
   const rejectedCount = results.filter((r) => !r.allowed).length;
 
   assert.equal(allowedCount, limit, 'Exactly limit=2 requests must be allowed');
   assert.equal(rejectedCount, 8, '8 requests must be rejected');
 });
 
void test('isolated daily quota race: 20 distinct IPs simultaneously at global daily 49 and concurrency 0 admits at most 1 and caps count at 50', async () => {
  const db = await migrated();
  const day = NOW_ISO.slice(0, 10);

  // Pre-seed global daily usage at 49 (concurrency is 0)
  db.raw
    .prepare('INSERT INTO public_daily_usage (scope, day, count) VALUES (?, ?, ?)')
    .run('global', day, 49);

  let providerCallsStarted = 0;
  let releaseProviderGate: () => void;
  const providerGate = new Promise<void>((resolve) => {
    releaseProviderGate = resolve;
  });

  const delayedFetcher = async () => {
    providerCallsStarted += 1;
    await providerGate;
    return questionAnswer;
  };

  // Launch 20 distinct IPs simultaneously
  const requests = Array.from({ length: 20 }, (_, index) =>
    POST(
      makeRequest(
        { input: baseInput, mode: 'deepseek', kind: 'goal' },
        { 'cf-connecting-ip': `203.0.113.${index + 1}` },
      ),
      {
        db,
        env: mockLiveEnv,
        readGoalFetcher: delayedFetcher,
        nowIso: () => NOW_ISO,
        nowMs: () => NOW_MS,
      },
    ),
  );

  // Wait a small tick so concurrent transactions hit SQLite
  await new Promise((resolve) => setTimeout(resolve, 30));

  // Assert that at most 1 provider call started
  assert.equal(
    providerCallsStarted,
    1,
    'AT MOST 1 provider call must start at daily 49 / concurrency 0',
  );

  releaseProviderGate!();
  const responses = await Promise.all(requests);

  const okResponses = responses.filter((r) => r.status === 200);
  const limitedResponses = responses.filter((r) => r.status === 429);

  assert.equal(okResponses.length, 1, 'Exactly 1 request must succeed');
  assert.equal(limitedResponses.length, 19, 'Exactly 19 requests must receive 429');

  // Verify daily usage counter was capped strictly at 50
  const finalUsage = db.raw
    .prepare('SELECT count FROM public_daily_usage WHERE scope = ? AND day = ?')
    .get('global', day) as { count: number };
  assert.equal(finalUsage.count, 50, 'Global daily count must be capped at 50');
});

void test('isolated global concurrency race: 11 distinct IPs simultaneously at global daily 0 and concurrency 9 admits at most 1', async () => {
  const db = await migrated();

  // Pre-seed 9 active in-flight concurrency slots (daily usage is 0)
  for (let i = 1; i <= 9; i += 1) {
    db.raw
      .prepare('INSERT INTO public_concurrency (id, ip_hash, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(`seed-concurrency-${i}`, `seed-ip-${i}`, NOW_MS, NOW_MS + 40_000);
  }

  let providerCallsStarted = 0;
  let releaseGate: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const delayedFetcher = async () => {
    providerCallsStarted += 1;
    await gate;
    return questionAnswer;
  };

  // Launch 11 simultaneous distinct IPs
  const requests = Array.from({ length: 11 }, (_, index) =>
    POST(
      makeRequest(
        { input: baseInput, mode: 'deepseek', kind: 'goal' },
        { 'cf-connecting-ip': `198.51.100.${index + 1}` },
      ),
      {
        db,
        env: mockLiveEnv,
        readGoalFetcher: delayedFetcher,
        nowIso: () => NOW_ISO,
        nowMs: () => NOW_MS,
      },
    ),
  );

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(providerCallsStarted, 1, 'Only 1 additional provider call admitted before reaching concurrency 10');

  releaseGate!();
  const responses = await Promise.all(requests);
  const ok = responses.filter((r) => r.status === 200);
  const rejected = responses.filter((r) => r.status === 429);

  assert.equal(ok.length, 1);
  assert.equal(rejected.length, 10);
});
 
 void test('visitor concurrency: simultaneous requests from same visitor permit only 1', async () => {
   const db = await migrated();
   const ip = '198.51.100.88';
 
   let providerCalls = 0;
   let releaseGate: () => void;
   const gate = new Promise<void>((resolve) => {
     releaseGate = resolve;
   });
 
   const delayedFetcher = async () => {
     providerCalls += 1;
     await gate;
     return questionAnswer;
   };
 
   // Launch 5 simultaneous requests from the same visitor IP
   const requests = Array.from({ length: 5 }, () =>
     POST(
       makeRequest(
         { input: baseInput, mode: 'deepseek', kind: 'goal' },
         { 'cf-connecting-ip': ip },
       ),
       {
         db,
         env: mockLiveEnv,
         readGoalFetcher: delayedFetcher,
         nowIso: () => NOW_ISO,
         nowMs: () => NOW_MS,
       },
     ),
   );
 
   await new Promise((resolve) => setTimeout(resolve, 20));
   assert.equal(providerCalls, 1, 'Only 1 provider call permitted per visitor concurrently');
 
   releaseGate!();
   const responses = await Promise.all(requests);
   const ok = responses.filter((r) => r.status === 200);
   const rejected = responses.filter((r) => r.status === 429);
 
   assert.equal(ok.length, 1);
   assert.equal(rejected.length, 4);
   // Runs refused a slot had their spend reservation removed again.
   const ledger = db.raw.prepare('SELECT status FROM spend_ledger').all() as Array<{ status: string }>;
   assert.deepEqual(ledger.map((row) => row.status), ['settled']);
 });
 
 void test('daily 429 returns Retry-After until UTC midnight reset', async () => {
   const db = await migrated();
   const ip = '198.51.100.77';
   const fetcher = async () => questionAnswer;
 
   // Consume 5 daily quota slots
   for (let i = 0; i < 5; i += 1) {
     await POST(
       makeRequest(
         { input: baseInput, mode: 'deepseek', kind: 'goal' },
         { 'cf-connecting-ip': ip },
       ),
       {
         db,
         env: mockLiveEnv,
         readGoalFetcher: fetcher,
         nowIso: () => NOW_ISO,
         nowMs: () => NOW_MS + i * 65_000,
       },
     );
   }
 
   // 6th call hits visitor daily quota
   const testMs = NOW_MS + 5 * 65_000;
   const res = await POST(
     makeRequest(
       { input: baseInput, mode: 'deepseek', kind: 'goal' },
       { 'cf-connecting-ip': ip },
     ),
     {
       db,
       env: mockLiveEnv,
       readGoalFetcher: fetcher,
       nowIso: () => NOW_ISO,
       nowMs: () => testMs,
     },
   );
 
   assert.equal(res.status, 429);
   const retryAfter = res.headers.get('retry-after');
   assert.ok(retryAfter !== null);
   const expectedSec = secondsUntilUtcMidnight(testMs);
   assert.equal(Number(retryAfter), expectedSec, 'Retry-After must equal seconds until next UTC 00:00:00');
 });
 
 void test('missing cf-connecting-ip rejects with 400 and does not trust x-real-ip', async () => {
   const db = await migrated();
 
   // Request with spoofed x-real-ip but missing cf-connecting-ip
   const spoofed = await POST(
     makeRequest(
       { input: baseInput, mode: 'deepseek', kind: 'goal' },
       { 'x-real-ip': '1.2.3.4' },
     ),
     {
       db,
       env: mockLiveEnv,
       nowIso: () => NOW_ISO,
       nowMs: () => NOW_MS,
     },
   );
 
   assert.equal(spoofed.status, 400);
   const payload = (await spoofed.json()) as { error: string };
   assert.match(payload.error, /client IP/iu);
 
   // In non-bypassable fallback mode, missing IP routes to a single shared bucket
   const fallbackRes = await POST(
     makeRequest(
       { input: baseInput, mode: 'deepseek', kind: 'goal' },
       {},
     ),
     {
       db,
       env: { ...mockLiveEnv, CADENCIA_ALLOW_IP_FALLBACK: 'true' },
       readGoalFetcher: async () => questionAnswer,
       nowIso: () => NOW_ISO,
       nowMs: () => NOW_MS,
     },
   );
   assert.equal(fallbackRes.status, 200);
 });
 
 void test('keyed crypto HMAC identity is non-reversible and cookie reset fails', async () => {
   const secret = 'cadencia-prod-secret-999';
   const hash1 = hmacIpHash('198.51.100.1', secret, '2026-09-06');
   const hash2 = hmacIpHash('198.51.100.1', secret, '2026-09-06');
   const hashOtherIp = hmacIpHash('198.51.100.2', secret, '2026-09-06');
   const hashNextDay = hmacIpHash('198.51.100.1', secret, '2026-09-07');
 
   assert.equal(hash1, hash2, 'Same IP and day must produce deterministic HMAC');
   assert.notEqual(hash1, hashOtherIp, 'Different IP must produce different HMAC');
   assert.notEqual(hash1, hashNextDay, 'Different day must rotate HMAC');
   assert.equal(hash1.length, 64, 'HMAC-SHA256 must be 64 hex characters (256-bit)');
 
   // Test in route: cookie reset does not bypass quota
   const db = await migrated();
   const fetcher = async () => questionAnswer;
   const ip = '198.51.100.99';
 
   for (let i = 0; i < 5; i += 1) {
     await POST(
       makeRequest(
         { input: baseInput, mode: 'deepseek', kind: 'goal' },
         { 'cf-connecting-ip': ip, cookie: 'auth_token=valid-cookie-1' },
       ),
       {
         db,
         env: mockLiveEnv,
         readGoalFetcher: fetcher,
         nowIso: () => NOW_ISO,
         nowMs: () => NOW_MS + i * 65_000,
       },
     );
   }
 
   // Attempt bypass with cleared / altered cookie
   const bypass = await POST(
     makeRequest(
       { input: baseInput, mode: 'deepseek', kind: 'goal' },
       { 'cf-connecting-ip': ip, cookie: 'auth_token=fresh-reset-cookie' },
     ),
     {
       db,
       env: mockLiveEnv,
       readGoalFetcher: fetcher,
       nowIso: () => NOW_ISO,
       nowMs: () => NOW_MS + 5 * 65_000,
     },
   );
   assert.equal(bypass.status, 429);
 });
 
 void test('production defaults with no injected deps: fails closed when DB absent', async () => {
   // Ensure no global DB binding
   delete (globalThis as Record<string, unknown>).__cadencia_db;
 
   const res = await POST(
     makeRequest(
       { input: baseInput, mode: 'deepseek', kind: 'goal' },
       { 'cf-connecting-ip': '198.51.100.5' },
     ),
   );
 
   // Must fail closed with 503 limits_not_configured
   assert.equal(res.status, 503);
   const payload = (await res.json()) as { error: string };
   assert.match(payload.error, /límite|tasa|configurad/iu);
 });
 
 void test('backend bearer secrecy: CADENCIA_SERVICE_TOKEN is never exposed', async () => {
   const db = await migrated();
   const token = 'super-secret-token-xyz';
   const fetcher = async () => {
     throw new Error(`connection failed for ${token}`);
   };
 
   const res = await POST(
     makeRequest(
       { input: baseInput, mode: 'deepseek', kind: 'goal' },
       { 'cf-connecting-ip': '198.51.100.4' },
     ),
     {
       db,
       env: { ...mockLiveEnv, CADENCIA_SERVICE_TOKEN: token },
       readGoalFetcher: fetcher,
       nowIso: () => NOW_ISO,
       nowMs: () => NOW_MS,
     },
   );
 
   assert.equal(res.status, 502);
   const text = await res.text();
   assert.equal(text.includes(token), false);
  for (const [header, val] of res.headers.entries()) {
    assert.equal(header.includes(token), false);
    assert.equal(val.includes(token), false);
  }
});

void test('missing HMAC secret throws and fails closed with 503', async () => {
  const db = await migrated();
  assert.throws(() => hmacIpHash('1.2.3.4', '', '2026-09-06'), /HMAC secret is required/u);

  const res = await POST(
    makeRequest(
      { input: baseInput, mode: 'deepseek', kind: 'goal' },
      { 'cf-connecting-ip': '198.51.100.9' },
    ),
    {
      db,
      env: { ...mockLiveEnv, CADENCIA_SERVICE_TOKEN: '' },
      nowIso: () => NOW_ISO,
      nowMs: () => NOW_MS,
    },
  );
  assert.equal(res.status, 503);
});

void test('D1 meta.changes contract is strictly checked during rate admission', async () => {
  const db = await migrated();
  // Mock a D1 statement return with meta.changes
  let changesValue = 0;
  const mockDb: Db = {
    prepare(sql: string) {
      const real = db.prepare(sql);
      return {
        bind(...params: unknown[]) {
          real.bind(...params);
          return this;
        },
        first: real.first.bind(real),
        all: real.all.bind(real),
        async run() {
          await real.run();
          return { success: true, meta: { changes: changesValue } };
        },
      };
    },
    batch: db.batch.bind(db),
  };

  // When changes is 0, admission must fail
  changesValue = 0;
  const rejected = await checkRateLimit(mockDb, {
    key: 'ip:test-changes:read',
    scope: 'read',
    nowMs: NOW_MS,
  });
  assert.equal(rejected.allowed, false);

  // When changes is 1, admission must succeed
  changesValue = 1;
  const allowed = await checkRateLimit(mockDb, {
    key: 'ip:test-changes-2:read',
    scope: 'read',
    nowMs: NOW_MS,
  });
  assert.equal(allowed.allowed, true);
});
 
