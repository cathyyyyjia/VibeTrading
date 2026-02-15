from __future__ import annotations

import pytest

from app.services import run_service
from app.services.llm_client import llm_client


@pytest.mark.asyncio
async def test_generate_ai_summary_fallback_when_llm_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.setattr(llm_client, "_api_key", "")
  result = await run_service._generate_ai_summary(  # type: ignore[attr-defined]
    prompt="test prompt",
    strategy_name="test strategy",
    kpis={"return_pct": 1.2, "sharpe": 0.8, "max_dd_pct": -5.1, "trades": 3},
    start_date="2025-01-01",
    end_date="2025-12-31",
  )
  assert run_service._summary_complete(result)  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_generate_ai_summary_fallback_when_llm_output_incomplete(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.setattr(llm_client, "_api_key", "dummy")

  async def _fake_chat_json(*args, **kwargs):
    return {"en": "too short", "zh": ""}

  monkeypatch.setattr(llm_client, "chat_json", _fake_chat_json)
  result = await run_service._generate_ai_summary(  # type: ignore[attr-defined]
    prompt="test prompt",
    strategy_name="test strategy",
    kpis={"return_pct": 1.2, "sharpe": 0.8, "max_dd_pct": -5.1, "trades": 3},
    start_date="2025-01-01",
    end_date="2025-12-31",
  )
  assert run_service._summary_complete(result)  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_generate_ai_summary_accepts_valid_llm_output(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.setattr(llm_client, "_api_key", "dummy")

  async def _fake_chat_json(*args, **kwargs):
    return {
      "en": "Return was solid with controlled drawdown, but entries can be timed better for consistency.",
      "zh": "整体收益表现尚可且回撤可控，但入场时机仍可优化，以提升策略稳定性。",
    }

  monkeypatch.setattr(llm_client, "chat_json", _fake_chat_json)
  result = await run_service._generate_ai_summary(  # type: ignore[attr-defined]
    prompt="test prompt",
    strategy_name="test strategy",
    kpis={"return_pct": 1.2, "sharpe": 0.8, "max_dd_pct": -5.1, "trades": 3},
    start_date="2025-01-01",
    end_date="2025-12-31",
  )
  assert run_service._summary_complete(result)  # type: ignore[attr-defined]
  assert "entries" in result["en"].lower()

