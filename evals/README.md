# Evaluation

The goal planner's evaluation is pre-registered in
[PREREGISTRATION.md](PREREGISTRATION.md). This folder holds the harness. Scored
runs go in `runs/<run-id>/` and are committed with everything they produced.

## Steps

1. **Write the cases.** The owner writes 100 to 150 goals in `cases/cases.jsonl`,
   following [cases/README.md](cases/README.md), then checks them:

   ```bash
   node --experimental-strip-types evals/validate.ts evals/cases/cases.jsonl
   ```

2. **Freeze Part B.** Fill in `systems.json` for each arm: model id, rate card
   with source and date, and the prompt versions the services report. Set
   `frozen` to `true`, commit, and tag the commit `eval-freeze-v1`. A scored run
   refuses unfrozen systems.

3. **Start one service per arm** on the port listed in `systems.json`. Every
   service runs the same code with the same `CADENCIA_SERVICE_TOKEN`:

   ```bash
   # Arm A: DeepSeek, the default provider
   DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=... CADENCIA_SERVICE_TOKEN=... \
     uv run --project service --frozen uvicorn app:app --app-dir service --port 8781
   # Arm B: an OpenAI model, with every value taken from the owner or OpenAI's API reference
   CADENCIA_PROVIDER=openai OPENAI_API_KEY=... OPENAI_URL=... OPENAI_MODEL=... \
     OPENAI_TOKEN_PARAM=... OPENAI_TEMPERATURE=... CADENCIA_SERVICE_TOKEN=... \
     uv run --project service --frozen uvicorn app:app --app-dir service --port 8782
   ```

4. **Run.** The runner reuses the product's pipeline and stops at a case
   boundary before it could pass the budget. It can resume.

   ```bash
   CADENCIA_SERVICE_TOKEN=... node --experimental-strip-types evals/run.ts \
     --cases evals/cases/cases.jsonl --run-id <run-id> --budget-usd 10
   ```

5. **Rate blind, before reading any table.** Make the pack, open
   `rate/index.html` from disk, load `rating-pack.json`, rate every pair, and
   export the ratings into the run folder:

   ```bash
   node --experimental-strip-types evals/blind.ts --cases evals/cases/cases.jsonl \
     --run evals/runs/<run-id> --arms A,B --seed <integer>
   ```

6. **Report.**

   ```bash
   node --experimental-strip-types evals/analyze.ts --cases evals/cases/cases.jsonl --run evals/runs/<run-id>
   node --experimental-strip-types evals/unblind.ts --run evals/runs/<run-id> --ratings evals/runs/<run-id>/ratings.json
   ```

To check the harness without spending, pass `--dry-run`. Output goes to
`dry-runs/`, which git ignores, and is never evidence.
