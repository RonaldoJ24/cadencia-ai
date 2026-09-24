import handler from 'vinext/server/fetch-handler';

const RUNTIME_ENV_KEY = '__cadencia_runtime_env_v1';

type HandlerEnv = Parameters<typeof handler.fetch>[1];
type HandlerContext = Parameters<typeof handler.fetch>[2];

function routeBindings(env: HandlerEnv): Readonly<Record<string, string>> {
  const source = env as Record<string, unknown>;
  const read = (name: string): string =>
    typeof source[name] === 'string' ? source[name] : '';
  return Object.freeze({
    CADENCIA_ENABLE_LIVE: read('CADENCIA_ENABLE_LIVE'),
    CADENCIA_INTENT_SERVICE_URL: read('CADENCIA_INTENT_SERVICE_URL'),
    CADENCIA_SERVICE_TOKEN: read('CADENCIA_SERVICE_TOKEN'),
    CADENCIA_PUBLIC_DAILY_QUOTA: read('CADENCIA_PUBLIC_DAILY_QUOTA'),
    CADENCIA_PUBLIC_GLOBAL_DAILY_CAP: read('CADENCIA_PUBLIC_GLOBAL_DAILY_CAP'),
    CADENCIA_PUBLIC_VISITOR_CONCURRENCY: read('CADENCIA_PUBLIC_VISITOR_CONCURRENCY'),
    CADENCIA_PUBLIC_GLOBAL_CONCURRENCY: read('CADENCIA_PUBLIC_GLOBAL_CONCURRENCY'),
    CADENCIA_PUBLIC_MINUTE_LIMIT: read('CADENCIA_PUBLIC_MINUTE_LIMIT'),
  });
}

const worker = {
  fetch(request: Request, env: HandlerEnv, ctx: HandlerContext): Promise<Response> {
    const scope = globalThis as Record<string, unknown>;
    if (!(RUNTIME_ENV_KEY in scope)) {
      Object.defineProperty(scope, RUNTIME_ENV_KEY, {
        value: routeBindings(env),
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
    if (!scope.__cadencia_db && (env as Record<string, unknown>)?.DB) {
      scope.__cadencia_db = (env as Record<string, unknown>).DB;
    }
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
