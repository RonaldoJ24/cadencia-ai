# Cadencia deployment

Cadencia runs in two places:

1. **Cloudflare Worker `cadencia-ai`**: the Vinext app (UI and `/api/routine`) on
   `https://cadencia-ai.ronaldo-jesus-alvarez.workers.dev`, with a D1 database for
   public limits.
2. **Cloud Run service `cadencia-intents`**: the FastAPI planning service that
   calls GPT-6 Luna through OpenAI. Only the Worker calls it, with a shared
   bearer token. (The
   service keeps its original name from the weekly-routine era.)

**Deploy order.** When a Worker change stops calling a service endpoint, deploy
and verify the Worker first, and only then deploy a service that drops the
endpoint. The Worker that is live at any moment, and the one you would roll back
to, must find every endpoint it calls.

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
    ├─ /api/routine: live goal runs when CADENCIA_ENABLE_LIVE is "true" (the demo
    │  runs in the browser and never calls it)
    ├─ D1 cadencia_beta: kill switch, dollar caps, spend ledger, request limits
    │
    ▼  HTTPS, Authorization: Bearer <CADENCIA_SERVICE_TOKEN>
[ Cloud Run: cadencia-intents ]  (us-central1)
    ├─ GET  /livez        public liveness
    ├─ POST /v1/read-goal reads a free-text goal: plan, clarify or abstain
    ├─ POST /v1/draft     drafts sessions for the weeks code has already sized
    ├─ POST /v1/replan    picks one of the options code built after missed
    │                     sessions, from the person's reason, or declines
    │                     (all: constant-time token check, strict schemas,
    │                     prompt byte ceilings; a scope guard on the reading)
    │
    ▼  HTTPS, Bearer <OPENAI_API_KEY>
[ OpenAI API ]  https://api.openai.com/v1/chat/completions (gpt-6-luna)
```

Rules that hold across both runtimes:

- **No secrets in the browser.** `CADENCIA_SERVICE_TOKEN` and `OPENAI_API_KEY`
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
| Worker | `CADENCIA_ENABLE_LIVE` | `wrangler.jsonc` | `"true"` enables live runs. Committed as `"true"`, so every deploy keeps live AI on (see §7). |
| Worker | `CADENCIA_INTENT_SERVICE_URL` | `wrangler.jsonc` | Cloud Run base URL |
| Worker | `CADENCIA_SERVICE_TOKEN` | Worker secret | Bearer token for Cloud Run; also keys the visitor hash (§8) |
| D1 | `app_settings` | Table (migration `0005`) | Kill switch and dollar caps, read on every live request (§7, §8) |
| D1 | `public_limits_config` | Table (migration `0003`) | Request limits per visitor and overall (§8) |
| Cloud Run | `CADENCIA_SERVICE_DAILY_ATTEMPT_CAP` | Env var (optional) | Provider attempts allowed per UTC day in the running instance; default 400 |
| Cloud Run | `CADENCIA_SERVICE_TOKEN` | Secret Manager `cadencia-service-token` | Token checked on every request |
| Cloud Run | `OPENAI_API_KEY` | Secret Manager `openai-api-key` | Provider key |
| Cloud Run | `CADENCIA_PROVIDER` | Env var | `openai`; the code default is `deepseek`, kept only as a fallback |
| Cloud Run | `OPENAI_URL`, `OPENAI_MODEL`, `OPENAI_TOKEN_PARAM`, `OPENAI_TEMPERATURE`, `OPENAI_REASONING_EFFORT` | Env vars | All required: `https://api.openai.com/v1/chat/completions`, `gpt-6-luna`, `max_completion_tokens`, `0.2`, `none` (the evaluated settings) |
| Cloud Run | `PORT` | Set by Cloud Run | Defaults to 8080 |

---

## 3. Cloud Run intent service

Production as read on 2026-09-24 with `gcloud run services describe`: revision
`cadencia-intents-00008-jsx`, image `cadencia-intents:175dab6`, 1 CPU, 256 MiB,
concurrency 8, min 0 and max 1 instances, 60 s timeout, public ingress (the app
checks the bearer token), `DEEPSEEK_MODEL=deepseek-flash`, and the DeepSeek
key and service token from Secret Manager. It serves prompts
`read-goal-f2bbb9b5a76f`, `draft-6ea4a82036d6` and `replan-aff51c833ae2`; a
service test pins all three, which the evaluation and the demo samples name.

`/v1/draft` allows 40 s per provider attempt and 50 s in total, so the service
needs a 60 s request timeout, which the deploy command below sets.

Cloud Run reserves some paths ending in `z`: `/healthz` never reaches the
container there, so health checks use `/livez`.

### 3.1 Build and deploy

Build from a clean copy of the committed service files, never from `service/`
itself: without a `.gcloudignore`, Cloud Build would upload everything in the
folder, including `service/.env.local` and the virtual environment. Builds run
as the dedicated `cadencia-build-sa` account; the default compute account cannot
read the Cloud Build source bucket.

```bash
export CADENCIA_GCP_PROJECT='<project-id>'
export CADENCIA_IMAGE_TAG="$(git rev-parse --short HEAD)"
CONTEXT="$(mktemp -d)"
git archive HEAD service/Dockerfile service/pyproject.toml service/uv.lock \
  service/app.py service/provider.py service/planning.py service/cloudbuild.yaml \
  | tar -x -C "$CONTEXT" --strip-components=1

gcloud builds submit "$CONTEXT" --project "$CADENCIA_GCP_PROJECT" --config "$CONTEXT/cloudbuild.yaml" \
  --service-account "projects/$CADENCIA_GCP_PROJECT/serviceAccounts/cadencia-build-sa@$CADENCIA_GCP_PROJECT.iam.gserviceaccount.com" \
  --substitutions _REGION=us-central1,_REPOSITORY=cadencia,_SERVICE=cadencia-intents,COMMIT_SHA="$CADENCIA_IMAGE_TAG"
```

A new image for an existing service needs the image and the timeout; the
revision keeps the service's other settings, secrets and scaling limits. Passing
the timeout every time is harmless and keeps a 30 s value from coming back:

```bash
gcloud run deploy cadencia-intents --project "$CADENCIA_GCP_PROJECT" --region us-central1 \
  --image "us-central1-docker.pkg.dev/$CADENCIA_GCP_PROJECT/cadencia/cadencia-intents:$CADENCIA_IMAGE_TAG" \
  --timeout 60s

# Expect 60
gcloud run services describe cadencia-intents --project "$CADENCIA_GCP_PROJECT" --region us-central1 \
  --format='value(spec.template.spec.timeoutSeconds)'
```

For a first deployment, create the service with every setting production uses:

```bash
gcloud run deploy cadencia-intents --project "$CADENCIA_GCP_PROJECT" \
  --image "us-central1-docker.pkg.dev/$CADENCIA_GCP_PROJECT/cadencia/cadencia-intents:$CADENCIA_IMAGE_TAG" \
  --region us-central1 --port 8080 --cpu 1 --memory 256Mi \
  --concurrency 8 --min-instances 0 --max-instances 1 --timeout 60s \
  --ingress all --no-invoker-iam-check \
  --set-env-vars "CADENCIA_PROVIDER=openai,OPENAI_URL=https://api.openai.com/v1/chat/completions,OPENAI_MODEL=gpt-6-luna,OPENAI_TOKEN_PARAM=max_completion_tokens,OPENAI_TEMPERATURE=0.2,OPENAI_REASONING_EFFORT=none" \
  --set-secrets "OPENAI_API_KEY=openai-api-key:latest,CADENCIA_SERVICE_TOKEN=cadencia-service-token:latest"
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

Production has every migration in `migrations/` applied, `0001` through
`0005_spend_controls` (checked 2026-09-24). The tables from `0001` and `0004`
served features removed on 2026-09-24 (§9); they stay in place, and dropping them
would be its own migration.

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
for endpoint in read-goal draft replan; do
  curl -s -o /dev/null -w "$endpoint %{http_code}\n" -X POST \
    "https://cadencia-intents-675488596560.us-central1.run.app/v1/$endpoint" \
    -H 'content-type: application/json' -d '{}'                                 # 401
done

# Worker readiness: {"liveAvailable":true} when live mode is configured
curl -fsS "https://cadencia-ai.ronaldo-jesus-alvarez.workers.dev/api/routine"

# One streamed live goal run: every stage, then the result (use today's date)
W=https://cadencia-ai.ronaldo-jesus-alvarez.workers.dev
curl -sN -X POST "$W/api/routine" -H "origin: $W" -H 'content-type: application/json' \
  -H 'accept: text/event-stream' \
  -d '{"mode":"live","kind":"goal","input":{"text":"Learn guitar chords by December, Tuesday and Thursday evenings","language":"en","today":"YYYY-MM-DD"}}'
```

A live goal run makes two or three model calls and settles at a few tenths of a
cent; it counts toward the caller's five live runs a day.

---

## 7. Turning live AI off

The kill switch is a row in D1, so it takes effect on the next request with no
deploy:

```bash
# Pause live AI (the demo keeps working; visitors see that live AI is paused)
npx wrangler d1 execute cadencia_beta --remote --command \
  "UPDATE app_settings SET value = '0', updated_at = datetime('now') WHERE key = 'live_enabled'"

# Resume
npx wrangler d1 execute cadencia_beta --remote --command \
  "UPDATE app_settings SET value = '1', updated_at = datetime('now') WHERE key = 'live_enabled'"
```

Setting `CADENCIA_ENABLE_LIVE` to anything but `"true"` in `wrangler.jsonc` and
deploying also turns live AI off; a one-off `wrangler deploy --var` override does
not last past the next normal deploy.

To stop the backend itself:

```bash
gcloud run services update cadencia-intents --region us-central1 --max-instances 0
```

---

## 8. Spend caps and request limits

### Dollar caps

Every live run reserves its worst case before any model call, priced from the
service's prompt byte ceilings (at most one token per byte, plus 64 template
tokens) and output caps, with two provider attempts per call
(`GOAL_BOUNDS` and `REPLAN_BOUNDS` in `lib/server/spend.ts`, which a test checks
against the service's constants):

| Run | Calls | Worst case |
|---|---|---|
| Goal plan | one reading and up to two drafts | 23,584 micro-USD ($0.0236) |
| Replan after missed sessions | one pick | 1,952 micro-USD ($0.0020) |

The reservation is written only if the day's and the month's committed spend plus
that amount stay within the caps, in one statement, so concurrent requests cannot
overshoot. When the run ends, however it ends, the row is settled once from the
tokens every call reported; an earlier failed attempt is charged at its worst
case, and a call with unknown usage is charged in full.

| Setting (`app_settings`) | Default | Meaning |
|---|---|---|
| `live_enabled` | `1` | Kill switch (§7) |
| `daily_cap_microusd` | `500000` | $0.50 per UTC day |
| `monthly_cap_microusd` | `5000000` | $5.00 per UTC month |

Prices come from OpenAI's pricing page for GPT-6 Luna (standard, read
2026-09-24). Luna runs with reasoning off, so no hidden reasoning tokens are
billed. When a cap is reached, live requests
stop before the model is called and the page says why; the demo keeps working.

```bash
# Spend so far this month
npx wrangler d1 execute cadencia_beta --remote --command \
  "SELECT day, COUNT(*) AS plans, SUM(CASE status WHEN 'settled' THEN actual_microusd ELSE reserved_microusd END) AS microusd FROM spend_ledger WHERE month = strftime('%Y-%m','now') GROUP BY day"

# Change the daily cap to $1.00
npx wrangler d1 execute cadencia_beta --remote --command \
  "UPDATE app_settings SET value = '1000000', updated_at = datetime('now') WHERE key = 'daily_cap_microusd'"
```

The Cloud Run service keeps a second, per-instance fence:
`CADENCIA_SERVICE_DAILY_ATTEMPT_CAP` provider attempts per UTC day (default 400),
so a leaked service token cannot spend without limit. It resets when the
instance restarts; the D1 ledger remains the real budget.

### Request limits

A live run on `/api/routine` also reserves a visitor slot in one D1 batch:

| Control | Default | Source |
|---|---|---|
| Per-visitor rate | 2 per minute | `public_limits_config` |
| Per-visitor daily quota | 5 | `public_limits_config` |
| Global daily cap | 50 | `public_limits_config` |
| Global in flight | 10 | `public_limits_config` |
| Per-visitor in flight | 1 | unique index on `public_concurrency` |
| Lease for a goal run | 180 s | `GOAL_LEASE_SEC` in `lib/server/goal-run.ts` |
| Request body | 128 KiB, room for 2,000 imported busy times | `MAX_BODY_BYTES` in `lib/server/http.ts` |

Goal runs and replans share the quota, and failed runs still count against it.
Quotas reset at 00:00 UTC.

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
- **2026-09-24**: the beta loop and Reviewer Replay were removed (with the
  unapplied `0005`); planning steps stream to the page; dollar caps and the D1
  kill switch arrive with migration `0005_spend_controls`. The weekly-routine flow
  and `/v1/intents` were retired for the goal planner (read-goal, draft); calendar
  import and replanning after missed sessions (`/v1/replan`) followed. Cloud Run
  moved through revisions 00003 to 00007, and the Worker was redeployed after each
  phase from `main`. Revision 00008 changed only `DEEPSEEK_MODEL`, from the
  retired name `deepseek-v4-flash` to `deepseek-flash`, the name the evaluation
  uses; a live goal run afterwards logged `deepseek-flash`.
