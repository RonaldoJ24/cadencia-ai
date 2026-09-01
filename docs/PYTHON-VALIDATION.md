# Python intent service — local validation snapshot

> Historical initial implementation report. Phase 1 subsequently corrected the
> evaluation-claim blind spot, added a frozen held-out set and review-packet tooling,
> and reran local gates. See [PHASE1-VALIDATION.md](PHASE1-VALIDATION.md). Historical
> measurements remain labeled as such; the exact current working-tree manifest is
> listed at the end of this report.

This file is a local validation snapshot. Semantic quality,
deployment, CI/container validation, users, and production readiness remain
unestablished.

Validated locally on 2026-08-31. This is a local validation snapshot of selected
implementation and deterministic replay checks, not a deployed-service or
real-model evaluation report. Semantic quality, deployment, CI/container
validation, users, and production readiness remain unestablished.

## Delivered work and repository state

Work remains in the existing Cadencia repository on
`feat/python-intent-service`, based on
`045ddf0da86597dbd3f9de08cf15207a186c2465`. These are uncommitted local changes;
no commit, push, history rewrite, deployment, cloud mutation, or paid provider
evaluation was performed. No résumé bullet was written.

The architecture is:

```text
Browser → existing /api/routine → bearer-authenticated Python /v1/intents
                              → DeepSeek → strict Pydantic Intent
        ← TypeScript validateIntent + buildPlan → deterministic schedule
```

Python owns the versioned prompt, provider call, schema validation, scope guard,
the strict internal `scope_refused` decision, retry and timeout bounds, and
operational metadata. TypeScript validates that decision and still owns every
date, selected day, duration, weekly limit, replan, Markdown export, and ICS
operation. Demo generation stays local and independent of Python or credentials.
The old direct TypeScript provider was removed; there is no second scheduler in
the product.

## Commands and actual results

Commands below ran from the repository root. Local versions were Node 26.3.1,
npm 11.16.0, uv 0.11.27, and Python 3.12.13. CI is configured for Node 22 and
Python 3.12; remote GitHub Actions execution has not been verified.

| Command / check | Actual result |
| --- | --- |
| `npm test` | **36 passed**, 0 failed; includes the existing 1,524 deterministic schedule/replan combinations |
| `npm run typecheck` | Passed, exit 0 |
| `npm run lint` | Passed, exit 0 |
| Sandboxed `npm run build` and `npm run build -- --mode test` | Both passed with network and `.env.local` file-data reads denied by macOS Seatbelt |
| `uv run --project service --frozen pytest service` | **85 passed** on the final parent run |
| `uv run --project service --frozen ruff check service` | All checks passed |
| `uv run --project service --frozen python service/evals/run.py --output outputs/evals/fixtures.json` | **60 cases**, 0 failed case IDs, exit 0 |
| `uv run --project service --frozen python service/evals/smoke.py` | Passed over loopback HTTP; 2 mocked provider calls; demo made no provider call |
| Runtime dependency audit commands below | No known vulnerabilities found at audit time |
| `git diff --check` | Passed |
| Workflow YAML parsing | Both workflow files parsed; automatic CI and manual-only live workflow are distinct |
| Existing development server HTTP probes | `/` returned 200; availability returned `liveAvailable: false`; demo POST returned 200 with two sessions and all constraint checks true |

The build explicitly disabled live mode and removed inherited provider/service
variables for that process:

```bash
env -u DEEPSEEK_API_KEY -u DEEPSEEK_MODEL \
  -u CADENCIA_SERVICE_TOKEN -u CADENCIA_INTENT_SERVICE_URL \
  CADENCIA_ENABLE_LIVE=false npm run build
```

The build produced a non-failing Vinext warning that `/` could not be statically
classified. `/api/routine` was recognized as an API route. The existing user-owned
development server was not stopped or replaced. HTTP checks do not constitute a
full browser interaction or accessibility audit.

The optional dependency audit used temporary tooling, not another application
dependency:

```bash
uv export --project service --frozen --no-dev --format requirements-txt \
  --output-file outputs/validation/runtime-requirements.txt --quiet
uvx --from pip-audit pip-audit --disable-pip --no-deps \
  -r outputs/validation/runtime-requirements.txt
```

An earlier dependency selection exposed known Starlette advisories; the compatible
FastAPI/Starlette selection was updated before the final audit and tests. The
final audit is a point-in-time database check, not proof of absence of security
defects. The audit tool also emitted its advisory about hashing requirements;
normal installation uses the frozen uv lockfile with package hashes.

## Deterministic evaluation results

Report: `outputs/evals/fixtures.json` (ignored local artifact).
Execution timestamp: **2026-08-31T17:13:23.367520+00:00**.
Prompt: **cadencia-intent-v1**. Requested model: **deepseek-v4-flash**.
Mode: **deterministic**. No DeepSeek request was made.

The report names the configured alias as `requested_model`. Provider observations
use separate `observed_model_counts` and `system_fingerprint_counts`; deterministic
fixtures have no provider metadata, so both counters are `{}`.

The corpus has 40 expected successes across learning, creative, and general goals,
8 scope refusals, 5 invalid inputs, and 7 provider failures. It includes ambiguity,
short and long input, spelling variation, prompt/JSON override attempts, code/tool
instructions, and medical, exercise, financial, and legal exclusions. Separate
synthetic responses traverse the real FastAPI and provider parsing code through
MockTransport; results are not copied from expected labels.

| Measurement | Observed result | Interpretation |
| --- | --- | --- |
| Cases completed / matching expected result | 60 / 60 | All expected successes and failures behaved as labeled |
| Failed case IDs | `[]` | No replay regression |
| Provider completion | 42 / 47 = 89.36% | Cases with a simulated provider attempt; intentional faults reduce completion |
| Schema valid | 40 / 42 = 95.24% | Completed responses include deliberately malformed and schema-invalid fixtures |
| Expected-domain agreement | 40 / 40 | Agreement with synthetic response labels, **not model accuracy** |
| Safety-critical pass | 8 / 8 = 100% | Labeled scope cases only; required threshold remains 100% |
| P50 / P95 elapsed per case | 0.29 ms / 0.51 ms | Local in-process replay timing, **not service or provider latency** |
| Usage source | `synthetic_fixture` | Simulated counters, not paid token usage |
| Usage coverage | 43 / 47 cases = 91.49% | Some fixtures deliberately omit usage fields |
| Prompt / completion counters | 4,240 / 820 | Sum only fields present in fixtures |
| Total-token counter / average | 4,880 / 119.02 | 41 cases supplied `total_tokens`; differing coverage means totals need not sum across fields |
| Estimated cost | `null` | No explicit pricing configured; no real cost measurement |

Provider completion and schema rates below 100% are expected in a fault-injection
corpus and do not indicate failed tests. Conversely, 100% domain agreement cannot
establish language understanding: fixture responses are predetermined.

Live mode has **not** run. It would keep the corpus total visible, exclude the
7 synthetic provider malfunction cases, and attempt 53 service cases; ordinary
in-scope cases can make paid provider calls. Runner tests also exercise a
`live-mocked` internal test path, explicitly labeled synthetic, which is not a live
baseline. Live runs require a positive shared `--max-provider-attempts` value that
includes retries; reports record the configured maximum, actual requests used, and
whether exhaustion prevented another request. Domain thresholds must follow a
genuine baseline; safety-critical success must remain 100%. Do not delete difficult
cases or weaken their labels.

The cost calculator requires explicit prices and complete prompt/completion
counters for each included case. Missing usage prevents complete cost attribution.
The current provider usage allowlist does not preserve a cache-hit breakdown, so
uncached input pricing is the conservative estimate; reports are not invoices.

## Integration and privacy evidence

The HTTP smoke starts Uvicorn on an ephemeral loopback port, imports the actual
Next.js route in Node, and makes real HTTP calls to Python with a fake upstream
transport. It validates a successful intent and deterministic plan, a malformed
provider response converted to a generic 502, and demo generation without another
provider call. It checks fixture credentials and upstream error text do not reach
the browser response. It does not test a deployed Cloudflare-to-Cloud-Run hop.

Service and route tests cover authentication, strict contracts, empty/oversized/
malformed/control-character input, duplicate JSON keys, output validation,
truncation, timeouts, slow streaming, bounded 429/5xx retries, and error/log
redaction. Additional review exercised the overall deadline across a retry and
prevented credentials embedded within a configured model label from reaching logs.

Controls implemented:

- Constant-time bearer comparison; missing credentials fail closed.
- Python input body limit 32 KiB and five-second body deadline; request text limit
  2,000 UTF-16 units to preserve TypeScript parity; strict unknown-field rejection.
- Provider response limit 32 KiB; compressed responses rejected; 10-second
  per-attempt and 20-second total deadlines; at most one retry, only for 429/5xx.
- Independent frontend 25-second service deadline and response limit; HTTPS
  outside loopback; redirects cannot forward the service token.
- Strict Pydantic Intent plus TypeScript `validateIntent` before `buildPlan`.
- Versioned prompt, untrusted user content, no model tools or executable actions.
- Generic errors with opaque request IDs; browser body remains `{ plan }` or a
  generic error. Service/model metadata is not copied into browser response bodies.
- Structured stdout logs contain only allowlisted operational metadata, including
  usage when actually supplied. No raw prompts, provider bodies, authorization
  headers, credentials, or stack traces. Supplied Uvicorn commands disable access
  logs and restrict server diagnostics.
- Non-root container, frozen runtime dependencies, narrow service-only build
  context, and no image-baked secrets.

`.env.local` remains ignored and untracked according to Git metadata. Its filesystem
metadata and contents were not inspected or changed. The versioned root-only guard
treats a direct child named `.env` or beginning with the literal `.env.` prefix as
absent and blocks direct access. Lookalikes such as `.environment`, `.envoy`, and
`.envrc`, plus nested dotenv paths, remain outside its scope. The normal production
build and `--mode test` both passed while macOS Seatbelt denied file-data reads for
`.env.local` and all network access. Changed-file
scans found no private-key material or provider-key patterns. Generated reports, logs,
virtualenvs, and caches remain ignored. These scans do not certify every possible
secret pattern.

## Development failure converted to a regression

Review found two contextual parity defects: Python refused a literary analysis
containing `dosis` and fiction containing `abogado`. Python now permits those terms
only under the documented literary/health-exclusion or fiction/creative-writing
conditions; other restricted matches continue to refuse. The demo guard in
`lib/routine.ts` mirrors those bounded cases, while `deepseek` uses the validated
Python `scope_refused` boolean and never infers scope from `Intent` text. This
check does not establish semantic safety or end-to-end quality.

This is a **development-observed** regression, not a production incident. The
prompt version stayed `cadencia-intent-v1`; the fix changes code. The final parent
replays are `phase1-root-contract-dev-009` at
`2026-09-01T02:36:31.724684+00:00` and `phase1-root-contract-heldout-009` at
`2026-09-01T02:36:37.227308+00:00`. Both record source fingerprint
`31455bfae2b1936e8313fdd523abca21fae43462090c7b460c1d1ad2b6b7b642`;
the revealed held-out result is regression-only.

The [evaluation guide](../service/evals/README.md) documents the request-ID-led,
privacy-safe eight-step loop for a future real failure. No private prompt storage
was introduced.

## Skipped validation and current limits

- **Container build/run:** Docker is not installed. The Uvicorn startup path and
  health endpoint work locally, but the image itself is unverified. CI includes
  `docker build`; that workflow has not run remotely.
- **Cloud deployment:** neither authorized nor performed; `gcloud` is unavailable.
  No project, billing, region, service identity, secrets, URL, or deployment status
  was invented.
- **Real provider evaluation:** not authorized or run. No live latency, token
  consumption, cost, or model accuracy was measured.
- **Public paid generation:** not ready. The shared token authenticates the
  server-to-server call, not an end user. Keep the frontend local or owner-only
  until authentication/access restriction, quotas, and abuse controls are approved.
- **Content safety:** the preserved lexical guard can miss requests or reject
  benign wording. The evaluator's output-marker checks are narrow heuristics,
  not comprehensive semantic safety evaluation.
- **Operational evidence:** no load test, production scale, external users,
  production failure, cost reduction, or representative accuracy is established.
  Fixture evaluation does not represent production quality. Platform request
  logs require separate access and retention decisions.

## Deployment requirements and next action

The [Cloud Run runbook](PYTHON-SERVICE.md) provides exact commands with explicit
placeholders, official guidance, secret provisioning, a dedicated runtime account,
an amd64 image build, and post-deployment checks. Execution requires approval,
Docker/gcloud, an approved billing-enabled project and region, resource names,
Secret Manager versions, and secure provider/service credentials. The current
frontend uses an application bearer token rather than Google IAM identity;
approve the documented public-transport/app-auth model or implement an approved
IAM identity flow before deployment. Frontend runtime configuration and publishing
must use its existing hosting workflow.

The next separately authorized action is a capped real baseline over the committed
synthetic corpus with credentials supplied through a secret manager or CI secrets:

```bash
uv run --project service --frozen python service/evals/run.py --live \
  --max-provider-attempts 64 \
  --output outputs/evals/live.json
```

Archive the report with the reviewed code revision, inspect every failure, and
require 100% safety-critical success before beta access. Pricing remains unset
unless the owner explicitly supplies current rates. This earns actual evidence
of the uncertain model boundary. Then complete the container check and authorized
owner-only deployment, recruit consenting external beta users, and document a
real failure converted into a redacted/synthetic regression with before/after
evidence. Deployment, a real live evaluation, external beta usage, and that real
failure cycle are all still required before writing the requested résumé bullet.

## Exact changed files

The exact visible manifest is **37 files: 12 modified, 24 added, 1 removed**.
It was generated from `git status --porcelain=v1 --untracked-files=all`.
Links are relative to this report.

| Status | File | Purpose |
| --- | --- | --- |
| Modified | [`.env.example`](../.env.example) | Safe server variable names/defaults |
| Modified | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Python checks, replay artifact, HTTP smoke, container build |
| Added | [`.github/workflows/live-eval.yml`](../.github/workflows/live-eval.yml) | Manual paid-evaluation opt-in and report artifact |
| Modified | [`.gitignore`](../.gitignore) | Python virtualenv/cache exclusions |
| Modified | [`README.md`](../README.md) | Architecture, startup, verification, evidence limits |
| Modified | [`app/api/routine/route.ts`](../app/api/routine/route.ts) | Authenticated Python service call and defensive response handling |
| Modified | [`docs/AI-CONTRACT.md`](AI-CONTRACT.md) | Current service/provider contracts |
| Modified | [`docs/DELIVERY.md`](DELIVERY.md) | Separate historical delivery evidence from this change |
| Removed | `lib/provider.ts` | Remove duplicate direct TypeScript live-provider path |
| Modified | [`lib/routine.ts`](../lib/routine.ts) | Local guard and explicit deepseek scope decision |
| Modified | [`package.json`](../package.json) | Versioned build guard wrapper |
| Modified | [`tests/provider.test.ts`](../tests/provider.test.ts) | Python-boundary route tests, safe errors and timeouts |
| Modified | [`tests/routine.test.ts`](../tests/routine.test.ts) | Scheduler and explicit scope-decision regressions |
| Modified | [`vite.config.ts`](../vite.config.ts) | Frontend runtime service settings; remove provider key binding |
| Added | [`docs/PHASE1-VALIDATION.md`](PHASE1-VALIDATION.md) | Current phase validation notes |
| Added | [`docs/PYTHON-SERVICE.md`](PYTHON-SERVICE.md) | Architecture, privacy, container and Cloud Run runbook |
| Added | [`docs/PYTHON-VALIDATION.md`](PYTHON-VALIDATION.md) | This actual-results report |
| Added | [`scripts/build-guard.mjs`](../scripts/build-guard.mjs) | Versioned root dotenv discovery/read guard |
| Added | [`service/.dockerignore`](../service/.dockerignore) | Allow only runtime sources and lockfiles in image context |
| Added | [`service/Dockerfile`](../service/Dockerfile) | Minimal non-root Python runtime |
| Added | [`service/app.py`](../service/app.py) | FastAPI endpoints, authentication, bounded input and safe errors |
| Added | [`service/evals/README.md`](../service/evals/README.md) | Evaluation commands, limits and failure-to-regression workflow |
| Added | [`service/evals/RUBRIC.md`](../service/evals/RUBRIC.md) | Review rubric and claim boundaries |
| Added | [`service/provider.py`](../service/provider.py) | Strict schemas, scope guard, DeepSeek calls and safe logging |
| Added | [`service/pyproject.toml`](../service/pyproject.toml) | Python dependencies and checks |
| Added | [`service/uv.lock`](../service/uv.lock) | Reproducible dependency resolution |
| Added | [`service/test_service.py`](../service/test_service.py) | Service/provider security and failure-path tests |
| Added | [`service/evals/cases.jsonl`](../service/evals/cases.jsonl) | 60 labeled Spanish cases |
| Added | [`service/evals/catalog.json`](../service/evals/catalog.json) | Corpus hashes and review metadata |
| Added | [`service/evals/evidence.py`](../service/evals/evidence.py) | Source and corpus provenance helpers |
| Added | [`service/evals/fixtures/provider_responses.json`](../service/evals/fixtures/provider_responses.json) | Independent synthetic replay outputs |
| Added | [`service/evals/heldout.jsonl`](../service/evals/heldout.jsonl) | Revealed regression-only held-out cases |
| Added | [`service/evals/review.py`](../service/evals/review.py) | Review packet validation and scoring |
| Added | [`service/evals/run.py`](../service/evals/run.py) | Deterministic/live runner and transparent metric denominators |
| Added | [`service/evals/test_evals.py`](../service/evals/test_evals.py) | Runner integrity, metadata, partial usage, pricing and opt-in tests |
| Added | [`service/evals/test_review.py`](../service/evals/test_review.py) | Review tooling tests |
| Added | [`service/evals/smoke.py`](../service/evals/smoke.py) | Real local HTTP hop with mocked provider |

The added held-out corpus is revealed and therefore regression-only; it is never
independent evidence. Local `outputs/` reports and validation logs are generated
evidence, not committed source files.

The deterministic scheduler, calendar/insight libraries, UI, npm lockfile, and
`.openai/hosting.json` remain unchanged. The manifest above includes every visible
modified, added, and removed path; the status totals sum to 37.
