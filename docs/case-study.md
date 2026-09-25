# Case study: rebuilding Cadencia as an AI goal planner

Cadencia started as a weekly-routine builder. It was rebuilt into a planner that
reads a goal written in plain language, drafts a multi-week plan with a model,
and fits it into the person's calendar. It was built as a portfolio piece, so the
bar was that every behavior is explainable, every number is backed by committed
evidence, and nothing about model quality is claimed before it is measured.

This document explains the main decisions, what broke along the way and what
changed because of it. What the product does is in the [README](../README.md);
measured numbers are in [evidence](evidence/README.md).

## The principle

**The model proposes, code decides, the person approves.** Every feature follows
from it:

- The model does two narrow things. It reads a goal into choices from fixed
  options (or asks one question, or declines), and it drafts session types and a
  weekly table for a calendar code has already sized. It never picks a date.
- Code owns every rule: the calendar, weekly caps, fitness load, busy times,
  trims and placement. An independent checker that shares no scheduling code has
  to pass before a plan is shown.
- The person approves whatever changes a plan they already have. After missed
  sessions, code builds the options, the model suggests one, and nothing changes
  until the person picks.

## Decisions

**Stream the real stages.** A run is a sequence of stages, each reported when it
really starts and ends, with who did it (code or model) and what it produced.
The demo runs the same pipeline in the browser, answering the model's steps from
outputs recorded from the model, so it shows the product rather than a
simulation of it.

**Size the calendar before drafting.** Code computes each week's room (sessions
that fit around busy times) and its most minutes, and the model drafts inside
that. The scheduler still enforces every limit itself: fixed ones first, then a
fitness load rule over the previous four weeks. A draft that breaks structure
gets one retry.

**Make spend a bound, not an estimate.** Every live run reserves its worst case
in D1 before any model call: 65,472 micro-USD for a goal plan, 5,674 for a
replan. The service refuses prompts over a byte ceiling, and DeepSeek's tokenizer
gives at most one token per byte, so the reservation really is the worst case.
The run settles once from the usage each call reported. Daily and monthly caps,
a kill switch and per-visitor quotas sit in front of every model call.

**Treat every person's text as data.** Goal text and reasons reach the model only
as escaped JSON inside `<untrusted_data>` tags. Model output passes strict
Pydantic schemas in the service and is checked again in TypeScript. A replan
request carries no free text except the reason. Sentences the model writes for
the page may contain no digits, because numbers and dates always come from code.

**Keep the calendar on the device.** The `.ics` file is parsed in the browser:
repeats are expanded in the event's own time zone, then converted to the
person's. Only start and end times leave the device, never titles. They reach the
Worker but never the model; the model only sees the room per week.

**Build replan options on the same calendar.** Replanning keeps every session up
to today, with its status, and schedules only from tomorrow. Week numbers and
session ids therefore continue, and the independent checker runs on the whole
plan. Sessions already done count toward their week's limits, and a missed week
lowers what the next fitness week may hold.

**Pre-register the evaluation.** Questions, metrics, the blind rating protocol,
the budget and the rule for shipping retrieval templates were written down before
any scored run. The metrics are counts with their denominators. The runner
refuses a service that isn't the pre-registered one, stops at a case boundary
before it could pass the budget, and never scores a run the harness broke. Dry
runs cannot use the evaluation's cases.

## What broke, and what changed

**The first planner flattened plans.** A repair step capped each week at 10% over
the one before. After a trimmed week, that cap compounded, and plans stopped
growing. Trims moved into the scheduler, and the load rule became "at most 30%
over the average of the previous four weeks", floored at the starting volume.

**A visitor who left mid-run held spend and a slot.** Found by experiment: a run
cancelled after its reservation stayed reserved until the lease expired. Live
runs now register with the Workers runtime's `waitUntil`, so the settle step runs
after a disconnect.

**The service image once shipped without a module.** The Dockerfile missed it,
and after that fix, the `.dockerignore` allow list did too. CI's container build
caught the second. A packaging test now checks the Dockerfile, the ignore file
and the deploy docs together.

**Scheduling a full calendar was too slow for a request.** Finding free time
scanned every busy time for every date. With 2,000 busy times over the longest
plan, the median was 389.7 ms, against 6.4 ms after a per-date index. On
production, one such run used 53 ms of Worker CPU for the whole request
([evidence](evidence/README.md)). A test counts reads through a proxy, so the
scheduler reads each busy time exactly once.

**A dry run caught a wrong model id.** The evaluation config expected the name
DeepSeek uses today, while the service sends and reports an older name the API
still accepts. The runner refused after one call, as designed, before any scored
run.

**The pre-registration had holes, closed before any run.** As written, the
scheduling-violation metric could only ever be zero: the fit stage stops any plan
that breaks a rule, so no ready plan can carry a violation. It now counts the
runs stopped that way. Harness failures (an unreachable service, say) would have
been scored as model failures; now they stop the run unscored. Each change is its
own commit, with its reason.

**"Lighter weeks" could plan more than "Keep going".** After a missed week, the
load rule cuts heavier drafted weeks harder, so trimming the draft did not make
the plan lighter. Lighter now trims what keep actually schedules. A test on the
demo's real plans checks every week, and it fails with the old version.

**Applying an option twice would have shifted the plan twice.** Plans now record
approved adjustments, and misses on or before the latest one count as answered.

## How it was checked

- Tests on both sides, 143 in TypeScript on Node 26 and 22 and 109 in Python,
  plus a smoke test that runs the Worker route against the real service with a
  fake provider ([evidence](evidence/README.md)).
- Planted bugs: for the calendar reader, the busy-time index and the replan
  logic, deliberate bugs were planted to confirm a test fails for each. Where one
  didn't, the fixtures were too uniform, and the tests were rewritten until it
  did.
- Browser checks of the page's flows (planning, calendar import, replanning,
  the demo's simulation and the rating page), in English and Spanish, at desktop
  and phone widths.
- Live checks on production from a separate network after deploys, reading
  stage timings and settlement.
- Development checks against the real model (prompt probes, dry runs, the demo's
  recordings). These guided the work, but they are not results and are not
  quoted as such.

## What was measured, and what is not claimed

The pre-registered evaluation ran once, from the tag `eval-freeze-v1`, on 148
goals: 80 adapted from public posts and 68 written for coverage, audited by a
separate agent, with the owner agreeing with 20 of 20 labels checked at random.
In the blind rating the owner preferred GPT-6 Luna's plan in 74 of 93 pairs and
DeepSeek's in 16. Luna also declined 14 of 99 goals that should have been
planned, against DeepSeek's 8, and it was slower. Both declined all 24 goals
that needed a professional, and no plan broke a scheduling rule
([report](../evals/runs/2026-09-24-freeze-v1/report.md)).

The evaluation doesn't claim that the cases represent Cadencia's users, that the
preference would hold with other raters, or anything about replanning or live
latency. There was one rater and no significance test. Retrieval templates were
not built: they ship only if a third arm beats DeepSeek in the same kind of blind
rating, and that hasn't run.
