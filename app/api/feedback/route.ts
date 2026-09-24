import { handleSubmitFeedback } from '../../../lib/server/account.ts';

export async function POST(request: Request): Promise<Response> {
  return handleSubmitFeedback(request);
}
