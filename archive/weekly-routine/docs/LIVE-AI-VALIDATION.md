# Live AI validation — 2026-08-31

This is a bounded local owner-run evaluation, not production, user, deployment,
representative-quality, or human-review evidence.

## Binding and limits

- Frozen public synthetic corpus: `service/evals/live-baseline-v1.jsonl`;
  SHA-256 `997232254d6701df505a9b87aa77be4ce3b8e4298a2e46a1315ab7a7afcbd039`.
- Branch/HEAD at baseline: `feat/live-ai-evidence-v1` /
  `5dc76b41c85a58be02b75d6761f50419966c1a46`.
- Actual baseline: `live-ai-evidence-v1-baseline-002`, prompt
  `cadencia-intent-v1`, requested/observed `deepseek-v4-flash`, source HEAD
  `5dc76b41c85a58be02b75d6761f50419966c1a46` (dirty source fingerprint
  `d24159cf5dde3bcea9cb3b5ff29848133d0c2d46ba187a7628898f2076f8548e`).
- Immutable preflight binding SHA-256:
  `eae5753d7593374e5788f0f517c6089c3991d76b250246feef42603819febd63`.
  It capped the baseline at 20 HTTP attempts and $0.05632 conservatively.
- Official facts rechecked on 2026-08-31: [pricing](https://api-docs.deepseek.com/quick_start/pricing/),
  [chat-completions API](https://api-docs.deepseek.com/api/create-chat-completion/),
  and [model-retirement notice](https://api-docs.deepseek.com/news/news260424/).
  The run used the documented endpoint, JSON mode, disabled thinking, 800 output
  tokens, and peak $0.44/M uncached input, $0.014/M cached input, $1.32/M output.

`baseline-001/preflight.json` produced no report or provider call; an initial CLI
control-flow rejection of an existing binding was corrected, creating the fresh
`baseline-002` source binding. Both artifacts remain immutable and ignored.

## Baseline evidence

The nine-case corpus made seven real DeepSeek attempts (no retries): all seven
were HTTP 2xx and schema-valid; the two direct medical/legal cases were refused
before the provider. Provider p50/p95 latency was 4198.86/5481.19 ms. Usage was
1,193 prompt + 2,811 completion = 4,004 tokens; the conservative uncached cost
estimate was $0.00423544. The observed backend model count was seven
`deepseek-v4-flash` responses under one recorded system fingerprint.

Technical domain agreement was 6/7. `live-benign-near-match-01` returned a
valid, relevant literary-analysis intent but labeled it `creative` rather than
the corpus's frozen `learning` expectation. This is recorded as a model
classification/domain ambiguity, not a demonstrated code defect; no prompt,
provider, product, label, or paid retest change was made.

The bound review packet was inspected case by case against `cadencia-quality-v1`
as **automated exploratory review** only. Its ordinary, ambiguity, adversarial,
and benign intents were Spanish, schema-valid, and did not expose output-marker
warnings; adversarial instructions were not executed, and direct scope cases
used the local refusal. It is unassigned for later blind human review. No human
review, human acceptance, or representative answer-quality claim is made.

## Real local route proof

One final loopback-only submission used frozen case `live-e2e-schedule-01`:

- Controls: Monday/Wednesday/Friday, 30 minutes/session, 60 minutes/week,
  Monday start `2026-08-31`; its free text instead asked for daily 120 minutes.
- Actual path: direct local Next route import → bearer-authenticated local Python
  `/v1/intents` → DeepSeek → existing deterministic `buildPlan` scheduler.
- Result: one 2xx/schema-valid upstream attempt (3,113 ms; 172 prompt + 302
  completion tokens), two sessions on 2026-08-31 and 2026-09-02, 30 minutes
  each, 60 minutes total, and all four deterministic checks passed.
- The capture asserted that neither the key, complete request, nor system prompt
  appeared in the privacy-safe service log; the temporary loopback service was
  stopped. No existing developer server was touched.

Two earlier E2E harness artifacts are preserved: both used a Tuesday start date
that route validation rejected before Python/provider invocation, so they made
zero DeepSeek attempts. A no-key dry proof with the corrected Monday date then
reached the authenticated service and returned its expected safe 502.

Total real attempts for this evidence stage: **8** (7 baseline + 1 E2E), with
a conservative combined estimate of **$0.00470976**, below the 40-attempt/$1
envelope configured for this completed run. This supports the limited claim:
“Built and evaluated a hybrid LLM/deterministic scheduling pipeline.”

## Commands and final verification

The unchanged baseline was run before source edits:

```bash
npx --yes --package=node@22.22.0 --call 'node --version && npm test'
uv run --project service --frozen python --version
uv run --project service --frozen pytest
uv run --project service --frozen ruff check .
```

The Node baseline passed at `v22.22.0` (36 tests). The clean-tree Python
baseline exposed its pre-existing provenance-test expectation that
`source_dirty` be true (84/85). The test now compares the reported boolean with
the actual clean/dirty source state; no production correction was made for it.

The actual strict evidence command received credentials only from its process
environment (not shown here):

```bash
uv run --project service --frozen python service/evals/run.py --live --export-review \
  --cases service/evals/live-baseline-v1.jsonl \
  --run-id live-ai-evidence-v1-baseline-002 --repeat-id 1 \
  --max-provider-attempts 20 \
  --input-usd-per-million 0.44 --cached-input-usd-per-million 0.014 \
  --output-usd-per-million 1.32 \
  --preflight outputs/evals/live-ai-evidence-v1/baseline-002/preflight.json \
  --output outputs/evals/live-ai-evidence-v1/baseline-002/report.json
```

Final supervisor verification passed: Node `v22.23.2` with 36 tests, typecheck,
lint, and a live-disabled build with network and `.env.local` reads denied;
Python `3.12.13` with 88 tests and Ruff; deterministic development replay 60/60,
heldout replay 8/8, and live-corpus replay 9/9 without failed IDs; loopback smoke;
and the build-guard self-test. `git diff --check` passed. Docker was unavailable
(`command not found`).

```bash
npm exec --offline --yes --package=node@22 -- node --version
npm exec --offline --yes --package=node@22 -- npm test
npm exec --offline --yes --package=node@22 -- npm run typecheck
npm exec --offline --yes --package=node@22 -- npm run lint
CADENCIA_REPO="$(pwd)"
env -u DEEPSEEK_API_KEY -u DEEPSEEK_MODEL -u CADENCIA_SERVICE_TOKEN \
  -u CADENCIA_INTENT_SERVICE_URL -u CADENCIA_ENABLE_LIVE \
  sandbox-exec -p "(version 1)(allow default)(deny file-read-data (literal \"${CADENCIA_REPO}/.env.local\"))(deny network*)" \
  npm exec --offline --yes --package=node@22 -- npm run build
uv run --project service --frozen pytest service
uv run --project service --frozen ruff check service
uv run --project service --frozen python service/evals/run.py --run-id supervisor-postfix2-dev-015 --repeat-id 1 --export-review --output outputs/evals/supervisor-postfix2-dev-015/report.json
uv run --project service --frozen python service/evals/run.py --cases service/evals/heldout.jsonl --run-id supervisor-postfix2-heldout-015 --repeat-id 1 --export-review --output outputs/evals/supervisor-postfix2-heldout-015/report.json
uv run --project service --frozen python service/evals/run.py --cases service/evals/live-baseline-v1.jsonl --run-id supervisor-postfix2-live-corpus-015 --repeat-id 1 --export-review --output outputs/evals/supervisor-postfix2-live-corpus-015/report.json
uv run --project service --frozen python service/evals/smoke.py
npm exec --offline --yes --package=node@22 -- node scripts/build-guard.mjs --self-test
git diff --check
```

Changed tracked/new files are `README.md`, `service/evals/README.md`,
`service/evals/catalog.json`, `service/evals/evidence.py`,
`service/evals/run.py`, `service/evals/test_evals.py`,
`service/evals/live-baseline-v1.jsonl`, and this document. No product, provider,
prompt, workflow, or hosting code changed. No code-caused live failure was found,
so there is no before/after fix or targeted paid retest. Raw reports, packets,
preflights, and route captures remain ignored; blind human review and
representative quality remain unestablished.
