# Cadencia

![Cadencia — De intención a rutina](public/og.png)

Cadencia is a small Spanish language routine compiler. You describe what you want to keep doing, choose the days and time that are actually available, and receive a weekly plan that can be inspected, adjusted, and downloaded.

The product separates two jobs. The optional provider can propose the intent and session content; the deterministic engine checks the selected Monday week, allowed days, session duration, local time, and weekly cap. Values from the controls always win over details in the free text request. The local demo uses no model and carries the label `Demo local · sin modelo`; it must not be read as a successful AI response.

The product sample is Spanish even when the goal is English practice:

> Practicar inglés para entrevistas de trabajo, con foco en responder con más seguridad.

You can also load examples for learning TypeScript or writing every week. After generating a plan, Cadencia explains the available capacity, projects four weeks of practice time without promising results, asks for missing context, and defines observable progress signals. You can mark a session complete, replan a missed session, add the selected session to Google Calendar, export the whole routine for Apple or Outlook, or share a plain-text copy with someone you trust.

## Architecture

```text
Browser → Next.js /api/routine → authenticated Python /v1/intents → DeepSeek
                              ← validated Intent ←
        ← TypeScript buildPlan() → deterministic weekly schedule
```

Python owns the uncertain model boundary: prompt, provider calls, scope guard,
the strict internal `scope_refused` decision, strict Pydantic schemas, bounded
retries, and privacy-safe metadata. TypeScript validates that decision and owns
dates, selected days, duration, weekly limits, replanning, Markdown and ICS.
There is one scheduling engine and one live provider implementation. The existing
Vinext/Cloudflare frontend remains in this repository; Python is a separate
container and deployment unit. There are no model tools or autonomous actions.

## Local deterministic mode

Node 22.13+ and the existing npm lockfile are required. From the repository root:

```bash
npm ci
CADENCIA_ENABLE_LIVE=false npm run dev
```

The browser demo calls `buildPlan` locally without Python, credentials, or a model
request. Its label remains `Demo local · sin modelo`. The API demo path is also
local. The optional availability check is not a provider health check.

## Live service mode

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and Python 3.12+.
Keep secrets in server-side process environments or a secret manager. The Python
service does not read dotenv files. Do not put any key in `NEXT_PUBLIC_*` or `VITE_*`.
`.env.example` documents names and safe defaults; `.env.local` remains ignored.

| Environment variable | Where | Purpose |
| --- | --- | --- |
| `CADENCIA_ENABLE_LIVE` | Frontend server | Explicit `true` opt-in; otherwise live mode is disabled |
| `CADENCIA_INTENT_SERVICE_URL` | Frontend server | Python base URL; HTTPS outside loopback development |
| `CADENCIA_SERVICE_TOKEN` | Both servers | Shared internal bearer credential; never browser-facing |
| `DEEPSEEK_API_KEY` | Python only | Provider credential |
| `DEEPSEEK_MODEL` | Python only | Optional model override; default `deepseek-v4-flash` |
| `PORT` | Python container | Listening port; defaults to 8080 |

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

The checks below are a local validation snapshot. They establish selected
software behavior only; semantic quality, deployment, CI/container validation,
users, and production readiness remain unestablished.

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
for a future capped live baseline with identified reviewer metadata.
Reports identify `requested_model` separately from bounded provider observations
(`observed_model_counts` and `system_fingerprint_counts`); deterministic replay
leaves those observations empty. Live evaluation requires a positive shared
`--max-provider-attempts` budget that includes retries.
Generated artifacts live under ignored `outputs/`; CI preserves reports. The
[evaluation and failure-to-regression workflow](service/evals/README.md) defines
the frozen held-out set, rubric, provenance, live commands and limits. The manual
live workflow requires explicit spend acknowledgement and repository secrets. The
synthetic packets and rubric calibrate controls only; meaningful value review is
reserved for a future capped live baseline. No representative quality result exists
before that run and review.

## Deployment and evidence boundary

[Python architecture and Cloud Run preparation](docs/PYTHON-SERVICE.md) contains
container, secret, authentication, and deployment commands. Those commands are
instructions, not evidence of execution. No deployment or push is part of this
change. [Current Phase 1 validation](docs/PHASE1-VALIDATION.md) records actual local
checks and remaining gates; the [initial implementation report](docs/PYTHON-VALIDATION.md)
is retained as historical evidence.

Structured JSON application logs contain only opaque request IDs and allowlisted
operational metadata. They do not retain prompts, provider bodies, authorization
headers, or secrets. Provider errors are generic; request IDs allow safe tracing.
Cloud platform access logs are separate and need their own retention/access policy.

## Current limits

- Python owns scope decisions for provider-bound requests and returns the internal
  boolean `scope_refused`; TypeScript validates it and does not infer scope from
  `Intent` text. The local demo guard in `lib/routine.ts` mirrors the bounded direct
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
- Deployment, real live baseline, external beta usage, and a documented real
  failure-to-regression cycle remain necessary before writing a résumé claim.

## Project notes

- [Concept and original direction](docs/CONCEPT.md)
- [Implementation roadmap](docs/ROADMAP.md)
- [AI contract and safety boundaries](docs/AI-CONTRACT.md)
- [Research from official product sources](docs/RESEARCH.md)
- [Launch narrative](docs/LAUNCH.md)
- [Delivery and verification](docs/DELIVERY.md)
- [Advanced insight contract](docs/INSIGHTS.md)
- [Calendar and sharing boundary](docs/CALENDAR.md)
- [V2 architecture](docs/ARCHITECTURE_V2.md)
- [V2 market direction](docs/MARKET_V2.md)
