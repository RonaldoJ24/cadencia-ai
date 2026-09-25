import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/routine/route.ts';
import { normalizeServiceUrl, serviceEndpoint } from '../lib/server/live.ts';
import { addDays, weekdayOf } from '../lib/planner/time.ts';
import { migratedDb } from './helpers/sqlite-d1.ts';

// The live goal run's calls to the Python service, end to end through the
// route: the real client, a stubbed network.

const NOW_ISO = '2026-09-24T12:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const PRODUCTION_URL = 'https://cadencia-intents-675488596560.us-central1.run.app';
const TOKEN = 'server-secret';
const REQUEST_ID = '123e4567-e89b-12d3-a456-426614174000';
const MIGRATIONS = ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql', '0006_live_limits.sql'];
const env = { CADENCIA_ENABLE_LIVE: 'true', CADENCIA_INTENT_SERVICE_URL: PRODUCTION_URL, CADENCIA_SERVICE_TOKEN: TOKEN };
const input = { text: 'Learn TypeScript on Monday and Wednesday evenings', language: 'en', today: '2026-09-24' };

const reading = {
  decision: 'plan',
  title: 'Learn TypeScript',
  summary: 'Learn TypeScript on Monday and Wednesday evenings.',
  domain: 'learning',
  level: 'unknown',
  deadline: null,
  deadline_basis: 'none',
  days: [0, 2],
  window: 'evening',
  weekly_minutes: 60,
  session_minutes: 30,
  question: null,
  abstain: null,
};

function draftFor(weeks: number) {
  return {
    phases: [{ title: 'Practice', fromWeek: 1, toWeek: weeks, focus: 'A small typed tool.' }],
    sessionTypes: [{
      id: 'practice',
      title: 'Typed practice',
      minutes: 30,
      intensity: 'moderate',
      role: 'key',
      blocks: [{ minutes: 30, activity: 'Write and compile one typed function.' }],
      deliverable: 'One compiled function.',
      doneWhen: 'It compiles.',
    }],
    weeks: Array.from({ length: weeks }, (_, index) => ({ week: index + 1, sessions: ['practice'] })),
    templateId: null,
  };
}

let ip = 10;
function request(body: unknown = { mode: 'live', kind: 'goal', input }, headers: Record<string, string> = {}): Request {
  ip += 1;
  return new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${ip}`, ...headers },
    body: JSON.stringify(body),
  });
}

function urlOf(target: RequestInfo | URL): string {
  return typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
}

function bodyOf(init?: RequestInit): string {
  return typeof init?.body === 'string' ? init.body : '';
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

async function withFetch<T>(fetcher: typeof fetch, run: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    return await run();
  } finally {
    globalThis.fetch = previous;
  }
}

async function withLogs<T>(run: () => Promise<T>): Promise<{ value: T; logs: string[] }> {
  const previous = console.error;
  const logs: string[] = [];
  // Keep only the route's JSON log lines; runtimes may print warnings too.
  console.error = (...values: unknown[]) => {
    const line = values.map(String).join(' ');
    if (line.startsWith('{')) logs.push(line);
  };
  try {
    return { value: await run(), logs };
  } finally {
    console.error = previous;
  }
}

function post(body?: unknown, headers?: Record<string, string>) {
  return POST(request(body, headers), { db: migratedDb(MIGRATIONS), env, nowIso: () => NOW_ISO, nowMs: () => NOW_MS });
}

void test('the production service URL maps to each endpoint', () => {
  for (const configured of [PRODUCTION_URL, `${PRODUCTION_URL}/`, `${PRODUCTION_URL}/v1/intents`]) {
    const base = normalizeServiceUrl(configured);
    assert.ok(base);
    assert.equal(serviceEndpoint(base, '/v1/read-goal'), `${PRODUCTION_URL}/v1/read-goal`);
    assert.equal(serviceEndpoint(base, '/v1/draft'), `${PRODUCTION_URL}/v1/draft`);
  }
});

void test('a goal run calls read-goal and then draft with the server token and no redirects', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: urlOf(url), init: init ?? {} });
    if (urlOf(url).endsWith('/v1/read-goal')) {
      return json({ reading, scope_refused: false, meta: { request_id: REQUEST_ID, attempts: 1 } });
    }
    const payload = JSON.parse(bodyOf(init)) as { calendar: { weeks: unknown[] } };
    return json({ draft: draftFor(payload.calendar.weeks.length), meta: { attempts: 1 } });
  };
  const response = await withFetch(fetcher, () => post());
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { outcome: string }).outcome, 'ready');
  assert.deepEqual(calls.map((call) => call.url), [`${PRODUCTION_URL}/v1/read-goal`, `${PRODUCTION_URL}/v1/draft`]);
  for (const call of calls) {
    assert.equal(new Headers(call.init.headers).get('authorization'), `Bearer ${TOKEN}`);
    assert.equal(call.init.redirect, 'manual');
  }
  assert.deepEqual(JSON.parse(bodyOf(calls[0].init)), { ...input, provided: [] });
});

void test('busy times shape the room the draft is offered but never reach the service', async () => {
  // Every Monday evening is taken, so of Monday and Wednesday only Wednesday is left.
  const busy = Array.from({ length: 26 }, (_, index) => {
    const monday = addDays('2026-09-28', index * 7);
    return { start: `${monday}T17:00`, end: `${monday}T23:00` };
  });
  const bodies: string[] = [];
  const rooms: number[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    bodies.push(bodyOf(init));
    if (urlOf(url).endsWith('/v1/read-goal')) return json({ reading, scope_refused: false, meta: { attempts: 1 } });
    const payload = JSON.parse(bodyOf(init)) as { calendar: { weeks: Array<{ room: number }> } };
    rooms.push(...payload.calendar.weeks.map((week) => week.room));
    return json({ draft: draftFor(payload.calendar.weeks.length), meta: { attempts: 1 } });
  };
  const response = await withFetch(fetcher, () => post({ mode: 'live', kind: 'goal', input: { ...input, busy } }));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { outcome: string; plan: { weeks: Array<{ sessions: Array<{ date: string }> }> } };
  assert.equal(body.outcome, 'ready');
  assert.equal(bodies.length, 2);
  for (const sent of bodies) assert.doesNotMatch(sent, /busy|T17:00|T23:00/u);
  assert.ok(rooms.length > 0 && rooms.every((room) => room <= 1));
  const days = body.plan.weeks.flatMap((week) => week.sessions.map((session) => weekdayOf(session.date)));
  assert.ok(days.length > 0 && days.every((day) => day === 2));
});

void test('a request with the most busy times fits the body limit, and a larger body is refused', async () => {
  // 2,000 half-hour busy times, about 104 KB of JSON.
  const busy = Array.from({ length: 2_000 }, (_, index) => {
    const date = addDays('2026-09-25', Math.floor(index / 11));
    const hour = String(8 + (index % 11)).padStart(2, '0');
    return { start: `${date}T${hour}:00`, end: `${date}T${hour}:30` };
  });
  const fetcher: typeof fetch = async (url, init) => {
    if (urlOf(url).endsWith('/v1/read-goal')) return json({ reading, scope_refused: false, meta: { attempts: 1 } });
    const payload = JSON.parse(bodyOf(init)) as { calendar: { weeks: unknown[] } };
    return json({ draft: draftFor(payload.calendar.weeks.length), meta: { attempts: 1 } });
  };
  const full = await withFetch(fetcher, () => post({ mode: 'live', kind: 'goal', input: { ...input, busy } }));
  assert.equal(full.status, 200);
  const oversized = await withFetch(fetcher, () => post({ mode: 'live', kind: 'goal', input: { ...input, busy, notes: 'x'.repeat(30_000) } }));
  assert.equal(oversized.status, 400);
  assert.equal(((await oversized.json()) as { error: string }).error.length > 0, true);
});

void test('service errors stay generic and expose at most an opaque request ID', async () => {
  const leaky: typeof fetch = async () => json({ error: `upstream key ${TOKEN} and private output`, request_id: REQUEST_ID }, 503);
  const { value: response } = await withLogs(() => withFetch(leaky, () => post()));
  assert.equal(response.status, 502);
  const payload = (await response.json()) as { error: string; reference: string };
  assert.deepEqual(Object.keys(payload).sort(), ['error', 'reference']);
  assert.equal(payload.error, 'The AI provider is not available.');
  assert.equal(response.headers.get('x-request-id'), REQUEST_ID);
  assert.equal(JSON.stringify(payload).includes(TOKEN), false);

  // A request id equal to the token is never echoed back.
  const echo: typeof fetch = async () => json({ error: 'private', request_id: TOKEN }, 503, { 'x-request-id': TOKEN });
  const tokenEnv = { ...env, CADENCIA_SERVICE_TOKEN: REQUEST_ID };
  const { value: second } = await withLogs(() => withFetch(
    async () => json({ error: 'private', request_id: REQUEST_ID }, 503, { 'x-request-id': REQUEST_ID }),
    () => POST(request(), { db: migratedDb(MIGRATIONS), env: tokenEnv, nowIso: () => NOW_ISO, nowMs: () => NOW_MS }),
  ));
  assert.equal(second.status, 502);
  assert.equal(second.headers.get('x-request-id'), null);
  const { value: third } = await withLogs(() => withFetch(echo, () => post()));
  assert.equal(third.headers.get('x-request-id'), null);
});

void test('a redirect is never followed with the service token', async () => {
  let calls = 0;
  const redirect: typeof fetch = async () => {
    calls += 1;
    return new Response(null, { status: 307, headers: { location: 'https://untrusted.example/v1/read-goal' } });
  };
  const { value: response, logs } = await withLogs(() => withFetch(redirect, () => post()));
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
  const log = JSON.parse(logs[0]) as { reason?: string; stage?: string; diagnostic?: { redirect_status?: number } };
  assert.equal(log.reason, 'upstream_redirect');
  assert.equal(log.stage, 'read_goal');
  assert.equal(log.diagnostic?.redirect_status, 307);
  assert.equal(logs.join('').includes(TOKEN), false);
});

void test('unavailable, malformed, truncated and oversized answers are safe errors at either call', async () => {
  const oversized = (bytes: number) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(bytes)));
      controller.close();
    },
  }), { status: 200 });
  const readCases: Array<[string, typeof fetch]> = [
    ['unavailable', async () => { throw new Error(`private network detail ${TOKEN}`); }],
    ['malformed', async () => new Response('{not-json', { status: 200 })],
    ['truncated', async () => new Response('{"reading":', { status: 200 })],
    ['declared oversized', async () => new Response('{}', { status: 200, headers: { 'content-length': '32769' } })],
    ['stream oversized', async () => oversized(32_769)],
  ];
  for (const [label, fetcher] of readCases) {
    const { value: response } = await withLogs(() => withFetch(fetcher, () => post()));
    assert.equal(response.status, 502, label);
    const payload = (await response.json()) as { error: string };
    assert.equal(payload.error, 'The AI provider is not available.', label);
  }
  // A draft answer may be larger than a reading, up to 128 KB.
  const draftTooLarge: typeof fetch = async (url) =>
    urlOf(url).endsWith('/v1/read-goal') ? json({ reading, scope_refused: false, meta: { attempts: 1 } }) : oversized(131_073);
  const { value: response, logs } = await withLogs(() => withFetch(draftTooLarge, () => post()));
  assert.equal(response.status, 502);
  assert.equal((JSON.parse(logs[0]) as { stage?: string }).stage, 'draft');
});

void test('failure logs use safe, specific categories', async () => {
  const cases: Array<[typeof fetch, string]> = [
    [async () => { throw new Error(`private ${TOKEN} network detail`); }, 'upstream_fetch_failed'],
    [async () => new Response('{not-json', { status: 200 }), 'upstream_invalid_response'],
  ];
  for (const [fetcher, reason] of cases) {
    const { logs } = await withLogs(() => withFetch(fetcher, () => post()));
    assert.equal(logs.length, 1);
    assert.equal((JSON.parse(logs[0]) as { reason?: string }).reason, reason);
    assert.equal(logs.join('').includes(TOKEN), false);
  }
});

void test('a stalled read-goal call is abandoned at its 35 s deadline', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const stalled: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const pending = withLogs(() => withFetch(stalled, () => post()));
    for (let step = 0; step < 5; step += 1) await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(35_001);
    const { value: response, logs } = await pending;
    assert.equal(response.status, 502);
    assert.equal((JSON.parse(logs[0]) as { reason?: string }).reason, 'upstream_timeout');
  } finally {
    mock.timers.reset();
  }
});

void test('the scope decision comes from the service, whatever the reading says', async () => {
  const refused: typeof fetch = async () => json({
    reading: { ...reading, decision: 'abstain', abstain: { category: 'medical', reason: 'It needs a professional.' } },
    scope_refused: true,
    meta: { attempts: 0 },
  });
  const response = await withFetch(refused, () => post());
  const body = (await response.json()) as { outcome: string; byGuard: boolean };
  assert.equal(body.outcome, 'cannot_plan');
  assert.equal(body.byGuard, true);
});

void test('origin, body, kind and mode checks stay enforced for goal runs', async () => {
  const cases: Array<[number, Request]> = [
    [403, request(undefined, { origin: 'https://evil.example' })],
    [403, request(undefined, { referer: 'https://evil.example/page' })],
    [400, new Request('http://localhost/api/routine', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })],
    [400, new Request('http://localhost/api/routine', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(40_000) })],
    [400, request({ mode: 'live', kind: 'weekly', input })],
    [400, request({ mode: 'provider', kind: 'goal', input })],
  ];
  const { value: statuses } = await withLogs(async () => {
    const out: number[] = [];
    for (const [, candidate] of cases) {
      out.push((await POST(candidate, { db: migratedDb(MIGRATIONS), env, nowIso: () => NOW_ISO, nowMs: () => NOW_MS })).status);
    }
    return out;
  });
  assert.deepEqual(statuses, cases.map(([status]) => status));
});
