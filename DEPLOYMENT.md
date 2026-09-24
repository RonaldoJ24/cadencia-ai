# Cadencia Deployment Guide — Owner-Only Pilot

This guide documents the deployment procedures for Cadencia's owner-only pilot across two independent, server-capable runtime environments:

1. **Frontend (BFF & UI)**: Cloudflare Worker running Vinext/Next.js on its generated `*.workers.dev` subdomain, protected by Cloudflare Access.
2. **Backend (Intent Service)**: Google Cloud Run container service running FastAPI/Uvicorn, proxying validated requests to DeepSeek.

---

## 1. Architecture & Security Boundaries

```
[ Browser ]
    │
    ▼ (HTTPS)
[ Cloudflare Access ] (Zero Trust OTP / Google Workspace allowlist for owner)
    │
    ▼
[ Cloudflare Worker: cadencia-ai ] (*.workers.dev)
    ├─ Serves static assets & RSC
    ├─ Handles /api/routine (BFF)
    │    • CADENCIA_ENABLE_LIVE ("true" | "false", kill switch)
    │    • CADENCIA_INTENT_SERVICE_URL (https://<cloud-run-service>.run.app)
    │    • CADENCIA_SERVICE_TOKEN (Cloudflare Worker Secret)
    │
    ▼ (HTTPS, Authorization: Bearer <CADENCIA_SERVICE_TOKEN>)
[ Google Cloud Run: cadencia-intents ]
    ├─ Runs as non-root user 'cadencia' (uid 10001, gid 10001)
    ├─ Listens on 0.0.0.0:$PORT (default 8080)
    ├─ GET /livez (public liveness; /healthz remains a local alias)
    ├─ POST /v1/intents (constant-time token check)
    │    • CADENCIA_SERVICE_TOKEN (GCP Secret Manager)
    │    • DEEPSEEK_API_KEY (GCP Secret Manager)
    │    • DEEPSEEK_MODEL (env var, optional alias)
    │
    ▼ (HTTPS, Bearer <DEEPSEEK_API_KEY>)
[ DeepSeek API ] (https://api.deepseek.com/chat/completions)
```

### Key Security & Boundary Rules
- **No Client Secrets**: Browser code never receives `CADENCIA_SERVICE_TOKEN`, `DEEPSEEK_API_KEY`, or provider keys.
- **Fail-Closed**: If `CADENCIA_ENABLE_LIVE` is not `"true"`, or if the service URL or token is missing, `/api/routine` falls back or returns 503 without invoking external endpoints.
- **Deterministic Demo**: The browser's demo mode executes entirely client-side without calling either server or AI provider.
- **No Tracked Secrets**: All secrets reside strictly in platform secret stores (Cloudflare Worker Secrets, GCP Secret Manager).
- **Private Routes**: `workers_dev` is `true` and `preview_urls` is `false` in `wrangler.jsonc`. The exact path `/api/routine` is served through a public Access bypass with strict D1 quotas; every other `/api/*` route stays behind the owner-only Access policy and Worker-side JWT verification.

---

## 2. Environment Variables & Secret Inventory

| Scope | Name | Storage | Description |
|---|---|---|---|
| Worker Runtime | `CADENCIA_ENABLE_LIVE` | `wrangler.jsonc` / Worker var | Kill switch: `"false"` (default) or `"true"` |
| Worker Runtime | `CADENCIA_INTENT_SERVICE_URL` | `wrangler.jsonc` / Worker var | Base URL of Cloud Run backend (e.g. `https://<service>.run.app`) |
| Worker Secret | `CADENCIA_SERVICE_TOKEN` | Cloudflare Worker Secret | Shared high-entropy bearer token sent to Cloud Run |
| Worker Runtime | `CADENCIA_ACCESS_TEAM_DOMAIN` | `wrangler.jsonc` / Worker var | Access team domain, e.g. `https://<team>.cloudflareaccess.com`; empty fails closed |
| Worker Runtime | `CADENCIA_ACCESS_AUD` | `wrangler.jsonc` / Worker var | Access application AUD tag; empty fails closed |
| Cloud Run Secret | `CADENCIA_SERVICE_TOKEN` | GCP Secret Manager | Shared token verified against incoming Bearer header |
| Cloud Run Secret | `DEEPSEEK_API_KEY` | GCP Secret Manager | API key for DeepSeek API completions |
| Cloud Run Env | `DEEPSEEK_MODEL` | Cloud Run Environment Variable | Optional model alias (default `deepseek-v4-flash`) |
| Cloud Run Env | `PORT` | Cloud Run Environment Variable | Port assigned by Cloud Run runtime (default `8080`) |

---

## 3. Step 1: Deploy Python Intent Service to Google Cloud Run

### 3.1 Operator Shell Configuration
Replace all placeholders before running:

```bash
export CADENCIA_GCP_PROJECT='<approved-project-id>'
export CADENCIA_GCP_REGION='<approved-region>' # e.g. us-central1
export CADENCIA_ARTIFACT_REPOSITORY='<approved-artifact-repo>' # e.g. cadencia
export CADENCIA_RUN_SERVICE='<approved-service-name>' # e.g. cadencia-intents
export CADENCIA_RUNTIME_ACCOUNT='<approved-runtime-sa>' # e.g. cadencia-run-sa
export CADENCIA_IMAGE_TAG='<git-commit-sha>'
export CADENCIA_KEY_SECRET='<deepseek-key-secret-name>' # e.g. deepseek-api-key
export CADENCIA_TOKEN_SECRET='<service-token-secret-name>' # e.g. cadencia-service-token
export CADENCIA_DEPLOY_MODEL='deepseek-chat' # or approved alias

export CADENCIA_RUNTIME_EMAIL="${CADENCIA_RUNTIME_ACCOUNT}@${CADENCIA_GCP_PROJECT}.iam.gserviceaccount.com"
export CADENCIA_IMAGE="${CADENCIA_GCP_REGION}-docker.pkg.dev/${CADENCIA_GCP_PROJECT}/${CADENCIA_ARTIFACT_REPOSITORY}/${CADENCIA_RUN_SERVICE}:${CADENCIA_IMAGE_TAG}"
```

### 3.2 Initialize GCP Resources
```bash
gcloud auth login
gcloud config set project "$CADENCIA_GCP_PROJECT"

# Enable required Google Cloud services
gcloud services enable   run.googleapis.com   artifactregistry.googleapis.com   secretmanager.googleapis.com   cloudbuild.googleapis.com

# Create Artifact Registry repository if not present
gcloud artifacts repositories create "$CADENCIA_ARTIFACT_REPOSITORY"   --repository-format docker   --location "$CADENCIA_GCP_REGION"   --description "Docker repository for Cadencia services" 2>/dev/null || true

# Create dedicated runtime service account
gcloud iam service-accounts create "$CADENCIA_RUNTIME_ACCOUNT"   --display-name "Cadencia Cloud Run Runtime Service Account" 2>/dev/null || true
```

### 3.3 Provision Secrets in Secret Manager
Provide secrets via secure local files outside version control:

```bash
# Create secrets with secure file inputs
gcloud secrets create "$CADENCIA_KEY_SECRET"   --data-file="<path-to-deepseek-api-key-file>"   --replication-policy automatic

gcloud secrets create "$CADENCIA_TOKEN_SECRET"   --data-file="<path-to-service-token-file>"   --replication-policy automatic

# Grant runtime service account access to only these two secrets
gcloud secrets add-iam-policy-binding "$CADENCIA_KEY_SECRET"   --member "serviceAccount:${CADENCIA_RUNTIME_EMAIL}"   --role roles/secretmanager.secretAccessor

gcloud secrets add-iam-policy-binding "$CADENCIA_TOKEN_SECRET"   --member "serviceAccount:${CADENCIA_RUNTIME_EMAIL}"   --role roles/secretmanager.secretAccessor
```

### 3.4 Build & Deploy Container
Option A: Using Google Cloud Build (recommended when local Docker is absent):
```bash
gcloud builds submit service   --config service/cloudbuild.yaml   --substitutions _REGION="$CADENCIA_GCP_REGION",_REPOSITORY="$CADENCIA_ARTIFACT_REPOSITORY",_SERVICE="$CADENCIA_RUN_SERVICE",COMMIT_SHA="$CADENCIA_IMAGE_TAG"
```

Option B: Using local Docker:
```bash
gcloud auth configure-docker "${CADENCIA_GCP_REGION}-docker.pkg.dev"
docker buildx build --platform linux/amd64 -t "$CADENCIA_IMAGE" --push service
```

### 3.5 Deploy Service to Cloud Run
```bash
gcloud run deploy "$CADENCIA_RUN_SERVICE"   --image "$CADENCIA_IMAGE"   --region "$CADENCIA_GCP_REGION"   --service-account "$CADENCIA_RUNTIME_EMAIL"   --port 8080   --cpu 1   --memory 256Mi   --concurrency 8   --min-instances 0   --max-instances 1   --timeout 30s   --ingress all   --no-invoker-iam-check   --set-env-vars "DEEPSEEK_MODEL=${CADENCIA_DEPLOY_MODEL}"   --set-secrets "DEEPSEEK_API_KEY=${CADENCIA_KEY_SECRET}:latest,CADENCIA_SERVICE_TOKEN=${CADENCIA_TOKEN_SECRET}:latest"
```

Retrieve the assigned Cloud Run URL:
```bash
export CLOUD_RUN_URL=$(gcloud run services describe "$CADENCIA_RUN_SERVICE" --region "$CADENCIA_GCP_REGION" --format 'value(status.url)')
echo "Cloud Run URL: $CLOUD_RUN_URL"
```

---

## 4. Step 2: Deploy Frontend to Cloudflare Workers

### 4.1 Pre-flight Validation & Dry Run
Execute the deployment helper script:

```bash
# Runs lint, typecheck, unit tests, Vinext build, and Wrangler dry-run
./scripts/deploy.sh --dry-run
```

### 4.2 Worker Secret Rotation

The checked-in configuration sets `workers_dev: true` with `preview_urls: false`.
The exact path `/api/routine` is intentionally public behind D1 quotas (see §9);
it is not a bootstrap accident. On the first deployment, use a permission-600
secrets file outside the repository containing only
`CADENCIA_SERVICE_TOKEN=<value>`:

```bash
npm run build
npx wrangler deploy --config dist/server/wrangler.json \
  --secrets-file "<path-to-worker-only-secrets-file>"
```

After this succeeds, delete the temporary secrets file. The Worker serves its
`workers.dev` URL with `preview_urls` disabled; `/api/routine` answers the
public bypass while `/api/routines/*` and all private routes require Access.

### 4.3 Worker Secret Rotation
For later rotations, update the shared token interactively (it must match the token stored in Secret Manager):

```bash
# Interactive prompt (does not leak into shell history):
npx wrangler secret put CADENCIA_SERVICE_TOKEN --config wrangler.jsonc
```

---

## 5. Step 3: Configure Cloudflare Access (Owner-Only Protection)

Protect the Worker before enabling live AI. Worker-level Access covers its production
`workers.dev` URL, previews, routes, and any later custom domains.

1. In the Cloudflare dashboard, open **Workers & Pages** -> **cadencia-ai** -> **Access**.
2. Select **Protect this Worker behind Access** and choose **All traffic**.
3. Create an allow policy for only `<owner-email@example.com>` using One-Time PIN or the configured identity provider.
4. Apply Access and verify an unauthenticated browser receives the Access login page.
5. Copy the application's **Application Audience (AUD) Tag** (Zero Trust -> Access -> Applications -> Configure -> Additional settings) and set `CADENCIA_ACCESS_TEAM_DOMAIN` plus `CADENCIA_ACCESS_AUD` on the Worker. The Worker verifies the RS256 `Cf-Access-Jwt-Assertion` signature against the team JWKS endpoint, pins issuer to the team domain and audience to the AUD tag, enforces expiration, and derives identity only from verified `sub`/`email` claims. Missing configuration, missing/expired bearer tokens, or wrong issuer/audience all fail closed with generic 401 responses. Test identities (`x-test-user-*`) work only when `CADENCIA_ALLOW_TEST_IDENTITY=true`, which stays `false` in deployed configuration.

Any browser navigating to `https://cadencia-ai.<your-subdomain>.workers.dev` will now require Cloudflare Access authentication before requests reach the Worker.

### 5.1 Configure Live Service Routing
After Cloud Run and Access are verified, deploy the already-built Worker artifact with
the backend URL and live kill switch enabled (`workers_dev` is already `true` in
`wrangler.jsonc`; keep `preview_urls` `false`):

```bash
# workers_dev is already true; keep preview_urls false.
npm run build
npx wrangler deploy --config dist/server/wrangler.json \
  --var CADENCIA_INTENT_SERVICE_URL:"$CLOUD_RUN_URL" \
  --var CADENCIA_ENABLE_LIVE:"true"
```

---

## 6. Verification & Health Checks

Execute these commands to verify every layer of the deployment without exposing sensitive keys:

### 6.1 Backend Health Check (Liveness)
```bash
curl -fsS "${CLOUD_RUN_URL}/livez"
# Expected response: {"status":"ok"}
```

### 6.2 Backend Unauthorized Rejection
Verify that requests without valid bearer authorization are rejected:
```bash
curl -i -X POST "${CLOUD_RUN_URL}/v1/intents"   -H "Content-Type: application/json"   -d '{"request":"test"}'
# Expected response: HTTP 401 Unauthorized
```

### 6.3 Backend Authorized Synthetic Check (Out-of-Scope)
Test an out-of-scope medical query using the service token. This exercises auth and scope guard logic without calling DeepSeek:
```bash
curl -i -X POST "${CLOUD_RUN_URL}/v1/intents"   -H "Authorization: Bearer <CADENCIA_SERVICE_TOKEN>"   -H "Content-Type: application/json"   -d '{"request":"receta medicina dolor", "language":"es"}'
# Expected response: HTTP 200 with {"scope_refused": true, ...}
```

### 6.4 Frontend Readiness Check
```bash
curl -fsS "https://cadencia-ai.<subdomain>.workers.dev/api/routine"
# Expected when CADENCIA_ENABLE_LIVE="true" and configured: {"liveAvailable":true}
# Expected when CADENCIA_ENABLE_LIVE="false": {"liveAvailable":false}
```

### 6.5 Frontend Deterministic Demo Mode
Verify demo mode works without calling backend AI:
```bash
curl -i -X POST "https://cadencia-ai.<subdomain>.workers.dev/api/routine"   -H "Content-Type: application/json"   -d '{"input":{"request":"learn piano","weeklyMinutes":60,"sessionMinutes":30,"days":["Mon","Wed"],"language":"en"},"mode":"demo"}'
# Expected response: HTTP 200 with {"plan": ...}
```

---

## 7. Kill Switch & Emergency Procedures

### 7.1 Immediate Frontend AI Kill Switch
To immediately cut off all calls to the backend and DeepSeek:

```bash
npx wrangler deploy --config dist/server/wrangler.json \
  --var CADENCIA_ENABLE_LIVE:"false" \
  --var CADENCIA_INTENT_SERVICE_URL:""
```

**Impact**:
- Calls to `/api/routine` with `mode="deepseek"` immediately return HTTP 503 (`notConfigured`).
- Demo mode remains 100% operational in the browser.
- No network requests are made from the Worker to Cloud Run.

### 7.2 Backend Traffic Containment
To disable Cloud Run execution:

```bash
# Scale service to 0 instances
gcloud run services update "$CADENCIA_RUN_SERVICE"   --region "$CADENCIA_GCP_REGION"   --min-instances 0   --max-instances 0

# Or disable the DeepSeek API key version in Secret Manager:
gcloud secrets versions disable 1 --secret="$CADENCIA_KEY_SECRET"
```

---

## 8. Rollback Procedures

### 8.1 Cloudflare Worker Rollback
To roll back the Worker to the previous deployment:

```bash
# Immediate rollback to the previous active version:
npx wrangler rollback

# Or list deployment versions and select an exact version:
npx wrangler versions list
npx wrangler rollback <version-id>
```

### 8.2 Google Cloud Run Rollback
To redirect 100% of Cloud Run traffic back to a prior revision:

```bash
# List available revisions:
gcloud run revisions list   --service "$CADENCIA_RUN_SERVICE"   --region "$CADENCIA_GCP_REGION"

# Route traffic to the previous healthy revision:
gcloud run services update-traffic "$CADENCIA_RUN_SERVICE"   --region "$CADENCIA_GCP_REGION"   --to-revisions "<prior-revision-name>=100"
```

---

## 9. Public API Abuse Controls & Cloudflare Access Activation

### 9.1 Public Limits & Budget Protection
Public generation on `/api/routine` is guarded by a single unified D1 batch transaction with conditional reservation and upserts:

| Control | Value | Enforcement Mechanism |
|---|---|---|
| Minute Rate Limit | 2 req/min | Atomic conditional insert in `rate_hits` with `Retry-After` |
| Visitor Daily Quota | 5 generations/day | Atomic conditional reservation + `WHERE EXISTS` counter upsert in D1 batch |
| Global Daily Hard Cap | 50 generations/day | Atomic conditional reservation + `WHERE EXISTS` counter upsert in D1 batch |
| Visitor Concurrency | 1 in-flight generation | Unique index on `public_concurrency.ip_hash` |
| Global Concurrency | 10 in-flight generations | Atomic conditional reservation in D1 batch |
| Concurrency Lease | 40 seconds | Auto-reclaimed; covers 25s Worker timeout |
| Quota Reset Time | 00:00:00 UTC | Dynamic `Retry-After` seconds until next UTC midnight |
| Request Body Cap | 32,768 bytes | Bounded `bodyJson`; request text $\le$ 2,000 UTF-16 units |
| Provider Max Tokens | 4,000 (routine) / 800 (intent) | Enforced in DeepSeek payload (`service/provider.py`) |
| Retries & Attempts | 0 Worker retries; max 1 Cloud Run retry | Max 2 provider attempts/gen $\implies$ max 100 provider calls/day |

*Note*: Private beta routes (`/api/routines/*`, `/api/sessions/*`, `/api/quota`, `/api/feedback`, `/api/account`) maintain separate authenticated quotas and remain outside the public budget. No Analytics Engine dataset is configured and no analytics writer ships: the former `BETA_EVENTS` code path was removed rather than left unprovisioned.

### 9.2 Keyed Identity Privacy
Client identity is strictly derived from the Cloudflare edge header `cf-connecting-ip` (never trusting `x-real-ip`). It is transformed into a non-reversible, daily-rotating 256-bit hash via `HMAC-SHA256(CADENCIA_SERVICE_TOKEN, "cadencia_identity:<YYYY-MM-DD>:<IP>")`. Raw IP addresses are never logged or persisted. Cookie clearing does not reset quota. Missing IP rejects with HTTP 400.

### 9.3 Deployment Status & Manual Cloudflare Access Steps
- **Remote D1 Database**: `cadencia_beta` (`1e26d779-9aaf-4785-96c7-ab55d8e8032a`).
- **Applied Migrations**: `0001_beta_loop.sql`, `0002_rate_limits.sql`, `0003_public_limits.sql` applied successfully.
- **Deployed Worker Version**: `efc4a8bb-8e3a-413a-b924-cd4903a292c5`.
- **Remaining Blocker**: Automated API creation was blocked because the local Wrangler OAuth token lacks `Access: Apps and Policies: Edit` permission (HTTP 403 `1010 auth.forbidden`). Public generation on `/api/routine` remains gated behind Access until this manual dashboard step is performed:

> Historical deployment record — unverified. The database ID, worker version,
> and Access application IDs below were recorded during a prior manual
> deployment and have not been re-verified from this working tree. They are
> operational notes, not evidence of current production state, and no
> production-ready claim follows from them.

**Manual Cloudflare Zero Trust Dashboard Instructions**:
1. In Cloudflare Zero Trust Dashboard, go to **Access** -> **Applications**.
2. Retain existing application `Cadencia Worker Access` (id `7b4364fd-41f8-40c9-92c8-a2aac28efa28`) on `cadencia-ai.ronaldo-jesus-alvarez.workers.dev/api/*` (Owner Only).
3. Click **Add an application** -> **Self-hosted**.
4. Set Application Name: `Cadencia Public Routine Bypass`.
5. Set Application Domain: `cadencia-ai.ronaldo-jesus-alvarez.workers.dev`, Path: `api/routine`.
6. Add Policy: Policy name `Public Bypass`, Action **Bypass**, Rule: **Everyone**.
7. Save Application. Cloudflare longest-prefix route matching routes `/api/routine` to the bypass application, while `/api/routines/*` and all private routes remain strictly owner-only.

### 9.4 Schedule Proof (deployed 2026-09-09)
- **Remote migration**: `migrations/0004_schedule_proof.sql` applied to `cadencia_beta` (additive: 4 new tables, verified present). Prior 0001–0003 confirmed applied.
- **Worker versions**: `76966a3d` (initial Schedule Proof) → `809d9488` (Workflow binding wired) → `7b373d0e` (current; Workflow `get()` await fix).
- **Workflow**: `adaptation-workflow` registered on the Worker; two real instances ran end-to-end (derive → wait → settle → Completed), candidate `470e98…` bit-identical to local evidence.
- **Remote journey proof**: POST start (201, Secure/HttpOnly/SameSite, `private, no-store`) → R1 with inputHash `e76e…`/scheduleHash `8ae3…` matching local bytes → PATCH replay (202, R1 unchanged, Tue→Thu move) → PATCH approve (200, committed R2) → GET readback R2. Found and fixed live: route used local-fallback (binding unwired) and `sendEvent` on un-awaited `get()`; both fixed, retested (`notified:true`), regression-tested.
- **Local evidence**: `outputs/validation/schedule-proof/`. Test sandboxes revoked after verification. No production-ready claim beyond what was exercised.

### 9.5 Schedule Proof correction attempt 1 (NOT deployed)
- Local-only follow-up addressing an independent audit. Adds `migrations/0005_schedule_proof_invariants.sql` (one-active partial index, decision table, trace columns).
- Binding release order: apply 0005 BEFORE deploying the accompanying code (the code answers 503 while the schema is absent).
- Production remains `7b373d0e` + 0004 until separately authorized.
