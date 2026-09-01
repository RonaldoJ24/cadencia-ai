import { buildPlan, validateInput, validateIntent } from '../../../lib/routine.ts';

const MAX_BODY_BYTES = 32_768;
const MAX_RESPONSE_BYTES = 32_768;
const SERVICE_TIMEOUT_MS = 25_000;
const SERVICE_PATH = '/v1/intents';
const SERVICE_ERROR = 'El proveedor de IA no está disponible.';
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type Dict = Record<string, unknown>;

function dict(value: unknown): Dict | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function json(body: unknown, status = 200, requestId?: string): Response {
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  if (requestId) headers.set('x-request-id', requestId);
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

async function runtimeEnv(): Promise<Record<string, unknown>> {
  try {
    const worker = await import('cloudflare:workers');
    return worker.env as Record<string, unknown>;
  } catch {
    return process.env;
  }
}

function env(source: Record<string, unknown>, name: string): string {
  const value = source[name];
  return typeof value === 'string' ? value.trim() : '';
}

function loopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/u.test(host)
  );
}

function normalizeServiceUrl(value: string): string | null {
  if (!value || value.includes('?') || value.includes('#')) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol === 'http:' && !loopback(url.hostname))
  ) {
    return null;
  }
  const path = url.pathname.replace(/\/+$/u, '');
  url.pathname = path === '' || path === SERVICE_PATH
    ? SERVICE_PATH
    : path.endsWith(SERVICE_PATH)
      ? path
      : `${path}${SERVICE_PATH}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

type LiveConfig = { serviceUrl: string; token: string };

async function liveConfig(): Promise<LiveConfig | null> {
  const source = await runtimeEnv();
  if (env(source, 'CADENCIA_ENABLE_LIVE') !== 'true') return null;
  const serviceUrl = normalizeServiceUrl(env(source, 'CADENCIA_INTENT_SERVICE_URL'));
  const token = env(source, 'CADENCIA_SERVICE_TOKEN');
  if (
    !serviceUrl ||
    token.length === 0 ||
    token.length > 4_096
  )
    return null;
  return { serviceUrl, token };
}

function sameOrigin(request: Request): boolean {
  try {
    const target = new URL(request.url).origin;
    const origin = request.headers.get('origin');
    if (origin && origin !== target) return false;
    const referer = request.headers.get('referer');
    if (!origin && referer && new URL(referer).origin !== target) return false;
    return true;
  } catch {
    return false;
  }
}

async function bodyJson(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isFinite(size) || size < 0 || size > MAX_BODY_BYTES)
      throw new Error('body-size');
  }
  const reader = request.body?.getReader();
  let raw: string;
  if (!reader) {
    raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES)
      throw new Error('body-size');
  } else {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('body-size');
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    raw = new TextDecoder().decode(bytes);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('body-json');
  }
}

class ServiceFailure extends Error {
  readonly requestId?: string;

  constructor(requestId?: string) {
    super(SERVICE_ERROR);
    this.name = 'ServiceFailure';
    this.requestId = requestId;
  }
}

function requestId(value: unknown): string | undefined {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value.trim())
    ? value.trim()
    : undefined;
}

function requestIdFromBody(raw: string): string | undefined {
  try {
    const root = dict(JSON.parse(raw));
    return requestId(root?.request_id) ?? requestId(dict(root?.meta)?.request_id);
  } catch {
    return undefined;
  }
}

function safeRequestId(value: string | undefined, token: string): string | undefined {
  return value && value.toLowerCase() !== token.toLowerCase() ? value : undefined;
}

function timed<T>(
  operation: () => Promise<T>,
  controller: AbortController,
  deadline: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const remaining = deadline - Date.now();
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(() => reject(new Error('service-timeout')));
    }, Math.max(0, remaining));
    if (remaining <= 0) {
      controller.abort();
      finish(() => reject(new Error('service-timeout')));
      return;
    }
    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

function responseBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function readLimitedText(
  response: Response,
  controller: AbortController,
  deadline: number,
): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isFinite(size) || size < 0 || size > MAX_RESPONSE_BYTES) {
      throw new Error('service-response-size');
    }
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const raw = await timed(() => response.text(), controller, deadline);
    if (responseBytes(raw) > MAX_RESPONSE_BYTES) throw new Error('service-response-size');
    return raw;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await timed(() => reader.read(), controller, deadline);
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error('service-response-size');
      }
      chunks.push(part.value);
    }
  } catch (error) {
    controller.abort();
    void reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function requestIntent(
  input: string,
  config: LiveConfig,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<{ intent: unknown; scopeRefused: boolean; requestId?: string }> {
  const controller = new AbortController();
  const deadline = Date.now() + SERVICE_TIMEOUT_MS;
  let responseRequestId: string | undefined;
  let response: Response;
  try {
    response = await timed(
      () =>
        fetcher(config.serviceUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ request: input }),
          redirect: 'error',
          signal: controller.signal,
        }),
      controller,
      deadline,
    );
    const headerRequestId = requestId(response.headers.get('x-request-id'));
    responseRequestId = safeRequestId(headerRequestId, config.token);
    const raw = await readLimitedText(response, controller, deadline);
    const bodyRequestId = requestIdFromBody(raw);
    const serviceRequestId =
      responseRequestId ??
      safeRequestId(bodyRequestId, config.token);
    responseRequestId = serviceRequestId;
    if (!response.ok) throw new ServiceFailure(serviceRequestId);
    const root = dict(JSON.parse(raw));
    if (!root || !('intent' in root) || typeof root.scope_refused !== 'boolean') {
      throw new Error('service-response-json');
    }
    return {
      intent: root.intent,
      scopeRefused: root.scope_refused,
      requestId: serviceRequestId,
    };
  } catch (error) {
    controller.abort();
    if (error instanceof ServiceFailure) throw error;
    throw new ServiceFailure(responseRequestId);
  }
}

export async function GET(): Promise<Response> {
  return json({ liveAvailable: (await liveConfig()) !== null });
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: 'Origen no permitido.' }, 403);

  let value: Dict | null;
  try {
    value = dict(await bodyJson(request));
  } catch {
    return json(
      { error: 'El cuerpo JSON no es válido o supera el límite.' },
      400,
    );
  }
  if (!value) return json({ error: 'El cuerpo JSON debe ser un objeto.' }, 400);

  let input;
  try {
    input = validateInput(value.input);
  } catch {
    return json({ error: 'Los datos de la rutina no son válidos.' }, 400);
  }
  const mode = value.mode === undefined ? 'demo' : value.mode;
  if (mode !== 'demo' && mode !== 'deepseek') {
    return json({ error: 'El modo de rutina no es válido.' }, 400);
  }
  if (mode === 'demo')
    return json({ plan: buildPlan(input, undefined, 'demo') });

  const config = await liveConfig();
  if (!config) return json({ error: 'La IA real no está configurada.' }, 503);
  let serviceRequestId: string | undefined;
  try {
    const serviceResult = await requestIntent(input.request, config);
    serviceRequestId = serviceResult.requestId;
    const intent = validateIntent(serviceResult.intent);
    return json(
      { plan: buildPlan(input, intent, 'deepseek', serviceResult.scopeRefused) },
      200,
      serviceRequestId,
    );
  } catch (error) {
    return json(
      { error: SERVICE_ERROR },
      502,
      error instanceof ServiceFailure ? error.requestId ?? serviceRequestId : serviceRequestId,
    );
  }
}
