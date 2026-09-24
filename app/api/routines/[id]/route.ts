import { handleGetRoutine } from '../../../../lib/server/routines.ts';

type RouteContext = {
  params?: { id?: string } | Promise<{ id?: string }>;
};

async function routineIdOf(context: RouteContext | undefined, request: Request): Promise<string> {
  const params = context?.params;
  const resolved = params && typeof (params as Promise<unknown>).then === 'function'
    ? await (params as Promise<{ id?: string }>)
    : (params as { id?: string } | undefined);
  if (resolved?.id) return resolved.id;
  // Fallback for runtimes that do not inject params: last path segment.
  try {
    const segments = new URL(request.url).pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? '';
  } catch {
    return '';
  }
}

export async function GET(request: Request, context?: RouteContext): Promise<Response> {
  return handleGetRoutine(request, await routineIdOf(context, request));
}
