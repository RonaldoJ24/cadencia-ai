import test from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../app/api/routine/route.ts';
import { generateIntent } from '../lib/provider.ts';

const config = { apiKey: 'test-key', model: 'deepseek-v4-flash' };
const intent = {
  title: 'Practicar acuarela',
  goal: 'Crear una muestra breve.',
  domain: 'creative',
  steps: [{ title: 'Boceto', instructions: 'Haz una primera versión pequeña.' }],
} as const;

function response(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

void test('provider sends the fixed DeepSeek JSON contract and validates output', async () => {
  let receivedUrl = '';
  let receivedInit: RequestInit | undefined;
  const result = await generateIntent(
    'practicar acuarela',
    config,
    async (url, init) => {
      receivedUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      receivedInit = init;
      return response(JSON.stringify(intent));
    },
  );
  assert.deepEqual(result, intent);
  assert.equal(receivedUrl, 'https://api.deepseek.com/chat/completions');
  assert.equal(receivedInit?.method, 'POST');
  const headers = receivedInit?.headers as Record<string, string> | undefined;
  assert.equal(headers?.authorization, 'Bearer test-key');
  const requestBody = receivedInit?.body;
  assert.ok(typeof requestBody === 'string');
  const payload = JSON.parse(requestBody);
  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.deepEqual(payload.thinking, { type: 'disabled' });
  assert.equal(payload.temperature, 0.2);
  assert.equal(payload.max_tokens, 800);
  assert.equal(payload.stream, false);
  assert.equal(payload.tools, undefined);
  assert.match(payload.messages[1].content, /practicar acuarela/u);
});

void test('provider rejects malformed, truncated, oversized, and invalid schema output generically', async () => {
  await assert.rejects(
    () => generateIntent('objetivo', config, async () => response('{bad json')),
    { message: 'No se pudo generar la intención con el proveedor.' },
  );
  await assert.rejects(
    () => generateIntent('objetivo', config, async () => response(JSON.stringify({ ...intent, domain: 'medical' }))),
    { message: 'No se pudo generar la intención con el proveedor.' },
  );
  await assert.rejects(
    () => generateIntent('objetivo', config, async () => response('x'.repeat(40_000))),
    { message: 'No se pudo generar la intención con el proveedor.' },
  );
  await assert.rejects(
    () => generateIntent('objetivo', config, async () => response('upstream secret', 503)),
    (error: unknown) => error instanceof Error && error.message === 'No se pudo generar la intención con el proveedor.' && !error.message.includes('secret'),
  );
});

void test('provider converts network and configuration failures without exposing details', async () => {
  await assert.rejects(
    () => generateIntent('objetivo', config, async () => { throw new Error('secret network detail'); }),
    { message: 'No se pudo generar la intención con el proveedor.' },
  );
  await assert.rejects(() => generateIntent('', config, async () => response('{}')), /Entrada inválida/u);
  await assert.rejects(() => generateIntent('objetivo', { apiKey: '', model: 'x' }, async () => response('{}')), /Configuración inválida/u);
});

void test('provider abort signal is passed for the bounded timeout', async () => {
  let signal: AbortSignal | undefined;
  await generateIntent('objetivo', config, async (_url, init) => {
    signal = init?.signal as AbortSignal;
    return response(JSON.stringify(intent));
  });
  assert.ok(signal);
  assert.equal(signal?.aborted, false);
});

const environment = ['CADENCIA_ENABLE_LIVE', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL'] as const;

void test('route keeps demo available without live credentials and exposes only a boolean on GET', async () => {
  for (const name of environment) delete process.env[name];
  const get = await GET();
  assert.deepEqual(await get.json(), { liveAvailable: false });
  const request = new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: { request: 'aprender TypeScript', days: [0], sessionMinutes: 30, weeklyMinutes: 30, startDate: '2026-08-31', time: '18:00' }, mode: 'demo' }),
  });
  const result = await POST(request);
  assert.equal(result.status, 200);
  const payload = await result.json() as { plan: { mode: string; input: { request: string } } };
  assert.equal(payload.plan.mode, 'demo');
  assert.equal(payload.plan.input.request, 'aprender TypeScript');
});

void test('route rejects cross-origin, malformed, oversized, and unconfigured live requests', async () => {
  for (const name of environment) delete process.env[name];
  const crossOrigin = await POST(new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.equal(crossOrigin.status, 403);

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

  process.env.CADENCIA_ENABLE_LIVE = 'true';
  const live = await POST(new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: { request: 'aprender TypeScript', days: [0], sessionMinutes: 30, weeklyMinutes: 30, startDate: '2026-08-31', time: '18:00' }, mode: 'deepseek' }),
  }));
  assert.equal(live.status, 503);
});
