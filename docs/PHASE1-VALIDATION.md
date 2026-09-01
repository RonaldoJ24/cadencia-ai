# Phase 1 local validation snapshot

Validated locally on 2026-08-31 on `feat/python-intent-service`, based on HEAD
`045ddf0da86597dbd3f9de08cf15207a186c2465` with uncommitted source. The final
post-edit replay fingerprint is
`31455bfae2b1936e8313fdd523abca21fae43462090c7b460c1d1ad2b6b7b642`.
Both final reports contain the same fingerprint and their per-file hashes. No
secret/dotenv files are fingerprinted.

This is a local validation snapshot of Phase 1 software. It is not a remote CI
result, container result, live-model evaluation, deployment, human quality
assessment, user study, production incident, or résumé claim. Semantic quality,
deployment, CI/container validation, users, and production readiness remain
unestablished.

## What Phase 1 changed

- Split automated results into technical validity, domain agreement, lexical guard,
  critical-case routing, adversarial behavior, latency by provider applicability,
  and answer quality. No single percentage now implies overall quality.
- Preserved the reproduced scorer blind spot as exact negative controls: a valid
  `learning` intent about knitting for a TypeScript request, a vague but valid
  `learning` answer, and a valid answer following unsafe/irrelevant instructions.
  Explicit synthetic grade fixtures reject them, but remain labeled fixtures and
  cannot produce a human score.
- Added the inspectable `cadencia-quality-v1` rubric and packet bindings for
  future value review: relevance, actionability, appropriate language,
  context/ambiguity handling, and boundary handling when applicable. Synthetic
  fixtures only calibrate the format and controls; they do not establish model
  quality or replace review of a future live baseline.
- Added review packets and templates bound to exact run, corpus, source fingerprint,
  output hash and rubric. Missing grades stay pending. Output export is allowed only
  for a hash-declared public synthetic corpus. Files are created exclusively and
  baselines cannot be overwritten.
- Froze an 8-case held-out corpus before its first execution: four indirect
  excluded requests and four benign near-matches. Its results are now revealed,
  so it is retained only as a regression baseline and is no longer independent
  evidence for tuning. Its hash is
  `5a6445519a4e318481abeaaad124c760a1b4b06747469a7db311516678d81f40`.
  The 60-case development corpus remains unchanged at
  `4f9924fc06cab3367b662369e9b8ff27835b3e49ff4bc39a5f377b5dffe4e1b5`.
- Made prompt-version propagation use the one `PROMPT_VERSION` constant in the
  prompt, Pydantic metadata literal, service response, logs, runner and tests.
- Added unique run/repeat IDs, immutable output paths, corpus hash, dirty-source
  fingerprint and intended-source manifest to reports and CI artifact paths.
- Added a versioned build guard that treats direct root children named `.env` or
  whose basename starts with the literal `.env.` prefix as absent and blocks direct
  reads. Lookalikes such as `.environment`, `.envoy`, and `.envrc`, plus nested
  `.env*` paths, remain outside this root-only guard. Its self-test covers the four
  original names, production, an arbitrary future mode, and those negative controls.
  Both the normal production build and `--mode test` passed while the OS sandbox
  denied network and `file-read-data` for the existing root `.env.local`.
- Recorded the deployment gate: the service bearer authenticates the frontend
  server, not a visitor. Paid frontend access has no demonstrated end-user
  authorization or enforced usage quota, so beta access remains out of scope.
- Made Python the scope authority for provider-bound requests. The service returns a
  strict internal `scope_refused` boolean; the demo keeps a local bounded guard,
  while `deepseek` uses only the validated boolean and does not infer scope from
  `Intent` text.

## Actual local gates

Local versions: Node 26.3.1, npm 11.16.0, uv 0.11.27, Python 3.12.13.

| Command / gate | Actual result |
| --- | --- |
| `uv run --project service --frozen pytest service` | **85 passed** locally |
| `uv run --project service --frozen ruff check service` | All checks passed |
| `npm test` | **36 passed**, 0 failed; the constraint suite reports 1,524 deterministic schedule/replan combinations |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| Sandboxed `npm run build` and `npm run build -- --mode test` | Both passed with network and `.env.local` file-data reads denied by macOS Seatbelt |
| Development replay command below | Exit 0; 60/60 technical expectations; no failed IDs or automated warnings |
| Held-out replay command below | Exit 0 after the contextual guard correction; no failed IDs |
| `uv run --project service --frozen python service/evals/smoke.py` | Passed; two mocked provider calls; demo made no call |
| Runtime dependency audit | No known vulnerabilities found at audit time |
| Workflow YAML parse and structure checks | Passed locally; no workflow was triggered |
| `git diff --check` | Passed |

Both final builds retained Vinext's non-failing warning that `/` could not be
statically classified; `/api/routine` was recognized as an API route. Node 22 remains
pending remote CI because it is unavailable locally.

## Development replay — software checks only

Artifacts are ignored local files under `outputs/evals/phase1-root-contract-dev-009/`.
Run ID `phase1-root-contract-dev-009`, repeat `1`, timestamp
`2026-09-01T02:36:31.724684+00:00`, mode `deterministic`, requested model
`deepseek-v4-flash`, prompt `cadencia-intent-v1`. This command created the
immutable artifact; rerunning it at the same path is intentionally refused.

```bash
uv run --project service --frozen python service/evals/run.py \
  --run-id phase1-root-contract-dev-009 --repeat-id 1 \
  --output outputs/evals/phase1-root-contract-dev-009/report.json
```

| Dimension | Observed | Claim boundary |
| --- | --- | --- |
| Technical expectations | 60 / 60 | Mocked pipeline behavior only |
| Provider-attempted cases / HTTP requests | 47 / 49 | Two retry fixtures add requests |
| Provider completions | 42 / 47 | Deliberate fault fixtures reduce completion |
| Schema-valid completed outputs | 40 / 42 | Deliberate malformed/schema-invalid fixtures included |
| Domain agreement | 40 / 40 | Fixture label agreement, not relevance or model accuracy |
| Lexical guard | 8 / 8 expected refusals | All 8 made zero provider calls; no model refusal evidence |
| Critical routing | 8 pre-provider, 0 provider | Semantic safety `not_established` |
| Adversarial routing | 7 cases: 6 provider, 1 pre-provider | Contract checks passed; value review reserved for a future live baseline |
| Latency | all p50 0.56 ms, p95 0.90 ms | Local replay, not provider/service latency |
| Provider-invoked latency | 47 cases; p50 0.57 ms, p95 1.10 ms | Local fixture timing |
| Pre-provider latency | 13 cases; p50 0.39 ms, p95 0.45 ms | Local validation/guard timing |
| Answer quality | 0 value-reviewed / 48 synthetic applicable | `overall_quality=not_established`; acceptance `null` |

Usage counters remain `synthetic_fixture`, not paid usage. Cost remains `null` unless
current prices are explicitly supplied. No actual model response was produced.
Deterministic reports keep `observed_model_counts` and
`system_fingerprint_counts` empty because fixtures contain no provider metadata.
Live runs require a positive shared `--max-provider-attempts` value; the report
records its configured maximum, actual requests used, and exhaustion state.

## Frozen held-out replay — current local check

Artifacts are under `outputs/evals/phase1-root-contract-heldout-009/`. Run ID
`phase1-root-contract-heldout-009`, repeat `1`, timestamp
`2026-09-01T02:36:37.227308+00:00`. Earlier artifacts remain immutable; this
fresh replay records the current contextual guard behavior. The revealed
`phase1-heldout-replay-002` artifact failed `hold-benign-01` and
`hold-benign-03`; this replay fails no cases.

```bash
uv run --project service --frozen python service/evals/run.py \
  --cases service/evals/heldout.jsonl \
  --run-id phase1-root-contract-heldout-009 --repeat-id 1 \
  --output outputs/evals/phase1-root-contract-heldout-009/report.json
```

- Four indirect medical/exercise/financial/legal requests bypassed the lexical guard
  and reached the mocked provider. Their semantic answers are unreviewed.
- The two previously revealed false-refusal cases (`hold-benign-01` for literary
  `dosis`, and `hold-benign-03` for fictional `abogado`) now reach the fixture.
- All eight cases reach the expected outcome in the fresh replay; this is guard and
  fixture evidence, not model performance.
- The eight synthetic rows remain control-calibration fixtures; no meaningful human
  value review is claimed for them. Overall quality and human acceptance are not
  established. Meaningful value review belongs to a future capped live baseline.

The public synthetic review packets contain bounded test requests and intents, which
are deliberately excluded from production logs. Pending templates have no reviewer,
timestamp, grade or rationale. Unit-test human-import fixtures use the explicit name
`software-test-fixture`; they are not real reviewers or report artifacts.

## Security, privacy and source integrity

The complete accumulated Python/Next.js diff was inspected. Provider calls remain
bounded to one retry for 429/5xx, strict schemas are validated again in TypeScript,
Python owns provider-bound scope decisions through `scope_refused`, the demo stays
local, and the scheduler stays in TypeScript.
Redirects cannot forward the service token, errors remain generic, and production
logs do not retain prompts or raw provider outputs. Evaluation output export does
not change production logging.

`.env.local` remains ignored and untracked according to Git metadata; no filesystem
metadata or contents were inspected. The versioned root-only `.env*` build guard
treated it as absent, and the OS sandbox independently denied its file-data reads
while both build modes passed.
Changed-source scans found no private-key/provider-token patterns. Generated reports,
logs, venv and caches remain ignored. These are targeted checks, not proof that no
secret could ever exist.

The TypeScript scheduler math, calendar, insights, UI, npm lockfile and
`.openai/hosting.json` remain unchanged. `package.json` changes only the build command
to invoke the versioned dotenv guard. The Phase 1 follow-up additionally changes/adds:

- `service/evals/run.py`, `evidence.py`, `review.py`, `test_evals.py`,
  `test_review.py`, `RUBRIC.md`, `catalog.json`, `heldout.jsonl`, and this evaluation README.
- `service/provider.py` for single-source prompt-version propagation.
- `vite.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/live-eval.yml`,
  `scripts/build-guard.mjs`, `package.json`, root `README.md`, this report, and the
  historical-report notice.

No commit, push, PR, remote workflow, provider call, deployment or cloud mutation occurred.

## Unverified gates and separate approvals

- **Human value review:** synthetic packets and rubric fixtures calibrate artifact
  controls only; they are not model-quality evidence. A future capped live baseline
  must be reviewed against the rubric, with reviewer identity and bindings retained.
- **Node 22 CI:** not installed locally. A remote CI run requires commit/push
  authorization, which was not granted.
- **Container:** Docker, Podman and Colima are absent. Uvicorn startup and HTTP smoke
  pass, but image build/start are unverified. Do not install a runtime merely to
  clear this gate without approval.
- **Live baseline:** requires separate approval for provider credentials, synthetic
  prompt transmission, paid calls, and a request/spend ceiling. A normal live run has
  53 service cases but normally only 40 provider-bound cases plus retries; 8 are
  guard rejections and 5 are invalid inputs. Supply a positive shared
  `--max-provider-attempts` value and report actual observations.
- **Controlled deployment:** requires approved project, billing, region, secrets,
  container registry and access model. Before beta, demonstrate end-user access
  control, an enforced usage ceiling and a kill switch through direct API tests.
  The server bearer alone is insufficient.

This Phase 1 local snapshot passes the listed software checks, while value review
of a real baseline and runtime/deployment gates remain open. The next separately approved action with the
highest evidence value is a capped real-model baseline followed by meaningful human
review of its responses. Deployment follows only after the container, access and
quota gates pass. No CV edit is warranted yet.
