import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/routine/route.ts';
import { migratedDb } from './helpers/sqlite-d1.ts';

// GET /api/routine with the production wiring: bindings from process.env or
// the Worker bridge, and the database from the global the entry point sets.

const ENV_NAMES = ['CADENCIA_ENABLE_LIVE', 'CADENCIA_INTENT_SERVICE_URL', 'CADENCIA_SERVICE_TOKEN'] as const;
const RUNTIME_ENV_KEY = '__cadencia_runtime_env_v1';
const MIGRATIONS = ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql'];

async function withEnvironment<T>(
  updates: Partial<Record<(typeof ENV_NAMES)[number], string | undefined>>,
  run: () => Promise<T>,
): Promise<T> {
  (globalThis as Record<string, unknown>).__cadencia_db = migratedDb(MIGRATIONS);
  const previous = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  try {
    for (const name of ENV_NAMES) {
      const value = updates[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return await run();
  } finally {
    delete (globalThis as Record<string, unknown>).__cadencia_db;
    for (const name of ENV_NAMES) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function withWorkerBindings<T>(value: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const prior = Object.getOwnPropertyDescriptor(globalThis, RUNTIME_ENV_KEY);
  Object.defineProperty(globalThis, RUNTIME_ENV_KEY, { value: Object.freeze(value), configurable: true });
  try {
    return await run();
  } finally {
    if (prior) Object.defineProperty(globalThis, RUNTIME_ENV_KEY, prior);
    else delete (globalThis as Record<string, unknown>)[RUNTIME_ENV_KEY];
  }
}

void test('without live configuration GET reports a coarse pause', async () => {
  await withEnvironment({}, async () => {
    assert.deepEqual(await (await GET()).json(), { liveAvailable: false, liveStatus: 'paused' });
  });
});

void test('GET reports readiness only for a valid authenticated service config', async () => {
  const live = { CADENCIA_ENABLE_LIVE: 'true', CADENCIA_SERVICE_TOKEN: 'server-secret' };
  await withEnvironment({ ...live, CADENCIA_INTENT_SERVICE_URL: 'https://intent.example/base' }, async () => {
    assert.deepEqual(await (await GET()).json(), { liveAvailable: true, liveStatus: 'available' });
  });
  for (const serviceUrl of ['http://intent.example', 'https://intent.example?token=leak', 'https://user:password@intent.example']) {
    await withEnvironment({ ...live, CADENCIA_INTENT_SERVICE_URL: serviceUrl }, async () => {
      assert.deepEqual(await (await GET()).json(), { liveAvailable: false, liveStatus: 'paused' });
    });
  }
});

void test('GET accepts the private Worker binding bridge when process.env is unavailable', async () => {
  await withEnvironment({}, () =>
    withWorkerBindings(
      { CADENCIA_ENABLE_LIVE: 'true', CADENCIA_INTENT_SERVICE_URL: 'https://intent.example', CADENCIA_SERVICE_TOKEN: 'server-secret' },
      async () => {
        assert.deepEqual(await (await GET()).json(), { liveAvailable: true, liveStatus: 'available' });
      },
    ));
});
