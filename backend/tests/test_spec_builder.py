from __future__ import annotations

import pytest

from app.services.llm_client import llm_client
from app.services.spec_builder import nl_to_strategy_spec


@pytest.mark.asyncio
async def test_nl_to_spec_enforces_hard_rules(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.setattr(llm_client, "_api_key", "")
  spec = await nl_to_strategy_spec("Sell TQQQ when MACD death cross and below MA5", "BACKTEST_ONLY")
  assert spec["timezone"] == "America/New_York"
  assert spec["calendar"]["value"] == "XNYS"
  assert spec["decision"]["decision_time_rule"]["offset"] == "-2m"
  assert spec["execution"]["model"] == "MOC"
  assert spec["universe"]["signal_symbol"] in ("QQQ", "NDX")
  assert spec["universe"]["trade_symbol"] == "TQQQ"
  assert spec["strategy_version"]
