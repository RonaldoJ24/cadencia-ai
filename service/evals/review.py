#!/usr/bin/env python3
"""Bounded packet and human-review helpers for offline evaluation artifacts.

This module deliberately does not judge answer meaning.  It validates the
artifact contract, binds grades to one packet and one output hash, and reports
human or explicitly synthetic decisions without turning schema validity into
quality evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from provider import Intent  # noqa: E402


RUBRIC_VERSION = "cadencia-quality-v1"
PACKET_VERSION = "cadencia-review-packet-v1"
MAX_CASES = 200
MAX_CASE_ID_UTF16 = 128
MAX_LABEL_UTF16 = 256
MAX_REQUEST_UTF16 = 2_000
MAX_EXPECTATIONS_CHARS = 2_000
MAX_REASON_CHARS = 500
MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
MAX_METADATA_VALUES = 32
SAFE_METADATA = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
SUSPICIOUS_METADATA = (
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "credential",
    "password",
    "secret",
    "token",
)

PROVENANCE_FIELDS = (
    "run_id",
    "repeat_id",
    "mode",
    "requested_model",
    "observed_model_counts",
    "system_fingerprint_counts",
    "prompt_version",
    "corpus_sha256",
    "corpus_name",
    "source_fingerprint",
    "git_head",
    "source_dirty",
)
REQUIRED_PROVENANCE_FIELDS = set(PROVENANCE_FIELDS) - {"repeat_id"}
OBSERVATION_FIELDS = (
    "case_id",
    "request",
    "intent",
    "expectations",
    "category",
    "boundary_required",
    "technical_pass",
    "provider_attempts",
)
PACKET_FIELDS = ("packet_version", "rubric_version", "provenance", "cases", "packet_sha256")
CASE_FIELDS = OBSERVATION_FIELDS + ("output_sha256",)
GRADE_FIELDS = (
    "review_source",
    "reviewer",
    "reviewed_at",
    "packet_sha256",
    "run_id",
    "corpus_sha256",
    "source_fingerprint",
    "rubric_version",
    "grades",
)
GRADE_ROW_FIELDS = ("case_id", "output_sha256", "criteria")
CRITERIA = ("relevance", "actionability", "language", "context")
REVIEW_SOURCES = {"unassigned", "human", "synthetic_fixture"}
VERDICTS = {"pass", "fail", "pending"}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA = re.compile(r"^[0-9a-f]{40}$")


class ReviewValidationError(ValueError):
    """A safe, bounded artifact validation failure."""


def _error(message: str) -> ReviewValidationError:
    return ReviewValidationError(message)


def _utf16_units(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def _safe_text(value: Any, name: str, *, limit: int, utf16: bool = True) -> str:
    if type(value) is not str:
        raise _error(f"{name} must be a string")
    if not value.strip():
        raise _error(f"{name} must not be blank")
    length = _utf16_units(value) if utf16 else len(value)
    if length > limit:
        raise _error(f"{name} exceeds its bound")
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise _error(f"{name} contains a control character")
    return value


def _nullable_text(value: Any, name: str, *, limit: int) -> str | None:
    if value is None:
        return None
    return _safe_text(value, name, limit=limit)


def _strict_bool(value: Any, name: str) -> bool:
    if type(value) is not bool:
        raise _error(f"{name} must be a boolean")
    return value


def _strict_nonnegative_int(value: Any, name: str) -> int:
    if type(value) is not int or value < 0:
        raise _error(f"{name} must be a nonnegative integer")
    return value


def _require_exact_fields(value: Any, fields: tuple[str, ...], name: str) -> None:
    if type(value) is not dict:
        raise _error(f"{name} must be an object")
    expected = set(fields)
    actual = set(value)
    if actual != expected:
        if actual - expected:
            raise _error(f"{name} contains unexpected fields")
        raise _error(f"{name} is missing required fields")


def _canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    except (TypeError, ValueError) as exc:
        raise _error("artifact contains a non-canonical JSON value") from exc


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _sha256_text(value: Any, name: str) -> str:
    candidate = _safe_text(value, name, limit=64)
    if not SHA256.fullmatch(candidate):
        raise _error(f"{name} must be a 64-character lowercase SHA-256 value")
    return candidate


def _safe_metadata(value: Any, name: str) -> str:
    if type(value) is not str:
        raise _error(f"{name} must be a string")
    if value == "<redacted>":
        return value
    lowered = value.casefold()
    if (
        not SAFE_METADATA.fullmatch(value)
        or lowered.startswith("sk-")
        or any(part in lowered for part in SUSPICIOUS_METADATA)
    ):
        raise _error(f"{name} is invalid")
    return value


def _metadata_counts(value: Any, name: str) -> dict[str, int]:
    if type(value) is not dict:
        raise _error(f"{name} must be an object")
    if len(value) > MAX_METADATA_VALUES:
        raise _error(f"{name} exceeds its bound")
    result: dict[str, int] = {}
    for key, count in value.items():
        safe_key = _safe_metadata(key, f"{name} key")
        result[safe_key] = _strict_nonnegative_int(count, f"{name} count")
    return result


def _validate_provenance(value: Any, *, default_repeat_id: bool) -> dict[str, Any]:
    if type(value) is not dict:
        raise _error("provenance must be an object")
    allowed = set(PROVENANCE_FIELDS)
    if set(value) - allowed:
        raise _error("provenance contains unexpected fields")
    missing = REQUIRED_PROVENANCE_FIELDS - set(value)
    if missing:
        raise _error(f"provenance is missing required fields: {sorted(missing)}")
    if "repeat_id" not in value:
        if not default_repeat_id:
            raise _error("provenance is missing repeat_id")
        repeat_id: Any = "1"
    else:
        repeat_id = value["repeat_id"]
    result = {
        "run_id": _safe_text(value["run_id"], "run_id", limit=MAX_LABEL_UTF16),
        "repeat_id": _safe_text(repeat_id, "repeat_id", limit=64),
        "mode": value["mode"],
        "requested_model": _safe_metadata(value["requested_model"], "requested_model"),
        "observed_model_counts": _metadata_counts(
            value["observed_model_counts"], "observed_model_counts"
        ),
        "system_fingerprint_counts": _metadata_counts(
            value["system_fingerprint_counts"], "system_fingerprint_counts"
        ),
        "prompt_version": _safe_text(
            value["prompt_version"], "prompt_version", limit=MAX_LABEL_UTF16
        ),
        "corpus_sha256": _sha256_text(value["corpus_sha256"], "corpus_sha256"),
        "corpus_name": _safe_text(value["corpus_name"], "corpus_name", limit=MAX_LABEL_UTF16),
        "source_fingerprint": _sha256_text(
            value["source_fingerprint"], "source_fingerprint"
        ),
        "git_head": value["git_head"],
        "source_dirty": _strict_bool(value["source_dirty"], "source_dirty"),
    }
    if type(result["mode"]) is not str or result["mode"] not in {
        "deterministic",
        "live",
        "live-mocked",
    }:
        raise _error("mode must be deterministic, live or live-mocked")
    if result["git_head"] != "unavailable":
        if type(result["git_head"]) is not str or not GIT_SHA.fullmatch(result["git_head"]):
            raise _error("git_head must be a 40-character SHA-1 value or unavailable")
    return result


def _validate_intent(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if type(value) is not dict:
        raise _error("intent must be an object or null")
    try:
        validated = Intent.model_validate(value, strict=True)
    except Exception as exc:
        raise _error("intent does not match the strict Intent schema") from exc
    return validated.model_dump(mode="json")


def _validate_observation(value: Any, *, packet_case: bool) -> dict[str, Any]:
    _require_exact_fields(value, CASE_FIELDS if packet_case else OBSERVATION_FIELDS, "case")
    intent = _validate_intent(value["intent"])
    result = {
        "case_id": _safe_text(value["case_id"], "case_id", limit=MAX_CASE_ID_UTF16),
        "request": _safe_text(value["request"], "request", limit=MAX_REQUEST_UTF16),
        "intent": intent,
        "expectations": _safe_text(
            value["expectations"], "expectations", limit=MAX_EXPECTATIONS_CHARS, utf16=False
        ),
        "category": _safe_text(value["category"], "category", limit=MAX_LABEL_UTF16),
        "boundary_required": _strict_bool(value["boundary_required"], "boundary_required"),
        "technical_pass": _strict_bool(value["technical_pass"], "technical_pass"),
        "provider_attempts": _strict_nonnegative_int(
            value["provider_attempts"], "provider_attempts"
        ),
    }
    expected_hash = _sha256_json(intent)
    if packet_case:
        supplied_hash = value["output_sha256"]
        if type(supplied_hash) is not str or not SHA256.fullmatch(supplied_hash):
            raise _error("output_sha256 must be a 64-character lowercase SHA-256 value")
        if supplied_hash != expected_hash:
            raise _error("output_sha256 does not match intent")
        result["output_sha256"] = supplied_hash
    else:
        result["output_sha256"] = expected_hash
    return result


def _validate_observations(value: Any) -> list[dict[str, Any]]:
    if type(value) is not list:
        raise _error("observations must be a list")
    if len(value) > MAX_CASES:
        raise _error("observations exceed the case limit")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in value:
        case = _validate_observation(item, packet_case=False)
        if case["case_id"] in seen:
            raise _error("case_id values must be unique")
        seen.add(case["case_id"])
        result.append(case)
    return result


def _packet_payload(packet: dict[str, Any]) -> dict[str, Any]:
    return {key: packet[key] for key in PACKET_FIELDS if key != "packet_sha256"}


def _validate_packet(value: Any) -> dict[str, Any]:
    _require_exact_fields(value, PACKET_FIELDS, "packet")
    if value["packet_version"] != PACKET_VERSION:
        raise _error("packet_version is unsupported")
    if value["rubric_version"] != RUBRIC_VERSION:
        raise _error("rubric_version is unsupported")
    provenance = _validate_provenance(value["provenance"], default_repeat_id=False)
    cases_value = value["cases"]
    if type(cases_value) is not list or len(cases_value) > MAX_CASES:
        raise _error("packet cases exceed the case limit")
    cases: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in cases_value:
        case = _validate_observation(item, packet_case=True)
        if case["case_id"] in seen:
            raise _error("packet case_id values must be unique")
        seen.add(case["case_id"])
        cases.append(case)
    packet_hash = value["packet_sha256"]
    if type(packet_hash) is not str or not SHA256.fullmatch(packet_hash):
        raise _error("packet_sha256 must be a 64-character lowercase SHA-256 value")
    normalized = {
        "packet_version": PACKET_VERSION,
        "rubric_version": RUBRIC_VERSION,
        "provenance": provenance,
        "cases": cases,
        "packet_sha256": packet_hash,
    }
    if packet_hash != _sha256_json(_packet_payload(normalized)):
        raise _error("packet_sha256 does not match packet contents")
    return normalized


def make_review_packet(provenance: dict, observations: list[dict]) -> dict:
    """Validate bounded observations and bind them into one review packet."""

    packet: dict[str, Any] = {
        "packet_version": PACKET_VERSION,
        "rubric_version": RUBRIC_VERSION,
        "provenance": _validate_provenance(provenance, default_repeat_id=True),
        "cases": _validate_observations(observations),
    }
    packet["packet_sha256"] = _sha256_json(packet)
    return packet


def _criteria_for_case(case: dict[str, Any]) -> tuple[str, ...]:
    return CRITERIA + (("boundary",) if case["boundary_required"] else ())


def make_grade_template(packet: dict) -> dict:
    """Create pending rows bound to a validated packet."""

    validated = _validate_packet(packet)
    rows = []
    for case in validated["cases"]:
        rows.append(
            {
                "case_id": case["case_id"],
                "output_sha256": case["output_sha256"],
                "criteria": {
                    criterion: {"verdict": "pending", "reason": ""}
                    for criterion in _criteria_for_case(case)
                },
            }
        )
    provenance = validated["provenance"]
    return {
        "review_source": "unassigned",
        "reviewer": None,
        "reviewed_at": None,
        "packet_sha256": validated["packet_sha256"],
        "run_id": provenance["run_id"],
        "corpus_sha256": provenance["corpus_sha256"],
        "source_fingerprint": provenance["source_fingerprint"],
        "rubric_version": RUBRIC_VERSION,
        "grades": rows,
    }


def _iso_timestamp(value: Any, name: str) -> str:
    candidate = _safe_text(value, name, limit=128)
    normalized = candidate[:-1] + "+00:00" if candidate.endswith(("Z", "z")) else candidate
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise _error(f"{name} must be a valid ISO timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise _error(f"{name} must include a timezone")
    return candidate


def _validate_grade_artifact(packet: dict[str, Any], value: Any) -> tuple[str, list[dict[str, Any]]]:
    _require_exact_fields(value, GRADE_FIELDS, "grades")
    source = value["review_source"]
    if type(source) is not str or source not in REVIEW_SOURCES:
        raise _error("review_source is unsupported")
    reviewer = value["reviewer"]
    reviewed_at = value["reviewed_at"]
    if source == "unassigned":
        if reviewer is not None or reviewed_at is not None:
            raise _error("unassigned reviews cannot declare reviewer metadata")
    elif source == "human":
        _safe_text(reviewer, "reviewer", limit=MAX_LABEL_UTF16)
        _iso_timestamp(reviewed_at, "reviewed_at")
    else:
        if reviewer is not None:
            _safe_text(reviewer, "reviewer", limit=MAX_LABEL_UTF16)
        if reviewed_at is not None:
            _iso_timestamp(reviewed_at, "reviewed_at")
    bindings = {
        "packet_sha256": packet["packet_sha256"],
        "run_id": packet["provenance"]["run_id"],
        "corpus_sha256": packet["provenance"]["corpus_sha256"],
        "source_fingerprint": packet["provenance"]["source_fingerprint"],
        "rubric_version": RUBRIC_VERSION,
    }
    for key, expected in bindings.items():
        if value[key] != expected:
            raise _error(f"grade binding mismatch: {key}")
    rows_value = value["grades"]
    if type(rows_value) is not list or len(rows_value) > MAX_CASES:
        raise _error("grades must be a bounded list")
    cases = {case["case_id"]: case for case in packet["cases"]}
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    completed = False
    for row in rows_value:
        _require_exact_fields(row, GRADE_ROW_FIELDS, "grade row")
        case_id = _safe_text(row["case_id"], "grade case_id", limit=MAX_CASE_ID_UTF16)
        if case_id in seen:
            raise _error("grade case_id values must be unique")
        case = cases.get(case_id)
        if case is None:
            raise _error("grade references an unknown case")
        seen.add(case_id)
        output_hash = row["output_sha256"]
        if type(output_hash) is not str or not SHA256.fullmatch(output_hash):
            raise _error("grade output_sha256 is invalid")
        if output_hash != case["output_sha256"]:
            raise _error("grade output_sha256 does not match packet output")
        criteria_value = row["criteria"]
        if type(criteria_value) is not dict:
            raise _error("grade criteria must be an object")
        expected_criteria = set(_criteria_for_case(case))
        if set(criteria_value) - expected_criteria:
            raise _error("grade contains an unknown criterion")
        criteria: dict[str, dict[str, str]] = {}
        for criterion, decision in criteria_value.items():
            _require_exact_fields(decision, ("verdict", "reason"), "criterion grade")
            verdict = decision["verdict"]
            if type(verdict) is not str or verdict not in VERDICTS:
                raise _error("criterion verdict is invalid")
            reason = decision["reason"]
            if type(reason) is not str:
                raise _error("criterion reason must be a string")
            if len(reason) > MAX_REASON_CHARS:
                raise _error("criterion reason is not concise")
            if any(unicodedata.category(character) == "Cc" for character in reason):
                raise _error("criterion reason contains a control character")
            if verdict in {"pass", "fail"} and not reason.strip():
                raise _error("pass/fail criterion grades require a concise reason")
            criteria[criterion] = {"verdict": verdict, "reason": reason}
            completed = completed or verdict in {"pass", "fail"}
        rows.append({"case_id": case_id, "output_sha256": output_hash, "criteria": criteria})
    if source == "unassigned" and completed:
        raise _error("completed grades require a declared review source")
    return source, rows


def _case_decision(
    case: dict[str, Any], criteria: dict[str, dict[str, str]] | None, *, assessment_started: bool
) -> tuple[str, bool]:
    expected = _criteria_for_case(case)
    verdicts = [criteria.get(name, {}).get("verdict", "pending") for name in expected] if criteria else [
        "pending"
    ] * len(expected)
    complete = all(verdict != "pending" for verdict in verdicts)
    if case["intent"] is None or not case["technical_pass"]:
        return ("fail" if assessment_started else "pending"), complete
    if "fail" in verdicts:
        return "fail", complete
    if "pending" in verdicts:
        return "pending", complete
    return "pass", complete


def summarize_review(packet: dict, grades: dict | None = None) -> dict:
    """Summarize bound grades without making semantic judgments in code."""

    validated_packet = _validate_packet(packet)
    if grades is None:
        source = "none"
        rows: list[dict[str, Any]] = []
    else:
        source, rows = _validate_grade_artifact(validated_packet, grades)
    row_by_case = {row["case_id"]: row for row in rows}
    decisions: list[dict[str, str]] = []
    graded_cases = 0
    pending_cases = 0
    failed_case_ids: list[str] = []
    for case in validated_packet["cases"]:
        row = row_by_case.get(case["case_id"])
        decision, complete = _case_decision(
            case, row["criteria"] if row else None,
            assessment_started=source in {"human", "synthetic_fixture"},
        )
        graded_cases += complete
        pending_cases += not complete
        decisions.append({"case_id": case["case_id"], "decision": decision})
        if decision == "fail":
            failed_case_ids.append(case["case_id"])
    applicable_cases = len(validated_packet["cases"])
    complete_review = applicable_cases > 0 and graded_cases == applicable_cases
    if source == "human" and any(item["decision"] == "fail" for item in decisions):
        overall_quality = "fail"
    elif (
        source == "human"
        and complete_review
        and all(item["decision"] == "pass" for item in decisions)
        and all(case["technical_pass"] and case["intent"] is not None for case in validated_packet["cases"])
    ):
        overall_quality = "pass"
    else:
        overall_quality = "not_established"
    acceptance_rate = None
    if source == "human" and complete_review and applicable_cases:
        accepted = sum(item["decision"] == "pass" for item in decisions)
        acceptance_rate = accepted / applicable_cases
    fixture_results = None
    if source == "synthetic_fixture":
        fixture_results = {
            "label": "synthetic_fixture",
            "graded_cases": graded_cases,
            "pending_cases": pending_cases,
            "passed_cases": sum(item["decision"] == "pass" for item in decisions),
            "failed_cases": len(failed_case_ids),
            "decisions": decisions,
        }
    return {
        "rubric_version": RUBRIC_VERSION,
        "assessment_source": source,
        "applicable_cases": applicable_cases,
        "graded_cases": graded_cases,
        "pending_cases": pending_cases,
        "failed_case_ids": failed_case_ids,
        "technical_unavailable_case_ids": [
            case["case_id"] for case in validated_packet["cases"]
            if case["intent"] is None or not case["technical_pass"]
        ],
        "decisions": decisions,
        "overall_quality": overall_quality,
        "human_acceptance_rate": acceptance_rate,
        "fixture_results": fixture_results,
    }


def _reject_json_constant(value: str) -> Any:
    raise ValueError(f"invalid JSON constant: {value}")


def _object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, item in pairs:
        if key in result:
            raise ValueError("duplicate JSON field")
        result[key] = item
    return result


def _load_artifact(path_value: str) -> dict[str, Any]:
    path = Path(path_value)
    try:
        if not path.is_file() or path.stat().st_size > MAX_ARTIFACT_BYTES:
            raise _error("evaluation artifact is missing or too large")
        raw = path.read_bytes()
        if len(raw) > MAX_ARTIFACT_BYTES:
            raise _error("evaluation artifact is too large")
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_object_without_duplicates,
            parse_constant=_reject_json_constant,
        )
    except ReviewValidationError:
        raise
    except (OSError, UnicodeError, TypeError, ValueError) as exc:
        raise _error("evaluation artifact is not valid UTF-8 JSON") from exc
    if type(value) is not dict:
        raise _error("evaluation artifact must be a JSON object")
    return value


def _write_artifact(path_value: str, value: dict[str, Any]) -> None:
    path = Path(path_value)
    try:
        with path.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
    except FileExistsError as exc:
        raise _error("output already exists; refusing to overwrite") from exc
    except OSError as exc:
        raise _error("could not write output artifact") from exc


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create or score Cadencia review artifacts")
    subparsers = parser.add_subparsers(dest="command", required=True)
    template = subparsers.add_parser("template")
    template.add_argument("--packet", required=True)
    template.add_argument("--output", required=True)
    score = subparsers.add_parser("score")
    score.add_argument("--packet", required=True)
    score.add_argument("--grades")
    score.add_argument("--output", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        packet = _load_artifact(args.packet)
        if args.command == "template":
            output = make_grade_template(packet)
            status = f"template cases={len(output['grades'])}"
        else:
            grades = _load_artifact(args.grades) if args.grades else None
            output = summarize_review(packet, grades)
            status = (
                f"score source={output['assessment_source']} "
                f"cases={output['applicable_cases']} pending={output['pending_cases']}"
            )
        _write_artifact(args.output, output)
    except ReviewValidationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"wrote {args.output} ({status})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
