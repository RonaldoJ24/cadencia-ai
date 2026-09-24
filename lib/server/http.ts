// Shared HTTP helpers for API routes. Extracted verbatim from
// app/api/routine/route.ts so behavior stays identical.

// A goal request may carry up to 2,000 busy times (about 50 bytes each) from an
// imported calendar, besides its text and settings.
export const MAX_BODY_BYTES = 131_072;

export type Dict = Record<string, unknown>;

export function dict(value: unknown): Dict | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

export function json(body: unknown, status = 200, requestId?: string, extraHeaders?: Record<string, string>): Response {
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  if (requestId) headers.set('x-request-id', requestId);
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  }
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

export function errorResponse(
  message: string,
  status: number,
  reason: string,
  requestId?: string,
  diagnostic?: Dict,
  event = 'cadencia_routine_failure',
  extraHeaders?: Record<string, string>,
): Response {
  const reference = crypto.randomUUID();
  console.error(
    JSON.stringify({
      event,
      reference,
      reason,
      status,
      ...(requestId ? { request_id: requestId } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    }),
  );
  return json({ error: message, reference }, status, requestId, extraHeaders);
}

export function rateLimited(retryAfterSec: number, event: string, message = 'Too many requests.'): Response {
  return errorResponse(
    message,
    429,
    'rate_limited',
    undefined,
    undefined,
    event,
    { 'retry-after': String(Math.max(1, Math.floor(retryAfterSec))) },
  );
}

export function sameOrigin(request: Request): boolean {
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

export async function bodyJson(request: Request): Promise<unknown> {
  const raw = await readBoundedText(request);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('body-json');
  }
}

/** Reads a request body once, refusing more than MAX_BODY_BYTES. */
export async function readBoundedText(request: Request): Promise<string> {
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
  return raw;
}
