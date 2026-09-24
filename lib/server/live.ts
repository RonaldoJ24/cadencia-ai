// Shared live intent-service client. Extracted verbatim from
// app/api/routine/route.ts so provider behavior stays identical.
import type { RoutineInput } from '../routine.ts';

export const SERVICE_TIMEOUT_MS = 25_000;
export const SERVICE_PATH = '/v1/intents';
export const RUNTIME_ENV_KEY = '__cadencia_runtime_env_v1';
export const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type Dict = Record<string, unknown>;
export type RuntimeEnv = {
  CADENCIA_ENABLE_LIVE?: unknown;
  CADENCIA_INTENT_SERVICE_URL?: unknown;
  CADENCIA_SERVICE_TOKEN?: unknown;
};

function dict(value: unknown): Dict | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

export function configuredRuntimeEnv(value: unknown): RuntimeEnv | null {
  const source = dict(value);
  if (
    !source ||
    typeof source.CADENCIA_ENABLE_LIVE !== 'string' ||
    typeof source.CADENCIA_INTENT_SERVICE_URL !== 'string' ||
    typeof source.CADENCIA_SERVICE_TOKEN !== 'string'
  ) {
    return null;
  }
  return source as RuntimeEnv;
}

export function fetchDiagnostic(error: unknown): Dict {
  if (!(error instanceof Error)) return { error_type: typeof error };
  // Preserve only a coarse transport category. Never persist an upstream
  // exception message: it could include configuration or credentials.
  const message = error.message.toLowerCase();
  const category = message.includes('redirect')
    ? 'redirect'
    : message.includes('header')
      ? 'header'
      : message.includes('private network')
        ? 'private_network'
        : message.includes('network') || message.includes('connect')
          ? 'network'
          : message.includes('tls') || message.includes('certificate')
            ? 'tls'
            : message.includes('url')
              ? 'url'
              : message.includes('abort')
                ? 'abort'
                : message.includes('fetch')
                  ? 'fetch'
                  : 'other';
  return { error_name: error.name, category };
}

export async function runtimeEnv(): Promise<RuntimeEnv> {
  // Vinext's top-level Worker receives bindings as fetch's second argument.
  // The custom entry stores only this route's three required strings under a
  // non-enumerable server-side key; it is never sent in a response or logged.
  const bridged = configuredRuntimeEnv(
    (globalThis as Record<string, unknown>)[RUNTIME_ENV_KEY],
  );
  if (bridged) return bridged;

  // With nodejs_compat, Cloudflare populates process.env from text and secret
  // bindings. Prefer it here: Vinext's request-time dynamic module import can
  // resolve successfully without exposing this route's binding map.
  const processSource = typeof process === 'undefined' ? undefined : process.env;
  const processBindings = configuredRuntimeEnv(processSource);
  if (processBindings) return processBindings;
  try {
    const worker = await import('cloudflare:workers');
    return configuredRuntimeEnv(worker.env) ?? {};
  } catch {
    return processSource ?? {};
  }
}

function env(source: RuntimeEnv, name: keyof RuntimeEnv): string {
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

export function normalizeServiceUrl(value: string): string | null {
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

export type LiveConfig = { serviceUrl: string; token: string };

export async function liveConfig(customEnv?: RuntimeEnv): Promise<LiveConfig | null> {
  const source = customEnv ?? await runtimeEnv();
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

export type ServiceFailureReason =
  | 'invalid_authorization_header'
  | 'upstream_redirect'
  | 'upstream_timeout'
  | 'upstream_fetch_failed'
  | 'upstream_invalid_response'
  | 'backend_rejected';

export class ServiceFailure extends Error {
  readonly requestId?: string;
  readonly backendRejected: boolean;
  readonly reason: ServiceFailureReason;
  readonly diagnostic?: Dict;

  constructor(
    requestId?: string,
    backendRejected = false,
    reason: ServiceFailureReason = backendRejected
      ? 'backend_rejected'
      : 'upstream_invalid_response',
    diagnostic?: Dict,
  ) {
    super('service-failure');
    this.name = 'ServiceFailure';
    this.requestId = requestId;
    this.backendRejected = backendRejected;
    this.reason = reason;
    this.diagnostic = diagnostic;
  }
}

export function requestId(value: unknown): string | undefined {
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

function redirectDiagnostic(response: Response): Dict {
  return { redirect_status: response.status };
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

const MAX_RESPONSE_BYTES = 32_768;

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

export async function requestIntent(
  input: RoutineInput,
  config: LiveConfig,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<{ intent: unknown; scopeRefused: boolean; requestId?: string }> {
  let headers: Headers;
  try {
    headers = new Headers({
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    });
  } catch {
    throw new ServiceFailure(undefined, false, 'invalid_authorization_header');
  }

  const controller = new AbortController();
  const deadline = Date.now() + SERVICE_TIMEOUT_MS;
  let responseRequestId: string | undefined;
  let response: Response;
  let phase: 'fetch' | 'response' = 'fetch';
  try {
    response = await timed(
      () =>
        // Workers' native fetch is host-backed. Preserve its global receiver
        // instead of calling a detached function from the route module.
        fetcher.call(globalThis, config.serviceUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            request: input.request,
            language: input.language,
            session_count: Math.min(
              input.days.length,
              Math.floor(input.weeklyMinutes / input.sessionMinutes),
            ),
            session_minutes: input.sessionMinutes,
          }),
          // Inspect redirects before any token could be sent to a new origin.
          redirect: 'manual',
          signal: controller.signal,
        }),
      controller,
      deadline,
    );
    phase = 'response';
    if (response.status >= 300 && response.status < 400) {
      throw new ServiceFailure(
        undefined,
        false,
        'upstream_redirect',
        redirectDiagnostic(response),
      );
    }
    const headerRequestId = requestId(response.headers.get('x-request-id'));
    responseRequestId = safeRequestId(headerRequestId, config.token);
    const raw = await readLimitedText(response, controller, deadline);
    const bodyRequestId = requestIdFromBody(raw);
    const serviceRequestId =
      responseRequestId ??
      safeRequestId(bodyRequestId, config.token);
    responseRequestId = serviceRequestId;
    if (!response.ok) throw new ServiceFailure(serviceRequestId, true, 'backend_rejected');
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
    const timedOut = controller.signal.aborted;
    controller.abort();
    if (error instanceof ServiceFailure) throw error;
    const reason: ServiceFailureReason = timedOut
      ? 'upstream_timeout'
      : phase === 'fetch'
        ? 'upstream_fetch_failed'
        : 'upstream_invalid_response';
    throw new ServiceFailure(
      responseRequestId,
      false,
      reason,
      reason === 'upstream_fetch_failed' ? fetchDiagnostic(error) : undefined,
    );
  }
}
