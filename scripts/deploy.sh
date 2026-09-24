#!/usr/bin/env bash
set -euo pipefail

# Cadencia Worker deploy helper, the only supported way to ship the Worker.
# Usage:
#   ./scripts/deploy.sh --dry-run    # checks, build and a Wrangler dry run (default)
#   ./scripts/deploy.sh --prod       # checks, build and deploy
#
# --prod refuses to deploy unless the checkout is a clean `main` that matches
# origin/main and production D1 already has every migration in migrations/.
# Applying a migration is a separate, deliberate step (see DEPLOYMENT.md).

MODE="dry-run"
case "${1:-}" in
  --prod|--deploy) MODE="prod" ;;
  --dry-run|"") MODE="dry-run" ;;
  *) echo "Usage: $0 [--dry-run | --prod]" >&2; exit 1 ;;
esac

export WRANGLER_WRITE_LOGS=false
export WRANGLER_SEND_METRICS=false

# In a dry run a failed precondition is reported and the run continues.
check() {
  local message="$1"
  if [[ "$MODE" == "prod" ]]; then
    echo "deploy: $message" >&2
    exit 1
  fi
  echo "warning: $message (a --prod run would stop here)" >&2
}

echo "==> Checking the checkout..."
branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" == "main" ]] || check "deploys only run from main (current branch: $branch)."
[[ -z "$(git status --porcelain)" ]] || check "the working tree has uncommitted changes."
if git fetch --quiet origin main; then
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] \
    || check "HEAD differs from origin/main; deploy exactly what is on GitHub."
else
  check "could not fetch origin/main."
fi

echo "==> Checking production D1 migrations..."
if migrations="$(npx wrangler d1 migrations list cadencia_beta --remote 2>&1)"; then
  if grep -q "Migrations to be applied" <<<"$migrations"; then
    echo "$migrations" >&2
    check "production D1 has pending migrations. Apply them first: npx wrangler d1 migrations apply cadencia_beta --remote"
  fi
else
  echo "$migrations" >&2
  check "could not list production D1 migrations (is Wrangler logged in?)."
fi

echo "==> Running lint, typecheck and tests..."
npm run lint
npm run typecheck
npm test

echo "==> Building (fails if the output contains local paths)..."
npm run build

if [[ "$MODE" == "dry-run" ]]; then
  echo "==> Running the Wrangler dry run..."
  npx wrangler deploy --config dist/server/wrangler.json --dry-run
  echo "==> Dry run passed. Deploy with: npm run deploy"
else
  echo "==> Deploying $(git rev-parse --short HEAD) to Cloudflare..."
  npx vinext-cloudflare deploy --config dist/server/wrangler.json --skip-build
  echo "==> Deployed $(git rev-parse --short HEAD)."
fi
