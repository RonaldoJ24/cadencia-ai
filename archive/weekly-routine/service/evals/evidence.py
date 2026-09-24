"""Small source/corpus provenance and immutable artifact helpers; no secret inputs."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
EVALS = Path(__file__).resolve().parent
LIVE_PRICING_SOURCE_DATE = "2026-08-31"
LIVE_PRICING_SOURCES = (
    "https://api-docs.deepseek.com/quick_start/pricing/",
    "https://api-docs.deepseek.com/api/create-chat-completion/",
    "https://api-docs.deepseek.com/news/news260424/",
)
# Explicit intended inputs only. Never glob the repository or hash dotenv files.
SOURCE_INPUTS = (
    "service/app.py", "service/provider.py", "service/pyproject.toml", "service/uv.lock",
    "service/Dockerfile", "service/.dockerignore", "service/test_service.py",
    "service/evals/run.py", "service/evals/evidence.py", "service/evals/review.py",
    "service/evals/test_evals.py", "service/evals/test_review.py", "service/evals/smoke.py",
    "service/evals/RUBRIC.md", "service/evals/catalog.json", "service/evals/cases.jsonl",
    "service/evals/heldout.jsonl", "service/evals/live-baseline-v1.jsonl",
    "service/evals/fixtures/provider_responses.json",
    "app/api/routine/route.ts", "lib/routine.ts", "lib/calendar.ts", "lib/insights.ts",
    "scripts/build-guard.mjs",
    "tests/provider.test.ts", "vite.config.ts", "package.json", "package-lock.json",
    ".github/workflows/ci.yml", ".github/workflows/live-eval.yml",
)


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def new_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:12]


def validate_id(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", value):
        raise ValueError("run/repeat ID must be a bounded filename-safe identifier")
    return value


def source_revision() -> dict[str, Any]:
    files = {name: digest((ROOT / name).read_bytes()) for name in SOURCE_INPUTS}
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if not re.fullmatch(r"[0-9a-f]{40,64}", head):
        raise ValueError("invalid source revision")
    dirty = False
    for name, current in files.items():
        base = subprocess.run(
            ["git", "show", f"{head}:{name}"], cwd=ROOT, capture_output=True, check=False,
        )
        if base.returncode or digest(base.stdout) != current:
            dirty = True
            break
    return {"git_head": head, "source_dirty": dirty,
            "source_fingerprint": digest(canonical(files)), "source_files": files}


def corpus_info(path: Path) -> tuple[str, str, dict[str, Any]]:
    """Only an exact catalog hash permits export of public synthetic test outputs."""
    corpus_hash = digest(path.read_bytes())
    catalog = json.loads((EVALS / "catalog.json").read_text())
    if catalog.get("declared_public_synthetic") is not True:
        raise ValueError("public synthetic catalog is not declared")
    for name in ("development", "heldout", "live-baseline-v1"):
        entry = catalog["corpora"][name]
        if corpus_hash == entry["sha256"]:
            return name, corpus_hash, catalog["cases"]
    return "custom-unreviewed", corpus_hash, {}


def write_new(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, indent=2, allow_nan=False)
        output.write("\n")


def live_preflight(
    *,
    corpus_name: str,
    corpus_sha256: str,
    prompt_version: str,
    requested_model: str,
    run_id: str,
    repeat_id: str,
    revision: dict[str, Any],
    max_provider_attempts: int,
    input_rate: float,
    cached_input_rate: float,
    output_rate: float,
) -> dict[str, Any]:
    """Build the non-secret binding that must exist before a live call."""

    if corpus_name != "live-baseline-v1" or not re.fullmatch(r"[0-9a-f]{64}", corpus_sha256):
        raise ValueError("live preflight requires the frozen live-baseline-v1 corpus")
    if requested_model != "deepseek-v4-flash":
        raise ValueError("live preflight requires requested model deepseek-v4-flash")
    if not isinstance(max_provider_attempts, int) or not 0 < max_provider_attempts <= 20:
        raise ValueError("live baseline attempt ceiling must be between 1 and 20")
    if min(input_rate, cached_input_rate, output_rate) < 0:
        raise ValueError("live preflight prices must be nonnegative")
    max_estimated_cost = max_provider_attempts * (
        4_000 * input_rate + 800 * output_rate
    ) / 1_000_000
    if max_estimated_cost >= 1:
        raise ValueError("live preflight conservative maximum must remain below one USD")
    return {
        "artifact_version": "cadencia-live-preflight-v1",
        "corpus_name": corpus_name,
        "corpus_sha256": corpus_sha256,
        "prompt_version": prompt_version,
        "git_head": revision["git_head"],
        "source_fingerprint": revision["source_fingerprint"],
        "source_dirty": revision["source_dirty"],
        "requested_model": requested_model,
        "run_id": run_id,
        "repeat_id": repeat_id,
        "baseline_max_provider_attempts": max_provider_attempts,
        "pricing": {
            "retrieved_at": LIVE_PRICING_SOURCE_DATE,
            "official_links": list(LIVE_PRICING_SOURCES),
            "input_usd_per_million": input_rate,
            "cached_input_usd_per_million": cached_input_rate,
            "output_usd_per_million": output_rate,
        },
        "conservative_max_estimated_usd": round(max_estimated_cost, 8),
    }
