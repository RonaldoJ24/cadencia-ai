import { generateIntent } from '../../../lib/provider.ts';
import { buildPlan, validateInput } from '../../../lib/routine.ts';

const MAX_BODY_BYTES = 32_768;
const DEFAULT_MODEL = 'deepseek-v4-flash';

type Dict = Record<string, unknown>;

function dict(value: unknown): Dict | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
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

async function liveConfig(): Promise<{ apiKey: string; model: string } | null> {
  const source = await runtimeEnv();
  const apiKey = env(source, 'DEEPSEEK_API_KEY');
  const model = env(source, 'DEEPSEEK_MODEL') || DEFAULT_MODEL;
  if (env(source, 'CADENCIA_ENABLE_LIVE') !== 'true' || apiKey.length === 0)
    return null;
  return { apiKey, model };
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
  try {
    const intent = await generateIntent(input.request, config);
    return json({ plan: buildPlan(input, intent, 'deepseek') });
  } catch {
    return json({ error: 'El proveedor de IA no está disponible.' }, 502);
  }
}
