import { handleGetVersion } from '../../../../../../lib/server/versions.ts';

type RouteContext = {
  params?: { id?: string; number?: string } | Promise<{ id?: string; number?: string }>;
};

async function idsOf(context: RouteContext | undefined, request: Request): Promise<{ id: string; number: number }> {
  const params = context?.params;
  const resolved = params && typeof (params as Promise<unknown>).then === 'function'
    ? await (params as Promise<{ id?: string; number?: string }>)
    : (params as { id?: string; number?: string } | undefined);
  let id = resolved?.id ?? '';
  let rawNumber = resolved?.number ?? '';
  if (!id || !rawNumber) {
    try {
      const segments = new URL(request.url).pathname.split('/').filter(Boolean);
      rawNumber = rawNumber || (segments[segments.length - 1] ?? '');
      id = id || (segments[segments.length - 3] ?? '');
    } catch {
      // Invalid ids surface as 404 below.
    }
  }
  return { id, number: Number(rawNumber) };
}

export async function GET(request: Request, context?: RouteContext): Promise<Response> {
  const { id, number } = await idsOf(context, request);
  return handleGetVersion(request, id, number);
}
