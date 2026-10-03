"""Shared test setup for the intent service and its evaluation tools."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module  # noqa: E402
import provider  # noqa: E402


@pytest.fixture(autouse=True)
def reset_daily_attempts():
    """Each test starts with an empty per-process attempt fence."""

    app_module.DAILY_ATTEMPTS.reset()
    yield
    app_module.DAILY_ATTEMPTS.reset()


@pytest.fixture(autouse=True)
def no_provider_retry_sleep(monkeypatch: pytest.MonkeyPatch):
    """Keep the existing provider tests fast; backoff tests inject their own sleep."""

    async def no_sleep(delay: float) -> None:
        del delay

    monkeypatch.setattr(provider, "_sleep", no_sleep)
