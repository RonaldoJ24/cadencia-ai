"""The deliberately small, schema validated boundary to the DeepSeek API."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import time
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

import httpx
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
)

DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
DEFAULT_MODEL = "deepseek-v4-flash"
REQUEST_TIMEOUT_SECONDS = 10.0
TOTAL_TIMEOUT_SECONDS = 20.0
# Provider attempts per call; the Worker's spend reservation counts on it.
MAX_ATTEMPTS = 2
MAX_RESPONSE_BYTES = 32_768

_SAFE_MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
_SAFE_PROVIDER_METADATA = _SAFE_MODEL
_SUSPICIOUS_MODEL_PARTS = (
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "credential",
    "password",
    "secret",
    "token",
)
_RESTRICTED_REQUEST = re.compile(
    r"\b(?:diagnos(?:is|tico|tica|ticos|ticas|ticar)?|"
    r"sintom(?:a|as)?|tratamiento(?:s)?|medicamento(?:s)?|dosis|"
    r"enfermedad(?:es)?|lesion(?:es)?|dolor(?:es)?|ejercicio(?:s)?|"
    r"entrenamiento(?:s)?|fitness|calorias|dieta(?:s)?|nutricion|"
    r"perder peso|ganar musculo|symptom(?:s)?|medical|medicine|"
    r"medication|dosage|disease(?:s)?|injur(?:y|ies)|pain|exercise|"
    r"workout|calorie(?:s)?|diet(?:s)?|weight loss|muscle gain|"
    r"invertir|inversion(?:es)?|acciones|cripto(?:moneda)?|trading|"
    r"prestamo(?:s)?|credito|hipoteca|impuesto(?:s)?|finanzas personales|"
    r"asesoria financiera|ganar dinero|invest(?:ment|ing)?|stocks?|"
    r"crypto(?:currency)?|loan|credit|mortgage|tax(?:es)?|personal finance|"
    r"financial advice|make money|abogado(?:s)?|asesoria legal|demanda(?:s)?|"
    r"contrato(?:s)?|litigio|derechos legales|divorcio|visa|inmigracion|"
    r"testamento|lawyer|legal advice|lawsuit|contract|litigation|legal rights|"
    r"divorce|immigration)\b",
    re.ASCII | re.IGNORECASE,
)
# The planning endpoints plan general fitness, so activity words are not
# refused there; medical, injury, pain, diet, money and legal terms still are.
_FITNESS_ACTIVITY_TERMS = frozenset(
    {"ejercicio", "ejercicios", "entrenamiento", "entrenamientos", "fitness", "exercise",
     "workout", "ganar musculo", "muscle gain"}
)
_DIRECT_REQUEST_CUE = re.compile(
    r"\b(?:dime|decime|indica(?:me)?|explica(?:me)?|recomiend(?:a|ame)|"
    r"aconsej(?:a|ame)|sugier(?:e|eme)|que\s+(?:debo|puedo|tengo\s+que)|"
    r"como\s+(?:debo|puedo|tengo\s+que)|cuant(?:o|a|os|as)\s+"
    r"(?:pastill(?:a|as)|tableta(?:s)?|capsul(?:a|as)|comprimid(?:o|os|a|as))|tell\s+me|"
    r"what\s+should|how\s+(?:much|many)|should\s+i|can\s+i)\b",
    re.ASCII | re.IGNORECASE,
)
_DIRECT_DOMAIN_ACTION_CUE = re.compile(
    r"\b(?:pastill(?:a|as)|tableta(?:s)?|capsul(?:a|as)|comprimid(?:o|os|a|as)|"
    r"tomar|tome|consumir|ingerir|declarar|declare|declar(?:acion|aciones)|"
    r"testificar|testifique|juez|tribunal|ganar\s+(?:mi|el)\s+caso|"
    r"defender(?:me)?|presentar\s+(?:ante|al)|pill(?:s)?|tablet(?:s)?|"
    r"capsule(?:s)?|take|ingest|declare|testify|judge|court|"
    r"win\s+(?:my|the)\s+case|defend(?:\s+me)?|file\s+(?:with|in))\b",
    re.ASCII | re.IGNORECASE,
)
_DOSAGE_MATCH = re.compile(r"\b(?:dosis|dosage)\b", re.ASCII | re.IGNORECASE)
_LAWYER_MATCH = re.compile(r"\b(?:abogado|abogados|lawyer|lawyers)\b", re.ASCII | re.IGNORECASE)
_ANALYSIS_ACTION = re.compile(
    r"\b(?:analiz(?:ar|a|ando|is)|analic(?:e|es|emos|en)|estudi(?:ar|a|ando|o)|examinar|interpretar|"
    r"identificar|explorar|comprender|comparar|uso|significado|meaning|analy[sz](?:e|ing|is))\b",
    re.ASCII | re.IGNORECASE,
)
_ANALYSIS_NEGATION = re.compile(
    r"\b(?:no|nunca|never|not|don't|do not|sin|without|avoid)\b"
    r"(?:\s+[a-z0-9]+){0,3}\s*$",
    re.ASCII | re.IGNORECASE,
)
_LITERARY_LINGUISTIC_CONTEXT = re.compile(
    r"\b(?:literari[oa]s?|literatura|poema(?:s)?|poesi(?:a|as)|metafora(?:s)?|"
    r"figura(?:s)? retorica(?:s)?|linguistic[oa]s?|linguistic|palabra(?:s)?|"
    r"lenguaje|language|literary|poem(?:s)?|metaphor(?:s)?|novela(?:s)?|"
    r"cuento(?:s)?|relato(?:s)?|texto(?:s)?|verso(?:s)?|semantica(?:s)?|gramatica(?:s)?|"
    r"retorica(?:s)?)\b",
    re.ASCII | re.IGNORECASE,
)
_HEALTH_ADVICE_CONTEXT = re.compile(
    r"\b(?:salud|health|medic(?:a|o|al)(?:s|es)?|medical|medicine|medication|"
    r"recomendacion(?:es)?|consejo(?:s)?|orientacion(?:es)?|asesoria(?:s)?|advice|"
    r"recommendation(?:s)?)\b",
    re.ASCII | re.IGNORECASE,
)
_HEALTH_ADVICE_EXCLUSION = re.compile(
    r"(?:\b(?:sin|no|nunca|evitar|evitando|excluir|excluyendo|exclude|without|"
    r"avoid|excluding)\b(?:\s+[a-z0-9]+){0,2}\s+"
    r"(?:recomendacion(?:es)?|consejo(?:s)?|orientacion(?:es)?|asesoria(?:s)?|advice|"
    r"recommendation(?:s)?)(?:\s+[a-z0-9]+){0,3}\s+"
    r"(?:salud|health|medic(?:a|o|al)(?:s|es)?|medical|medicine|medication)\b)"
    r"|(?:\b(?:sin|no|nunca|evitar|evitando|excluir|excluyendo|exclude|without|"
    r"avoid|excluding)\b(?:\s+[a-z0-9]+){0,2}\s+"
    r"(?:salud|health|medic(?:a|o|al)(?:s|es)?|medical|medicine|medication)"
    r"(?:\s+[a-z0-9]+){0,3}\s+"
    r"(?:recomendacion(?:es)?|consejo(?:s)?|orientacion(?:es)?|asesoria(?:s)?|advice|"
    r"recommendation(?:s)?)\b)",
    re.ASCII | re.IGNORECASE,
)
_CREATIVE_ACTION = re.compile(
    r"\b(?:ficcion|fictici[oa]s?|fiction|creative|escrib(?:ir|e|iendo)|"
    r"crear|crea|creando|redactar|narrar|imagina|cuento|relato|novela|story|"
    r"write|writing|create)\b",
    re.ASCII | re.IGNORECASE,
)
_FICTION_TARGET = re.compile(
    r"\b(?:personaje(?:s)?|escena(?:s)?|dialogo(?:s)?|narrativ[oa]s?|"
    r"character(?:s)?|scene(?:s)?|dialogue(?:s)?|narrative(?:s)?|"
    r"historia(?:s)?|story(?:line|lines)?|capitulo(?:s)?)\b",
    re.ASCII | re.IGNORECASE,
)

_MODEL_CONFIG = ConfigDict(extra="forbid", strict=True)
Language = Literal["en", "es"]


class IntentUsage(BaseModel):
    """Token counts the provider reported for the successful attempt."""

    model_config = _MODEL_CONFIG

    prompt_tokens: StrictInt = Field(ge=0)
    completion_tokens: StrictInt = Field(ge=0)
    total_tokens: StrictInt | None = Field(default=None, ge=0)


def intent_usage(usage: dict[str, int] | None) -> IntentUsage | None:
    """Return reportable usage only when both token counts are present."""

    if not usage or "prompt_tokens" not in usage or "completion_tokens" not in usage:
        return None
    return IntentUsage(
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
        total_tokens=usage.get("total_tokens"),
    )


@dataclass(frozen=True, slots=True)
class IntentResult:
    # The validated model output, of the class the planning call asked for.
    intent: Any
    scope_refused: bool
    model: str
    attempts: int
    latency_ms: int
    usage: dict[str, int] | None
    provider_completed: bool
    schema_valid: bool
    outcome: str
    status_category: str
    observed_model: str | None = None
    system_fingerprint: str | None = None


class ProviderError(Exception):
    """A provider failure containing metadata safe for logs and tracing."""

    SAFE_MESSAGES = {
        "en": "The AI provider could not generate the intention.",
        "es": "No se pudo generar la intención con el proveedor.",
    }
    SAFE_MESSAGE = SAFE_MESSAGES["en"]

    def __init__(
        self,
        *,
        request_id: str,
        model: str,
        attempts: int,
        latency_ms: int,
        status_category: str,
        outcome: str,
        provider_completed: bool = False,
        schema_valid: bool = False,
        usage: dict[str, int] | None = None,
        observed_model: str | None = None,
        system_fingerprint: str | None = None,
        language: str = "en",
    ) -> None:
        self.language = language if language in self.SAFE_MESSAGES else "en"
        self.safe_message = self.SAFE_MESSAGES[self.language]
        super().__init__(self.safe_message)
        self.request_id = request_id
        self.model = model
        self.attempts = attempts
        self.latency_ms = latency_ms
        self.status_category = status_category
        self.outcome = outcome
        self.provider_completed = provider_completed
        self.schema_valid = schema_valid
        self.usage = usage
        self.observed_model = observed_model
        self.system_fingerprint = system_fingerprint


class ProviderAttemptLimitError(Exception):
    """Raised by a synchronous before-attempt hook when its budget is spent."""


class _Failure(Exception):
    def __init__(
        self,
        *,
        outcome: str,
        status_category: str,
        retryable: bool = False,
        provider_completed: bool = False,
        schema_valid: bool = False,
        usage: dict[str, int] | None = None,
        observed_model: str | None = None,
        system_fingerprint: str | None = None,
    ) -> None:
        super().__init__()
        self.outcome = outcome
        self.status_category = status_category
        self.retryable = retryable
        self.provider_completed = provider_completed
        self.schema_valid = schema_valid
        self.usage = usage
        self.observed_model = observed_model
        self.system_fingerprint = system_fingerprint


def restricted_request(request: str, *, fitness_in_scope: bool = False) -> bool:
    normalized = "".join(
        character
        for character in unicodedata.normalize("NFD", request).lower()
        if not unicodedata.category(character).startswith("M")
    )
    matches = [
        match
        for match in _RESTRICTED_REQUEST.finditer(normalized)
        if not (fitness_in_scope and match.group(0).casefold() in _FITNESS_ACTIVITY_TERMS)
    ]
    if not matches:
        return False
    if _direct_advice_request(normalized):
        return True

    dosage_context = bool(
        _DOSAGE_MATCH.search(normalized)
        and _literary_analysis_context(normalized)
        and _explicit_health_exclusion(normalized)
    )
    fiction_context = bool(
        _CREATIVE_ACTION.search(normalized) and _FICTION_TARGET.search(normalized)
    )
    for match in matches:
        term = match.group(0).casefold()
        if _DOSAGE_MATCH.fullmatch(term) and dosage_context:
            continue
        if dosage_context and _explicitly_excluded_health_term(normalized, match):
            continue
        if _LAWYER_MATCH.fullmatch(term) and fiction_context:
            continue
        return True
    return False


def _direct_advice_request(normalized: str) -> bool:
    request_cues = list(_DIRECT_REQUEST_CUE.finditer(normalized))
    action_cues = list(_DIRECT_DOMAIN_ACTION_CUE.finditer(normalized))
    return bool(request_cues and action_cues)


def _literary_analysis_context(normalized: str) -> bool:
    literary_terms = list(_LITERARY_LINGUISTIC_CONTEXT.finditer(normalized))
    return any(
        not _ANALYSIS_NEGATION.search(normalized[max(0, action.start() - 64) : action.start()])
        and any(abs(action.start() - term.start()) <= 120 for term in literary_terms)
        for action in _ANALYSIS_ACTION.finditer(normalized)
    )


def _explicit_health_exclusion(normalized: str) -> bool:
    """Require an ordered phrase excluding health advice or recommendations."""

    return _HEALTH_ADVICE_EXCLUSION.search(normalized) is not None


def _explicitly_excluded_health_term(normalized: str, match: re.Match[str]) -> bool:
    if not _HEALTH_ADVICE_CONTEXT.fullmatch(match.group(0)):
        return False
    return any(
        exclusion.start() <= match.start() and match.end() <= exclusion.end()
        for exclusion in _HEALTH_ADVICE_EXCLUSION.finditer(normalized)
    )


def _configured_credentials() -> tuple[str, ...]:
    return tuple(
        credential.casefold()
        for credential in (
            os.environ.get("DEEPSEEK_API_KEY", "").strip(),
            os.environ.get("OPENAI_API_KEY", "").strip(),
            os.environ.get("CADENCIA_SERVICE_TOKEN", "").strip(),
        )
        if credential
    )


def _safe_provider_metadata(value: Any) -> str | None:
    """Return only bounded, opaque provider metadata suitable for reports."""

    if not isinstance(value, str) or not _SAFE_PROVIDER_METADATA.fullmatch(value):
        return None
    lowered = value.casefold()
    if (
        lowered.startswith("sk-")
        or any(credential in lowered for credential in _configured_credentials())
        or any(part in lowered for part in _SUSPICIOUS_MODEL_PARTS)
    ):
        return None
    return value


def _reject_json_constant(value: str) -> Any:
    raise ValueError(f"invalid JSON constant: {value}")


def _object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON field")
        result[key] = value
    return result


def parse_json_object(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(
            raw,
            object_pairs_hook=_object_without_duplicates,
            parse_constant=_reject_json_constant,
        )
    except (TypeError, ValueError, json.JSONDecodeError):
        raise ValueError("invalid JSON")
    if not isinstance(parsed, dict):
        raise ValueError("JSON value must be an object")
    return parsed


def _status_category(status_code: int) -> str:
    if 100 <= status_code <= 199:
        return "1xx"
    if 200 <= status_code <= 299:
        return "2xx"
    if 300 <= status_code <= 399:
        return "3xx"
    if 400 <= status_code <= 499:
        return "4xx"
    if 500 <= status_code <= 599:
        return "5xx"
    return "unknown"


def _usage(value: Any) -> dict[str, int] | None:
    if not isinstance(value, dict):
        return None
    allowed = ("prompt_tokens", "completion_tokens", "total_tokens")
    result = {
        key: candidate
        for key in allowed
        if type(candidate := value.get(key)) is int and candidate >= 0
    }
    return result or None


async def _read_limited(response: httpx.Response, max_bytes: int | None = None) -> str:
    max_bytes = MAX_RESPONSE_BYTES if max_bytes is None else max_bytes
    encoding = response.headers.get("content-encoding", "").strip().lower()
    if encoding and encoding != "identity":
        raise _Failure(
            outcome="unsupported_encoding",
            status_category=_status_category(response.status_code),
        )
    declared = response.headers.get("content-length")
    if declared is not None:
        try:
            declared_bytes = int(declared)
        except (TypeError, ValueError) as error:
            raise _Failure(
                outcome="invalid_response",
                status_category=_status_category(response.status_code),
            ) from error
        if declared_bytes < 0 or declared_bytes > max_bytes:
            raise _Failure(
                outcome="oversized_response",
                status_category=_status_category(response.status_code),
            )

    chunks: list[bytes] = []
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > max_bytes:
            raise _Failure(
                outcome="oversized_response",
                status_category=_status_category(response.status_code),
            )
        chunks.append(chunk)
    try:
        return b"".join(chunks).decode("utf-8")
    except UnicodeDecodeError as error:
        raise _Failure(
            outcome="malformed_response",
            status_category=_status_category(response.status_code),
        ) from error


def _parse_provider_response(
    raw: str,
    status_category: str,
    model_cls: type[BaseModel],
) -> tuple[BaseModel, dict[str, int] | None, bool, str | None, str | None]:
    if not raw.strip():
        raise _Failure(outcome="empty_response", status_category=status_category)
    try:
        root = parse_json_object(raw)
    except ValueError:
        raise _Failure(outcome="malformed_response", status_category=status_category)

    usage = _usage(root.get("usage"))
    observed_model = _safe_provider_metadata(root.get("model"))
    system_fingerprint = _safe_provider_metadata(root.get("system_fingerprint"))
    choices = root.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise _Failure(
            outcome="malformed_response",
            status_category=status_category,
            usage=usage,
            observed_model=observed_model,
            system_fingerprint=system_fingerprint,
        )
    choice = choices[0]
    if choice.get("finish_reason") != "stop":
        raise _Failure(
            outcome="truncated_response",
            status_category=status_category,
            usage=usage,
            observed_model=observed_model,
            system_fingerprint=system_fingerprint,
        )
    message = choice.get("message")
    if not isinstance(message, dict) or not isinstance(message.get("content"), str):
        raise _Failure(
            outcome="empty_response",
            status_category=status_category,
            usage=usage,
            observed_model=observed_model,
            system_fingerprint=system_fingerprint,
        )
    content = message["content"]
    if not content.strip():
        raise _Failure(
            outcome="empty_response",
            status_category=status_category,
            usage=usage,
            observed_model=observed_model,
            system_fingerprint=system_fingerprint,
        )
    try:
        intent_value = parse_json_object(content)
    except ValueError:
        raise _Failure(
            outcome="malformed_response",
            status_category=status_category,
            provider_completed=True,
            usage=usage,
            observed_model=observed_model,
            system_fingerprint=system_fingerprint,
        )
    try:
        intent = model_cls.model_validate(intent_value, strict=True)
    except Exception:
        raise _Failure(
            outcome="schema_invalid",
            status_category=status_category,
            provider_completed=True,
            schema_valid=False,
            usage=usage,
            observed_model=observed_model,
            system_fingerprint=system_fingerprint,
        )
    return intent, usage, True, observed_model, system_fingerprint


def _checked_model(raw: str, api_key: str) -> str:
    lowered = raw.casefold()
    credentials = [
        credential.casefold()
        for credential in (
            api_key.strip(),
            os.environ.get("CADENCIA_SERVICE_TOKEN", "").strip(),
        )
        if credential.strip()
    ]
    if (
        not _SAFE_MODEL.fullmatch(raw)
        or lowered.startswith("sk-")
        or any(credential in lowered for credential in credentials)
        or any(part in lowered for part in _SUSPICIOUS_MODEL_PARTS)
    ):
        raise ValueError("invalid model configuration")
    return raw


@dataclass(frozen=True, slots=True)
class ProviderSettings:
    """Where and how this service calls its model, read from the environment."""

    name: Literal["deepseek", "openai"]
    url: str
    api_key: str
    model: str
    token_param: Literal["max_tokens", "max_completion_tokens"]
    temperature: float | None
    extra: dict[str, Any]


def provider_settings() -> ProviderSettings:
    """The configured provider. DeepSeek is the default. OpenAI must be configured
    in full, with its URL, model id, token-limit parameter and temperature taken
    from the owner or OpenAI's current API reference, never assumed here."""

    name = os.environ.get("CADENCIA_PROVIDER", "deepseek").strip() or "deepseek"
    if name == "deepseek":
        api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
        raw = os.environ.get("DEEPSEEK_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
        return ProviderSettings(
            name="deepseek",
            url=DEEPSEEK_URL,
            api_key=api_key,
            model=_checked_model(raw, api_key),
            token_param="max_tokens",
            temperature=0.2,
            extra={"thinking": {"type": "disabled"}},
        )
    if name == "openai":
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        url = os.environ.get("OPENAI_URL", "").strip()
        token_param = os.environ.get("OPENAI_TOKEN_PARAM", "").strip()
        temperature = os.environ.get("OPENAI_TEMPERATURE", "").strip()
        if not url.startswith("https://") or token_param not in ("max_tokens", "max_completion_tokens") or not temperature:
            raise ValueError("incomplete provider configuration")
        if temperature == "omit":
            chosen: float | None = None
        else:
            chosen = float(temperature)
            if not 0.0 <= chosen <= 2.0:
                raise ValueError("invalid temperature")
        return ProviderSettings(
            name="openai",
            url=url,
            api_key=api_key,
            model=_checked_model(os.environ.get("OPENAI_MODEL", "").strip(), api_key),
            token_param=token_param,  # type: ignore[arg-type]
            temperature=chosen,
            extra={},
        )
    raise ValueError("unknown provider")


def model_for_logging() -> str:
    """Return a model label safe to place in an allowlisted log record."""

    try:
        return provider_settings().model
    except ValueError:
        return "<redacted>"


def _provider_error(
    *,
    request_id: str,
    model: str,
    attempts: int,
    started: float,
    failure: _Failure,
    language: Language = "en",
) -> ProviderError:
    return ProviderError(
        request_id=request_id,
        model=model,
        attempts=attempts,
        latency_ms=max(0, int((time.monotonic() - started) * 1000)),
        status_category=failure.status_category,
        outcome=failure.outcome,
        provider_completed=failure.provider_completed,
        schema_valid=failure.schema_valid,
        usage=failure.usage,
        observed_model=failure.observed_model,
        system_fingerprint=failure.system_fingerprint,
        language=language,
    )


async def _attempt(
    client: httpx.AsyncClient,
    payload: dict[str, Any],
    api_key: str,
    *,
    url: str,
    model_cls: type[BaseModel],
    request_timeout: float | None = None,
    max_bytes: int | None = None,
) -> tuple[BaseModel, dict[str, int] | None, str, str | None, str | None]:
    # Resolved at call time so tests and callers can adjust the module limits.
    request_timeout = REQUEST_TIMEOUT_SECONDS if request_timeout is None else request_timeout
    try:
        async with asyncio.timeout(request_timeout):
            async with client.stream(
                "POST",
                url,
                headers={
                    "content-type": "application/json",
                    "authorization": f"Bearer {api_key}",
                    "accept-encoding": "identity",
                },
                json=payload,
                timeout=request_timeout,
            ) as response:
                category = _status_category(response.status_code)
                if response.status_code == 429:
                    raise _Failure(
                        outcome="rate_limited",
                        status_category=category,
                        retryable=True,
                    )
                if 500 <= response.status_code <= 599:
                    raise _Failure(
                        outcome="provider_5xx",
                        status_category=category,
                        retryable=True,
                    )
                if not 200 <= response.status_code <= 299:
                    raise _Failure(outcome="provider_error", status_category=category)
                intent, usage, _, observed_model, system_fingerprint = _parse_provider_response(
                    await _read_limited(response, max_bytes), category, model_cls
                )
                return intent, usage, category, observed_model, system_fingerprint
    except _Failure:
        raise
    except (TimeoutError, httpx.TimeoutException):
        raise _Failure(outcome="timeout", status_category="timeout") from None
    except Exception:
        # The exception is intentionally not included in the public error or log.
        raise _Failure(outcome="network_error", status_category="network") from None


async def _call_provider(
    client: httpx.AsyncClient,
    *,
    payload: dict[str, Any],
    api_key: str,
    url: str,
    model: str,
    request_id: str,
    started: float,
    language: Language = "en",
    before_attempt: Callable[[], None] | None = None,
    model_cls: type[BaseModel],
    request_timeout: float | None = None,
    total_timeout: float | None = None,
    max_bytes: int | None = None,
) -> IntentResult:
    attempts = 0
    total_timeout = TOTAL_TIMEOUT_SECONDS if total_timeout is None else total_timeout
    try:
        async with asyncio.timeout(total_timeout):
            while attempts < MAX_ATTEMPTS:
                try:
                    if before_attempt is not None:
                        before_attempt()
                    attempts += 1
                    intent, usage, category, observed_model, system_fingerprint = await _attempt(
                        client,
                        payload,
                        api_key,
                        url=url,
                        model_cls=model_cls,
                        request_timeout=request_timeout,
                        max_bytes=max_bytes,
                    )
                except ProviderAttemptLimitError:
                    raise _provider_error(
                        request_id=request_id,
                        model=model,
                        attempts=attempts,
                        started=started,
                        failure=_Failure(
                            outcome="provider_attempt_cap_exhausted",
                            status_category="budget",
                        ),
                        language=language,
                    ) from None
                except _Failure as failure:
                    if failure.retryable and attempts == 1:
                        continue
                    raise _provider_error(
                        request_id=request_id,
                        model=model,
                        attempts=attempts,
                        started=started,
                        failure=failure,
                        language=language,
                    ) from None
                return IntentResult(
                    intent=intent,
                    scope_refused=False,
                    model=model,
                    attempts=attempts,
                    latency_ms=max(0, int((time.monotonic() - started) * 1000)),
                    usage=usage,
                    provider_completed=True,
                    schema_valid=True,
                    outcome="success",
                    status_category=category,
                    observed_model=observed_model,
                    system_fingerprint=system_fingerprint,
                )
    except ProviderError:
        raise
    except TimeoutError:
        raise ProviderError(
            request_id=request_id,
            model=model,
            attempts=attempts,
            latency_ms=max(0, int((time.monotonic() - started) * 1000)),
            status_category="timeout",
            outcome="timeout",
            language=language,
        ) from None
    except Exception:
        raise ProviderError(
            request_id=request_id,
            model=model,
            attempts=attempts,
            latency_ms=max(0, int((time.monotonic() - started) * 1000)),
            status_category="network",
            outcome="network_error",
            language=language,
        ) from None


def log_model_is_safe(model: str) -> str:
    """Sanitize a model label before it reaches structured logs."""

    if not isinstance(model, str) or not _SAFE_MODEL.fullmatch(model):
        return "<redacted>"
    lowered = model.casefold()
    credentials = [
        credential.casefold()
        for credential in (
            os.environ.get("DEEPSEEK_API_KEY", "").strip(),
            os.environ.get("CADENCIA_SERVICE_TOKEN", "").strip(),
        )
        if credential.strip()
    ]
    if (
        lowered.startswith("sk-")
        or any(credential in lowered for credential in credentials)
        or any(part in lowered for part in _SUSPICIOUS_MODEL_PARTS)
    ):
        return "<redacted>"
    return model


def configure_logging() -> logging.Logger:
    logger = logging.getLogger("cadencia.intent")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not any(getattr(handler, "_cadencia_handler", False) for handler in logger.handlers):
        handler = logging.StreamHandler(sys.stdout)
        handler._cadencia_handler = True  # type: ignore[attr-defined]
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    for name in ("httpx", "httpcore", "uvicorn.access"):
        noisy = logging.getLogger(name)
        noisy.setLevel(logging.CRITICAL)
        noisy.propagate = False
    return logger


def log_event(
    *,
    logger: logging.Logger,
    request_id: str,
    model: str,
    latency_ms: int,
    attempts: int,
    status_category: str,
    outcome: str,
    schema_valid: bool,
    prompt_version: str | None,
    event_name: str,
    usage: dict[str, int] | None = None,
) -> None:
    event: dict[str, Any] = {
        "event": event_name,
        "request_id": request_id,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        **({"prompt_version": prompt_version} if prompt_version else {}),
        "model": log_model_is_safe(model),
        "latency_ms": max(0, int(latency_ms)),
        "attempts": max(0, int(attempts)),
        "status_category": status_category,
        "outcome": outcome,
        "schema_valid": bool(schema_valid),
    }
    safe_usage = _usage(usage)
    if safe_usage is not None:
        event["usage"] = safe_usage
    logger.info(json.dumps(event, ensure_ascii=False, separators=(",", ":")))


LOGGER = configure_logging()

__all__ = [
    "DEFAULT_MODEL",
    "DEEPSEEK_URL",
    "IntentResult",
    "IntentUsage",
    "LOGGER",
    "Language",
    "MAX_ATTEMPTS",
    "MAX_RESPONSE_BYTES",
    "ProviderAttemptLimitError",
    "ProviderError",
    "ProviderSettings",
    "TOTAL_TIMEOUT_SECONDS",
    "intent_usage",
    "log_event",
    "log_model_is_safe",
    "model_for_logging",
    "parse_json_object",
    "provider_settings",
    "restricted_request",
]
