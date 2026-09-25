# Evaluation report: 2026-09-24-freeze-v1

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

| Metric | Arm A | Arm B |
|---|---:|---:|
| Readings that passed every check / cases run | 147 / 148 | 147 / 148 |

## M2 Decisions (expected → actual, first reading)

Arm A:

| Expected | plan | clarify | abstain | invalid |
|---|---:|---:|---:|---:|
| plan | 88 | 2 | 8 | 1 |
| clarify | 7 | 15 | 3 | 0 |
| abstain | 0 | 0 | 24 | 0 |

Matching abstention categories: 21 / 24
Readings the service's scope guard declined: 6

Arm B:

| Expected | plan | clarify | abstain | invalid |
|---|---:|---:|---:|---:|
| plan | 82 | 2 | 14 | 1 |
| clarify | 7 | 16 | 2 | 0 |
| abstain | 0 | 0 | 24 | 0 |

Matching abstention categories: 20 / 24
Readings the service's scope guard declined: 6

## M3 After a scripted answer (the second reading)

| Decision | Arm A | Arm B |
|---|---:|---:|
| Runs with an answer | 15 | 16 |
| Plan | 14 | 15 |
| Still unclear | 0 | 0 |
| Abstain | 1 | 1 |
| Invalid reading | 0 | 0 |

## M4 Drafts

| Drafts | Arm A | Arm B |
|---|---:|---:|
| Runs that reached drafting | 109 | 104 |
| First draft well-formed | 103 / 109 | 102 / 104 |
| Well-formed after the retry | 1 | 0 |
| Failed twice | 0 | 0 |
| A draft call failed | 5 | 2 |

## M5 Scheduling violations

| Violations | Arm A | Arm B |
|---|---:|---:|
| Runs the fit stage stopped on checkPlan violations | 0 | 0 |
| Rules broken in those runs | none | none |
| Violations the runner found in ready plans | 0 | 0 |

## M6 Code trims

| Per ready plan | Arm A | Arm B |
|---|---:|---:|
| Ready plans | 104 | 102 |
| Sessions trimmed (median, max) | 0, 26 | 0, 35 |
| Weeks over their limits (median, max) | 0, 20 | 0, 18 |

## M8 Cost

| Per run | Arm A | Arm B |
|---|---:|---:|
| Median | $0.0023 | $0.0008 |
| Max | $0.0045 | $0.0014 |
| Total | $0.2910 | $0.1084 |
| Runs stopped by the harness, not scored | 0, $0.0000 | 0, $0.0000 |

## M9 Latency at the runner (local service, not the edge)

| Milliseconds: median / p90 / max (n) | Arm A | Arm B |
|---|---:|---:|
| Read-goal call | 1187 / 1510 / 1729 (163) | 1906 / 2476 / 4342 (164) |
| Draft call | 5727 / 6758 / 7903 (110) | 12454 / 17086 / 20400 (104) |
| Whole run | 6359 / 7849 / 13288 (163) | 12162 / 18216 / 22914 (164) |

## Failed runs by stage and code

Arm A: read_goal:backend_rejected 1, draft:backend_rejected 5
Arm B: read_goal:backend_rejected 1, draft:backend_rejected 2

M7, the blind rating, is reported separately after unblinding.
