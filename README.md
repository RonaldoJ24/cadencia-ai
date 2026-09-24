# Cadencia

![Cadencia — De intención a rutina](public/og.png)

Cadencia turns a goal written in plain English or Spanish into a week-by-week
plan that fits your calendar, and shows you how it got there: what the model
read and proposed, what code decided, and why each session sits where it does.

**Try it:** https://cadencia-ai.ronaldo-jesus-alvarez.workers.dev. The demo needs
no account and replays outputs recorded from the model; live AI plans your own
goal, within daily limits.

[Leer en español](README.es.md)

## What you can do

- **Write a goal the way you'd say it.** "Run a 10K by December, weekday
  mornings only, 3 hours a week at most." Cadencia reads the deadline, days, time
  of day and weekly time from your words, or asks one question when it can't
  tell what you want to get better at.
- **Set only what matters to you.** Deadline, days, time of day, minutes a week,
  longest session and level all start on Auto. What you set wins, and the plan
  says where every other value came from: your words, or a default.
- **Plan around your calendar.** Import an `.ics` file and sessions avoid your
  busy times. The file is read on your device; only the start and end of each
  busy time are sent, never titles or places.
- **Watch the plan being made.** Each step shows who did it (code or model), how
  long it took and what it produced, as it happens.
- **Get a refusal when you should.** Goals that need a professional (an injury,
  a diet, a timeline that could hurt you) are declined with a reason instead of
  planned.
- **Recover from a missed week.** Mark sessions done or missed. After a miss,
  code builds the ways to go on, a model suggests one from your reason, and
  nothing changes until you choose.
- **Take it with you.** Download the plan as a calendar file or add a session to
  Google Calendar.

## How a plan is made

The model proposes, code decides, the person approves. A live run streams these
stages as they really start and end:

1. **Check the request** (code): plain goal text, a date near the server's, only
   the settings you changed, and any busy times, clipped to the dates a plan can
   use.
2. **Check live AI limits** (code): the kill switch, the daily and monthly dollar
   caps at the run's worst case, and per-visitor limits.
3. **Read the goal** (model): a plan, one clarifying question, or a reasoned
   refusal. A keyword check can decline before any model call.
4. **Check availability** (code): your settings, then the reading, then defaults,
   each with its source. Code sizes every week: how many sessions fit around your
   busy times and how many minutes the week may hold.
5. **Draft sessions** (model), then **check the draft** (code): broken structure
   gets one retry, and a second failure stops the run.
6. **Fit into your calendar** (code): weeks over their limits are trimmed, key
   sessions kept first; sessions are placed, moved around busy times or dropped
   with a reason; and an independent checker that shares no scheduling code must
   pass.

For fitness goals, code enforces the load: weekly volume starts at your level's
volume and grows at most 10% a week, never more than 30% above the average of
the four weeks before, with at most two hard sessions a week and a rest day
between them.

## After missed sessions

When you mark a session from the last two weeks as missed, code builds up to four
options on the same calendar, each checked by the independent checker:

| Option | What it does |
|---|---|
| Keep going | Goes on from here; what you missed is skipped |
| Redo what was missed | Redoes it now; what no longer fits before the deadline is left out |
| Redo it and move the deadline | Redoes it and moves the deadline, so nothing is left out |
| Lighter weeks | Keeps the most important sessions within three quarters of the time |

You write what happened, and the model picks the option that fits, with one
sentence saying why. Pain, an injury or an illness gets a pointer to a
professional instead of a pick. The model receives your reason, your goal's area
and level, and the options as numbers, never your plan or your goal's text. Every
date and number you see comes from code, and nothing changes until you use an
option. In the demo you can pretend the second week was missed and try it with
four recorded reasons.

## Your data

- Plans and imported busy times are saved only in your browser; there are no
  accounts. A live run sends what it needs, and Cadencia's servers keep none of
  it.
- Live AI sends your goal text, a clarifying answer and a replan reason to the
  model provider, DeepSeek, a third party. Busy times from your calendar reach
  Cadencia's Worker but never the provider; the model only sees how much room
  each week has. The demo sends none of this.
- Your goal text and reasons reach the model only as escaped data, and whatever
  the model returns is checked by strict schemas in the service and again in
  code before anything uses it.
- API keys never reach the browser; the Worker and the service share a bearer
  token.

## Live AI limits and cost

Every live run reserves its worst case before any model call (65,472 micro-USD
for a goal plan, 5,674 for a replan, defined in `lib/server/spend.ts`) and
settles once from what each call reported. Runs stop before the model when the
daily or monthly cap would be passed (by default $0.50 a day and $5.00 a month),
when live AI is switched off, or after a visitor's five live runs of the day.
The demo always works. Details are in [DEPLOYMENT.md](DEPLOYMENT.md).

## Evaluation

The evaluation was pre-registered in
[evals/PREREGISTRATION.md](evals/PREREGISTRATION.md) before any scored run: the
questions, the metrics (counts with their denominators, no percentages), a blind
rating protocol, a $10 budget and the rule for shipping retrieval templates. It
compares DeepSeek with GPT-6 Luna on the same pipeline.

**No scored run exists yet, so this README makes no claim about model quality.**
The run needs 100 to 150 cases, adapted from goals people describe in public
posts and reviewed by the owner ([protocol](evals/cases/SOURCING.md)), and the
GPT-6 Luna settings. The steps
are in [evals/README.md](evals/README.md), and results will be committed with the
run under `evals/runs/`.

## Engineering evidence

Measured numbers live in [docs/evidence](docs/evidence/README.md), each with the
command, commit, date and raw output. Two examples:

- Scheduling 2,000 busy times over the longest plan took a median 389.7 ms before
  a per-date index and 6.4 ms after, on the same machine.
- On production, one live goal run with 2,000 busy times used 53 ms of Worker CPU.

## Architecture

```text
Browser ──SSE── Worker /api/routine ──bearer── Python service ──── DeepSeek
  the demo       │  limits, spend, D1          /v1/read-goal
  runs the same  │  goal and replan            /v1/draft
  pipelines      │  pipelines (TS)             /v1/replan
                 └─ planner: spec, skeleton, scheduler, independent check
```

- `lib/planner/`: goal spec and provenance, availability and weekly ceilings,
  fitness load rules, the scheduler, the independent `checkPlan`, replan options,
  calendar export.
- `lib/calendar-import.ts`: the `.ics` reader that runs in the browser.
- `lib/goal-stream.ts`, `lib/replan-stream.ts`: the staged pipelines shared by
  live runs and the demo.
- `lib/server/`: the service client, spend reservations and request limits.
- `service/`: FastAPI with strict Pydantic models, prompt byte ceilings,
  JSON-escaped untrusted text and bounded provider retries.
- `evals/`: the pre-registered evaluation, its runner and the blind rating page.

## Run it locally

Node 22.13+ and the npm lockfile are required:

```bash
npm ci
npm run dev
```

The demo needs no key. For live runs on your machine, put `DEEPSEEK_API_KEY` in
`service/.env.local` and start both servers with `npm run dev:live`, which
creates a throwaway internal token and sends the key only to Python.

None of these checks call a real provider:

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

## Limitations

- **Model quality is unmeasured.** The evaluation is pre-registered but not run.
  Its cases adapt goals people chose to post in public, which are not a random
  sample; one person reviews them and is the only blind rater; and it covers
  reading and drafting, not replanning.
- **Not advice.** Fitness limits are general rules for healthy adults, not
  individual guidance, and refusals cover the declared categories only.
- **Calendar import covers the common cases.** Daily and weekly repeats are
  expanded; other repeats count once, unknown time zones are read as local, and
  at most 2,000 busy times are used. The page says when any of these happened.
- **Plans live in one browser.** There are no accounts, sync or reminders.
- **Replanning looks back two weeks** and suggests one option from a short
  reason; it doesn't reshape the whole plan.
- **Retrieval templates were not built.** The brief ties them to a gain in the
  evaluation, which hasn't run.
- **The demo replays recorded outputs.** Live runs are capped and can be
  unavailable; the demo keeps working.
- **Latency depends on the model.** A live plan takes several seconds, most of it
  in the two model calls.

## History

The earlier weekly-routine flow, its endpoint, its labelled corpus and its
validation write-ups are kept unchanged in
[archive/weekly-routine](archive/weekly-routine/README.md). Earlier product notes
remain in [docs/](docs/). How the rebuild went, including what broke and how it
was fixed, is in [docs/case-study.md](docs/case-study.md).
