# Cadencia

![Cadencia — De intención a rutina](public/og.png)

A goal needs room in a real week. Cadencia turns an intention into short sessions,
respects the time available, and helps find the next opening when a day is missed.
The interface is in Spanish. Product and experience design by Ronaldo.

## Try a week

The homepage opens with an interactive example: Monday is done and the weekly
limit is 90 minutes. Mark Tuesday as missed and try both situations:

- **One day free:** Tuesday moves to Thursday. Monday stays completed and active
  time remains 90 minutes.
- **No free days:** the plan explains that no later allowed slot exists. It keeps
  the completed and remaining sessions, with 60 active minutes.

This example runs the same `buildPlan`, `markDone`, and `replan` functions as the
full planner. Its practice content is authored sample data, not model output.
The fixed week is labelled in the example's details; reload resets the interaction.

Continue to **Planificar** to use your own goal, days, session duration, and weekly
limit. Complete or replan a session, inspect the checks, download Markdown or ICS,
or prepare a single event for Google Calendar. The planner starts on the current
local Monday after the page loads.

## Run locally

Use Node 22.13+ and the committed npm lockfile:

```bash
npm ci
CADENCIA_ENABLE_LIVE=false npm run dev
```

The local demo needs no account, API key, Python service, or model call.
`GET /api/routine` checks configuration availability; it is not a provider health check.

## How it works

| Responsibility                                        | Implementation                                                        | What to inspect                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Dates, allowed days, duration, weekly cap, replanning | [TypeScript planner](lib/routine.ts)                                  | Explicit controls remain authoritative; completed work is preserved.                |
| Interactive week example                              | [Scenario](lib/week-example.ts) and [UI](components/week-example.tsx) | The two outcomes use the real planner, with isolated in-memory state.               |
| Optional model intent                                 | [Python service](service/app.py) and [provider](service/provider.py)  | Strict schemas, bounded retries and timeouts, authenticated server-to-server calls. |
| Validated intent to schedule                          | [Frontend API](app/api/routine/route.ts)                              | Python's scope decision and intent are checked before scheduling.                   |
| Calendar copies                                       | [Exports](lib/calendar.ts)                                            | One-time calendar links, ICS and shareable text; no calendar synchronization.       |

The model can propose content. TypeScript owns the schedule. The browser demo
uses the planner directly; connected generation takes the optional authenticated
Python route. Details live in the [AI contract](docs/AI-CONTRACT.md).

## Verify

```bash
npm test
npm run typecheck
npm run build
```

The tests cover schedule constraints, missed sessions, calendar exports, the API
boundary, and both interactive-example outcomes. Normal verification makes no
real provider calls. These checks establish software behavior, not model quality.
See [development and evaluation](docs/DEVELOPMENT.md) for the Python checks,
optional provider setup, and evaluation procedure.

## Current scope

- One Monday-to-Sunday week, one session per selected day, local calendar times.
- Plans live in browser memory and reset on reload. Export a copy before leaving.
- No accounts, persistent history, automatic reminders, or connected calendars.
- Connected generation is opt-in. The internal service token does not authenticate
  visitors; keep paid generation owner-only until visitor authorization and quotas
  are implemented and verified.
- No production-scale or representative model-quality result is claimed.

The [documentation index](docs/README.md) separates current contracts, dated
validation reports, and future design proposals.
