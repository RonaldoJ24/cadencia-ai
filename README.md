# Cadencia

![Cadencia — De intención a rutina](public/og.png)

Cadencia turns a goal written in plain English or Spanish into a week-by-week
plan that fits your calendar. You write what you want to reach and by when; a
model reads it and drafts sessions; code sizes the calendar, checks every rule
and places each session. You see every step as it runs, where each setting came
from, and every change code made to the model's draft.

Live: https://cadencia-ai.ronaldo-jesus-alvarez.workers.dev

> This README is an interim version written when the goal planner replaced the
> earlier weekly-routine flow. A full product write-up, a case study and a
> Limitations section follow.

## How a plan is made

The model proposes, code decides, the person approves. A live run streams these
stages, each reported when it really starts and ends:

1. **Check the request** (code): plain goal text, a date near the server's, and
   only the settings the person changed.
2. **Check live AI limits** (code): the kill switch, daily and monthly dollar
   caps at the run's worst case, and per-visitor limits.
3. **Read the goal** (model): plan, one clarifying question, or a reasoned
   abstention. A keyword scope check can decline before any model call.
4. **Check availability** (code): settings the person set win, then the
   reading, then defaults; each field records its source. Code sizes every week.
5. **Draft sessions** (model), then **check the draft** (code): broken structure
   gets one retry; a second failure stops the run.
6. **Fit into the calendar** (code): weeks over their limits are trimmed (key
   sessions first), sessions are placed, and an independent checker must pass.

The demo runs the same pipeline in the browser, with the model's two steps
answered from outputs recorded from the model for fixed example goals.

## Architecture

```text
Browser ──SSE── Worker /api/routine ──bearer── Python service ──── DeepSeek
                 │  limits, spend, D1          /v1/read-goal
                 │  goal pipeline (TS)         /v1/draft
                 └─ planner: spec, skeleton, scheduler, independent checks
```

- `lib/planner/`: goal spec and provenance, availability and weekly ceilings,
  fitness load rules, the scheduler, the independent `checkPlan`, calendar export.
- `lib/goal-stream.ts`: the staged pipeline shared by live runs and the demo.
- `lib/server/`: the service client, spend reservations, request limits.
- `service/`: FastAPI with strict Pydantic models, prompt byte ceilings,
  JSON-escaped untrusted text, bounded provider retries and a scope guard.

Deployment, configuration and the order to deploy in are in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Local development

Node 22.13+ and the npm lockfile are required:

```bash
npm ci
npm run dev
```

The demo needs no key. For live runs on your machine, put `DEEPSEEK_API_KEY` in
`service/.env.local` and start both servers with `npm run dev:live`, which
creates a throwaway internal token and sends the key only to Python. Keys never
go to the browser.

## Verification

None of these call a real provider:

```bash
npm test
npm run typecheck
npm run lint
npm run build
uv run --project service --frozen pytest service
uv run --project service --frozen ruff check service
uv run --project service --frozen python service/smoke.py
docker build -t cadencia-intents:local service
```

## History

The earlier weekly-routine flow, its endpoint, its labelled evaluation corpus
and its validation write-ups are kept unchanged in
[archive/weekly-routine](archive/weekly-routine/README.md). Earlier product
notes remain in [docs/](docs/).
