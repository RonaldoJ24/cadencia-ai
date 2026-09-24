// Typed D1 access for the public limits. Every value crosses via bound `?`
// params; no user content is interpolated into SQL.

export interface DbStatement {
  bind(...params: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
  runSync?(): { success: boolean; meta?: { changes?: number } };
}

export interface Db {
  prepare(query: string): DbStatement;
  batch(statements: DbStatement[]): Promise<unknown[]>;
  exec?(query: string): Promise<unknown>;
}

export function envDb(env: Record<string, unknown> | undefined): Db | null {
  if (!env) return null;
  const candidate = env.DB as Db | undefined;
  if (candidate && typeof candidate.prepare === 'function' && typeof candidate.batch === 'function') {
    return candidate;
  }
  return null;
}
