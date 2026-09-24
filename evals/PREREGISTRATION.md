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

1. How often does the planner turn a goal written by a person into the right
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

## 4. Cases

- The owner writes 100 to 150 cases in `evals/cases/cases.jsonl`, following
  `evals/cases/README.md`. An agent does not write, edit or relabel them.
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

  The validator flags any owner case that matches one of these closely. The
  owner decides whether to keep it, and kept matches are listed with the
  results.
- **Exclusions.** A case is excluded only for a validator error before the run.
  No case is removed after results are seen. A case that fails because of the
  harness (the local service is down, a network error before any provider call)
  is re-run once, and both attempts are reported.

## 5. Metrics

All figures are counts with their denominators. No percentages. Per arm:

| Id | Metric | Definition |
|---|---|---|
| M1 | Valid readings | Readings that pass the service's schema and the Worker's re-check, over cases run |
| M2 | Decisions | 3×3 table of expected against actual decision (plan, clarify, abstain) on the first reading, plus matching abstention categories on cases expected to abstain |
| M3 | After an answer | For cases with an expected question and a scripted answer: outcomes of the second reading (plan, still unclear, abstain) |
| M4 | Drafts | First draft structurally valid; valid after the one retry; failed twice. Denominator: runs that reached drafting |
| M5 | Scheduling violations | `checkPlan` violations summed over ready plans. Expected: 0 |
| M6 | Code trims | Sessions removed by code per ready plan (median, max), and weeks over their limits |
| M7 | Blind rating | Section 6 |
| M8 | Cost | Micro-dollars per run from reported usage and the arm's rate card (median, max, total) |
| M9 | Latency | Per stage and per run, measured at the runner against a local service (median, p90, max). This is not edge latency |

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
  as "Plan 1" and "Plan 2". Their order is randomized with a recorded seed, and
  the key that unblinds them lives in a file the page never loads.
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

- **Ceiling.** $10 in total, across every arm and any re-runs. Dry runs against
  a fake service cost nothing.
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

- That the cases represent real users. One person wrote them.
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

GPT-6 Luna's model id, parameters and prices will come from the owner or from
OpenAI's API reference at that time, not from memory.

Development values, not frozen: prompts `read-goal-f2bbb9b5a76f` and
`draft-6ea4a82036d6`; DeepSeek `deepseek-flash` at $0.30 per million input
tokens and $1.20 per million output tokens (peak prices, pricing page read on
2026-09-24).
