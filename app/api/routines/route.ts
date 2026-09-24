import { handleCreateRoutine, handleListRoutines } from '../../../lib/server/routines.ts';

export async function GET(request: Request): Promise<Response> {
  return handleListRoutines(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateRoutine(request);
}
