"""Shared test setup for the intent service and its evaluation tools."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module  # noqa: E402


@pytest.fixture(autouse=True)
def reset_daily_attempts():
    """Each test starts with an empty per-process attempt fence."""

    app_module.DAILY_ATTEMPTS.reset()
    yield
    app_module.DAILY_ATTEMPTS.reset()
