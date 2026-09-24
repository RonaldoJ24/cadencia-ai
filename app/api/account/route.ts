import { handleDeleteAccount } from '../../../lib/server/account.ts';

export async function DELETE(request: Request): Promise<Response> {
  return handleDeleteAccount(request);
}
