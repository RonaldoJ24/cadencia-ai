# Python intent service

Cadencia keeps one repository and two independently deployable server components.
The existing Next.js-compatible Vinext frontend runs the backend-for-frontend
`/api/routine`. It sends only `{ "request": "…" }` to Python's `/v1/intents` with
an internal bearer token. Python calls DeepSeek and returns a validated `Intent`
plus the strict internal boolean `scope_refused`. TypeScript validates both before
`buildPlan` computes the schedule. Python
does not receive or calculate dates, durations, selected days, or weekly limits.
The browser's deterministic demo does not need either server or a provider call.

## Contracts and budgets

`GET /healthz` is public and reveals no credentials or configuration. It is a
liveness check, not a paid provider probe. The intent endpoint uses constant-time
token comparison against `CADENCIA_SERVICE_TOKEN`. Missing configuration fails
closed. Success preserves the existing `Intent` fields and adds the service-only
`scope_refused` boolean plus metadata: opaque request ID, prompt version, model, elapsed milliseconds, and
attempt count. The provider result keeps the configured alias as
`requested_model` and records optional `observed_model` and `system_fingerprint`
separately after bounded metadata validation. Browser responses retain the
existing `{ plan }` contract.

Requests are strict JSON objects, with no unknown fields, nonblank text and at
most 2,000 UTF-16 code units to match TypeScript's length limits. Python rejects
control characters and limits the HTTP body to 32 KiB. Model output has strict
types, no unknown fields, bounded text and 1–12 steps. The provider envelope is
bounded to 32 KiB while reading; incomplete, malformed, empty, and invalid-schema
responses fail safely. The model cannot call tools or execute code.

The Python provider operation has a total 20-second deadline and at most two
attempts. Only a 429 or provider 5xx may trigger the second attempt; timeouts,
network failures and invalid content are not retried. The frontend has its own
25-second deadline and bounded response read. It does not follow redirects with
the internal token. HTTPS is required outside loopback development.

The live evaluation runner requires a positive `--max-provider-attempts` value and
reserves one shared budget immediately before each provider request. Retries use
the same budget; exhaustion returns a bounded failure before another request.

The prompt is versioned as `cadencia-intent-v1`. DeepSeek's existing JSON mode,
disabled thinking, temperature 0.2, 800-token output cap, and non-streaming
request remain explicit. JSON mode still needs local validation, including
truncation checks. See the official [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/).

The scope guard preserves the existing medical/exercise/financial/legal exclusion.
A matched request receives the same safe out-of-scope intent without calling
DeepSeek. The Python guard allows `dosis`/`dosage` only for literary or linguistic
analysis that explicitly excludes health advice, and `abogado`/`lawyer` only for
fiction or creative writing about characters, scenes, dialogue, or narrative.
Other restricted matches still refuse. A direct request cue and an unambiguous
medical or legal action anywhere in one request override a literary or fiction
wrapper. Python is authoritative for provider-bound scope decisions. The demo guard
in `lib/routine.ts` mirrors the bounded direct signals and documented contextual
cases; `deepseek` uses only the validated `scope_refused` boolean and never infers
scope from `Intent` text. This is a limited guard, not a general content-safety or
end-to-end semantic guarantee.

## Privacy and debugging

Application JSON logs go to stdout. The allowlist is event, request ID, timestamp,
prompt version, model, latency, attempts, status category, outcome, schema validity,
and provider token usage only when returned. No raw prompt, raw response, bearer
header, key, stack trace or configuration dump belongs in a log or error response.
Access logging is disabled in the supplied Uvicorn commands and container;
Uvicorn diagnostics are restricted to critical severity.

Use the request ID to find metadata, then create a synthetic or explicitly redacted
reproducer. Never recover private prompts from a storage system: none is built.
The [evaluation guide](../service/evals/README.md) documents the complete
failure-to-regression loop and how to record before/after evidence. A development
fixture is not a production incident. Cloud Run request logs and a hosting
platform's own telemetry are separate; configure access and retention before beta
usage, and keep sensitive data out of URLs as well as request bodies.

## Local container

From the repository root, after installing Docker:

```bash
docker build -t cadencia-intents:local service
docker run --rm -p 8080:8080 \
  -e DEEPSEEK_API_KEY -e DEEPSEEK_MODEL -e CADENCIA_SERVICE_TOKEN \
  -e PORT=8080 cadencia-intents:local
```

The `-e NAME` form passes already injected server environment variables without
placing their values in the command. Never bake secrets into an image or use the
repository root as the build context. The service image installs the locked
runtime dependencies, runs as a non-root user, and listens on `0.0.0.0:$PORT`.
The base image tag receives patch updates; rebuild and validate before use.
Locked dependencies do not imply a byte-for-byte reproducible base operating system.

## Cloud Run preparation — commands not executed

No cloud mutation, image push, purchase, or deployment is authorized by this
implementation task. The following is a reviewable runbook for a later authorized
deployment. `gcloud` and Docker must be installed, and an owner must supply an
approved billing-enabled project, region, repository name, service name, runtime
service account, model, and Secret Manager resource/version names. Values below
are placeholders, not discovered resources. Apply only to a new dedicated service;
review existing policies before adapting commands to an existing service.

The container must include `linux/amd64`, bind to all interfaces, and respect
`PORT`; Cloud Run terminates TLS. See the official [container runtime contract](https://docs.cloud.google.com/run/docs/container-contract).
Use [Secret Manager bindings](https://docs.cloud.google.com/run/docs/configuring/services/secrets)
with explicit secret versions. Grant the runtime account secret accessor on only
the two required secrets, not across the whole project.

In a shell, replace all placeholders first (none of these are secret values):

```bash
export CADENCIA_GCP_PROJECT='<approved-project-id>'
export CADENCIA_GCP_REGION='<approved-region>'
export CADENCIA_ARTIFACT_REPOSITORY='<approved-container-repository>'
export CADENCIA_RUN_SERVICE='<approved-service-name>'
export CADENCIA_RUNTIME_ACCOUNT='<approved-service-account-name>'
export CADENCIA_IMAGE_TAG='<reviewed-code-revision>'
export CADENCIA_KEY_SECRET='<deepseek-secret-name>'
export CADENCIA_KEY_VERSION='<numeric-secret-version>'
export CADENCIA_TOKEN_SECRET='<internal-token-secret-name>'
export CADENCIA_TOKEN_VERSION='<numeric-secret-version>'
export CADENCIA_DEPLOY_MODEL='<approved-deepseek-model>'
export CADENCIA_RUNTIME_EMAIL="${CADENCIA_RUNTIME_ACCOUNT}@${CADENCIA_GCP_PROJECT}.iam.gserviceaccount.com"
export CADENCIA_IMAGE="${CADENCIA_GCP_REGION}-docker.pkg.dev/${CADENCIA_GCP_PROJECT}/${CADENCIA_ARTIFACT_REPOSITORY}/${CADENCIA_RUN_SERVICE}:${CADENCIA_IMAGE_TAG}"
```

After explicit authorization, create only resources that do not already exist:

```bash
gcloud auth login
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project "$CADENCIA_GCP_PROJECT"
gcloud artifacts repositories create "$CADENCIA_ARTIFACT_REPOSITORY" --repository-format docker --location "$CADENCIA_GCP_REGION" --project "$CADENCIA_GCP_PROJECT"
gcloud iam service-accounts create "$CADENCIA_RUNTIME_ACCOUNT" --project "$CADENCIA_GCP_PROJECT"
```

Have the owner provision the provider key and a high-entropy shared token through
an approved secure input method. For example, with two existing mode-0600
secret files outside the repository (no trailing newline), these commands create
new secrets without putting their values in shell history or command arguments:

```bash
export CADENCIA_KEY_FILE='<absolute-path-to-approved-key-file>'
export CADENCIA_TOKEN_FILE='<absolute-path-to-approved-token-file>'
gcloud secrets create "$CADENCIA_KEY_SECRET" --data-file "$CADENCIA_KEY_FILE" --replication-policy automatic --project "$CADENCIA_GCP_PROJECT"
gcloud secrets create "$CADENCIA_TOKEN_SECRET" --data-file "$CADENCIA_TOKEN_FILE" --replication-policy automatic --project "$CADENCIA_GCP_PROJECT"
```

For existing secrets, use `gcloud secrets versions add` with the same `--data-file`
and project flags instead; set the numeric version variables from the actual
creation result. Follow the owner's policy for destroying temporary secret files.
Never print their contents or copy them into reports, chat, images, or this
repository. Then grant access:

```bash
gcloud secrets add-iam-policy-binding "$CADENCIA_KEY_SECRET" --member "serviceAccount:${CADENCIA_RUNTIME_EMAIL}" --role roles/secretmanager.secretAccessor --project "$CADENCIA_GCP_PROJECT"
gcloud secrets add-iam-policy-binding "$CADENCIA_TOKEN_SECRET" --member "serviceAccount:${CADENCIA_RUNTIME_EMAIL}" --role roles/secretmanager.secretAccessor --project "$CADENCIA_GCP_PROJECT"
gcloud auth configure-docker "${CADENCIA_GCP_REGION}-docker.pkg.dev"
docker buildx build --platform linux/amd64 --tag "$CADENCIA_IMAGE" --push service
```

Authentication decision: the current frontend uses an application bearer token,
not a Google identity token. To reach it from the existing Cloudflare frontend,
this runbook exposes the Cloud Run transport while the app authenticates every
intent request; `/healthz` stays public. This exposes an internet-reachable service
and requires explicit deployment approval. It is **not** a private IAM service.
If organizational policy requires Cloud Run IAM, stop and add an approved identity
flow before deployment; the shared token alone cannot satisfy Google IAM.
Google documents the distinction in [Cloud Run access control](https://docs.cloud.google.com/run/docs/securing/managing-access).

After approving that access model:

```bash
gcloud run deploy "$CADENCIA_RUN_SERVICE" \
  --project "$CADENCIA_GCP_PROJECT" --region "$CADENCIA_GCP_REGION" \
  --image "$CADENCIA_IMAGE" --service-account "$CADENCIA_RUNTIME_EMAIL" \
  --port 8080 --timeout 30s --concurrency 8 --min-instances 0 --max-instances 1 \
  --cpu 1 --memory 256Mi --ingress all --no-invoker-iam-check \
  --set-env-vars "DEEPSEEK_MODEL=${CADENCIA_DEPLOY_MODEL}" \
  --set-secrets "DEEPSEEK_API_KEY=${CADENCIA_KEY_SECRET}:${CADENCIA_KEY_VERSION},CADENCIA_SERVICE_TOKEN=${CADENCIA_TOKEN_SECRET}:${CADENCIA_TOKEN_VERSION}"
gcloud run services describe "$CADENCIA_RUN_SERVICE" --project "$CADENCIA_GCP_PROJECT" --region "$CADENCIA_GCP_REGION" --format 'value(status.url)'
```

These initial resource limits are conservative configuration choices, not measured
capacity or a guaranteed spend cap. Verify billing alerts and provider limits before
enabling paid calls. The deployer's access requirements and container deployment
process are described in [Deploy container images](https://docs.cloud.google.com/run/docs/deploying).

Configure the returned HTTPS base URL as `CADENCIA_INTENT_SERVICE_URL`, the same
token as the frontend server's secret `CADENCIA_SERVICE_TOKEN`, and
`CADENCIA_ENABLE_LIVE=true` only in an approved owner-only frontend runtime. No
DeepSeek key is needed there. For this Sites-managed frontend, runtime settings
and publishing belong to its existing hosting workflow; no hosting changes were
made here. Verify health, unauthorized rejection, and an explicitly authorized
synthetic intent call through the frontend. Save revision, timestamp, safe
request ID and result metadata; do not publish secret values or model text.

## Evidence still needed

Passing local tests proves specific code paths, not deployed operation, external
users, model accuracy, production scale, or cost reduction. First run a real
opt-in baseline and review every safety-critical case; safety must pass 100%.
Set any further thresholds only from observed baseline results. Then deploy with
approval, recruit consenting external beta users, and document at least one real
failure converted into a synthetic regression with before/after evidence. Only
then reassess defensible résumé language. No résumé bullet is part of this change.
