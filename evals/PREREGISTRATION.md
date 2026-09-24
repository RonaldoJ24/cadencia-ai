# Evaluation pre-registration

This document fixes how Cadencia's goal planner will be evaluated **before any
scored run**. It is frozen in two parts:

- **Part A** (sections 1–9): questions, cases, metrics, rating, budget and
  decision rules. Frozen by the commit that adds this file. Any later change is a
  new commit with the reason, made before the scored run, never after seeing
  results.
- **Part B** (section 10): the systems themselves, meaning prompt versions, model
  ids, provider parameters and prices. These still change while the product is
  built, so Part B is frozen at the git tag `eval-freeze-v1`, created right before
  the scored run. The runner refuses to run a system whose service does not match
  Part B.

No result exists yet. Nothing in this file is a finding.

## 1. Questions

1. How often does the planner turn a goal, as people describe one, into the right
   decision (plan, one question, or a reasoned abstention) and, when it plans,
   into a plan that passes every scheduling rule?
2. With the same pipeline, prompts and code checks, how do two models compare:
   DeepSeek and GPT-6 Luna?
3. If retrieval templates are built, do they make plans better enough to ship
   (section 8)?

## 2. Scope

In scope: the goal pipeline from request to fitted plan. That covers the two
model tasks (`POST /v1/read-goal`, `POST /v1/draft`) and every code stage around
them: request validation, the spec built from settings, reading and defaults,
calendar sizing, the draft check with one structural retry, trimming,
scheduling and the independent `checkPlan`.

Out of scope, tested elsewhere or not at all:

- the Worker's spend reservations, request limits and streaming, which have
  their own tests;
- the demo and its recorded samples;
- calendar import;
- missed-week replanning. It adds a model task after this document was written
  and is not part of this evaluation;
- retrieval templates, unless the conditional arm in section 3 is run.

## 3. Arms and run order

| Arm | System |
|---|---|
| A | The pipeline with DeepSeek (Part B) |
| B | The same pipeline with GPT-6 Luna through OpenAI (Part B) |
| C | Arm A plus retrieval templates. It exists only if templates are built, and is compared with Arm A under section 8 |

Cases run in ascending `id`. For each case, the arms run in the order A, B, C.
Before starting a case, the runner requires the remaining budget to cover every
arm's worst case for that case (section 7). Otherwise it stops at that case
boundary. Every arm therefore covers the same prefix of cases, and money never
decides which arm got more.

The runner also stops, to be resumed after a look:

- at once, when the harness fails (section 4);
- before the next case, after three failed runs in a row on one arm. Those
  failures are scored like any other.

A resumed run needs the same commit, cases and arms, and runs only what has no
scored result yet.

## 4. Cases

- 100 to 150 cases go in `evals/cases/cases.jsonl`, in the format of
  `evals/cases/README.md`. **Changed on 2026-09-24, before any case was
  written:** the owner first planned to write every case, then chose to ground
  them in goals people describe in public posts instead of goals one person
  imagines. The protocol is `evals/cases/SOURCING.md`:
  - Agents running a Claude model, which is neither arm, find public posts, turn
    each goal into a new text with no copied sentences and no identifying
    details, and draft its labels. Cases no post covers, such as adversarial
    texts, are written for coverage and marked as such.
  - The agents never see the service's prompts, the demo samples or any output
    of the arms, and never call either arm's provider.
  - A separate check opens every recorded source and confirms it carries the
    case's goal. A case whose source cannot be confirmed counts as written for
    coverage.
  - **Changed again on 2026-09-24, before any run:** instead of reading every
    case, the owner chose an independent audit and a random check. A separate
    agent audited all the cases from a customer's side: whether each reads like
    what a person types into Cadencia, whether the set covers how people
    behave, and whether a careful planner and a reasonable customer would agree
    with each label. The owner decided every change the audit proposed and
    every label doubt it raised. The owner then checked a random 20 cases,
    drawn from the final set with a recorded seed. How many of those 20 labels
    the owner agrees with is reported with the results, and any label the owner
    changes in that check is changed in the set.
  - Each case's origin and review outcome (accepted, relabeled or rewritten) is
    recorded in `evals/cases/provenance.jsonl`. `evals/cases/review.json`
    records the drafts written and dropped, the shuffle seed and the random
    check. A scored run refuses cases without both, and these counts are
    reported with the results.
  - After the owner's decisions and check, no agent writes, edits or relabels a
    case.
- Coverage quotas, which `evals/validate.ts` enforces:

  | Quota | Minimum |
  |---|---|
  | Cases | 100 |
  | Spanish cases | 35 |
  | Expected clarifying question | 15 |
  | Expected abstention | 15, across at least 4 categories |
  | Fitness goals | 20 |
  | Cases with settings (controls) | 10 |
  | Relative deadlines ("in six weeks", "by December") | 10 |
  | Adversarial text (instructions hidden in the goal) | 5 |

- Each case fixes its own `today`, so a run reproduces on any date.
- **Labels never reach a prompt.** The runner sends only the goal text,
  language, `today`, the case's settings, and, after a question, the case's
  scripted answer.
- **Development contamination.** These texts were used while writing prompts
  and tuning planner rules:
  - the five demo examples in English and Spanish (`lib/samples/goal-samples.ts`);
  - "I want to run a 10K by December, weekday mornings only, 3 hours a week max";
  - "Quiero aprender a tocar guitarra para fin de año, martes y jueves en la
    noche, máximo 2 horas por semana";
  - a 2,000-character string of `<` used to measure token counts.

  The validator flags any case that matches one of these closely. The owner
  decides whether to keep it, and kept matches are listed with the results.
- **Exclusions.** A case is excluded only for a validator error before the run.
  No case is removed after results are seen.
- **Harness failures.** A run fails because of the harness when the runner
  cannot reach the local service, when the service refuses the call before any
  provider attempt (a bad token or configuration, its daily attempt cap), or
  when the service is not the one in Part B. Such a run is not scored: it is
  kept with its cost, the runner stops, and resuming runs the case again. Every
  harness failure is listed with the results. A failed provider call is not a
  harness failure; it is scored.

## 5. Metrics

All figures are counts with their denominators. No percentages. Medians and
p90 use the nearest rank, the value at position ⌈q·n⌉ in sorted order, so the
median of an even count is the lower of the two middle values. Per arm:

| Id | Metric | Definition |
|---|---|---|
| M1 | Valid readings | Readings that pass the service's schema and the Worker's re-check, over cases run |
| M2 | Decisions | 3×3 table of expected against actual decision (plan, clarify, abstain) on the first reading, plus matching abstention categories on cases expected to abstain |
| M3 | After an answer | For runs where the first reading asked a question and the case has a scripted answer: the second reading's decision (plan, still unclear, abstain) or an invalid reading |
| M4 | Drafts | First draft structurally valid; valid after the one retry; failed twice; a draft call failed. These add up to the denominator, runs that reached drafting |
| M5 | Scheduling violations | A plan with a violation never reaches the person: the fit stage stops the run. M5 counts those runs with the rules they broke, plus any violation the runner's own `checkPlan` finds in ready plans. Expected: 0 for both |
| M6 | Code trims | Sessions removed by code per ready plan (median, max), and weeks over their limits |
| M7 | Blind rating | Section 6 |
| M8 | Cost | Micro-dollars per run from reported usage and the arm's rate card (median, max, total) |
| M9 | Latency | Per model call and per run, measured at the runner against a local service (median, p90, max). This is not edge latency |

Comparisons between A and B rest on:

- M7 preference counts;
- M4 counts of drafts that failed twice;
- M5, which must be 0 for both;
- M8 totals.

With one rater and 100 to 150 cases, no significance test is run. The counts
are reported as they are.

## 6. Blind rating

- **Pairs.** Cases where both A and B produced a ready plan.
- **Hiding the systems.** The rating page shows the goal text and the two plans
  as "Plan 1" and "Plan 2". Their order is randomized with a random seed. The
  seed and the key that unblinds the pairs live in a file the page never loads,
  and the owner leaves it closed until the ratings are exported.
- **Scale.** For each plan, the owner rates three statements from 1 to 5:
  - it fits my constraints;
  - the progression makes sense;
  - the sessions are clear and doable.

  Then the owner picks a preferred plan or a tie.
- **Order.** The owner rates before seeing any automatic table (M1–M6, M8, M9).
- **One rater.** There is no agreement statistic, and this is stated as a
  limitation.
- **Record.** Ratings are exported from the page and committed with the run.

## 7. Budget

- **Ceiling.** $10 in total for scored runs, across every arm and any re-runs.
- **Dry runs** try the harness on the template cases, never on
  `evals/cases/cases.jsonl`, so no evaluation case is seen before the scored
  run. They call the real services and cost real money, which is logged as
  development spend apart from the $10. They are never evidence.
- **Worst case per run.** One reading and two drafts, each with two provider
  attempts, priced at the arm's rates. Prompt tokens are taken as the service's
  prompt byte ceiling plus 64 template tokens, and output as the service's
  output token caps. This is the same bound the Worker reserves live.
- **Guard.** Before each case, the runner requires the remaining budget to cover
  every arm's worst case. After each call it charges the reported usage, earlier
  attempts at their worst case, and any call without usage in full.
- **Tokens against bytes.** The bound assumes at most one prompt token per UTF-8
  byte. That was checked for DeepSeek on 2026-09-24: the most expensive valid
  read-goal prompt, 19,846 bytes, was billed as 9,231 tokens. For Arm B it is
  checked once at the freeze with the same prompt, or a margin of 2× is applied.

## 8. Decision rule for retrieval templates

Templates ship only if Arm C beats Arm A on the same cases in a blind rating of
C against A, run the same way as section 6. All three must hold:

- C is preferred in at least 5 more pairs than A;
- C's count of drafts that failed twice (M4) is not higher than A's;
- C has no scheduling violations (M5 = 0).

Otherwise templates do not ship. A tie means they do not ship.

## 9. What this evaluation cannot show

- That the cases represent Cadencia's users. They adapt goals that people chose
  to post in public, which are not a random sample of anyone. Agents drafted
  and audited the labels; one person decided every proposed change and checked
  a random 20.
- Whether people follow the plans or reach their goals.
- Safety beyond the declared abstention categories.
- Behavior, latency or cost on the live edge, or under load.

## 10. Part B: systems (frozen at tag `eval-freeze-v1`)

At the freeze, this section records for each arm:

- the provider and the API model id;
- the request parameters: temperature, the name of the token-limit parameter,
  JSON mode, and any reasoning controls;
- input and output prices per million tokens, with their source and the date
  they were read;
- the service's prompt versions for read-goal and draft;
- the service commit.

GPT-6 Luna's model id, parameters and prices came from OpenAI's API reference,
not from memory.

**Recorded at the freeze, 2026-09-24.** The service commit is the commit the tag
points to.

| | Arm A | Arm B |
|---|---|---|
| Provider and API model id | DeepSeek, `deepseek-flash` | OpenAI, `gpt-6-luna` |
| Endpoint | `https://api.deepseek.com/chat/completions` | `https://api.openai.com/v1/chat/completions` |
| Temperature | 0.2 | 0.2 |
| Token-limit parameter | `max_tokens` | `max_completion_tokens` |
| JSON mode | `response_format: {"type": "json_object"}` | the same |
| Reasoning | thinking disabled: `thinking: {"type": "disabled"}` | `reasoning_effort: "none"` |
| Price per million input tokens, output tokens | $0.30, $1.20 (peak, cache miss) | $0.10, $0.50 (standard) |
| Price source, read on | api-docs.deepseek.com pricing page, 2026-09-24 | developers.openai.com pricing page, 2026-09-24 |
| Prompt versions | `read-goal-f2bbb9b5a76f`, `draft-6ea4a82036d6` | the same |

Why Arm B runs without reasoning: GPT-6 Luna reasons at `medium` by default, and
OpenAI's GPT-6 guide accepts temperature only at `none`. Arm A runs DeepSeek with
thinking disabled, so both arms use the same pipeline, caps and temperature
without hidden reasoning tokens.

**Tokens against bytes (section 7).** Arm A: the most expensive valid read-goal
prompt at the time, 19,846 bytes, was billed as 9,231 tokens (2026-09-24, under
the retired name, which DeepSeek serves with the same Flash model). Arm B: the
most expensive valid read-goal prompt under today's prompt version, 19,798 bytes
(a 2,000-character goal, a 300-character question and a 500-character answer,
all `<`), was billed as 9,184 tokens on 2026-09-24 with the settings above. Both
stay under one token per byte, so no margin is applied.
