#!/usr/bin/env python3
"""Exercise the Python service and the public route over a local HTTP hop.

This is test tooling only. The Python provider client is replaced in memory
with an httpx MockTransport; the production service has no fixture switch.
One goal run plans end to end, one gets unreadable provider output that must
never reach the browser, and one replan picks an option, so the Worker's
request matches the service's strict schema field for field.
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


ROOT = Path(__file__).resolve().parents[1]
SERVICE_DIR = ROOT / "service"
TOKEN = "cadencia-smoke-token"
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
REPLAN_PICK = {"decision": "pick", "option": "keep", "why": "You are ready to go on, so keep the plan as it is.", "abstain": None}


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

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        import planning

        self.calls += 1
        messages = json.loads(request.content)["messages"]
        if messages[0]["content"] == planning.READ_GOAL_PROMPT:
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
            prefix = "Plan calendar, fixed by code: "
            line = next(item for item in messages[1]["content"].splitlines() if item.startswith(prefix))
            return _envelope(_goal_draft(json.loads(line[len(prefix):])))
        if messages[0]["content"] == planning.REPLAN_PROMPT:
            return _envelope(REPLAN_PICK)
        return httpx.Response(500, content=b"unexpected provider request")


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
const { SseParser } = await import('./lib/sse.ts');
const today = new Date().toISOString().slice(0, 10);
function goalRequest(text, ip, stream) {
  return new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': ip,
      ...(stream ? { accept: 'text/event-stream' } : {}),
    },
    body: JSON.stringify({ mode: 'live', kind: 'goal', input: { text, language: 'en', today } }),
  });
}
const availability = await GET();
const goal = await POST(goalRequest('Learn TypeScript on Monday and Wednesday evenings', '127.0.0.2', true));
const messages = [];
const parser = new SseParser((message) => messages.push(message));
parser.push(await goal.text());
parser.end();
const result = JSON.parse(messages.at(-1)?.data ?? '{}');
const ledger = db.raw.prepare('SELECT status, actual_microusd FROM spend_ledger').get();
const failed = await POST(goalRequest('Goal for the leak check', '127.0.0.3', false));
const failedBody = await failed.json();
const summary = (id, deadline, weeksLeft) => ({ id, deadline, weeksLeft, sessionsLeft: 12, minutesLeft: 360, nextSevenDaysMinutes: 60, sessionsLeftOut: 2 });
const replan = await POST(new Request('http://localhost/api/routine', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '127.0.0.4', accept: 'text/event-stream' },
  body: JSON.stringify({ mode: 'live', kind: 'replan', input: {
    language: 'en', today, domain: 'learning', level: 'unknown',
    situation: { missedSessions: 2, missedWeeks: 1, weeksLeft: 6 },
    options: [summary('keep', '2026-12-01', 6), summary('extend', '2026-12-08', 7)],
    reason: 'I just forgot last week, but I am ready now.',
  } }),
}));
const replanMessages = [];
const replanParser = new SseParser((message) => replanMessages.push(message));
replanParser.push(await replan.text());
replanParser.end();
const replanResult = JSON.parse(replanMessages.at(-1)?.data ?? '{}');
const replanLedger = db.raw.prepare('SELECT status, actual_microusd FROM spend_ledger ORDER BY rowid DESC LIMIT 1').get();
const serialized = JSON.stringify({ result, failedBody });
console.log(JSON.stringify({
  availability: await availability.json(),
  goal: {
    status: goal.status,
    outcome: result?.outcome ?? null,
    stages: messages
      .filter((message) => message.event === 'stage')
      .map((message) => JSON.parse(message.data))
      .filter((event) => event.status !== 'started')
      .map((event) => `${event.stage}:${event.status}`),
    sessions: (result?.plan?.weeks ?? []).reduce((total, week) => total + week.sessions.length, 0),
    ledger: ledger ?? null,
  },
  failed: { status: failed.status, error: failedBody?.error ?? null },
  replan: {
    status: replan.status,
    outcome: replanResult?.outcome ?? null,
    option: replanResult?.option ?? null,
    stages: replanMessages
      .filter((message) => message.event === 'stage')
      .map((message) => JSON.parse(message.data))
      .filter((event) => event.status !== 'started')
      .map((event) => `${event.stage}:${event.status}`),
    ledger: replanLedger ?? null,
  },
  returnedBodiesSafe: !serialized.includes('smoke-token') && !serialized.includes('upstream secret'),
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
            availability = value.get("availability")
            goal = value.get("goal")
            failed = value.get("failed")
            replan = value.get("replan")
            if not (
                isinstance(availability, dict)
                and availability.get("liveAvailable") is True
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
                # Two calls at 500 in and 300 out settle at 200 micro-USD each (Luna's rates).
                and goal.get("ledger") == {"status": "settled", "actual_microusd": 400}
                and isinstance(failed, dict)
                and failed.get("status") == 502
                and failed.get("error") == "The AI provider is not available."
                and isinstance(replan, dict)
                and replan.get("status") == 200
                and replan.get("outcome") == "suggested"
                and replan.get("option") == "keep"
                and replan.get("stages") == [
                    "check_request:completed",
                    "reserve:completed",
                    "pick_option:completed",
                    "check_pick:completed",
                ]
                and replan.get("ledger") == {"status": "settled", "actual_microusd": 200}
                and value.get("returnedBodiesSafe") is True
                # The leak check's non-JSON answer is retried once: 2 + 2 + 1 calls.
                and provider.calls == 5
            ):
                raise RuntimeError("smoke assertions failed")
        finally:
            if server is not None:
                server.stop()
        print(json.dumps({"status": "ok", "provider_calls": provider.calls, "service_transport": "loopback"}))
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
