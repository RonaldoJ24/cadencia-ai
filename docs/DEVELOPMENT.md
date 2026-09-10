# Development and verification

For the product overview and local demo, start with the [project README](../README.md).
This guide covers the optional service, evaluation tools, and operating boundaries.

## Live service mode

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and Python 3.12+.
Keep secrets in server-side process environments or a secret manager. The Python
service does not read dotenv files. Do not put any key in `NEXT_PUBLIC_*` or `VITE_*`.
`.env.example` documents names and safe defaults; `.env.local` remains ignored.

| Environment variable          | Where            | Purpose                                                 |
| ----------------------------- | ---------------- | ------------------------------------------------------- |
| `CADENCIA_ENABLE_LIVE`        | Frontend server  | Explicit `true` opt-in; otherwise live mode is disabled |
| `CADENCIA_INTENT_SERVICE_URL` | Frontend server  | Python base URL; HTTPS outside loopback development     |
| `CADENCIA_SERVICE_TOKEN`      | Both servers     | Shared internal bearer credential; never browser-facing |
| `DEEPSEEK_API_KEY`            | Python only      | Provider credential                                     |
| `DEEPSEEK_MODEL`              | Python only      | Optional model override; default `deepseek-v4-flash`    |
| `PORT`                        | Python container | Listening port; defaults to 8080                        |

After securely injecting the Python key and shared token, start Python:

```bash
uv sync --project service --frozen --python 3.12
uv run --project service --frozen uvicorn app:app --app-dir service --host 127.0.0.1 --port 8080 --no-access-log --log-level critical
```

In another terminal with the same shared token injected into its environment:

```bash
CADENCIA_ENABLE_LIVE=true \
CADENCIA_INTENT_SERVICE_URL=http://127.0.0.1:8080 \
CLOUDFLARE_INCLUDE_PROCESS_ENV=true npm run dev
```

Choose `IA conectada` explicitly. Only the request text crosses into Python and
DeepSeek; scheduling controls stay in TypeScript. Avoid sensitive information.
Read the provider's current pricing and data terms before enabling paid calls.
The internal token authenticates the frontend server, not end users. Keep the
frontend local or owner-only until authentication, quotas, and abuse controls
protect paid generation.

## Verification and evaluation

The commands below verify software behavior. Dated validation reports record
which checks have been run and their results; passing these commands alone does
not establish semantic quality, real usage, or production readiness.

Normal verification never calls a real provider:

```bash
npm test
npm run typecheck
npm run lint
npm run build
uv run --project service --frozen pytest service
uv run --project service --frozen ruff check service
uv run --project service --frozen python service/evals/run.py \
  --run-id '<new-run-id>' --repeat-id 1 \
  --output 'outputs/evals/<new-run-id>/report.json'
uv run --project service --frozen python service/evals/smoke.py
docker build -t cadencia-intents:local service
```

The public synthetic Spanish corpus separates deterministic fake-provider replay
from opt-in real-provider evaluation. Technical validity, domain agreement, lexical
guard behavior, adversarial behavior, and human answer quality have different
denominators. Bounded outputs leave normal reports only with `--export-review` for a
catalogued public corpus. The bound packets support control and rubric tooling;
synthetic outputs do not receive meaningful value review. That review is reserved
for blind human review with identified reviewer metadata; the small owner-only live
baseline is recorded separately and does not establish representative quality.
Reports identify `requested_model` separately from bounded provider observations
(`observed_model_counts` and `system_fingerprint_counts`); deterministic replay
leaves those observations empty. Live evaluation requires a positive shared
`--max-provider-attempts` budget that includes retries.
Generated artifacts live under ignored `outputs/`; CI preserves reports. The
[evaluation and failure-to-regression workflow](../service/evals/README.md) defines
the frozen held-out set, rubric, provenance, live commands and limits. The manual
live workflow requires explicit spend acknowledgement and repository secrets. The
synthetic packets and rubric calibrate controls only; meaningful value review is
pending blind human review. No representative quality result exists.

The bounded owner-only DeepSeek baseline and one local route proof are recorded in
[LIVE-AI-VALIDATION.md](LIVE-AI-VALIDATION.md). They establish limited local
pipeline evidence only; no human review, production, deployment, or representative
quality claim follows from them.

## Deployment and evidence boundary

[Python architecture and Cloud Run preparation](PYTHON-SERVICE.md) contains
container, secret, authentication, and deployment commands. Those commands are
instructions, not evidence of execution. The [Phase 1 validation snapshot](PHASE1-VALIDATION.md) records actual local
checks and remaining gates; the [initial implementation report](PYTHON-VALIDATION.md)
is retained as historical evidence.

Structured JSON application logs contain only opaque request IDs and allowlisted
operational metadata. They do not retain prompts, provider bodies, authorization
headers, or secrets. Provider errors are generic; request IDs allow safe tracing.
Cloud platform access logs are separate and need their own retention/access policy.

## Current limits

- Python owns scope decisions for provider-bound requests and returns the internal
  boolean `scope_refused`; TypeScript validates it and does not infer scope from
  `Intent` text. The local demo guard in `../lib/routine.ts` mirrors the bounded direct
  cues and the documented literary and fiction cases. A direct request signal plus
  an unambiguous medical or legal action anywhere in one request outranks a
  literary or fiction wrapper. This is not comprehensive moderation.
- The Python bearer token authenticates the frontend server, not visitors. The paid
  frontend route has no demonstrated end-user authorization or enforced quota. Keep
  live mode owner-only until access, limits and a kill switch are tested.
- One Monday-to-Sunday window, one session per selected day, and local floating
  calendar times. Calendar links, ICS, and shared text are one-time copies.
- No accounts, persistence, reminders, connected calendars, payments, or background jobs.
- No claim of production scale, representative model accuracy, real users, or cost reduction.
- Fixture evaluation does not represent production quality. Synthetic transport
  responses validate code behavior; they cannot measure language understanding.
- Deployment, external beta usage, and a documented real failure-to-regression
  cycle remain necessary before claims of production readiness.
