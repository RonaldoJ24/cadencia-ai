import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
const localLiveEnabled = process.env.CADENCIA_ENABLE_LIVE === 'true';
const localNodeRuntime = process.env.CADENCIA_LOCAL_NODE === 'true';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = localLiveEnabled
  ? {
      vars: {
        CADENCIA_ENABLE_LIVE: 'true',
        CADENCIA_INTENT_SERVICE_URL:
          process.env.CADENCIA_INTENT_SERVICE_URL || 'http://127.0.0.1:8080',
      },
      secrets: { required: ['CADENCIA_SERVICE_TOKEN'] },
    }
  : {};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Local live development uses Vinext's Node runtime so it can reach the
  // loopback-only Python service. Builds and normal previews keep workerd.
  const cloudflarePlugin = localNodeRuntime
    ? []
    : [
        cloudflare({
          viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
          config: localBindingConfig,
        }),
      ];

  return {
    // Runtime/server variables come from the process or platform bindings. Keep
    // Vite itself from loading dotenv files into client-facing import.meta.env.
    envDir: false as const,
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      ...cloudflarePlugin,
    ],
  };
});
