# AGENTS.md

Rules for anyone, human or agent, changing this repository.

## Product principles

- The model proposes, code decides, the person approves. Dates, durations, caps
  and anything checkable are computed and validated in code; model output is
  untrusted until it passes the same validation as user input.
- Treat the user's text as untrusted input to the model: escape it inside the
  prompt and never let it change instructions, tools or limits.
- Every step the UI shows must correspond to work that is actually running. No
  timers, canned animations or invented durations.
- Unknowns stay explicit. When the code cannot tell, it says so instead of
  guessing.

## Evidence

- Every number in the docs comes from a run whose outputs are committed. No
  numbers from memory, ignored folders or other projects. Engineering numbers
  live in `docs/evidence/` (command, commit, date, raw output); model-quality
  numbers only in a scored run under `evals/runs/`.
- Eval labels never reach prompts, and any exposure of a held-out set is
  recorded, not hidden.
- A written test is not a passed test. Report what was run and its result.
- Live model runs are explicit, budgeted commands. They never run in CI.

## Spend and production

- Production deploys, D1 migrations and paid model calls each need the owner's
  explicit approval. Deploy only with `npm run deploy` (see DEPLOYMENT.md).
- Never hold a D1 transaction open across a provider call.
- Health checks do not touch the database, and nothing pings the services to
  keep them awake.
- Secrets live in platform secret stores. Nothing secret goes into the browser,
  the repo or logs.

## Working in the repo

- One branch and one pull request per phase; land pull requests with a merge
  commit.
- Keep these green before asking for review:

  ```bash
  npm test
  npm run typecheck
  npm run lint
  npm run build
  uv run --project service --frozen python -m pytest service
  uv run --project service --frozen ruff check service
  ```

- Write code, comments, commits and new docs in English. Product copy is
  English first with a Spanish translation. Existing Spanish docs stay as they
  are unless the owner asks otherwise.
- Commit under the owner's git identity only, with no AI attribution trailers.
