# Cadencia walkthrough

Cadencia starts with an everyday situation: you want to practice consistently,
but your availability changes. The page lets you observe replanning before
configuring a routine of your own. English is the default; the language control
switches the experience to Spanish.

## A week in action

The example contains three 30-minute English sessions. Monday is complete. When
Tuesday is marked missed, it runs `replan`:

- With Monday-through-Thursday availability, Wednesday is occupied and Thursday
  is free, so the session moves there and active time remains 90 minutes.
- With availability only through Wednesday, no later allowed opening exists.
  Completed work remains visible and active time becomes 60 minutes.

The practice content is authored. Planning and checks use the same product
functions. The fixed week of August 31, 2026 makes both outcomes reproducible and
is identified in the details. No model runs and reload does not preserve state.

## Plan with your data

The form keeps the goal, days, duration, weekly limit, local time, and week. On
load, it selects the current local Monday. Changing an example preserves the
chosen week. The result supports completion, replanning, checks, and exports.

## Understand the decisions

“How it works” explains three choices: respecting available time, separating
content proposals from calendar rules, and preserving completed work during
replanning. Each explanation links to the implementation or its tests.

The visible scope matches the product: browser-session state, calendar copies,
and optional connected generation. Persistence, synchronization, and automatic
reminders remain outside the current scope.
