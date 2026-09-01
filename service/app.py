"""FastAPI application for Cadencia's authenticated intent service."""

from __future__ import annotations

import asyncio
import hmac
import json
import os
import uuid
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
        ProviderError,
        generate_intent,
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
        ProviderError,
        generate_intent,
        log_event,
        model_for_logging,
        LOGGER,
    )

MAX_BODY_BYTES = 32_768
BODY_TIMEOUT_SECONDS = 5.0
ERROR_INVALID = "La solicitud no es válida."
ERROR_UNAUTHORIZED = "No autorizado."
ERROR_PROVIDER = "No se pudo generar la intención."
ERROR_INTERNAL = "No se pudo completar la solicitud."


class _BodyTooLarge(Exception):
    pass


class _BodyTimeout(Exception):
    pass


class _UnsupportedEncoding(Exception):
    pass


app = FastAPI(title="Cadencia Intent Service", docs_url=None, redoc_url=None)
app.state.provider_client = None


def _request_id() -> str:
    return str(uuid.uuid4())


def _json_response(body: dict[str, Any], *, status_code: int, request_id: str | None = None) -> JSONResponse:
    headers = {"cache-control": "no-store"}
    if request_id is not None:
        headers["x-request-id"] = request_id
    return JSONResponse(content=body, status_code=status_code, headers=headers)


def _error(message: str, request_id: str, status_code: int) -> JSONResponse:
    return _json_response(
        {"error": message, "request_id": request_id},
        status_code=status_code,
        request_id=request_id,
    )


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


@app.get("/healthz")
async def healthz() -> JSONResponse:
    return _json_response({"status": "ok"}, status_code=200)


@app.post("/v1/intents")
async def intents(request: Request) -> JSONResponse:
    request_id = _request_id()
    if not _authorized(request):
        _log_client_failure(request_id, "unauthorized")
        return _error(ERROR_UNAUTHORIZED, request_id, 401)

    try:
        raw = await _read_body(request)
        value = _parse_request_body(raw)
        intent_request = IntentRequest.model_validate(value, strict=True)
    except _BodyTooLarge:
        _log_client_failure(request_id, "body_too_large")
        return _error(ERROR_INVALID, request_id, 413)
    except _UnsupportedEncoding:
        _log_client_failure(request_id, "unsupported_encoding")
        return _error(ERROR_INVALID, request_id, 400)
    except _BodyTimeout:
        _log_client_failure(request_id, "body_timeout")
        return _error(ERROR_INVALID, request_id, 408)
    except (ValueError, ValidationError, TypeError):
        _log_client_failure(request_id, "invalid_request")
        return _error(ERROR_INVALID, request_id, 400)
    except Exception:
        _log_client_failure(request_id, "invalid_request")
        return _error(ERROR_INVALID, request_id, 400)

    injected_client = getattr(request.app.state, "provider_client", None)
    try:
        result = await generate_intent(
            intent_request.request,
            request_id=request_id,
            client=injected_client,
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
        status = 503 if failure.outcome == "configuration_error" else 502
        return _error(ERROR_PROVIDER, request_id, status)
    except Exception:
        _log_client_failure(request_id, "internal_error", status_category="internal")
        return _error(ERROR_INTERNAL, request_id, 500)

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
        ),
    )
    return _json_response(response.model_dump(mode="json"), status_code=200, request_id=request_id)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exception: StarletteHTTPException) -> JSONResponse:
    del request
    request_id = _request_id()
    _log_client_failure(request_id, "http_error", status_category="client")
    status = exception.status_code if 400 <= exception.status_code < 500 else 500
    return _error(ERROR_INVALID if status < 500 else ERROR_INTERNAL, request_id, status)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exception: RequestValidationError) -> JSONResponse:
    del request, exception
    request_id = _request_id()
    _log_client_failure(request_id, "invalid_request")
    return _error(ERROR_INVALID, request_id, 400)


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exception: Exception) -> JSONResponse:
    del request, exception
    request_id = _request_id()
    _log_client_failure(request_id, "internal_error", status_category="internal")
    return _error(ERROR_INTERNAL, request_id, 500)


__all__ = ["MAX_BODY_BYTES", "app", "healthz", "intents"]
