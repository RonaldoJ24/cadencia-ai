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
# Explicit intended inputs only. Never glob the repository or hash dotenv files.
SOURCE_INPUTS = (
    "service/app.py", "service/provider.py", "service/pyproject.toml", "service/uv.lock",
    "service/Dockerfile", "service/.dockerignore", "service/test_service.py",
    "service/evals/run.py", "service/evals/evidence.py", "service/evals/review.py",
    "service/evals/test_evals.py", "service/evals/test_review.py", "service/evals/smoke.py",
    "service/evals/RUBRIC.md", "service/evals/catalog.json", "service/evals/cases.jsonl",
    "service/evals/heldout.jsonl", "service/evals/fixtures/provider_responses.json",
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
    for name in ("development", "heldout"):
        entry = catalog["corpora"][name]
        if corpus_hash == entry["sha256"]:
            return name, corpus_hash, catalog["cases"]
    return "custom-unreviewed", corpus_hash, {}


def write_new(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, indent=2, allow_nan=False)
        output.write("\n")
