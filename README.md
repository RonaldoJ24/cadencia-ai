# Cadencia

Cadencia is a small Spanish language routine compiler. You describe what you want to keep doing, choose the days and time that are actually available, and receive a weekly plan that can be inspected, adjusted, and downloaded.

The product separates two jobs. The optional provider can propose the intent and session content; the deterministic engine checks the selected Monday week, allowed days, session duration, local time, and weekly cap. Values from the controls always win over details in the free text request. The local demo uses no model and carries the label `Demo local · sin modelo`; it must not be read as a successful AI response.

The product sample is Spanish even when the goal is English practice:

> Practicar inglés para entrevistas de trabajo, con foco en responder con más seguridad.

You can also load examples for learning TypeScript or writing every week. After generating a plan, mark a session complete, ask Cadencia to replan a missed session, inspect the understood intent and deterministic checks, or download Markdown and ICS files. Plans exist only in the current browser session and are not saved when the tab closes.

## Local setup

From the app directory:

```bash
npm install
npm run dev
```

Run the checks used by CI:

```bash
npm test
npm run typecheck
npm run build
```

The local demo is the default path. It calls `buildPlan` in the browser and makes no paid provider request. A server route can optionally use DeepSeek when the backend is explicitly enabled and a user chooses `IA conectada`; the browser never receives the API key. The live path sends the request text to DeepSeek, so avoid sensitive information and review the provider's current pricing and data terms before enabling it.

Copy `.env.example` to `.env.local` only when configuring the optional backend:

```text
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
CADENCIA_ENABLE_LIVE=false
```

Keep `CADENCIA_ENABLE_LIVE=false` for a local demo. No paid calls are enabled by this repository's defaults, and an empty key keeps the connected mode disabled. The server validates provider output before scheduling. To enable the optional provider, configure the key on the server and set the flag to `true`, then explicitly select the live mode in the UI. Restrict live deployments to local or owner-only use; authentication, quotas, and abuse controls are required before offering paid generation publicly.

## Current limits

- Cadencia covers learning, creative practice, and general personal work. A lightweight word-based guard rejects common requests for medical, exercise, financial, or legal guidance; it is not comprehensive content moderation.
- The first version plans one weekly Monday-to-Sunday window. The selected date must be a Monday, and sessions use the chosen local time.
- The weekly cap may leave some selected days without a session; Cadencia shows that conflict instead of inventing time.
- There are no accounts, persistence, reminders, connected calendars, payments, or background jobs.
- The live DeepSeek path is optional and has no quality benchmark in this project. Deterministic fixture checks are evidence about the scheduler, not measurements of model quality.

This is a portfolio demo and an explicit boundary for future work, not a production readiness claim.

## Project notes

- [Concept and original direction](docs/CONCEPT.md)
- [Implementation roadmap](docs/ROADMAP.md)
- [AI contract and safety boundaries](docs/AI-CONTRACT.md)
- [Research from official product sources](docs/RESEARCH.md)
- [Launch narrative](docs/LAUNCH.md)
- [Delivery and verification](docs/DELIVERY.md)
