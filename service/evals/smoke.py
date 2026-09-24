#!/usr/bin/env python3
"""Exercise the Python service and Next.js route over a local HTTP hop.

This is test tooling only.  The Python provider client is replaced in memory
with an httpx MockTransport; the production service has no fixture switch.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import httpx


ROOT = Path(__file__).resolve().parents[2]
SERVICE_DIR = ROOT / "service"
TOKEN = "cadencia-smoke-token"


def _provider_body() -> bytes:
    intent = {
        "title": "TypeScript practice",
        "goal": "Practice one concept with a small piece of evidence.",
        "domain": "learning",
        "steps": [
            {
                "title": "Practice and verify",
                "instructions": "Complete one exercise with visible evidence.",
                "blocks": [
                    {"minutes": 5, "activity": "Define what you will demonstrate."},
                    {"minutes": 20, "activity": "Solve one short exercise."},
                    {"minutes": 5, "activity": "Review the result and note the next step."},
                ],
                "deliverable": "One solved, dated exercise.",
                "done_when": "The exercise works and the next step is written down.",
            },
        ],
    }
    content = json.dumps(intent, ensure_ascii=False, separators=(",", ":"))
    return json.dumps(
        {"choices": [{"finish_reason": "stop", "message": {"content": content}}]},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


GOAL_READING = {
    "decision": "plan",
    "title": "Learn TypeScript",
    "summary": "Learn TypeScript on Monday and Wednesday evenings.",
    "domain": "learning",
    "level": "unknown",
    "deadline": None,
    "deadline_basis": "none",
    "days": [0, 2],
    "window": "evening",
    "weekly_minutes": 60,
    "session_minutes": 30,
    "question": None,
    "abstain": None,
}
GOAL_USAGE = {"prompt_tokens": 500, "completion_tokens": 300, "total_tokens": 800}


def _envelope(content: dict[str, Any]) -> httpx.Response:
    body = {
        "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(content)}}],
        "usage": GOAL_USAGE,
    }
    return httpx.Response(200, content=json.dumps(body).encode("utf-8"), headers={"content-type": "application/json"})


def _goal_draft(calendar: dict[str, Any]) -> dict[str, Any]:
    """A draft that fits whatever calendar code sent, as a well-behaved model would."""

    weeks = calendar["weeks"]
    return {
        "phases": [{"title": "Practice", "fromWeek": 1, "toWeek": len(weeks), "focus": "Practise a little every week."}],
        "sessionTypes": [
            {
                "id": "practice",
                "title": "Typed practice",
                "minutes": 30,
                "intensity": "moderate",
                "role": "key",
                "blocks": [
                    {"minutes": 5, "activity": "Pick one concept."},
                    {"minutes": 20, "activity": "Write and compile a small example."},
                    {"minutes": 5, "activity": "Note what to try next."},
                ],
                "deliverable": "One compiled example.",
                "doneWhen": "The example compiles.",
            }
        ],
        "weeks": [
            {"week": week["week"], "sessions": ["practice"] * min(week["room"], week["maxMinutes"] // 30)}
            for week in weeks
        ],
        "templateId": None,
    }


class SmokeProvider:
    def __init__(self) -> None:
        self.calls = 0
        self.goal_calls = 0
        self.success_body = _provider_body()

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        import planning

        messages = json.loads(request.content)["messages"]
        if messages[0]["content"] == planning.READ_GOAL_PROMPT:
            self.goal_calls += 1
            if "leak check" in messages[1]["content"]:
                # Unparseable provider output must stay behind the service
                # and the route's error boundary.
                return httpx.Response(
                    200,
                    content=b'{"choices":[{"finish_reason":"stop","message":{"content":"upstream secret"}}]}',
                    headers={"content-type": "application/json"},
                )
            return _envelope(GOAL_READING)
        if messages[0]["content"] == planning.DRAFT_PROMPT:
            self.goal_calls += 1
            prefix = "Plan calendar, fixed by code: "
            line = next(item for item in messages[1]["content"].splitlines() if item.startswith(prefix))
            return _envelope(_goal_draft(json.loads(line[len(prefix):])))
        self.calls += 1
        if self.calls == 1:
            return httpx.Response(
                200,
                content=self.success_body,
                headers={"content-type": "application/json"},
            )
        # The second live call proves that provider details stay behind a safe
        # service/Next.js error boundary.  The service does not retry malformed
        # output, so this remains one provider call.
        return httpx.Response(
            200,
            content=b'{"choices":[{"finish_reason":"stop","message":{"content":"upstream secret"}}]}',
            headers={"content-type": "application/json"},
        )


class LocalServer:
    def __init__(self, application: Any, provider: SmokeProvider) -> None:
        self.application = application
        self.provider = provider
        self.port = self._ephemeral_port()
        self.provider_client = httpx.AsyncClient(transport=httpx.MockTransport(provider))
        self.application.state.provider_client = self.provider_client
        try:
            import uvicorn
        except ImportError as error:  # pragma: no cover - dependency comes from service
            raise RuntimeError("uvicorn is required for the smoke test") from error
        self.server = uvicorn.Server(
            uvicorn.Config(
                application,
                host="127.0.0.1",
                port=self.port,
                log_level="critical",
                access_log=False,
                lifespan="off",
            )
        )
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    @staticmethod
    def _ephemeral_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])

    def start(self) -> None:
        self.thread.start()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                response = httpx.get(
                    f"http://127.0.0.1:{self.port}/healthz",
                    timeout=0.25,
                )
                if response.status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.03)
        raise RuntimeError("local Python service did not start")

    def stop(self) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=5)
        asyncio.run(self.provider_client.aclose())


def _node_script() -> str:
    return r'''
const { DatabaseSync } = await import('node:sqlite');
const { readFileSync } = await import('node:fs');
// Live mode fails closed without its D1 quota tables, so the smoke gives the
// route an in-memory SQLite database with the same migrations as production.
function sqliteDb() {
  const raw = new DatabaseSync(':memory:');
  const wrap = (sql) => {
    let params = [];
    const api = {
      bind(...values) { params = values; return api; },
      async first() { return raw.prepare(sql).get(...params) ?? null; },
      async all() { return { results: raw.prepare(sql).all(...params) }; },
      async run() { return api.runSync(); },
      runSync() {
        const info = raw.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(info.changes) } };
      },
    };
    return api;
  };
  return {
    raw,
    prepare: (sql) => wrap(sql),
    batch: async (statements) => {
      raw.exec('BEGIN');
      try {
        const out = statements.map((statement) => statement.runSync());
        raw.exec('COMMIT');
        return out;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
const db = sqliteDb();
db.raw.exec('PRAGMA foreign_keys = ON');
for (const file of ['0001_beta_loop.sql', '0002_rate_limits.sql', '0003_public_limits.sql', '0005_spend_controls.sql']) {
  db.raw.exec(readFileSync(`./migrations/${file}`, 'utf8'));
}
globalThis.__cadencia_db = db;
const { GET, POST } = await import('./app/api/routine/route.ts');
const input = {
  request: 'aprender TypeScript',
  language: 'en',
  days: [0],
  sessionMinutes: 30,
  weeklyMinutes: 30,
  startDate: '2026-08-31',
  time: '18:00',
};
async function invoke(mode) {
  return POST(new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '127.0.0.1' },
    body: JSON.stringify({ input, mode }),
  }));
}
const availability = await GET();
const live = await invoke('deepseek');
const liveBody = await live.json();
const failed = await invoke('deepseek');
const failedBody = await failed.json();
const demo = await invoke('demo');
const demoBody = await demo.json();
const livePlan = liveBody?.plan;
const demoPlan = demoBody?.plan;
// A goal run over the same loopback hop: read, size, draft, check and fit.
const { SseParser } = await import('./lib/sse.ts');
const goal = await POST(new Request('http://localhost/api/routine', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'cf-connecting-ip': '127.0.0.2' },
  body: JSON.stringify({
    mode: 'deepseek',
    kind: 'goal',
    input: { text: 'Learn TypeScript on Monday and Wednesday evenings', language: 'en', today: new Date().toISOString().slice(0, 10) },
  }),
}));
const goalMessages = [];
const parser = new SseParser((message) => goalMessages.push(message));
parser.push(await goal.text());
parser.end();
const goalResult = JSON.parse(goalMessages.at(-1)?.data ?? '{}');
const goalLedger = db.raw.prepare("SELECT status, actual_microusd FROM spend_ledger WHERE reserved_microusd > 20000").get();
const goalFailed = await POST(new Request('http://localhost/api/routine', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '127.0.0.3' },
  body: JSON.stringify({
    mode: 'deepseek',
    kind: 'goal',
    input: { text: 'Goal for the leak check', language: 'en', today: new Date().toISOString().slice(0, 10) },
  }),
}));
const goalFailedBody = await goalFailed.json();
const serializedBodies = JSON.stringify({ liveBody, failedBody, demoBody, goalResult, goalFailedBody });
console.log(JSON.stringify({
  availability: await availability.json(),
  live: {
    status: live.status,
    mode: livePlan?.mode,
    intentTitle: livePlan?.intent?.title,
    intentGoal: livePlan?.intent?.goal,
    stepCount: livePlan?.intent?.steps?.length,
    session: livePlan?.sessions?.[0] ?? null,
    input: livePlan?.input ?? null,
    checksPassed: Array.isArray(livePlan?.checks) && livePlan.checks.every((check) => check?.passed === true),
  },
  failed: { status: failed.status, error: failedBody?.error ?? null },
  demo: {
    status: demo.status,
    mode: demoPlan?.mode,
    session: demoPlan?.sessions?.[0] ?? null,
    input: demoPlan?.input ?? null,
    checksPassed: Array.isArray(demoPlan?.checks) && demoPlan.checks.every((check) => check?.passed === true),
  },
  goal: {
    status: goal.status,
    outcome: goalResult?.outcome ?? null,
    stages: goalMessages
      .filter((message) => message.event === 'stage')
      .map((message) => JSON.parse(message.data))
      .filter((event) => event.status !== 'started')
      .map((event) => `${event.stage}:${event.status}`),
    sessions: (goalResult?.plan?.weeks ?? []).reduce((total, week) => total + week.sessions.length, 0),
    ledger: goalLedger ?? null,
    failedStatus: goalFailed.status,
    failedError: goalFailedBody?.error ?? null,
  },
  returnedBodiesSafe: !serializedBodies.includes('smoke-token') && !serializedBodies.includes('upstream secret'),
}));
'''


def _run_node(repo: Path, port: int) -> dict[str, Any]:
    environment = os.environ.copy()
    environment.update(
        {
            "CADENCIA_ENABLE_LIVE": "true",
            "CADENCIA_INTENT_SERVICE_URL": f"http://127.0.0.1:{port}",
            "CADENCIA_SERVICE_TOKEN": TOKEN,
            # The route catches the unavailable Cloudflare runtime import and
            # uses these process values, just as local Node execution does.
            "DEEPSEEK_API_KEY": "",
            "DEEPSEEK_MODEL": "",
        }
    )
    result = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            "--input-type=module",
            "--eval",
            _node_script(),
        ],
        cwd=repo,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("Next.js route smoke process failed")
    try:
        value = json.loads(result.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as error:
        raise RuntimeError("Next.js route smoke output was not JSON") from error
    if not isinstance(value, dict):
        raise RuntimeError("Next.js route smoke output was not an object")
    return value


def main() -> int:
    previous = {name: os.environ.get(name) for name in ("CADENCIA_SERVICE_TOKEN", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL")}
    os.environ["CADENCIA_SERVICE_TOKEN"] = TOKEN
    os.environ["DEEPSEEK_API_KEY"] = "cadencia-smoke-key"
    os.environ["DEEPSEEK_MODEL"] = "deepseek-v4-flash"
    old_path = str(SERVICE_DIR)
    if old_path not in sys.path:
        sys.path.insert(0, old_path)
    try:
        from app import app

        provider = SmokeProvider()
        server: LocalServer | None = None
        try:
            server = LocalServer(app, provider)
            server.start()
            value = _run_node(ROOT, server.port)
            live = value.get("live")
            failed = value.get("failed")
            demo = value.get("demo")
            availability = value.get("availability")
            goal = value.get("goal")
            returned_bodies_safe = value.get("returnedBodiesSafe")
            if not (
                isinstance(availability, dict)
                and availability.get("liveAvailable") is True
                and isinstance(live, dict)
                and live.get("status") == 200
                and live.get("mode") == "deepseek"
                and live.get("intentTitle") == "TypeScript practice"
                and live.get("intentGoal") == "Practice one concept with a small piece of evidence."
                and live.get("stepCount") == 1
                and isinstance(live.get("input"), dict)
                and live["input"].get("sessionMinutes") == 30
                and live["input"].get("startDate") == "2026-08-31"
                and live["input"].get("language") == "en"
                and isinstance(live.get("session"), dict)
                and live["session"].get("date") == "2026-08-31"
                and live["session"].get("minutes") == 30
                and live["session"].get("instructions") == "Complete one exercise with visible evidence."
                and live["session"].get("deliverable") == "One solved, dated exercise."
                and live["session"].get("doneWhen") == "The exercise works and the next step is written down."
                and live.get("checksPassed") is True
                and isinstance(failed, dict)
                and failed.get("status") == 502
                and failed.get("error") == "The AI provider is not available."
                and isinstance(demo, dict)
                and demo.get("status") == 200
                and demo.get("mode") == "demo"
                and isinstance(demo.get("input"), dict)
                and demo["input"].get("sessionMinutes") == 30
                and demo["input"].get("language") == "en"
                and isinstance(demo.get("session"), dict)
                and demo["session"].get("date") == "2026-08-31"
                and demo["session"].get("minutes") == 30
                and demo["session"].get("instructions", "").startswith("Complete session")
                and demo.get("checksPassed") is True
                and isinstance(goal, dict)
                and goal.get("status") == 200
                and goal.get("outcome") == "ready"
                and goal.get("stages") == [
                    "check_request:completed",
                    "reserve:completed",
                    "read_goal:completed",
                    "check_availability:completed",
                    "draft:completed",
                    "check_draft:completed",
                    "fit:completed",
                ]
                and isinstance(goal.get("sessions"), int)
                and goal["sessions"] > 0
                # Two calls at 500 in and 300 out settle at 510 micro-USD each.
                and goal.get("ledger") == {"status": "settled", "actual_microusd": 1_020}
                and goal.get("failedStatus") == 502
                and goal.get("failedError") == "The AI provider is not available."
                and returned_bodies_safe is True
                and provider.calls == 2
                and provider.goal_calls == 3
            ):
                raise RuntimeError("smoke assertions failed")
        finally:
            if server is not None:
                server.stop()
        print(json.dumps({
            "status": "ok",
            "provider_calls": provider.calls,
            "goal_provider_calls": provider.goal_calls,
            "demo_preserved_no_provider_call": True,
            "service_transport": "loopback",
        }))
        return 0
    except (ImportError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Smoke test failed: {error}", file=sys.stderr)
        return 1
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


if __name__ == "__main__":
    raise SystemExit(main())
