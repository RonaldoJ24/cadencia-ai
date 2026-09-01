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
        "title": "Ruta de TypeScript",
        "goal": "Practicar un concepto con una evidencia pequeña.",
        "domain": "learning",
        "steps": [
            {"title": "Define la evidencia", "instructions": "Escribe qué podrás explicar."},
            {"title": "Practica", "instructions": "Resuelve un ejercicio breve."},
        ],
    }
    content = json.dumps(intent, ensure_ascii=False, separators=(",", ":"))
    return json.dumps(
        {"choices": [{"finish_reason": "stop", "message": {"content": content}}]},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


class SmokeProvider:
    def __init__(self) -> None:
        self.calls = 0
        self.success_body = _provider_body()

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        del request
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
const { GET, POST } = await import('./app/api/routine/route.ts');
const input = {
  request: 'aprender TypeScript',
  days: [0],
  sessionMinutes: 30,
  weeklyMinutes: 30,
  startDate: '2026-08-31',
  time: '18:00',
};
async function invoke(mode) {
  return POST(new Request('http://localhost/api/routine', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
const serializedBodies = JSON.stringify({ liveBody, failedBody, demoBody });
console.log(JSON.stringify({
  availability: await availability.json(),
  live: {
    status: live.status,
    mode: livePlan?.mode,
    intentTitle: livePlan?.intent?.title,
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
            returned_bodies_safe = value.get("returnedBodiesSafe")
            if not (
                isinstance(availability, dict)
                and availability.get("liveAvailable") is True
                and isinstance(live, dict)
                and live.get("status") == 200
                and live.get("mode") == "deepseek"
                and live.get("intentTitle") == "Ruta de TypeScript"
                and live.get("stepCount") == 2
                and isinstance(live.get("input"), dict)
                and live["input"].get("sessionMinutes") == 30
                and live["input"].get("startDate") == "2026-08-31"
                and isinstance(live.get("session"), dict)
                and live["session"].get("date") == "2026-08-31"
                and live["session"].get("minutes") == 30
                and live.get("checksPassed") is True
                and isinstance(failed, dict)
                and failed.get("status") == 502
                and failed.get("error") == "El proveedor de IA no está disponible."
                and isinstance(demo, dict)
                and demo.get("status") == 200
                and demo.get("mode") == "demo"
                and isinstance(demo.get("input"), dict)
                and demo["input"].get("sessionMinutes") == 30
                and isinstance(demo.get("session"), dict)
                and demo["session"].get("date") == "2026-08-31"
                and demo["session"].get("minutes") == 30
                and demo.get("checksPassed") is True
                and returned_bodies_safe is True
                and provider.calls == 2
            ):
                raise RuntimeError("smoke assertions failed")
        finally:
            if server is not None:
                server.stop()
        print(json.dumps({
            "status": "ok",
            "provider_calls": provider.calls,
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
