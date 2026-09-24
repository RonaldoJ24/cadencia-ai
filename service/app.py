"""FastAPI application for Cadencia's authenticated intent service."""

from __future__ import annotations

import asyncio
import hmac
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

try:
    from .provider import (
        IntentRequest,
        IntentMeta,
        IntentResponse,
        PROMPT_VERSION,
        ProviderAttemptLimitError,
        ProviderError,
        generate_intent,
        intent_usage,
        log_event,
        model_for_logging,
        LOGGER,
    )
except ImportError:  # Allows `uvicorn app:app` from the service directory.
    from provider import (  # type: ignore[no-redef]
        IntentRequest,
        IntentMeta,
        IntentResponse,
        PROMPT_VERSION,
        ProviderAttemptLimitError,
        ProviderError,
        generate_intent,
        intent_usage,
        log_event,
        model_for_logging,
        LOGGER,
    )

try:
    from .planning import (
        DRAFT_VERSION,
        READ_GOAL_VERSION,
        DraftRequest,
        ReadGoalRequest,
        draft_plan,
        read_goal,
    )
except ImportError:  # Allows `uvicorn app:app` from the service directory.
    from planning import (  # type: ignore[no-redef]
        DRAFT_VERSION,
        READ_GOAL_VERSION,
        DraftRequest,
        ReadGoalRequest,
        draft_plan,
        read_goal,
    )

MAX_BODY_BYTES = 32_768
BODY_TIMEOUT_SECONDS = 5.0
DAILY_ATTEMPT_CAP_ENV = "CADENCIA_SERVICE_DAILY_ATTEMPT_CAP"
DEFAULT_DAILY_ATTEMPT_CAP = 400
ERRORS = {
    "en": {
        "invalid": "The request is invalid.",
        "unauthorized": "Not authorized.",
        "provider": "The AI provider could not generate the intention.",
        "internal": "The request could not be completed.",
    },
    "es": {
        "invalid": "La solicitud no es válida.",
        "unauthorized": "No autorizado.",
        "provider": "No se pudo generar la intención con el proveedor.",
        "internal": "No se pudo completar la solicitud.",
    },
}
ERROR_INVALID = ERRORS["en"]["invalid"]
ERROR_UNAUTHORIZED = ERRORS["en"]["unauthorized"]
ERROR_PROVIDER = ERRORS["en"]["provider"]
ERROR_INTERNAL = ERRORS["en"]["internal"]


class _BodyTooLarge(Exception):
    pass


class _BodyTimeout(Exception):
    pass


class _UnsupportedEncoding(Exception):
    pass


def _daily_attempt_cap() -> int:
    raw = os.environ.get(DAILY_ATTEMPT_CAP_ENV, "").strip()
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_DAILY_ATTEMPT_CAP
    return value if value >= 0 else DEFAULT_DAILY_ATTEMPT_CAP


class DailyAttempts:
    """A second fence behind the Worker's spend caps.

    Counts provider attempts per UTC day in this process, so a leaked service
    token cannot run up unlimited spend. The count resets when the instance
    restarts; the Worker's D1 ledger remains the real budget.
    """

    def __init__(self) -> None:
        self.day = ""
        self.count = 0

    def reset(self) -> None:
        self.day = ""
        self.count = 0

    def before_attempt(self) -> None:
        today = datetime.now(timezone.utc).date().isoformat()
        if today != self.day:
            self.day = today
            self.count = 0
        if self.count >= _daily_attempt_cap():
            raise ProviderAttemptLimitError
        self.count += 1


DAILY_ATTEMPTS = DailyAttempts()

app = FastAPI(title="Cadencia Intent Service", docs_url=None, redoc_url=None)
app.state.provider_client = None


def _request_id() -> str:
    return str(uuid.uuid4())


def _json_response(body: dict[str, Any], *, status_code: int, request_id: str | None = None) -> JSONResponse:
    headers = {"cache-control": "no-store"}
    if request_id is not None:
        headers["x-request-id"] = request_id
    return JSONResponse(content=body, status_code=status_code, headers=headers)


def _error(
    message: str,
    request_id: str,
    status_code: int,
    *,
    extra: dict[str, Any] | None = None,
) -> JSONResponse:
    return _json_response(
        {"error": message, "request_id": request_id, **(extra or {})},
        status_code=status_code,
        request_id=request_id,
    )


def _language(value: Any) -> str:
    candidate = value.get("language") if isinstance(value, dict) else None
    return candidate if isinstance(candidate, str) and candidate in ERRORS else "en"


def _error_text(language: str, key: str) -> str:
    return ERRORS.get(language, ERRORS["en"])[key]


def _authorized(request: Request) -> bool:
    expected = os.environ.get("CADENCIA_SERVICE_TOKEN", "").strip()
    supplied_header = request.headers.get("authorization", "")
    if not expected or not supplied_header.startswith("Bearer "):
        return False
    supplied = supplied_header.removeprefix("Bearer ")
    if not supplied:
        return False
    try:
        return hmac.compare_digest(supplied, expected)
    except TypeError:
        return False


async def _read_body(request: Request) -> bytes:
    encoding = request.headers.get("content-encoding", "").strip().lower()
    if encoding and encoding != "identity":
        raise _UnsupportedEncoding
    try:
        async with asyncio.timeout(BODY_TIMEOUT_SECONDS):
            declared = request.headers.get("content-length")
            if declared is not None:
                try:
                    declared_bytes = int(declared)
                except (TypeError, ValueError) as error:
                    raise ValueError("invalid content length") from error
                if declared_bytes < 0:
                    raise ValueError("invalid content length")
                if declared_bytes > MAX_BODY_BYTES:
                    raise _BodyTooLarge

            chunks: list[bytes] = []
            total = 0
            async for chunk in request.stream():
                total += len(chunk)
                if total > MAX_BODY_BYTES:
                    raise _BodyTooLarge
                chunks.append(chunk)
            return b"".join(chunks)
    except TimeoutError as error:
        raise _BodyTimeout from error


def _parse_request_body(raw: bytes) -> dict[str, Any]:
    try:
        decoded = raw.decode("utf-8")
        # Importing this helper keeps duplicate-key behavior identical for the
        # inbound request and the provider response.
        try:
            from .provider import parse_json_object
        except ImportError:
            from provider import parse_json_object  # type: ignore[no-redef]

        return parse_json_object(decoded)
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("invalid JSON body") from error


def _log_client_failure(request_id: str, outcome: str, *, status_category: str = "client") -> None:
    log_event(
        logger=LOGGER,
        request_id=request_id,
        model=model_for_logging(),
        latency_ms=0,
        attempts=0,
        status_category=status_category,
        outcome=outcome,
        schema_valid=False,
    )


@app.get("/livez")
@app.get("/healthz")
async def healthz() -> JSONResponse:
    return _json_response({"status": "ok"}, status_code=200)


@app.post("/v1/intents")
async def intents(request: Request) -> JSONResponse:
    request_id = _request_id()
    language = "en"
    if not _authorized(request):
        _log_client_failure(request_id, "unauthorized")
        return _error(_error_text(language, "unauthorized"), request_id, 401)

    try:
        raw = await _read_body(request)
        value = _parse_request_body(raw)
        language = _language(value)
        intent_request = IntentRequest.model_validate(value, strict=True)
    except _BodyTooLarge:
        _log_client_failure(request_id, "body_too_large")
        return _error(_error_text(language, "invalid"), request_id, 413)
    except _UnsupportedEncoding:
        _log_client_failure(request_id, "unsupported_encoding")
        return _error(_error_text(language, "invalid"), request_id, 400)
    except _BodyTimeout:
        _log_client_failure(request_id, "body_timeout")
        return _error(_error_text(language, "invalid"), request_id, 408)
    except (ValueError, ValidationError, TypeError):
        _log_client_failure(request_id, "invalid_request")
        return _error(_error_text(language, "invalid"), request_id, 400)
    except Exception:
        _log_client_failure(request_id, "invalid_request")
        return _error(_error_text(language, "invalid"), request_id, 400)

    injected_client = getattr(request.app.state, "provider_client", None)
    try:
        result = await generate_intent(
            intent_request.request,
            request_id=request_id,
            language=intent_request.language,
            session_count=intent_request.session_count,
            session_minutes=intent_request.session_minutes,
            client=injected_client,
            before_attempt=DAILY_ATTEMPTS.before_attempt,
        )
    except ProviderError as failure:
        log_event(
            logger=LOGGER,
            request_id=request_id,
            model=failure.model,
            latency_ms=failure.latency_ms,
            attempts=failure.attempts,
            status_category=failure.status_category,
            outcome=failure.outcome,
            schema_valid=failure.schema_valid,
            usage=failure.usage,
        )
        status = (
            503
            if failure.outcome in ("configuration_error", "provider_attempt_cap_exhausted")
            else 502
        )
        # When the provider was called, report what was spent so the Worker
        # can settle its reservation instead of charging the worst case.
        spent: dict[str, Any] = {}
        if failure.attempts > 0:
            spent["attempts"] = failure.attempts
            usage = intent_usage(failure.usage)
            if usage is not None:
                spent["usage"] = usage.model_dump(mode="json", exclude_none=True)
        return _error(failure.safe_message, request_id, status, extra=spent)
    except Exception:
        _log_client_failure(request_id, "internal_error", status_category="internal")
        return _error(_error_text(language, "internal"), request_id, 500)

    log_event(
        logger=LOGGER,
        request_id=request_id,
        model=result.model,
        latency_ms=result.latency_ms,
        attempts=result.attempts,
        status_category=result.status_category,
        outcome=result.outcome,
        schema_valid=result.schema_valid,
        usage=result.usage,
    )
    response = IntentResponse(
        intent=result.intent,
        scope_refused=result.scope_refused,
        meta=IntentMeta(
            request_id=request_id,
            prompt_version=PROMPT_VERSION,
            model=result.model,
            latency_ms=result.latency_ms,
            attempts=result.attempts,
            usage=intent_usage(result.usage),
        ),
    )
    return _json_response(
        response.model_dump(mode="json", exclude_none=True),
        status_code=200,
        request_id=request_id,
    )


def _meta(request_id: str, prompt_version: str, result: Any) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "request_id": request_id,
        "prompt_version": prompt_version,
        "model": model_for_logging() if result is None else result.model,
        "latency_ms": 0 if result is None else result.latency_ms,
        "attempts": 0 if result is None else result.attempts,
    }
    usage = None if result is None else intent_usage(result.usage)
    if usage is not None:
        meta["usage"] = usage.model_dump(mode="json", exclude_none=True)
    return meta


async def _planning_endpoint(
    request: Request,
    *,
    event_name: str,
    prompt_version: str,
    parse: Any,
    call: Any,
    respond: Any,
) -> JSONResponse:
    """Shared auth, body limits, error mapping and logging for the planning calls."""

    request_id = _request_id()
    language = "en"
    if not _authorized(request):
        _log_client_failure(request_id, "unauthorized")
        return _error(_error_text(language, "unauthorized"), request_id, 401)
    try:
        raw = await _read_body(request)
        value = _parse_request_body(raw)
        language = _language(value)
        body = parse(value)
    except _BodyTooLarge:
        _log_client_failure(request_id, "body_too_large")
        return _error(_error_text(language, "invalid"), request_id, 413)
    except _UnsupportedEncoding:
        _log_client_failure(request_id, "unsupported_encoding")
        return _error(_error_text(language, "invalid"), request_id, 400)
    except _BodyTimeout:
        _log_client_failure(request_id, "body_timeout")
        return _error(_error_text(language, "invalid"), request_id, 408)
    except Exception:
        _log_client_failure(request_id, "invalid_request")
        return _error(_error_text(language, "invalid"), request_id, 400)

    try:
        payload, result = await call(body, request_id)
    except ProviderError as failure:
        log_event(
            logger=LOGGER,
            request_id=request_id,
            model=failure.model,
            latency_ms=failure.latency_ms,
            attempts=failure.attempts,
            status_category=failure.status_category,
            outcome=failure.outcome,
            schema_valid=failure.schema_valid,
            usage=failure.usage,
            prompt_version=prompt_version,
            event_name=event_name,
        )
        status = (
            503
            if failure.outcome in ("configuration_error", "provider_attempt_cap_exhausted")
            else 502
        )
        spent: dict[str, Any] = {}
        if failure.attempts > 0:
            spent["attempts"] = failure.attempts
            usage = intent_usage(failure.usage)
            if usage is not None:
                spent["usage"] = usage.model_dump(mode="json", exclude_none=True)
        return _error(failure.safe_message, request_id, status, extra=spent)
    except Exception:
        _log_client_failure(request_id, "internal_error", status_category="internal")
        return _error(_error_text(language, "internal"), request_id, 500)

    log_event(
        logger=LOGGER,
        request_id=request_id,
        model=model_for_logging() if result is None else result.model,
        latency_ms=0 if result is None else result.latency_ms,
        attempts=0 if result is None else result.attempts,
        status_category="none" if result is None else result.status_category,
        outcome="refused" if result is None else result.outcome,
        schema_valid=True,
        usage=None if result is None else result.usage,
        prompt_version=prompt_version,
        event_name=event_name,
    )
    return _json_response(
        respond(payload, _meta(request_id, prompt_version, result)),
        status_code=200,
        request_id=request_id,
    )


@app.post("/v1/read-goal")
async def read_goal_endpoint(request: Request) -> JSONResponse:
    injected_client = getattr(request.app.state, "provider_client", None)

    async def call(body: ReadGoalRequest, request_id: str) -> tuple[Any, Any]:
        reading, result = await read_goal(
            body, request_id=request_id, client=injected_client, before_attempt=DAILY_ATTEMPTS.before_attempt
        )
        return reading, result

    return await _planning_endpoint(
        request,
        event_name="read_goal_request",
        prompt_version=READ_GOAL_VERSION,
        parse=lambda value: ReadGoalRequest.model_validate(value, strict=True),
        call=call,
        respond=lambda reading, meta: {
            "reading": reading.model_dump(mode="json"),
            "scope_refused": meta["attempts"] == 0,
            "meta": meta,
        },
    )


@app.post("/v1/draft")
async def draft_endpoint(request: Request) -> JSONResponse:
    injected_client = getattr(request.app.state, "provider_client", None)

    async def call(body: DraftRequest, request_id: str) -> tuple[Any, Any]:
        result = await draft_plan(
            body, request_id=request_id, client=injected_client, before_attempt=DAILY_ATTEMPTS.before_attempt
        )
        return result.intent, result

    return await _planning_endpoint(
        request,
        event_name="draft_request",
        prompt_version=DRAFT_VERSION,
        parse=lambda value: DraftRequest.model_validate(value, strict=True),
        call=call,
        respond=lambda draft, meta: {"draft": draft.model_dump(mode="json"), "meta": meta},
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exception: StarletteHTTPException) -> JSONResponse:
    del request
    request_id = _request_id()
    _log_client_failure(request_id, "http_error", status_category="client")
    status = exception.status_code if 400 <= exception.status_code < 500 else 500
    return _error(_error_text("en", "invalid" if status < 500 else "internal"), request_id, status)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exception: RequestValidationError) -> JSONResponse:
    del request, exception
    request_id = _request_id()
    _log_client_failure(request_id, "invalid_request")
    return _error(_error_text("en", "invalid"), request_id, 400)


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exception: Exception) -> JSONResponse:
    del request, exception
    request_id = _request_id()
    _log_client_failure(request_id, "internal_error", status_category="internal")
    return _error(_error_text("en", "internal"), request_id, 500)


__all__ = ["MAX_BODY_BYTES", "app", "draft_endpoint", "healthz", "intents", "read_goal_endpoint"]
