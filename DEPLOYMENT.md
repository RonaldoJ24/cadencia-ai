# Cadencia deployment

Cadencia runs in two places:

1. **Cloudflare Worker `cadencia-ai`**: the Vinext app (UI and `/api/routine`) on
   `https://cadencia-ai.ronaldo-jesus-alvarez.workers.dev`, with a D1 database for
   public limits.
2. **Cloud Run service `cadencia-intents`**: the FastAPI intent service that calls
   DeepSeek. Only the Worker calls it, with a shared bearer token.

---

## 1. Architecture and boundaries

```
[ Browser ]
    │  HTTPS
    ▼
[ Cloudflare Access ]  owner-only app on /api/*, public bypass on exactly /api/routine
    │
    ▼
[ Worker: cadencia-ai ]
    ├─ Serves the page and static assets
    ├─ /api/routine: demo plans, and live plans when CADENCIA_ENABLE_LIVE is "true"
    ├─ D1 cadencia_beta: rate limits, daily quotas, in-flight leases
    │
    ▼  HTTPS, Authorization: Bearer <CADENCIA_SERVICE_TOKEN>
[ Cloud Run: cadencia-intents ]  (us-central1)
    ├─ GET  /livez      public liveness
    ├─ POST /v1/intents constant-time token check, strict schemas, scope guard
    │
    ▼  HTTPS, Bearer <DEEPSEEK_API_KEY>
[ DeepSeek API ]  https://api.deepseek.com/chat/completions
```

Rules that hold across both runtimes:

- **No secrets in the browser.** `CADENCIA_SERVICE_TOKEN` and `DEEPSEEK_API_KEY`
  live only in platform secret stores (Worker secrets, GCP Secret Manager).
- **Live mode fails closed.** Without `CADENCIA_ENABLE_LIVE="true"`, a valid https
  service URL and the token, or without D1, `/api/routine` answers 503 and makes
  no outbound call.
- **The demo runs in the browser** and never calls the Worker's live path or a model.
- **New API routes start private.** Access protects every `/api/*` path; only the
  exact path `/api/routine` has a public bypass.

---

## 2. Configuration

| Where | Name | Stored in | Purpose |
|---|---|---|---|
| Worker | `CADENCIA_ENABLE_LIVE` | `wrangler.jsonc` | `"true"` enables live generation. Committed as `"true"`, so every deploy keeps live AI on (see §7). |
| Worker | `CADENCIA_INTENT_SERVICE_URL` | `wrangler.jsonc` | Cloud Run base URL |
| Worker | `CADENCIA_SERVICE_TOKEN` | Worker secret | Bearer token for Cloud Run; also keys the visitor hash (§8) |
| Worker | `CADENCIA_PUBLIC_*` | `wrangler.jsonc` | Only the per-minute limit and error wording read these today; daily quotas and concurrency come from the D1 table `public_limits_config` (§8) |
| Cloud Run | `CADENCIA_SERVICE_TOKEN` | Secret Manager `cadencia-service-token` | Token checked on every request |
| Cloud Run | `DEEPSEEK_API_KEY` | Secret Manager `deepseek-api-key` | Provider key |
| Cloud Run | `DEEPSEEK_MODEL` | Env var | Model name; code default `deepseek-v4-flash` |
| Cloud Run | `PORT` | Set by Cloud Run | Defaults to 8080 |

---

## 3. Cloud Run intent service

Production as read on 2026-09-23 with `gcloud run services describe`: 1 CPU,
256 MiB, concurrency 8, min 0 and max 1 instances, 30 s timeout, public ingress
(the app checks the bearer token), secrets from Secret Manager, and an image built
on 2026-09-02 that serves prompt `cadencia-routine-v2`.

Cloud Run reserves some paths ending in `z`: `/healthz` never reaches the
container there, so health checks use `/livez`.

### 3.1 Build and deploy

Set the placeholders, then build with Cloud Build (no local Docker needed):

```bash
export CADENCIA_GCP_PROJECT='<project-id>'
export CADENCIA_GCP_REGION='us-central1'
export CADENCIA_ARTIFACT_REPOSITORY='cadencia'
export CADENCIA_RUN_SERVICE='cadencia-intents'
export CADENCIA_IMAGE_TAG="$(git rev-parse --short HEAD)"

gcloud builds submit service --config service/cloudbuild.yaml \
  --substitutions _REGION="$CADENCIA_GCP_REGION",_REPOSITORY="$CADENCIA_ARTIFACT_REPOSITORY",_SERVICE="$CADENCIA_RUN_SERVICE",COMMIT_SHA="$CADENCIA_IMAGE_TAG"
```

Deploy the image with the same settings as production:

```bash
gcloud run deploy "$CADENCIA_RUN_SERVICE" \
  --image "${CADENCIA_GCP_REGION}-docker.pkg.dev/${CADENCIA_GCP_PROJECT}/${CADENCIA_ARTIFACT_REPOSITORY}/${CADENCIA_RUN_SERVICE}:${CADENCIA_IMAGE_TAG}" \
  --region "$CADENCIA_GCP_REGION" --port 8080 --cpu 1 --memory 256Mi \
  --concurrency 8 --min-instances 0 --max-instances 1 --timeout 30s \
  --ingress all --no-invoker-iam-check \
  --set-env-vars "DEEPSEEK_MODEL=deepseek-v4-flash" \
  --set-secrets "DEEPSEEK_API_KEY=deepseek-api-key:latest,CADENCIA_SERVICE_TOKEN=cadencia-service-token:latest"
```

`service/artifact-cleanup-policy.json` keeps the three newest images and deletes
images older than 30 days.

---

## 4. Worker deploys

Deploy only through the script:

```bash
npm run deploy:check   # checks, build and a Wrangler dry run; warns instead of stopping
npm run deploy         # the same checks, then deploys; stops on the first failed check
```

`npm run deploy` stops unless:

- the checkout is a clean `main` equal to `origin/main`;
- production D1 has every migration in `migrations/`;
- lint, typecheck, tests and the build pass;
- the build output contains no absolute local path (`scripts/check-dist.mjs`).

The last check exists because the 2026-09-10 deploy was built from a laptop whose
`.vinext` font cache still pointed at the folder the repo had moved from: the live
page linked its fonts to that local path and they returned 404. If the check
fails, delete `.vinext/` and build again.

### 4.1 D1 migrations

Applying a migration is a deliberate step, never part of a deploy:

```bash
npx wrangler d1 migrations list cadencia_beta --remote
npx wrangler d1 migrations apply cadencia_beta --remote
```

Production has `0001` through `0004` applied (checked 2026-09-23). The tables from
`0001` and `0004` served features removed on 2026-09-24 (§9); they stay in place,
and dropping them would be its own migration.

### 4.2 Worker secret

First deploy or rotation (the value must match Secret Manager):

```bash
npx wrangler secret put CADENCIA_SERVICE_TOKEN
```

---

## 5. Cloudflare Access

Two Access applications cover the Worker's `workers.dev` hostname:

1. **Cadencia Worker Access** on `/api/*`, allowing only the owner.
2. **Cadencia Public Routine Bypass** on exactly `api/routine`, action **Bypass**,
   rule **Everyone**. Longest-prefix matching sends `/api/routine` here.

`scripts/configure-access-bypass.mjs` creates the bypass with the local Wrangler
login when that token has Access edit permission; otherwise create it in the
Zero Trust dashboard with the values above.

---

## 6. Verification

```bash
# Cloud Run liveness and auth
curl -fsS "https://cadencia-intents-675488596560.us-central1.run.app/livez"      # {"status":"ok"}
curl -i -X POST "https://cadencia-intents-675488596560.us-central1.run.app/v1/intents" \
  -H 'content-type: application/json' -d '{"request":"test"}'                   # 401

# Worker readiness: {"liveAvailable":true} when live mode is configured
curl -fsS "https://cadencia-ai.ronaldo-jesus-alvarez.workers.dev/api/routine"

# Server-side demo plan (no model call); startDate must be a Monday
curl -i -X POST "https://cadencia-ai.ronaldo-jesus-alvarez.workers.dev/api/routine" \
  -H 'content-type: application/json' \
  -d '{"mode":"demo","input":{"request":"learn piano","days":[0,2],"sessionMinutes":30,"weeklyMinutes":60,"startDate":"2026-09-21","time":"18:00","language":"en"}}'
```

A live check costs a real model call; run one only when the spend is approved.

---

## 7. Turning live AI off

Today the switch is configuration, so it takes a deploy. Set
`"CADENCIA_ENABLE_LIVE": "false"` in `wrangler.jsonc`, commit, and run
`npm run deploy`. A one-off `wrangler deploy --var` override does not last: the
next normal deploy restores the committed value. Live requests then return 503
and the demo keeps working. A switch that works without a deploy is planned
alongside dollar caps.

To stop the backend itself:

```bash
gcloud run services update cadencia-intents --region us-central1 --max-instances 0
```

---

## 8. Public limits

Live generation on `/api/routine` reserves a slot in one D1 batch before any
provider call:

| Control | Value | Source |
|---|---|---|
| Per-visitor rate | 2 per minute | `CADENCIA_PUBLIC_MINUTE_LIMIT` |
| Per-visitor daily quota | 5 | `public_limits_config` (seeded by `0003`) |
| Global daily cap | 50 | `public_limits_config` |
| Global in flight | 10 | `public_limits_config` |
| Per-visitor in flight | 1 | unique index on `public_concurrency` |
| Lease | 40 s | code default |
| Provider attempts | up to 2 per generation | `service/provider.py` |

Failed generations still count against quota. The limits count requests, not
money; dollar caps are planned. Quotas reset at 00:00 UTC.

Visitors are identified by `HMAC-SHA256(CADENCIA_SERVICE_TOKEN, day + IP)` from
the `cf-connecting-ip` header; raw IPs are not stored. Rotating the service token
therefore also resets every visitor's quota for the day.

---

## 9. History

- **2026-09-02**: Cloud Run service deployed.
- **2026-09-06**: migrations `0001` to `0003` applied to production D1 (the beta
  loop tables and the public limits).
- **2026-09-09**: migration `0004` applied for the public Reviewer Replay (a
  Cloudflare Workflow). Together with the owner-only beta (Access login, saved
  routines, sessions, versions) it shipped by 2026-09-10. Production never
  received migration `0005`, which the replay checks for first, and the deployed
  Access settings were blank, so both were likely broken.
- **2026-09-10 19:32 UTC**: last deploy, built from commit `e48a0a1`.
- **2026-09-24**: the beta loop and Reviewer Replay were removed from the code
  (with the unapplied `0005`); production serves them until the next deploy.
