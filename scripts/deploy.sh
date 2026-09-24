#!/usr/bin/env bash
set -euo pipefail

# Cadencia Cloudflare Worker Pre-flight and Deployment Helper
# Usage:
#   ./scripts/deploy.sh --dry-run    # Runs preflight tests, build, and dry-run deployment validation
#   ./scripts/deploy.sh --prod       # Runs preflight checks and deploys Worker to Cloudflare

MODE="dry-run"
if [[ "${1:-}" == "--prod" || "${1:-}" == "--deploy" ]]; then
  MODE="prod"
elif [[ "${1:-}" == "--dry-run" || -z "${1:-}" ]]; then
  MODE="dry-run"
else
  echo "Usage: $0 [--dry-run | --prod]" >&2
  exit 1
fi

export WRANGLER_WRITE_LOGS=false

echo "==> Running lint check..."
npm run lint

echo "==> Running typecheck..."
npm run typecheck

echo "==> Running frontend test suite..."
npm test

echo "==> Building production Worker artifact with Vinext..."
npm run build

if [[ "$MODE" == "dry-run" ]]; then
  echo "==> Running Wrangler dry-run deployment..."
  npx wrangler deploy --config dist/server/wrangler.json --dry-run
  echo "==> Dry-run deployment preflight passed successfully."
else
  echo "==> Deploying Worker to Cloudflare..."
  npm run deploy -- --skip-build
  echo "==> Cloudflare Worker deployment complete."
fi
