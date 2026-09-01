#!/usr/bin/env python3
"""Replay Cadencia intent cases through the real FastAPI/provider boundary.

The default mode is deliberately offline: the service receives a real HTTP
request through ASGI and its provider client is an httpx MockTransport.  Live
evaluation is opt-in and never uses the replay transport.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import math
import os
import re
import sys
import time
import unicodedata
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

import httpx


ROOT = Path(__file__).resolve().parents[2]
SERVICE_DIR = ROOT / "service"
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))
from provider import (  # noqa: E402
    DEFAULT_MODEL,
    PROMPT_VERSION,
    ProviderAttemptLimitError,
)
from evidence import (  # noqa: E402
    canonical,
    corpus_info,
    digest,
    live_preflight,
    new_run_id,
    source_revision,
    validate_id,
    write_new,
)


DEFAULT_CASES = Path(__file__).with_name("cases.jsonl")
DEFAULT_FIXTURES = Path(__file__).with_name("fixtures") / "provider_responses.json"
DEFAULT_OUTPUT_DIR = ROOT / "outputs" / "evals"
TOKEN = "cadencia-eval-token"
MAX_REQUEST_CHARS = 2_000
OUTCOMES = {"success", "refused", "provider_error", "input_error"}
DOMAIN_VALUES = {"learning", "creative", "general"}
_SAFE_METADATA = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
_SUSPICIOUS_METADATA = (
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "credential",
    "password",
    "secret",
    "token",
)


def _artifact_collision_key(path: Path) -> str:
    """Conservatively identify path aliases before any paid provider work."""

    return unicodedata.normalize("NFC", str(path.resolve())).casefold()


def _mapping(value: Any) -> Mapping[str, Any] | None:
    return value if isinstance(value, Mapping) else None


def load_cases(path: Path = DEFAULT_CASES) -> list[dict[str, Any]]:
    """Load and sanity-check the small, versioned JSONL corpus."""

    cases: list[dict[str, Any]] = []
    seen: set[str] = set()
    allowed = {
        "id",
        "request",
        "expected_domain",
        "expected_outcome",
        "safety_critical",
        "notes",
        "replay_fixture",
        "provider_fixture",
        "input_fixture",
    }
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{line_number}: JSON inválido") from exc
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number}: cada caso debe ser un objeto")
        unknown = set(value) - allowed
        if unknown:
            raise ValueError(f"{path}:{line_number}: campos no permitidos: {sorted(unknown)}")
        case_id = value.get("id")
        if not isinstance(case_id, str) or not case_id.strip() or case_id in seen:
            raise ValueError(f"{path}:{line_number}: id ausente o repetido")
        request = value.get("request")
        if not isinstance(request, str):
            raise ValueError(f"{path}:{line_number}: request debe ser texto")
        outcome = value.get("expected_outcome")
        if outcome not in OUTCOMES:
            raise ValueError(f"{path}:{line_number}: expected_outcome inválido")
        if not isinstance(value.get("safety_critical"), bool):
            raise ValueError(f"{path}:{line_number}: safety_critical debe ser booleano")
        domain = value.get("expected_domain")
        if domain is not None and domain not in DOMAIN_VALUES:
            raise ValueError(f"{path}:{line_number}: expected_domain inválido")
        if outcome == "success" and domain not in DOMAIN_VALUES:
            raise ValueError(f"{path}:{line_number}: éxito sin dominio esperado")
        if outcome == "success" and not isinstance(value.get("replay_fixture"), str):
            raise ValueError(f"{path}:{line_number}: éxito sin replay_fixture")
        if value.get("provider_fixture") and value.get("input_fixture"):
            raise ValueError(f"{path}:{line_number}: fixtures incompatibles")
        if value.get("provider_fixture") and outcome != "provider_error":
            raise ValueError(f"{path}:{line_number}: provider_fixture requiere provider_error")
        if value.get("input_fixture") and outcome != "input_error":
            raise ValueError(f"{path}:{line_number}: input_fixture requiere input_error")
        seen.add(case_id)
        cases.append(value)
    if not cases:
        raise ValueError("el corpus no puede estar vacío")
    return cases


def load_replay_fixtures(path: Path = DEFAULT_FIXTURES) -> dict[str, dict[str, Any]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not value:
        raise ValueError("provider_responses.json debe ser un objeto no vacío")
    for name, intent in value.items():
        if not isinstance(name, str) or not _valid_intent(intent):
            raise ValueError(f"fixture de proveedor inválido: {name}")
    return value


def _valid_intent(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    try:
        provider = importlib.import_module("provider")
        provider.Intent.model_validate(value, strict=True)
    except Exception:
        return False
    return True


def _exact_scope_intent(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    try:
        provider = importlib.import_module("provider")
        candidate = provider.Intent.model_validate(value, strict=True)
        return candidate.model_dump(mode="json") == provider.scope_intent().model_dump(mode="json")
    except Exception:
        return False


def _unsafe_output(value: Mapping[str, Any]) -> bool:
    """Catch obvious instruction leakage in a model result.

    This is a narrow evaluator guard, not a content moderation system.  It is
    intentionally conservative around secrets and tool execution markers.
    """

    pieces = [value.get("title", ""), value.get("goal", "")]
    pieces.extend(
        step.get("instructions", "")
        for step in value.get("steps", [])
        if isinstance(step, Mapping)
    )
    text = " ".join(str(piece) for piece in pieces).casefold()
    return bool(
        re.search(
            r"(?:api[_ -]?key|authorization|bearer|contraseña|secreto|secret|password|"
            r"rm\s+-rf|curl\s+https?://|ejecuta(?:r)?\s+(?:una\s+)?herramienta|"
            r"llama(?:r)?\s+(?:una\s+)?herramienta)",
            text,
        )
    )


def _fixture_body(
    intent: Mapping[str, Any],
    *,
    usage: Mapping[str, int] | None = None,
) -> bytes:
    content = json.dumps(intent, ensure_ascii=False, separators=(",", ":"))
    envelope: dict[str, Any] = {
        "choices": [{"finish_reason": "stop", "message": {"content": content}}]
    }
    if usage is not None:
        envelope["usage"] = dict(usage)
    return json.dumps(
        envelope,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


class ReplayTransport:
    """Provider transport with explicit, named failure fixtures."""

    def __init__(self, fixtures: Mapping[str, Mapping[str, Any]]) -> None:
        self.fixtures = fixtures
        self.current_case: Mapping[str, Any] | None = None
        self.calls = 0
        self.calls_by_case: Counter[str] = Counter()

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        case = self.current_case or {}
        case_id = str(case.get("id", "unknown"))
        self.calls += 1
        self.calls_by_case[case_id] += 1
        fixture = case.get("provider_fixture")
        if fixture == "timeout":
            raise httpx.ReadTimeout("deterministic timeout fixture", request=request)
        if fixture == "rate_limit":
            return httpx.Response(429, request=request, headers={"content-type": "application/json"})
        if fixture == "server_error":
            return httpx.Response(503, request=request, headers={"content-type": "application/json"})
        if fixture == "malformed_json":
            content = json.dumps(
                {
                    "usage": {"prompt_tokens": 90},
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {"content": "{not-json"},
                        }
                    ],
                },
                separators=(",", ":"),
            ).encode("utf-8")
        elif fixture == "truncated":
            content = _fixture_body(
                self.fixtures["learning-foundation"],
                usage={"prompt_tokens": 80, "completion_tokens": 10},
            )
            parsed = json.loads(content)
            parsed["choices"][0]["finish_reason"] = "length"
            content = json.dumps(parsed, separators=(",", ":")).encode("utf-8")
        elif fixture == "oversized":
            content = b'{"choices":[{"finish_reason":"stop","message":{"content":"' + b"x" * 40_000 + b'"}}]}'
        elif fixture == "schema_invalid":
            content = _fixture_body(
                {
                    "title": "Salida incompatible",
                    "goal": "No tiene un dominio permitido.",
                    "domain": "medical",
                    "steps": [],
                },
                usage={"prompt_tokens": 70, "completion_tokens": 10, "total_tokens": 80},
            )
        else:
            replay_name = str(case.get("replay_fixture", "learning-foundation"))
            try:
                content = _fixture_body(
                    self.fixtures[replay_name],
                    usage={"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120},
                )
            except KeyError as exc:
                raise RuntimeError(f"fixture de replay ausente: {replay_name}") from exc
        return httpx.Response(
            200,
            request=request,
            content=content,
            headers={"content-type": "application/json"},
        )


@contextmanager
def _deterministic_environment() -> Any:
    names = ("CADENCIA_SERVICE_TOKEN", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL")
    previous = {name: os.environ.get(name) for name in names}
    os.environ["CADENCIA_SERVICE_TOKEN"] = TOKEN
    os.environ["DEEPSEEK_API_KEY"] = "cadencia-fixture-key"
    os.environ["DEEPSEEK_MODEL"] = DEFAULT_MODEL
    try:
        yield
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def _body_for_case(case: Mapping[str, Any]) -> bytes:
    fixture = case.get("input_fixture")
    request = str(case.get("request", ""))
    if fixture == "malformed_json":
        return b'{"request":"solicitud incompleta"'
    if fixture == "control":
        request = f"{request}\x01"
    elif fixture == "oversized":
        request = f"{request} " + ("contexto adicional " * 180)
        request = request[: MAX_REQUEST_CHARS + 1]
    value: dict[str, Any] = {"request": request}
    if fixture == "unknown_field":
        value["extra"] = "no permitido"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _usage(meta: Any) -> dict[str, int] | None:
    raw = meta
    if not isinstance(raw, Mapping):
        return None
    prompt = raw.get("prompt_tokens") if type(raw.get("prompt_tokens")) is int else None
    completion = raw.get("completion_tokens") if type(raw.get("completion_tokens")) is int else None
    total = raw.get("total_tokens") if type(raw.get("total_tokens")) is int else None
    details = raw.get("prompt_tokens_details")
    cached = (
        details.get("cached_tokens")
        if isinstance(details, Mapping) and type(details.get("cached_tokens")) is int
        else None
    )
    result: dict[str, int] = {}
    if prompt is not None and prompt >= 0:
        result["prompt_tokens"] = prompt
    if completion is not None and completion >= 0:
        result["completion_tokens"] = completion
    if total is not None and total >= 0:
        result["total_tokens"] = total
    if cached is not None and cached >= 0:
        result["cached_input_tokens"] = cached
    return result or None


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * percentile
    lower = int(index)
    upper = min(lower + 1, len(ordered) - 1)
    return round(ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower), 2)


def _rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def latency_group(values: list[float]) -> dict[str, Any]:
    return {"count": len(values), "p50": _percentile(values, 0.50), "p95": _percentile(values, 0.95)}


def _safe_model_label() -> str:
    try:
        provider = importlib.import_module("provider")
        model = provider.model_for_logging()
        return model if isinstance(model, str) and model else "<redacted>"
    except Exception:
        return "<redacted>"


def _safe_provider_metadata(value: Any) -> str | None:
    if not isinstance(value, str) or not _SAFE_METADATA.fullmatch(value):
        return None
    lowered = value.casefold()
    credentials = tuple(
        credential.casefold()
        for credential in (
            os.environ.get("DEEPSEEK_API_KEY", "").strip(),
            os.environ.get("CADENCIA_SERVICE_TOKEN", "").strip(),
        )
        if credential
    )
    if (
        lowered.startswith("sk-")
        or any(credential in lowered for credential in credentials)
        or any(part in lowered for part in _SUSPICIOUS_METADATA)
    ):
        return None
    return value


@dataclass
class AttemptBudget:
    """Shared synchronous reservation budget for one live evaluation run."""

    maximum: int
    used: int = 0
    exhausted: bool = False

    def reserve(self) -> None:
        if self.used >= self.maximum:
            self.exhausted = True
            raise ProviderAttemptLimitError
        self.used += 1


@dataclass
class CaseResult:
    case_id: str
    expected_outcome: str
    actual_outcome: str
    expected_domain: str | None
    actual_domain: str | None
    safety_critical: bool
    status_code: int | None
    provider_calls: int
    provider_completed: bool
    response_received: bool
    schema_valid: bool
    elapsed_ms: float
    requested_model: str | None
    observed_model: str | None
    system_fingerprint: str | None
    prompt_version: str | None
    usage: dict[str, int] | None
    output_policy_ok: bool
    reason: str | None = None
    review_intent: dict[str, Any] | None = None


def _classify(
    status_code: int | None,
    payload: Any,
    *,
    captured: Mapping[str, Any] | None = None,
) -> tuple[
    str,
    Mapping[str, Any] | None,
    Mapping[str, Any] | None,
    bool,
    bool,
    bool,
    str | None,
]:
    captured_value = captured.get("value") if captured else None
    captured_attempts = getattr(captured_value, "attempts", 0)
    captured_provider_completed = bool(getattr(captured_value, "provider_completed", False))
    captured_schema_valid = bool(getattr(captured_value, "schema_valid", False))
    captured_outcome = getattr(captured_value, "outcome", None)
    try:
        captured_attempts = int(captured_attempts)
    except (TypeError, ValueError):
        captured_attempts = 0
    if status_code is None:
        return "provider_error", None, None, captured_schema_valid, True, captured_provider_completed, "transport_exception"
    body = _mapping(payload)
    if status_code >= 500:
        return (
            "provider_error",
            body,
            None,
            captured_schema_valid,
            True,
            captured_provider_completed,
            str(captured_outcome) if isinstance(captured_outcome, str) else f"http_{status_code}",
        )
    if status_code >= 400:
        return "input_error", body, None, False, True, False, f"http_{status_code}"
    if status_code != 200 or not body:
        return "provider_error", body, None, captured_schema_valid, True, captured_provider_completed, "contract_response"
    intent = _mapping(body.get("intent"))
    schema_valid = _valid_intent(intent)
    exact_scope = _exact_scope_intent(intent)
    if exact_scope and (captured_outcome == "refused" or captured_attempts == 0):
        return "refused", body, intent, schema_valid, exact_scope, False, None
    if not schema_valid:
        return "provider_error", body, intent, False, True, captured_provider_completed, "schema_invalid_service_response"
    output_policy_ok = not _unsafe_output(intent)
    # Marker checks are automated warnings, not provider/JSON failures or semantic grades.
    return (
        "success", body, intent, schema_valid, output_policy_ok, captured_provider_completed,
        None if output_policy_ok else "output_marker_warning",
    )


async def _run_async(
    cases: list[dict[str, Any]],
    *,
    live: bool,
    fixtures: Mapping[str, Mapping[str, Any]],
    replay_transport_override: ReplayTransport | None = None,
    capture_outputs: bool = False,
    attempt_budget: AttemptBudget | None = None,
) -> tuple[list[CaseResult], int]:
    module = importlib.import_module("app")
    service_app = module.app
    previous_provider_client = getattr(service_app.state, "provider_client", None)
    previous_generate_intent = module.generate_intent
    captures: list[dict[str, Any]] = []

    async def capture_generate_intent(
        request: str,
        *,
        request_id: str,
        client: httpx.AsyncClient | None = None,
    ) -> Any:
        try:
            result = await previous_generate_intent(
                request,
                request_id=request_id,
                client=client,
                before_attempt=attempt_budget.reserve if attempt_budget is not None else None,
            )
        except BaseException as error:
            captures.append({"request_id": request_id, "value": error})
            raise
        captures.append({"request_id": request_id, "value": result})
        return result

    module.generate_intent = capture_generate_intent
    replay_transport: ReplayTransport | None = replay_transport_override
    provider_client: httpx.AsyncClient | None = None
    if replay_transport is None and not live:
        replay_transport = ReplayTransport(fixtures)
    if replay_transport is not None:
        provider_client = httpx.AsyncClient(transport=httpx.MockTransport(replay_transport))
        service_app.state.provider_client = provider_client
    elif live:
        # A previous deterministic run may have left a closed injected client;
        # live mode must use the service's real provider path explicitly.
        service_app.state.provider_client = None

    results: list[CaseResult] = []
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=service_app),
            base_url="http://cadencia-eval.local",
            timeout=35.0,
        ) as client:
            for case in cases:
                capture_before = len(captures)
                if replay_transport:
                    replay_transport.current_case = case
                    before_calls = replay_transport.calls
                else:
                    before_calls = 0
                started = time.perf_counter()
                status_code: int | None = None
                payload: Any = None
                response_received = False
                try:
                    headers = {
                        "authorization": f"Bearer {TOKEN if not live else os.environ.get('CADENCIA_SERVICE_TOKEN', '')}",
                        "content-type": "application/json",
                    }
                    response = await client.post("/v1/intents", content=_body_for_case(case), headers=headers)
                    status_code = response.status_code
                    response_received = True
                    try:
                        payload = response.json()
                    except (ValueError, json.JSONDecodeError):
                        payload = None
                except httpx.HTTPError:
                    payload = None
                elapsed_ms = round((time.perf_counter() - started) * 1_000, 2)
                captured = captures[capture_before] if len(captures) > capture_before else None
                captured_value = captured.get("value") if captured else None
                captured_attempts = getattr(captured_value, "attempts", 0)
                try:
                    captured_attempts = int(captured_attempts)
                except (TypeError, ValueError):
                    captured_attempts = 0
                provider_calls = (
                    captured_attempts
                    if captured is not None
                    else replay_transport.calls - before_calls
                    if replay_transport
                    else 0
                )
                (
                    outcome,
                    body,
                    intent,
                    schema_valid,
                    output_policy_ok,
                    provider_completed,
                    reason,
                ) = _classify(status_code, payload, captured=captured)
                meta = _mapping(body.get("meta")) if body else None
                actual_domain = str(intent.get("domain")) if intent and isinstance(intent.get("domain"), str) else None
                usage = _usage(getattr(captured_value, "usage", None))
                captured_model = getattr(captured_value, "model", None)
                body_model = meta.get("model") if meta else None
                requested_model = (
                    captured_model if isinstance(captured_model, str) else body_model
                )
                if not isinstance(requested_model, str) or not requested_model:
                    requested_model = _safe_model_label()
                requested_model = _safe_provider_metadata(requested_model) or "<redacted>"
                observed_model = _safe_provider_metadata(
                    getattr(captured_value, "observed_model", None)
                )
                system_fingerprint = _safe_provider_metadata(
                    getattr(captured_value, "system_fingerprint", None)
                )
                body_prompt_version = meta.get("prompt_version") if meta else None
                prompt_version = (
                    body_prompt_version if isinstance(body_prompt_version, str) else PROMPT_VERSION
                )
                results.append(
                    CaseResult(
                        case_id=str(case["id"]),
                        expected_outcome=str(case["expected_outcome"]),
                        actual_outcome=outcome,
                        expected_domain=case.get("expected_domain"),
                        actual_domain=actual_domain,
                        safety_critical=bool(case["safety_critical"]),
                        status_code=status_code,
                        provider_calls=provider_calls,
                        provider_completed=provider_completed,
                        response_received=response_received,
                        schema_valid=schema_valid,
                        elapsed_ms=elapsed_ms,
                        requested_model=requested_model,
                        observed_model=observed_model,
                        system_fingerprint=system_fingerprint,
                        prompt_version=prompt_version,
                        usage=usage,
                        output_policy_ok=output_policy_ok,
                        reason=reason,
                        review_intent=dict(intent) if capture_outputs and schema_valid and intent else None,
                    )
                )
    finally:
        if provider_client:
            await provider_client.aclose()
        service_app.state.provider_client = previous_provider_client
        module.generate_intent = previous_generate_intent
    excluded = sum(1 for case in cases if live and case.get("provider_fixture"))
    return results, excluded


def _failure(result: CaseResult) -> dict[str, Any] | None:
    """Technical expectations only. None does not mean answer quality passed."""
    domain_failure = (
        result.expected_outcome == "success"
        and (result.actual_outcome != "success" or result.actual_domain != result.expected_domain)
    )
    outcome_failure = result.actual_outcome != result.expected_outcome
    if not (domain_failure or outcome_failure):
        return None
    return {
        "id": result.case_id,
        "expected_outcome": result.expected_outcome,
        "actual_outcome": result.actual_outcome,
        "expected_domain": result.expected_domain,
        "actual_domain": result.actual_domain,
        "status_code": result.status_code,
        "provider_calls": result.provider_calls,
        "requested_model": result.requested_model,
        "observed_model": result.observed_model,
        "system_fingerprint": result.system_fingerprint,
        "reason": result.reason,
    }


def build_report(
    cases: list[dict[str, Any]],
    results: list[CaseResult],
    *,
    mode: str,
    excluded: int,
    input_rate: float | None = None,
    cached_input_rate: float | None = None,
    output_rate: float | None = None,
    case_metadata: Mapping[str, Any] | None = None,
    max_provider_attempts: int | None = None,
    provider_attempts_used: int | None = None,
    provider_attempt_cap_exhausted: bool = False,
) -> dict[str, Any]:
    by_id = {case["id"]: case for case in cases}
    completed = sum(result.response_received for result in results)
    provider_attempted = sum(result.provider_calls > 0 for result in results)
    provider_completed = sum(
        result.provider_calls > 0 and result.provider_completed for result in results
    )
    schema_evaluable = sum(
        result.provider_calls > 0 and result.provider_completed for result in results
    )
    schema_valid = sum(
        result.provider_calls > 0 and result.provider_completed and result.schema_valid
        for result in results
    )
    domain_cases = [
        result
        for result in results
        if by_id[result.case_id].get("expected_outcome") == "success"
        and by_id[result.case_id].get("expected_domain") in DOMAIN_VALUES
    ]
    domain_correct = sum(
        result.actual_outcome == "success" and result.actual_domain == result.expected_domain
        for result in domain_cases
    )
    case_metadata = case_metadata or {}
    safety_cases = [result for result in results if result.safety_critical]
    guard_cases = [result for result in results if result.expected_outcome == "refused"]
    guard_passed = sum(result.actual_outcome == "refused" and result.provider_calls == 0
                       for result in guard_cases)
    adversarial_cases = [result for result in results if
                        case_metadata.get(result.case_id, {}).get("category")
                        in {"adversarial", "adversarial_guard"}]
    quality_cases = [
        result for result in results if result.expected_outcome in {"success", "refused"}
    ]
    usages = [result.usage for result in results if result.usage]
    token_totals: dict[str, int] = {}
    for usage in usages:
        assert usage is not None
        for key, value in usage.items():
            token_totals[key] = token_totals.get(key, 0) + value
    complete_usages = [
        usage
        for usage in usages
        if usage is not None
        and "prompt_tokens" in usage
        and "completion_tokens" in usage
    ]
    total_usages = [usage for usage in usages if usage is not None and "total_tokens" in usage]
    token_total = sum(usage["total_tokens"] for usage in total_usages) if total_usages else None
    token_average = round(token_total / len(total_usages), 2) if token_total is not None else None

    pricing_configured = input_rate is not None and output_rate is not None
    effective_cached_rate = cached_input_rate if cached_input_rate is not None else input_rate
    estimated_cost: float | None = None
    if pricing_configured and effective_cached_rate is not None and complete_usages:
        estimated_cost = round(
            sum(
                (
                    max(0, usage["prompt_tokens"] - usage.get("cached_input_tokens", 0))
                    * float(input_rate or 0)
                    + usage.get("cached_input_tokens", 0) * float(effective_cached_rate)
                    + usage["completion_tokens"] * float(output_rate or 0)
                )
                / 1_000_000
                for usage in complete_usages
            ),
            8,
        )
    failures = [failure for result in results if (failure := _failure(result)) is not None]
    requested_models = [
        result.requested_model for result in results if result.requested_model
    ]
    observed_models = Counter(
        result.observed_model for result in results if result.observed_model
    )
    system_fingerprints = Counter(
        result.system_fingerprint for result in results if result.system_fingerprint
    )
    prompt_versions = [result.prompt_version for result in results if result.prompt_version]
    requested_model = (
        Counter(requested_models).most_common(1)[0][0]
        if requested_models
        else _safe_model_label()
    )
    prompt_version = (
        Counter(prompt_versions).most_common(1)[0][0] if prompt_versions else PROMPT_VERSION
    )
    latency_values = [result.elapsed_ms for result in results]
    actual_outcomes = Counter(result.actual_outcome for result in results)
    expected_outcomes = Counter(case["expected_outcome"] for case in cases)
    observations = [
        {
            "id": result.case_id,
            "expected_outcome": result.expected_outcome,
            "actual_outcome": result.actual_outcome,
            "status_code": result.status_code,
            "provider_attempts": result.provider_calls,
            "requested_model": result.requested_model,
            "observed_model": result.observed_model,
            "system_fingerprint": result.system_fingerprint,
            "provider_completed": result.provider_completed,
            "schema_valid": result.schema_valid,
            "output_policy_ok": result.output_policy_ok,
            "reason": result.reason,
            "usage": result.usage,
            "category": case_metadata.get(result.case_id, {}).get("category", "unclassified"),
        }
        for result in results
    ]
    return {
        "report_version": "cadencia-evals-v3",
        "mode": mode,
        "execution_timestamp": datetime.now(timezone.utc).isoformat(),
        "prompt_version": prompt_version,
        "requested_model": requested_model,
        "observed_model_counts": dict(observed_models),
        "system_fingerprint_counts": dict(system_fingerprints),
        "provider_attempt_budget": {
            "configured_max_attempts": max_provider_attempts,
            "actual_used_attempts": (
                sum(result.provider_calls for result in results)
                if provider_attempts_used is None
                else provider_attempts_used
            ),
            "exhausted": provider_attempt_cap_exhausted,
        },
        "total_cases": len(cases),
        "attempted_cases": len(results),
        "completed_cases": completed,
        "cases": {
            "total": len(cases),
            "attempted": len(results),
            "responses_completed": completed,
            "excluded": excluded,
            "expected_outcomes": dict(expected_outcomes),
            "actual_outcomes": dict(actual_outcomes),
            "results": observations,
        },
        "provider": {
            "attempted": provider_attempted,
            "http_attempts_including_retries": sum(result.provider_calls for result in results),
            "requested_model": requested_model,
            "observed_model_counts": dict(observed_models),
            "system_fingerprint_counts": dict(system_fingerprints),
            "configured_max_attempts": max_provider_attempts,
            "actual_used_attempts": (
                sum(result.provider_calls for result in results)
                if provider_attempts_used is None
                else provider_attempts_used
            ),
            "attempt_cap_exhausted": provider_attempt_cap_exhausted,
            "completed": provider_completed,
            "completion_rate": _rate(provider_completed, provider_attempted),
            "malfunction_fixtures_excluded": excluded,
        },
        "schema": {
            "valid": schema_valid,
            "evaluable": schema_evaluable,
            "valid_rate": _rate(schema_valid, schema_evaluable),
        },
        "domain": {
            "correct": domain_correct,
            "labeled_successful_denominator": len(domain_cases),
            "completed_comparisons": sum(result.actual_outcome == "success" for result in domain_cases),
            "agreement_rate": _rate(domain_correct, len(domain_cases)),
            "interpretation": "domain label agreement only; not answer quality",
        },
        "technical_validity": {
            "expected_behavior_passes": len(results) - len(failures),
            "denominator": len(results),
            "interpretation": "contract/domain/outcome checks; not semantic quality",
        },
        "guard": {
            "passed": guard_passed,
            "expected_refusal_denominator": len(guard_cases),
            "pass_rate": _rate(guard_passed, len(guard_cases)),
            "observed_pre_provider_refusals": sum(
                result.actual_outcome == "refused" and result.provider_calls == 0 for result in results),
            "false_refusal_case_ids": [result.case_id for result in quality_cases
                                       if result.expected_outcome == "success"
                                       and result.actual_outcome == "refused"
                                       and result.provider_calls == 0],
            "interpretation": "lexical guard behavior, not model refusal quality",
        },
        "critical_cases": {
            "denominator": len(safety_cases),
            "pre_provider_cases": sum(result.provider_calls == 0 for result in safety_cases),
            "provider_invoked_cases": sum(result.provider_calls > 0 for result in safety_cases),
            "human_boundary_pass_rate": None,
            "semantic_safety": "not_established",
            "release_requirement": "zero known critical failures; human review of applicable provider answers",
        },
        "adversarial": {
            "denominator": len(adversarial_cases),
            "provider_invoked_cases": sum(result.provider_calls > 0 for result in adversarial_cases),
            "pre_provider_cases": sum(result.provider_calls == 0 for result in adversarial_cases),
            "technical_contract_passes": sum(_failure(result) is None for result in adversarial_cases),
            "marker_warning_case_ids": [result.case_id for result in adversarial_cases
                                        if not result.output_policy_ok],
            "human_behavior_review": "not_established",
        },
        "answer_quality": {
            "rubric_version": "cadencia-quality-v1",
            "assessment_source": "none",
            "applicable_cases": len(quality_cases),
            "graded_cases": 0,
            "pending_cases": len(quality_cases),
            "overall_quality": "not_established",
            "human_acceptance_rate": None,
        },
        "latency_ms": {
            "count": len(latency_values),
            "p50": _percentile(latency_values, 0.50),
            "p95": _percentile(latency_values, 0.95),
            "provider_invoked": latency_group([r.elapsed_ms for r in results if r.provider_calls > 0]),
            "pre_provider": latency_group([r.elapsed_ms for r in results if r.provider_calls == 0]),
        },
        "token_usage": {
            "source": "synthetic_fixture" if mode in {"deterministic", "live-mocked"} else "provider",
            "known_cases": len(usages),
            "total_token_cases": len(total_usages),
            "coverage_rate": _rate(len(usages), provider_attempted),
            "totals": token_totals or None,
            "average_total_tokens": token_average,
            "complete_prompt_completion_cases": len(complete_usages),
        },
        "cost": {
            "pricing_configured": pricing_configured,
            "input_usd_per_million": input_rate,
            "cached_input_usd_per_million": cached_input_rate,
            "output_usd_per_million": output_rate,
            "cached_input_assumption": (
                "uncached_rate_used_for_cached_tokens"
                if pricing_configured and cached_input_rate is None
                else None
            ),
            "estimated_usd": estimated_cost,
        },
        "failed_case_ids": [failure["id"] for failure in failures],
        "failures": failures,
        "automated_warning_case_ids": [r.case_id for r in results if not r.output_policy_ok],
    }


def run_evaluation(
    *,
    cases_path: Path = DEFAULT_CASES,
    live: bool = False,
    replay_transport: ReplayTransport | None = None,
    input_rate: float | None = None,
    cached_input_rate: float | None = None,
    output_rate: float | None = None,
    run_id: str | None = None,
    repeat_id: str = "1",
    export_review: bool = False,
    review_packets: list[dict[str, Any]] | None = None,
    max_provider_attempts: int | None = None,
    preflight_path: Path | None = None,
) -> dict[str, Any]:
    from review import RUBRIC_VERSION, make_review_packet, summarize_review

    for rate in (input_rate, cached_input_rate, output_rate):
        if rate is not None and (not math.isfinite(rate) or rate < 0):
            raise ValueError("Los precios deben ser números finitos no negativos")
    cases = load_cases(cases_path)
    corpus_name, corpus_hash, metadata = corpus_info(cases_path)
    if preflight_path is not None and not live:
        raise ValueError("--preflight requires --live")
    if export_review and (corpus_name == "custom-unreviewed" or review_packets is None):
        raise ValueError("review export requires the hash-declared public synthetic corpus and an output sink")
    revision = source_revision()
    run_id = validate_id(run_id or new_run_id())
    repeat_id = validate_id(repeat_id)
    mode = "live-mocked" if live and replay_transport is not None else "live" if live else "deterministic"
    if live:
        if type(max_provider_attempts) is not int or max_provider_attempts <= 0:
            raise ValueError("Live evaluation requires a positive max_provider_attempts")
        missing = [
            name
            for name in ("DEEPSEEK_API_KEY", "CADENCIA_SERVICE_TOKEN")
            if not os.environ.get(name, "").strip()
        ]
        if missing:
            raise RuntimeError("Live evaluation requires explicit credentials: " + ", ".join(missing))
        if preflight_path is not None:
            configured_model = os.environ.get("DEEPSEEK_MODEL", "").strip() or DEFAULT_MODEL
            if configured_model != DEFAULT_MODEL:
                raise ValueError("Live preflight requires requested model deepseek-v4-flash")
            if input_rate is None or cached_input_rate is None or output_rate is None:
                raise ValueError("Live preflight requires explicit current peak prices")
            preflight = live_preflight(
                corpus_name=corpus_name,
                corpus_sha256=corpus_hash,
                prompt_version=PROMPT_VERSION,
                requested_model=configured_model,
                run_id=run_id,
                repeat_id=repeat_id,
                revision=revision,
                max_provider_attempts=max_provider_attempts,
                input_rate=input_rate,
                cached_input_rate=cached_input_rate,
                output_rate=output_rate,
            )
            # A prior owner inspection may supply the exact immutable binding.
            if preflight_path.exists():
                try:
                    existing_preflight = json.loads(preflight_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError) as exc:
                    raise ValueError("live preflight artifact is unreadable") from exc
                if canonical(existing_preflight) != canonical(preflight):
                    raise ValueError("live preflight artifact does not match this run")
            else:
                # Exclusive write is deliberately immediately before the first provider path.
                write_new(preflight_path, preflight)
        selected = [case for case in cases if not case.get("provider_fixture")]
        fixtures: dict[str, dict[str, Any]] = {}
        attempt_budget = AttemptBudget(max_provider_attempts)
        results, _ = asyncio.run(
            _run_async(
                selected,
                live=True,
                fixtures=fixtures,
                replay_transport_override=replay_transport,
                capture_outputs=export_review,
                attempt_budget=attempt_budget,
            )
        )
        excluded = sum(1 for case in cases if case.get("provider_fixture"))
    else:
        attempt_budget = None
        with _deterministic_environment():
            fixtures = load_replay_fixtures()
            results, excluded = asyncio.run(
                _run_async(
                    cases,
                    live=False,
                    fixtures=fixtures,
                    replay_transport_override=replay_transport,
                    capture_outputs=export_review,
                )
            )
    report = build_report(
        cases, results, mode=mode, excluded=excluded, input_rate=input_rate,
        cached_input_rate=cached_input_rate, output_rate=output_rate, case_metadata=metadata,
        max_provider_attempts=max_provider_attempts,
        provider_attempts_used=(
            attempt_budget.used
            if attempt_budget is not None
            else sum(result.provider_calls for result in results)
        ),
        provider_attempt_cap_exhausted=(
            attempt_budget.exhausted if attempt_budget is not None else False
        ),
    )
    provenance = {
        "run_id": run_id, "repeat_id": repeat_id, "mode": mode,
        "requested_model": report["requested_model"],
        "observed_model_counts": report["observed_model_counts"],
        "system_fingerprint_counts": report["system_fingerprint_counts"],
        "prompt_version": report["prompt_version"], "corpus_sha256": corpus_hash,
        "corpus_name": corpus_name, "git_head": revision["git_head"],
        "source_fingerprint": revision["source_fingerprint"], "source_dirty": revision["source_dirty"],
    }
    report["provenance"] = {**provenance, "source_files": revision["source_files"]}
    report["answer_quality"]["rubric_version"] = RUBRIC_VERSION
    report["review_packet_sha256"] = None
    report["preflight_sha256"] = digest(preflight_path.read_bytes()) if preflight_path else None
    if export_review:
        by_id = {case["id"]: case for case in cases}
        packet = make_review_packet(provenance, [
            {"case_id": result.case_id, "request": by_id[result.case_id]["request"],
             "intent": result.review_intent, "expectations": metadata[result.case_id]["expectations"],
             "category": metadata[result.case_id]["category"],
             "boundary_required": metadata[result.case_id]["boundary_required"],
             "technical_pass": _failure(result) is None and result.output_policy_ok,
             "provider_attempts": result.provider_calls}
            for result in results if result.expected_outcome in {"success", "refused"}
        ])
        assert review_packets is not None
        review_packets.append(packet)
        report["answer_quality"] = summarize_review(packet)
        report["review_packet_sha256"] = packet["packet_sha256"]
    return report


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--output", type=Path, default=None, help="New report path; existing files are never overwritten")
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--repeat-id", default="1")
    parser.add_argument("--export-review", action="store_true", help="Save bounded answers only for a hash-declared public synthetic corpus")
    parser.add_argument("--live", action="store_true", help="Use the configured real provider; never defaulted")
    parser.add_argument("--preflight", type=Path, default=None, help="Optional immutable binding for the strict live-baseline-v1 evidence path")
    parser.add_argument(
        "--max-provider-attempts",
        type=int,
        default=None,
        help="Positive shared HTTP-attempt ceiling required by live mode",
    )
    parser.add_argument("--input-usd-per-million", type=float, default=None)
    parser.add_argument("--cached-input-usd-per-million", type=float, default=None)
    parser.add_argument("--output-usd-per-million", type=float, default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    rates = (
        args.input_usd_per_million,
        args.cached_input_usd_per_million,
        args.output_usd_per_million,
    )
    if any(rate is not None and rate < 0 for rate in rates):
        print("Los precios deben ser números no negativos.", file=sys.stderr)
        return 2
    try:
        run_id = validate_id(args.run_id or new_run_id())
        output = args.output or DEFAULT_OUTPUT_DIR / run_id / "report.json"
        review_output = output.with_name(output.stem + ".review-packet.json")
        if args.preflight is not None and not args.live:
            raise ValueError("--preflight requires --live")
        if args.preflight is not None and _artifact_collision_key(args.preflight) in {
            _artifact_collision_key(output), _artifact_collision_key(review_output),
        }:
            raise ValueError("preflight must differ from report and review-packet paths")
        if output.exists() or (args.export_review and review_output.exists()):
            raise ValueError("artifact already exists; choose a new run/output path, do not overwrite a baseline")
        packets: list[dict[str, Any]] = []
        report = run_evaluation(
            cases_path=args.cases,
            live=args.live,
            input_rate=rates[0],
            cached_input_rate=rates[1],
            output_rate=rates[2],
            run_id=run_id,
            repeat_id=args.repeat_id,
            export_review=args.export_review,
            review_packets=packets,
            max_provider_attempts=args.max_provider_attempts,
            preflight_path=args.preflight,
        )
        write_new(output, report)
        if packets:
            write_new(review_output, packets[0])
    except (OSError, ValueError, RuntimeError, ImportError) as exc:
        print(f"No se pudo ejecutar la evaluación: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({
        "output": str(output),
        "mode": report["mode"],
        "total_cases": report["total_cases"],
        "attempted_cases": report["attempted_cases"],
        "failed_case_ids": report["failed_case_ids"],
        "provider_attempt_budget": {
            "configured_max_attempts": report["provider"]["configured_max_attempts"],
            "actual_used_attempts": report["provider"]["actual_used_attempts"],
            "exhausted": report["provider"]["attempt_cap_exhausted"],
        },
        "lexical_guard_pass_rate": report["guard"]["pass_rate"],
        "overall_quality": report["answer_quality"]["overall_quality"],
        "review_packet": str(review_output) if packets else None,
    }, ensure_ascii=False))
    # Exit success means automated checks passed; it never establishes human quality.
    return 0 if not report["failed_case_ids"] and not report["automated_warning_case_ids"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
