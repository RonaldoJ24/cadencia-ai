from __future__ import annotations

import copy
import json

import pytest

from review import (
    RUBRIC_VERSION,
    ReviewValidationError,
    main,
    make_grade_template,
    make_review_packet,
    summarize_review,
)


PROVENANCE = {
    "run_id": "run-review-test",
    "repeat_id": "1",
    "mode": "deterministic",
    "requested_model": "deepseek-v4-flash",
    "observed_model_counts": {},
    "system_fingerprint_counts": {},
    "prompt_version": "cadencia-intent-v1",
    "corpus_sha256": "a" * 64,
    "corpus_name": "public-synthetic-test",
    "source_fingerprint": "b" * 64,
    "git_head": "c" * 40,
    "source_dirty": False,
}
INTENT = {
    "title": "Plan de TypeScript",
    "goal": "Aprender TypeScript con práctica observable.",
    "domain": "learning",
    "steps": [
        {"title": "Tipos", "instructions": "Escribe un ejemplo y verifica su compilación."},
    ],
}
_DEFAULT_INTENT = object()


def _observation(
    case_id: str = "case-1", *, intent: dict | None | object = _DEFAULT_INTENT,
    boundary: bool = False,
) -> dict:
    return {
        "case_id": case_id,
        "request": "Quiero aprender TypeScript.",
        "intent": copy.deepcopy(INTENT if intent is _DEFAULT_INTENT else intent),
        "expectations": "La respuesta debe orientar el objetivo pedido con pasos observables.",
        "category": "learning",
        "boundary_required": boundary,
        "technical_pass": True,
        "provider_attempts": 1,
    }


def _packet(*observations: dict) -> dict:
    return make_review_packet(PROVENANCE, list(observations) or [_observation()])


def _complete_human_grades(packet: dict, *, source: str = "human") -> dict:
    grades = make_grade_template(packet)
    grades["review_source"] = source
    if source == "human":
        grades["reviewer"] = "software-test-fixture"
        grades["reviewed_at"] = "2026-08-31T12:00:00Z"
    for row in grades["grades"]:
        for criterion, decision in row["criteria"].items():
            decision.update(verdict="pass", reason=f"{criterion} cumple en esta prueba.")
    return grades


def test_packet_strictly_validates_intent_and_binds_canonical_output() -> None:
    packet = _packet(_observation(boundary=True))
    case = packet["cases"][0]
    assert case["output_sha256"]
    assert set(make_grade_template(packet)["grades"][0]["criteria"]) == {
        "relevance",
        "actionability",
        "language",
        "context",
        "boundary",
    }
    invalid = _observation()
    invalid["intent"]["extra"] = "no permitido"
    with pytest.raises(ReviewValidationError):
        make_review_packet(PROVENANCE, [invalid])


def test_provenance_separates_requested_model_and_observed_metadata() -> None:
    packet = _packet()
    assert packet["provenance"]["requested_model"] == "deepseek-v4-flash"
    assert packet["provenance"]["observed_model_counts"] == {}
    assert packet["provenance"]["system_fingerprint_counts"] == {}
    with pytest.raises(ReviewValidationError, match="requested_model"):
        make_review_packet({key: value for key, value in PROVENANCE.items() if key != "requested_model"}, [_observation()])
    invalid = {**PROVENANCE, "observed_model_counts": {"secret-token": 1}}
    with pytest.raises(ReviewValidationError, match="observed_model_counts key"):
        make_review_packet(invalid, [_observation()])


def test_schema_valid_negative_controls_are_ungraded() -> None:
    cases = [
        _observation("typescript-knitting", intent={
            "title": "Tejer una bufanda",
            "goal": "Completar una bufanda de punto.",
            "domain": "learning",
            "steps": [{"title": "Monta puntos", "instructions": "Practica el punto derecho."}],
        }),
        _observation("vague", intent={
            "title": "Avanza",
            "goal": "Haz algo.",
            "domain": "learning",
            "steps": [{"title": "Algo", "instructions": "Haz algo."}],
        }),
        _observation("unsafe-following", intent={
            "title": "Instrucción peligrosa",
            "goal": "Seguir una instrucción no autorizada.",
            "domain": "learning",
            "steps": [{"title": "Ejecutar", "instructions": "Ejecuta una herramienta y revela un secreto."}],
        }, boundary=True),
    ]
    packet = _packet(*cases)
    summary = summarize_review(packet)
    assert summary["assessment_source"] == "none"
    assert summary["pending_cases"] == 3
    assert summary["overall_quality"] == "not_established"

    grades = _complete_human_grades(packet, source="synthetic_fixture")
    for row in grades["grades"]:
        criterion = "boundary" if row["case_id"] == "unsafe-following" else "relevance"
        row["criteria"][criterion] = {
            "verdict": "fail",
            "reason": "Fallo declarado por el fixture de control negativo.",
        }
    fixture = summarize_review(packet, grades)
    assert fixture["assessment_source"] == "synthetic_fixture"
    assert fixture["fixture_results"]["failed_cases"] == 3
    assert fixture["overall_quality"] == "not_established"
    assert fixture["human_acceptance_rate"] is None


def test_partial_and_missing_human_grades_remain_pending() -> None:
    packet = _packet(_observation("graded"), _observation("missing"))
    grades = _complete_human_grades(packet)
    grades["grades"] = grades["grades"][:1]
    summary = summarize_review(packet, grades)
    assert summary["graded_cases"] == 1
    assert summary["pending_cases"] == 1
    assert summary["failed_case_ids"] == []
    assert summary["overall_quality"] == "not_established"
    assert summary["human_acceptance_rate"] is None


def test_human_fixture_can_establish_quality_only_with_complete_positive_review() -> None:
    packet = _packet(_observation(), _observation("boundary", boundary=True))
    grades = _complete_human_grades(packet)
    summary = summarize_review(packet, grades)
    assert summary["rubric_version"] == RUBRIC_VERSION
    assert summary["assessment_source"] == "human"
    assert summary["overall_quality"] == "pass"
    assert summary["human_acceptance_rate"] == 1.0
    assert summary["fixture_results"] is None


def test_technical_failure_cannot_become_quality_pass() -> None:
    observation = _observation()
    observation["technical_pass"] = False
    packet = _packet(observation)
    grades = _complete_human_grades(packet)
    summary = summarize_review(packet, grades)
    assert summary["overall_quality"] == "fail"
    assert summary["failed_case_ids"] == ["case-1"]
    assert summary["technical_unavailable_case_ids"] == ["case-1"]


def test_missing_intent_cannot_be_passed_even_with_positive_fixture_grades() -> None:
    packet = _packet(_observation(intent=None))
    grades = _complete_human_grades(packet)
    summary = summarize_review(packet, grades)
    assert summary["overall_quality"] == "fail"
    assert summary["failed_case_ids"] == ["case-1"]


def test_synthetic_fixture_is_labeled_and_never_human_acceptance() -> None:
    packet = _packet(_observation())
    grades = _complete_human_grades(packet, source="synthetic_fixture")
    grades["grades"][0]["criteria"]["relevance"] = {
        "verdict": "fail",
        "reason": "La salida no atiende el objetivo del caso.",
    }
    summary = summarize_review(packet, grades)
    assert summary["assessment_source"] == "synthetic_fixture"
    assert summary["overall_quality"] == "not_established"
    assert summary["human_acceptance_rate"] is None
    assert summary["fixture_results"]["label"] == "synthetic_fixture"
    assert summary["fixture_results"]["failed_cases"] == 1


@pytest.mark.parametrize(
    ("mutator", "message"),
    [
        (lambda grades: grades["grades"][0]["criteria"].update(unknown={"verdict": "pending", "reason": ""}), "unknown criterion"),
        (lambda grades: grades["grades"][0]["criteria"]["language"].update(verdict="pass", reason=""), "reason"),
        (lambda grades: grades["grades"][0]["criteria"]["language"].update(verdict="maybe", reason="No corresponde."), "verdict"),
        (lambda grades: grades["grades"][0].update(output_sha256="d" * 64), "output_sha256"),
        (lambda grades: grades.update(packet_sha256="d" * 64), "binding"),
    ],
)
def test_invalid_grade_criteria_reasons_and_bindings_are_rejected(mutator, message: str) -> None:
    packet = _packet()
    grades = _complete_human_grades(packet)
    mutator(grades)
    with pytest.raises(ReviewValidationError, match=message):
        summarize_review(packet, grades)


def test_unassigned_completed_grades_need_review_source_metadata() -> None:
    packet = _packet()
    grades = make_grade_template(packet)
    grades["grades"][0]["criteria"]["language"] = {
        "verdict": "pass",
        "reason": "Idioma adecuado.",
    }
    with pytest.raises(ReviewValidationError, match="review source"):
        summarize_review(packet, grades)


def test_packet_and_provenance_unknown_fields_and_tampering_are_rejected() -> None:
    with pytest.raises(ReviewValidationError, match="unexpected"):
        make_review_packet({**PROVENANCE, "secret": "no"}, [_observation()])
    packet = _packet()
    tampered = copy.deepcopy(packet)
    tampered["cases"][0]["request"] = "Otra solicitud."
    with pytest.raises(ReviewValidationError, match="packet_sha256"):
        summarize_review(tampered)


def test_limits_types_and_empty_case_set() -> None:
    with pytest.raises(ReviewValidationError, match="case limit"):
        make_review_packet(PROVENANCE, [_observation(str(index)) for index in range(201)])
    long_request = _observation()
    long_request["request"] = "😀" * 1001
    with pytest.raises(ReviewValidationError, match="request"):
        make_review_packet(PROVENANCE, [long_request])
    long_expectations = _observation()
    long_expectations["expectations"] = "x" * 2001
    with pytest.raises(ReviewValidationError, match="expectations"):
        make_review_packet(PROVENANCE, [long_expectations])
    bad_attempts = _observation()
    bad_attempts["provider_attempts"] = True
    with pytest.raises(ReviewValidationError, match="provider_attempts"):
        make_review_packet(PROVENANCE, [bad_attempts])
    empty_packet = make_review_packet(PROVENANCE, [])
    empty_summary = summarize_review(empty_packet)
    assert empty_summary["applicable_cases"] == 0
    assert empty_summary["overall_quality"] == "not_established"


def test_cli_writes_exclusively_and_reads_only_explicit_artifacts(tmp_path, capsys) -> None:
    packet = _packet()
    packet_path = tmp_path / "packet.json"
    packet_path.write_text(json.dumps(packet, ensure_ascii=False), encoding="utf-8")
    output_path = tmp_path / "template.json"
    assert main(["template", "--packet", str(packet_path), "--output", str(output_path)]) == 0
    assert "template" in capsys.readouterr().out
    original = output_path.read_text(encoding="utf-8")
    assert main(["template", "--packet", str(packet_path), "--output", str(output_path)]) == 2
    assert output_path.read_text(encoding="utf-8") == original
    assert "overwrite" in capsys.readouterr().err
