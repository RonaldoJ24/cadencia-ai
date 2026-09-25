# Evidence

Every number the README, the case study or a CV line quotes about Cadencia's
engineering comes from a file here. Each file records the command, the commit it
ran against, the date, the machine and the raw output. They were regenerated at
the commit named in each file, not copied from earlier notes.

| Claim | File | Command |
|---|---|---|
| 143 TypeScript tests pass on Node 26 | [tests-typescript.txt](tests-typescript.txt) | `npm test` |
| The same 143 pass on Node 22 | [tests-typescript-node22.txt](tests-typescript-node22.txt) | `node --test` under `node@22` |
| 109 service tests pass, each listed | [tests-python.txt](tests-python.txt) | `uv run --project service --frozen pytest service -vv` |
| The Worker route and the real service agree end to end, with a fake provider: a goal plan, a leak check and a replan | [smoke.txt](smoke.txt) | `uv run --project service --frozen python service/smoke.py` |
| Scheduling 2,000 busy times over the longest plan: median 389.7 ms before the per-date index, 6.4 ms after | [bench-busy.txt](bench-busy.txt) | `node --experimental-strip-types scripts/bench-busy.mts`, on both versions |
| One live goal run with 2,000 busy times used 53 ms of Worker CPU (7.7 s wall time, including two model calls) | [edge-cpu.txt](edge-cpu.txt) | `wrangler tail` during a live run from Cloud Build |

What these files do not show:

- **Model quality.** No scored evaluation has run yet. The pre-registration is in
  [evals/PREREGISTRATION.md](../../evals/PREREGISTRATION.md), and results will be
  committed with the run under `evals/runs/`. Development checks against the real
  model (prompt probes, dry runs, the demo's recordings) are described in pull
  requests but are not evidence and are not quoted as results.
- **Behavior under load.** The edge figure is one request, not a distribution.
- **Timings elsewhere.** Local timings come from one machine and will differ on
  another; the ratio between the two versions is the point.

Design constants, such as the spend reservations (23,584 micro-USD for a goal run,
1,952 for a replan, at GPT-6 Luna's prices), the caps and the request limits, are stated with a pointer
to the code that defines them, in [DEPLOYMENT.md](../../DEPLOYMENT.md).
