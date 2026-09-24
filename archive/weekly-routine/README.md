# Archive: the weekly-routine flow

Until September 2026, Cadencia planned one week at a time. You chose days, a
session length and a weekly cap, a model proposed a fixed number of sessions
through `POST /v1/intents`, and code placed them in that single week.

The goal planner replaced it: a model reads a free-text goal and drafts a
multi-week plan, and code sizes, checks and schedules it. The weekly flow, its
endpoint, its evaluation corpus and its runner were retired together in one
commit. Nothing here runs anymore.

What is kept, byte for byte as it was, so earlier write-ups can still be read
against their evidence:

- `docs/`: the documents that described the weekly flow and its local and live
  validation. Their relative links into `service/evals/` still resolve here.
- `service/evals/`: the labelled Spanish case sets, the frozen live baseline,
  the review rubric, the fixtures, and the runner and review code that produced
  the earlier reports. The case labels were never edited.
- `live-eval.yml`: the manual GitHub workflow that ran the paid live evaluation.

The commands in these documents point at the old paths and the old endpoint;
they describe what was run then, not something to run now. The goal planner's
evaluation is separate, pre-registered and has its own cases.
