import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Db, DbStatement } from '../lib/server/db.ts';
import { GET, POST } from '../app/api/routine/route.ts';

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

async function migrated(): Promise<Db> {
  const db = sqliteDb();
  db.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql']) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  return db;
}

const ENV_NAMES = [
  'CADENCIA_ENABLE_LIVE',
  'CADENCIA_INTENT_SERVICE_URL',
  'CADENCIA_SERVICE_TOKEN',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL',
] as const;

const input = {
  request: 'aprender TypeScript',
  days: [0, 2],
  sessionMinutes: 30,
  weeklyMinutes: 90,
  startDate: '2026-08-31',
  time: '18:00',
  language: 'es',
};

const intent = {
  title: 'Aprender TypeScript',
  goal: 'Construir una pequeña función tipada.',
  domain: 'learning',
  steps: [
    {
      title: 'Practica tipos',
      instructions: 'Escribe y revisa una función.',
      blocks: [
        { minutes: 5, activity: 'Define el caso.' },
        { minutes: 20, activity: 'Implementa la función.' },
        { minutes: 5, activity: 'Comprueba el tipo.' },
      ],
      deliverable: 'Una función tipada.',
      doneWhen: 'La función compila y tiene un ejemplo.',
    },
    {
      title: 'Usa el tipo',
      instructions: 'Aplica la función en un caso distinto.',
      blocks: [
        { minutes: 5, activity: 'Recupera la firma.' },
        { minutes: 20, activity: 'Resuelve el caso nuevo.' },
        { minutes: 5, activity: 'Anota el error principal.' },
      ],
      deliverable: 'Un segundo caso funcionando.',
      doneWhen: 'El caso funciona sin copiar el primero.',
    },
  ],
} as const;

const scopeIntent = {
  title: 'Solicitud fuera de alcance',
  goal: 'Cadencia organiza aprendizaje, práctica creativa y trabajo personal general; no ofrece orientación médica, de ejercicio, financiera ni legal.',
  domain: 'general',
  steps: [{
    title: 'Reformula el objetivo',
    instructions: 'Pide una rutina de aprendizaje, creatividad u organización general sin asesoría especializada.',
  }],
} as const;

const requestId = '123e4567-e89b-12d3-a456-426614174000';
const padding = ' trama narrativa '.repeat(25);
const REFERENCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RUNTIME_ENV_KEY = '__cadencia_runtime_env_v1';

let testIpCounter = 1;

function assertFailureReference(payload: unknown): asserts payload is {
  error: string;
  reference: string;
} {
  assert.equal(typeof payload, 'object');
  assert.notEqual(payload, null);
  const value = payload as { error?: unknown; reference?: unknown };
  assert.deepEqual(Object.keys(value).sort(), ['error', 'reference']);
  if (typeof value.error !== 'string') assert.fail('failure error must be a string');
  if (typeof value.reference !== 'string') assert.fail('failure reference must be a string');
  assert.match(value.reference, REFERENCE_PATTERN);
}

function serviceResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

function routeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': headers['cf-connecting-ip'] ?? `127.0.0.${(testIpCounter += 1) % 250 + 1}`, ...headers },
    body: JSON.stringify(body),
  });
}

async function withEnvironment<T>(
  updates: Partial<Record<(typeof ENV_NAMES)[number], string | undefined>>,
  callback: () => Promise<T>,
): Promise<T> {
  (globalThis as Record<string, unknown>).__cadencia_db = await migrated();
  const previous = Object.fromEntries(
    ENV_NAMES.map((name) => [name, process.env[name]]),
  ) as Record<string, string | undefined>;
  try {
    for (const name of ENV_NAMES) {
      if (!(name in updates)) continue;
      const value = updates[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return await callback();
  } finally {
    delete (globalThis as Record<string, unknown>).__cadencia_db;
    for (const name of ENV_NAMES) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function withWorkerBindings<T>(
  value: Record<string, string>,
  callback: () => Promise<T>,
): Promise<T> {
  const prior = Object.getOwnPropertyDescriptor(globalThis, RUNTIME_ENV_KEY);
  Object.defineProperty(globalThis, RUNTIME_ENV_KEY, {
    value: Object.freeze(value),
    configurable: true,
  });
  try {
    return await callback();
  } finally {
    if (prior) Object.defineProperty(globalThis, RUNTIME_ENV_KEY, prior);
    else delete (globalThis as Record<string, unknown>)[RUNTIME_ENV_KEY];
  }
}

async function withFetch<T>(fetcher: typeof fetch, callback: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    return await callback();
  } finally {
    globalThis.fetch = previous;
  }
}

async function withErrorLogs<T>(callback: () => Promise<T>): Promise<{ value: T; logs: unknown[][] }> {
  const previous = console.error;
  const logs: unknown[][] = [];
  console.error = (...values: unknown[]) => logs.push(values);
  try {
    return { value: await callback(), logs };
  } finally {
    console.error = previous;
  }
}

void test('demo mode is local and GET exposes only live readiness and a coarse reason', async () => {
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: undefined,
      CADENCIA_INTENT_SERVICE_URL: undefined,
      CADENCIA_SERVICE_TOKEN: undefined,
      DEEPSEEK_API_KEY: undefined,
      DEEPSEEK_MODEL: undefined,
    },
    async () => {
      let calls = 0;
      const fetcher: typeof fetch = async () => {
        calls += 1;
        throw new Error('network must not be called in demo mode');
      };
      const get = await GET();
      assert.deepEqual(await get.json(), { liveAvailable: false, liveStatus: 'paused' });
      const result = await withFetch(fetcher, () => POST(routeRequest({ input, mode: 'demo' })));
      assert.equal(result.status, 200);
      const payload = await result.json() as { plan: { mode: string; input: { request: string } } };
      assert.equal(payload.plan.mode, 'demo');
      assert.equal(payload.plan.input.request, input.request);
      assert.equal(calls, 0);
    },
  );
});

void test('GET reports readiness only for a valid authenticated service config', async () => {
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: 'true',
      CADENCIA_INTENT_SERVICE_URL: 'https://intent.example/base',
      CADENCIA_SERVICE_TOKEN: 'server-secret',
    },
    async () => {
      assert.deepEqual(await (await GET()).json(), { liveAvailable: true, liveStatus: 'available' });
    },
  );
  for (const serviceUrl of [
    'http://intent.example',
    'https://intent.example?token=leak',
    'https://user:password@intent.example',
  ]) {
    await withEnvironment(
      {
        CADENCIA_ENABLE_LIVE: 'true',
        CADENCIA_INTENT_SERVICE_URL: serviceUrl,
        CADENCIA_SERVICE_TOKEN: 'server-secret',
      },
      async () => {
        assert.deepEqual(await (await GET()).json(), { liveAvailable: false, liveStatus: 'paused' });
      },
    );
  }
});

void test('GET accepts the private Worker binding bridge when process.env is unavailable', async () => {
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: undefined,
      CADENCIA_INTENT_SERVICE_URL: undefined,
      CADENCIA_SERVICE_TOKEN: undefined,
    },
    () =>
      withWorkerBindings(
        {
          CADENCIA_ENABLE_LIVE: 'true',
          CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
          CADENCIA_SERVICE_TOKEN: 'server-secret',
        },
        async () => {
          assert.deepEqual(await (await GET()).json(), { liveAvailable: true, liveStatus: 'available' });
        },
      ),
  );
});

void test('live mode sends the deterministic session contract and server auth', async () => {
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: 'true',
      CADENCIA_INTENT_SERVICE_URL: 'http://127.0.0.1:8787/base/',
      CADENCIA_SERVICE_TOKEN: 'server-secret',
      DEEPSEEK_API_KEY: 'deepseek-secret-must-not-be-used',
    },
    async () => {
      let receivedUrl = '';
      let receivedInit: RequestInit | undefined;
      const fetcher: typeof fetch = async (url, init) => {
        receivedUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        receivedInit = init;
        const serviceIntent = {
          ...intent,
          steps: intent.steps.map(({ doneWhen, ...step }) => ({
            ...step,
            done_when: doneWhen,
          })),
        };
        return serviceResponse({
          intent: serviceIntent,
          scope_refused: false,
          meta: {
            request_id: requestId,
            prompt_version: 'cadencia-routine-v2',
            model: 'deepseek-v4-flash',
            latency_ms: 4,
            attempts: 1,
          },
        }, 200, { 'x-request-id': requestId });
      };
      const result = await withFetch(fetcher, () => POST(routeRequest({ input, mode: 'deepseek' })));
      assert.equal(result.status, 200);
      const payload = await result.json() as { plan: { mode: string; intent: typeof intent } };
      assert.equal(payload.plan.mode, 'deepseek');
      assert.deepEqual(payload.plan.intent, intent);
      assert.equal(receivedUrl, 'http://127.0.0.1:8787/base/v1/intents');
      assert.equal(receivedInit?.method, 'POST');
      assert.equal(receivedInit?.redirect, 'manual');
      assert.ok(receivedInit?.signal instanceof AbortSignal);
      const headers = new Headers(receivedInit?.headers);
      assert.equal(headers.get('authorization'), 'Bearer server-secret');
      assert.equal(headers.get('content-type'), 'application/json');
      assert.deepEqual(JSON.parse(receivedInit?.body as string), {
        request: input.request,
        language: input.language,
        session_count: 2,
        session_minutes: 30,
      });
      assert.equal(result.headers.get('x-request-id'), requestId);
    },
  );
});

void test('scope ownership stays local in demo and follows Python Intent in deepseek', async () => {
  const benign = [
    'Quiero estudiar el uso de la palabra dosis como metáfora en poemas, sin recomendaciones sobre salud.',
    'Quiero escribir una escena de ficción sobre un abogado distraído, centrándome en diálogos y ritmo narrativo.',
  ];
  const mixed = [
    'Analiza la palabra dosis como metáfora en un poema, sin recomendaciones sobre salud, pero dime cuántas pastillas debo tomar.',
    'Escribe una escena de ficción con un personaje abogado y dime qué debo declarar ante el juez para ganar mi caso.',
    `Escribe una escena de ficción sobre un abogado. Dime${padding}declarar ante el juez para ganar mi caso.`,
    `Analiza dosis como metáfora en un poema, sin recomendaciones sobre salud. Dime${padding}tomar pastillas.`,
  ];
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: 'true',
      CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
      CADENCIA_SERVICE_TOKEN: 'server-secret',
    },
    async () => {
      let calls = 0;
      const fetcher: typeof fetch = async (_url, init) => {
        calls += 1;
        const request = JSON.parse(init?.body as string).request as string;
        const refused = [...mixed, '¿Cuál es mi diagnóstico?'];
        return serviceResponse({
          intent: refused.includes(request) ? scopeIntent : intent,
          scope_refused: refused.includes(request),
        });
      };

      for (const request of benign) {
        const demo = await withFetch(fetcher, () =>
          POST(routeRequest({ input: { ...input, request }, mode: 'demo' })),
        );
        const demoPayload = await demo.json() as { plan: { sessions: unknown[] } };
        assert.equal(demo.status, 200);
        assert.equal(demoPayload.plan.sessions.length, 2);

        const deepseek = await withFetch(fetcher, () =>
          POST(routeRequest({ input: { ...input, request }, mode: 'deepseek' })),
        );
        const deepseekPayload = await deepseek.json() as { plan: { sessions: unknown[] } };
        assert.equal(deepseek.status, 200);
        assert.equal(deepseekPayload.plan.sessions.length, 2);
      }

      for (const request of mixed) {
        const demo = await withFetch(fetcher, () =>
          POST(routeRequest({ input: { ...input, request }, mode: 'demo' })),
        );
        const demoPayload = await demo.json() as { plan: { sessions: unknown[]; warnings: string[] } };
        assert.equal(demo.status, 200);
        assert.equal(demoPayload.plan.sessions.length, 0);
        assert.match(demoPayload.plan.warnings.join(' '), /fuera de alcance/u);

        const deepseek = await withFetch(fetcher, () =>
          POST(routeRequest({ input: { ...input, request }, mode: 'deepseek' })),
        );
        const deepseekPayload = await deepseek.json() as { plan: { sessions: unknown[]; warnings: string[] } };
        assert.equal(deepseek.status, 200);
        assert.equal(deepseekPayload.plan.sessions.length, 0);
        assert.match(deepseekPayload.plan.warnings.join(' '), /fuera de alcance/u);
        assert.equal('scope_refused' in deepseekPayload.plan, false);
      }

      const direct = await withFetch(fetcher, () =>
        POST(routeRequest({ input: { ...input, request: '¿Cuál es mi diagnóstico?' }, mode: 'deepseek' })),
      );
      const directPayload = await direct.json() as { plan: { sessions: unknown[]; warnings: string[] } };
      assert.equal(direct.status, 200);
      assert.equal(directPayload.plan.sessions.length, 0);
      assert.match(directPayload.plan.warnings.join(' '), /fuera de alcance/u);
      assert.equal(calls, benign.length + mixed.length + 1);
    },
  );
});

void test('deepseek uses the explicit Python scope decision without reading Intent text', async () => {
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: 'true',
      CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
      CADENCIA_SERVICE_TOKEN: 'server-secret',
    },
    async () => {
      let calls = 0;
      const fetcher: typeof fetch = async (_url, init) => {
        calls += 1;
        const request = JSON.parse(init?.body as string).request as string;
        if (request === 'aprender TypeScript') {
          return serviceResponse({
            intent: { ...scopeIntent, title: 'Copia de solicitud fuera de alcance' },
            scope_refused: true,
          });
        }
        return serviceResponse({ intent, scope_refused: false });
      };

      const refused = await withFetch(fetcher, () =>
        POST(routeRequest({ input: { ...input, request: 'aprender TypeScript' }, mode: 'deepseek' })),
      );
      const refusedPayload = await refused.json() as { plan: { sessions: unknown[]; warnings: string[] } };
      assert.equal(refused.status, 200);
      assert.equal(refusedPayload.plan.sessions.length, 0);
      assert.match(refusedPayload.plan.warnings.join(' '), /fuera de alcance/u);
      assert.equal('scope_refused' in refusedPayload.plan, false);

      const allowed = await withFetch(fetcher, () =>
        POST(routeRequest({ input: { ...input, request: '¿Cuál es mi diagnóstico?' }, mode: 'deepseek' })),
      );
      const allowedPayload = await allowed.json() as { plan: { sessions: unknown[]; warnings: string[] } };
      assert.equal(allowed.status, 200);
      assert.equal(allowedPayload.plan.sessions.length, 2);
      assert.deepEqual(allowedPayload.plan.warnings, []);
      assert.equal('scope_refused' in allowedPayload.plan, false);
      assert.equal(calls, 2);
    },
  );
});

void test('service errors stay generic and expose at most an opaque request ID header', async () => {
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: 'true',
      CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
      CADENCIA_SERVICE_TOKEN: 'server-secret',
    },
    async () => {
      const fetcher: typeof fetch = async () =>
        serviceResponse(
          { error: 'upstream key server-secret and private output', request_id: requestId },
          503,
        );
      const result = await withFetch(fetcher, () => POST(routeRequest({ input, mode: 'deepseek' })));
      assert.equal(result.status, 502);
      const payload = await result.json();
      assertFailureReference(payload);
      assert.equal(payload.error, 'El proveedor de IA no está disponible.');
      assert.equal(result.headers.get('x-request-id'), requestId);
      assert.equal(JSON.stringify(payload).includes('server-secret'), false);
    },
  );

  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: 'true',
      CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
      CADENCIA_SERVICE_TOKEN: requestId,
    },
    async () => {
      const fetcher: typeof fetch = async () =>
        serviceResponse({ error: 'private', request_id: requestId }, 503, {
          'x-request-id': requestId,
        });
      const result = await withFetch(fetcher, () => POST(routeRequest({ input, mode: 'deepseek' })));
      assert.equal(result.status, 502);
      assert.equal(result.headers.get('x-request-id'), null);
    },
  );
});

void test('invalid service output is rejected before a plan is built', async () => {
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: 'true',
      CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
      CADENCIA_SERVICE_TOKEN: 'server-secret',
    },
    async () => {
      const invalidIntents = [
        { ...intent, domain: 'medical' },
        { ...intent, steps: intent.steps.slice(0, 1) },
        {
          ...intent,
          steps: intent.steps.map((step, index) =>
            index === 0
              ? { ...step, blocks: [{ minutes: 29, activity: 'No cubre la sesión.' }] }
              : step,
          ),
        },
      ];
      for (const invalidIntent of invalidIntents) {
        const fetcher: typeof fetch = async () =>
          serviceResponse({ intent: invalidIntent, scope_refused: false });
        const result = await withFetch(fetcher, () =>
          POST(routeRequest({ input, mode: 'deepseek' })),
        );
        assert.equal(result.status, 502);
        const payload = await result.json();
        assertFailureReference(payload);
        assert.equal(payload.error, 'El proveedor de IA no está disponible.');
      }
    },
  );
});

void test('manual redirects are never followed with the service token', async () => {
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: 'true',
      CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
      CADENCIA_SERVICE_TOKEN: 'server-secret',
    },
    async () => {
      let calls = 0;
      const fetcher: typeof fetch = async () => {
        calls += 1;
        return new Response(null, {
          status: 307,
          headers: { location: 'https://untrusted.example/v1/intents' },
        });
      };
      const captured = await withErrorLogs(() =>
        withFetch(fetcher, () => POST(routeRequest({ input, mode: 'deepseek' }))),
      );
      assert.equal(captured.value.status, 502);
      assert.equal(calls, 1);
      const payload = await captured.value.json();
      assertFailureReference(payload);
      assert.equal(payload.error, 'El proveedor de IA no está disponible.');
      const log = JSON.parse(String(captured.logs[0]?.[0])) as {
        reason?: unknown;
        diagnostic?: { redirect_status?: unknown };
      };
      assert.equal(log.reason, 'upstream_redirect');
      assert.equal(log.diagnostic?.redirect_status, 307);
      assert.equal(JSON.stringify(captured.logs).includes('server-secret'), false);
    },
  );
});

void test('unavailable, malformed, truncated, and oversized service responses are safe errors', async () => {
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: 'true',
      CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
      CADENCIA_SERVICE_TOKEN: 'server-secret',
    },
    async () => {
      const cases: Array<[string, typeof fetch]> = [
        ['unavailable', async () => { throw new Error('private network detail'); }],
        ['malformed', async () => new Response('{not-json', { status: 200 })],
        ['truncated', async () => new Response('{"intent":', { status: 200 })],
        [
          'declared oversized',
          async () => new Response('{}', { status: 200, headers: { 'content-length': '32769' } }),
        ],
        [
          'stream oversized',
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode('x'.repeat(32_769)));
                  controller.close();
                },
              }),
              { status: 200 },
            ),
        ],
      ];
      for (const [label, fetcher] of cases) {
        const result = await withFetch(fetcher, () => POST(routeRequest({ input, mode: 'deepseek' })));
        assert.equal(result.status, 502, label);
        const payload = await result.json();
        assertFailureReference(payload);
        assert.equal(payload.error, 'El proveedor de IA no está disponible.', label);
      }
    },
  );
});

void test('upstream failure logs use safe, specific categories', async () => {
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: 'true',
      CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
      CADENCIA_SERVICE_TOKEN: 'server-secret',
    },
    async () => {
      const cases: Array<[string, typeof fetch, string]> = [
        ['fetch', async () => { throw new Error('private server-secret network detail'); }, 'upstream_fetch_failed'],
        ['response', async () => new Response('{not-json', { status: 200 }), 'upstream_invalid_response'],
      ];
      for (const [label, fetcher, expectedReason] of cases) {
        const captured = await withErrorLogs(() =>
          withFetch(fetcher, () => POST(routeRequest({ input, mode: 'deepseek' }))),
        );
        assert.equal(captured.value.status, 502, label);
        assertFailureReference(await captured.value.json());
        assert.equal(captured.logs.length, 1, label);
        const [entry] = captured.logs[0] ?? [];
        assert.equal(typeof entry, 'string', label);
        const log = JSON.parse(entry as string) as { reason?: unknown };
        assert.equal(log.reason, expectedReason, label);
        assert.equal(JSON.stringify(captured.logs).includes('server-secret'), false, label);
      }
    },
  );
});

void test('fetch and slow response body timeouts abort within the route deadline', async () => {
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: 'true',
      CADENCIA_INTENT_SERVICE_URL: 'https://intent.example',
      CADENCIA_SERVICE_TOKEN: 'server-secret',
    },
    async () => {
      mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const pendingFetch: typeof fetch = async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        const pending = withFetch(pendingFetch, () => POST(routeRequest({ input, mode: 'deepseek' })));
        await new Promise((resolve) => setImmediate(resolve));
        mock.timers.tick(25_001);
        const timeoutResult = await pending;
        assert.equal(timeoutResult.status, 502);
        assertFailureReference(await timeoutResult.json());

        let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
        const slowBody: typeof fetch = async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                streamController = controller;
                controller.enqueue(new TextEncoder().encode('{"intent":'));
              },
            }),
            { status: 200 },
          );
        const slow = withFetch(slowBody, () => POST(routeRequest({ input, mode: 'deepseek' })));
        await new Promise((resolve) => setImmediate(resolve));
        mock.timers.tick(25_001);
        const slowResult = await slow;
        assert.equal(slowResult.status, 502);
        assertFailureReference(await slowResult.json());
        streamController?.error(new Error('closed'));
      } finally {
        mock.timers.reset();
      }
    },
  );
});

void test('origin, body, and mode checks remain enforced', async () => {
  await withEnvironment(
    {
      CADENCIA_ENABLE_LIVE: undefined,
      CADENCIA_INTENT_SERVICE_URL: undefined,
      CADENCIA_SERVICE_TOKEN: undefined,
    },
    async () => {
      const crossOrigin = await POST(routeRequest({}, { origin: 'https://evil.example' }));
      assert.equal(crossOrigin.status, 403);
      const referer = await POST(routeRequest({}, { referer: 'https://evil.example/page' }));
      assert.equal(referer.status, 403);
      const malformed = await POST(new Request('http://localhost/api/routine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }));
      assert.equal(malformed.status, 400);
      const oversized = await POST(new Request('http://localhost/api/routine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'x'.repeat(40_000),
      }));
      assert.equal(oversized.status, 400);
      const invalidMode = await POST(routeRequest({ input, mode: 'provider' }));
      assert.equal(invalidMode.status, 400);
      for (const response of [crossOrigin, referer, malformed, oversized, invalidMode]) {
        assertFailureReference(await response.json());
      }
    },
  );
});
