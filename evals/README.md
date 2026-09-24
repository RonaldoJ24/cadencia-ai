# Evaluation

The goal planner's evaluation is pre-registered in
[PREREGISTRATION.md](PREREGISTRATION.md). This folder holds the harness. Scored
runs go in `runs/<run-id>/` and are committed with everything they produced.

## Steps

1. **Source and review the cases.** 100 to 150 goals go in `cases/cases.jsonl`,
   in the format of [cases/README.md](cases/README.md). They are drafted from
   goals people describe in public posts, following
   [cases/SOURCING.md](cases/SOURCING.md), audited by a separate agent, and the
   owner decides the audit's proposals and checks a random 20. Their origin and
   review go in `cases/provenance.jsonl`, and the drafts, the seed and the random
   check in `cases/review.json`. Check them:

   ```bash
   node --experimental-strip-types evals/validate.ts evals/cases/cases.jsonl evals/cases/provenance.jsonl
   ```

2. **Freeze Part B.** Fill in `systems.json` for each arm: model id, rate card
   with source and date, and the prompt versions the services report. Set
   `frozen` to `true`, commit, and tag the commit `eval-freeze-v1`. A scored run
   refuses unfrozen systems.

3. **Start one service per arm** on the port listed in `systems.json`. Every
   service runs the same code with the same `CADENCIA_SERVICE_TOKEN`. Raise
   `CADENCIA_SERVICE_DAILY_ATTEMPT_CAP` (400 provider attempts a day by default)
   above what the run can use; the runner's budget guard is the real ceiling. The
   API keys come from git-ignored env files, so they never appear on a command
   line:

   ```bash
   # Arm A: DeepSeek, the default provider (DEEPSEEK_API_KEY in service/.env.local)
   DEEPSEEK_MODEL=... CADENCIA_SERVICE_TOKEN=... CADENCIA_SERVICE_DAILY_ATTEMPT_CAP=2000 \
     uv run --env-file service/.env.local --project service --frozen uvicorn app:app --app-dir service --port 8781
   # Arm B: an OpenAI model (OPENAI_API_KEY in service/.env.eval-openai.local), with every
   # other value taken from the owner or OpenAI's API reference. OPENAI_REASONING_EFFORT
   # is the Chat Completions reasoning control, or "omit" for a model without one.
   CADENCIA_PROVIDER=openai OPENAI_URL=... OPENAI_MODEL=... OPENAI_TOKEN_PARAM=... \
     OPENAI_TEMPERATURE=... OPENAI_REASONING_EFFORT=... \
     CADENCIA_SERVICE_TOKEN=... CADENCIA_SERVICE_DAILY_ATTEMPT_CAP=2000 \
     uv run --env-file service/.env.eval-openai.local --project service --frozen uvicorn app:app --app-dir service --port 8782
   ```

4. **Run** from a clean checkout of the tag. The runner reuses the product's
   pipeline and:

   - checks every service's health and token before the first case, at no cost;
   - refuses a service that reports another prompt version or model;
   - stops at a case boundary before it could pass the budget;
   - stops at once when the harness fails (a service that cannot be reached, or
     that refuses a call before any provider attempt). That run is kept with
     its cost but never scored;
   - stops before the next case after three failed runs in a row on one arm.
     Those failures are scored; look at the provider before resuming.

   Running the same command again resumes the run. It needs the same commit,
   cases and arms, and runs only what has no scored result yet.

   ```bash
   CADENCIA_SERVICE_TOKEN=... node --experimental-strip-types evals/run.ts \
     --cases evals/cases/cases.jsonl --run-id <run-id> --budget-usd 10
   ```

5. **Rate blind, before reading any table.** Make the pack, open
   `rate/index.html` from disk, load `rating-pack.json`, rate every pair, and
   export. Move the exported `ratings-<pack>.json` into the run folder. The
   shuffle seed is random and goes only into `rating-key.json`; leave that file
   closed until the ratings are exported. The page makes no network requests and
   keeps progress in the browser, so a pack can be rated over several sittings.

   ```bash
   node --experimental-strip-types evals/blind.ts --cases evals/cases/cases.jsonl \
     --run evals/runs/<run-id> --arms A,B
   ```

6. **Report.**

   ```bash
   node --experimental-strip-types evals/analyze.ts --cases evals/cases/cases.jsonl --run evals/runs/<run-id>
   node --experimental-strip-types evals/unblind.ts --run evals/runs/<run-id> --ratings evals/runs/<run-id>/ratings-<pack>.json
   ```

`--dry-run` skips the freeze, quota and clean checkout checks, so the harness
can be tried on a few cases. It still calls the real services and spends, so
give it a small budget. Its output goes to `dry-runs/`, which git ignores, and is
never evidence. Until Part B is filled in, only Arm A has a rate card:

```bash
CADENCIA_SERVICE_TOKEN=... node --experimental-strip-types evals/run.ts --dry-run \
  --cases evals/cases/TEMPLATE.jsonl --run-id try-1 --budget-usd 0.5 --arms A
```
