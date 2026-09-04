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
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
