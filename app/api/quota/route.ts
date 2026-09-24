import { handleGetQuota } from '../../../lib/server/account.ts';

export async function GET(request: Request): Promise<Response> {
  return handleGetQuota(request);
}
