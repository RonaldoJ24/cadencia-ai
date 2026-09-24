import { handleReplan } from '../../../../../lib/server/versions.ts';

type RouteContext = {
  params?: { id?: string } | Promise<{ id?: string }>;
};

async function routineIdOf(context: RouteContext | undefined, request: Request): Promise<string> {
  const params = context?.params;
  const resolved = params && typeof (params as Promise<unknown>).then === 'function'
    ? await (params as Promise<{ id?: string }>)
    : (params as { id?: string } | undefined);
  if (resolved?.id) return resolved.id;
  try {
    const segments = new URL(request.url).pathname.split('/').filter(Boolean);
    return segments[segments.length - 2] ?? '';
  } catch {
    return '';
  }
}

export async function POST(request: Request, context?: RouteContext): Promise<Response> {
  return handleReplan(request, await routineIdOf(context, request));
}
