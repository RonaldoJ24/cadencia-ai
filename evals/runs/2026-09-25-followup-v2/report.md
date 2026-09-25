# Evaluation report: 2026-09-25-followup-v2

Counts with their denominators, as pre-registered in `evals/PREREGISTRATION.md`. 148 cases in the file.

## Cases

| Origin and review | Cases |
|---|---:|
| origin post | 63 |
| origin composite | 17 |
| origin constructed | 68 |
| posts read in full | 63 |
| posts read from a search result | 0 |
| review accepted | 118 |
| review relabeled | 1 |
| review rewritten | 29 |

Drafts written: 150. Dropped in the audit and review: 2.

The owner's random check: agreed with 20 of 20 labels.

Cases close to development texts, kept: none.

## M1 Valid readings

| Metric | Arm B2 |
|---|---:|
| Readings that passed every check / cases run | 147 / 148 |

## M2 Decisions (expected → actual, first reading)

Arm B2:

| Expected | plan | clarify | abstain | invalid |
|---|---:|---:|---:|---:|
| plan | 92 | 1 | 5 | 1 |
| clarify | 5 | 18 | 2 | 0 |
| abstain | 0 | 0 | 24 | 0 |

Matching abstention categories: 21 / 24
Readings the service's scope guard declined: 6

## M3 After a scripted answer (the second reading)

| Decision | Arm B2 |
|---|---:|
| Runs with an answer | 18 |
| Plan | 17 |
| Still unclear | 0 |
| Abstain | 1 |
| Invalid reading | 0 |

## M4 Drafts

| Drafts | Arm B2 |
|---|---:|
| Runs that reached drafting | 114 |
| First draft well-formed | 111 / 114 |
| Well-formed after the retry | 0 |
| Failed twice | 0 |
| A draft call failed | 3 |

## M5 Scheduling violations

| Violations | Arm B2 |
|---|---:|
| Runs the fit stage stopped on checkPlan violations | 0 |
| Rules broken in those runs | none |
| Violations the runner found in ready plans | 0 |

## M6 Code trims

| Per ready plan | Arm B2 |
|---|---:|
| Ready plans | 111 |
| Sessions trimmed (median, max) | 0, 18 |
| Weeks over their limits (median, max) | 0, 18 |

## M8 Cost

| Per run | Arm B2 |
|---|---:|
| Median | $0.0009 |
| Max | $0.0015 |
| Total | $0.1185 |
| Runs stopped by the harness, not scored | 0, $0.0000 |

## M9 Latency at the runner (local service, not the edge)

| Milliseconds: median / p90 / max (n) | Arm B2 |
|---|---:|
| Read-goal call | 1699 / 1993 / 2988 (166) |
| Draft call | 12682 / 16412 / 20709 (114) |
| Whole run | 13040 / 17296 / 22266 (166) |

## Failed runs by stage and code

Arm B2: read_goal:backend_rejected 1, draft:backend_rejected 3

M7, the blind rating, is reported separately after unblinding.
