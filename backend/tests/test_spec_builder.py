from __future__ import annotations

import os
from typing import Any

import pytest

from app.services.llm_client import llm_client
from app.services.spec_builder import nl_to_strategy_spec


PROMPT = "Sell 25% TQQQ when QQQ has a 4H MACD death cross and at 2 minutes before close it's still below the 5-day MA."


def _mock_strategy_draft() -> dict[str, Any]:
  return {
    "name": "QQQ MACD bearish partial sell",
    "universe": {"signal_symbol": "QQQ", "trade_symbol": "TQQQ"},
    "risk": {"cooldown": {"scope": "SYMBOL_ACTION", "value": "1d"}, "max_orders_per_day": 1},
    "dsl": {
      "atomic": {
        "symbols": {"signal": "QQQ", "trade": "TQQQ"},
        "constants": {"lookback": "5d", "sell_fraction": 0.25},
      },
      "time": {
        "primary_tf": "1m",
        "derived_tfs": ["4h", "1d"],
        "aggregation": {"4h": "SESSION_ALIGNED_4H", "1d": "SESSION_ALIGNED_1D"},
      },
      "signal": {
        "indicators": [
          {"id": "macd_4h", "type": "MACD", "tf": "4h", "symbol_ref": "signal", "params": {"fast": 12, "slow": 26, "signal": 9}},
          {"id": "close_1m", "type": "CLOSE", "tf": "1m", "symbol_ref": "signal", "params": {}},
          {"id": "ma5_1d", "type": "SMA", "tf": "1d", "symbol_ref": "signal", "params": {"window": "5d", "bar_selection": "LAST_CLOSED_1D"}},
        ],
        "events": [
          {
            "id": "macd_bear_cross",
            "type": "CROSS_DOWN",
            "a": "macd_4h.macd",
            "b": "macd_4h.signal",
            "left": None,
            "right": None,
            "direction": "DOWN",
            "op": None,
            "value": None,
          }
        ],
      },
      "logic": {
        "rules": [
          {
            "id": "r_sell",
            "when": {
              "all": [
                {"event_within": {"event_id": "macd_bear_cross", "lookback": "5d"}},
                {"lt": {"a": "close_1m.value@decision", "b": "ma5_1d.value@decision"}},
              ]
            },
            "then": [{"action_id": "sell_25pct"}],
          }
        ]
      },
      "action": {
        "actions": [
          {
            "id": "sell_25pct",
            "type": "ORDER",
            "symbol_ref": "trade",
            "side": "SELL",
            "qty": {"mode": "FRACTION_OF_POSITION", "value": 0.25},
            "order_type": "MOC",
            "cooldown": "1d",
          }
        ]
      },
    },
  }


def _find_sell_fraction(spec: dict[str, Any]) -> float | None:
  actions = (((spec.get("dsl") or {}).get("action") or {}).get("actions") or [])
  if not isinstance(actions, list):
    return None
  for action in actions:
    if not isinstance(action, dict):
      continue
    if str(action.get("side") or "").upper() != "SELL":
      continue
    qty = action.get("qty") or {}
    if not isinstance(qty, dict):
      continue
    if str(qty.get("mode") or "").upper() != "FRACTION_OF_POSITION":
      continue
    try:
      return float(qty.get("value"))
    except Exception:
      return None
  return None


def _has_4h_macd_cross_down(spec: dict[str, Any]) -> bool:
  signal = ((spec.get("dsl") or {}).get("signal") or {})
  if not isinstance(signal, dict):
    return False
  indicators = signal.get("indicators") or []
  events = signal.get("events") or []
  has_macd_4h = any(
    isinstance(ind, dict)
    and str(ind.get("type") or "").upper() == "MACD"
    and str(ind.get("tf") or "").lower() == "4h"
    for ind in indicators
    if isinstance(indicators, list)
  )
  has_cross_down = any(
    isinstance(ev, dict)
    and str(ev.get("type") or "").upper() in ("CROSS_DOWN", "CROSS")
    and isinstance(ev.get("a"), str)
    and "." in str(ev.get("a"))
    and isinstance(ev.get("b"), str)
    and "." in str(ev.get("b"))
    for ev in events
    if isinstance(events, list)
  )
  return has_macd_4h and has_cross_down


@pytest.mark.asyncio
async def test_nl_to_spec_builds_final_spec_from_draft(monkeypatch: pytest.MonkeyPatch) -> None:
  async def _fake_chat_json(*args: Any, **kwargs: Any) -> dict[str, Any]:
    return _mock_strategy_draft()

  monkeypatch.setattr(llm_client, "chat_json", _fake_chat_json)
  spec = await nl_to_strategy_spec(PROMPT, "BACKTEST_ONLY")

  assert spec["timezone"] == "America/New_York"
  assert spec["calendar"]["value"] == "XNYS"
  assert spec["decision"]["decision_time_rule"]["offset"] == "-2m"
  assert spec["execution"]["model"] == "MOC"
  assert spec["universe"]["signal_symbol"] == "QQQ"
  assert spec["universe"]["trade_symbol"] == "TQQQ"
  assert "signal_symbol_fallbacks" not in spec["universe"]
  assert spec["strategy_version"] == "v0"
  assert bool((spec.get("meta") or {}).get("llm_used")) is True


@pytest.mark.asyncio
async def test_nl_to_spec_applies_overrides_after_assembly(monkeypatch: pytest.MonkeyPatch) -> None:
  async def _fake_chat_json(*args: Any, **kwargs: Any) -> dict[str, Any]:
    return _mock_strategy_draft()

  monkeypatch.setattr(llm_client, "chat_json", _fake_chat_json)
  spec = await nl_to_strategy_spec(
    PROMPT,
    "BACKTEST_ONLY",
    overrides={
      "execution": {"slippage_bps": 5.0},
      "universe": {"trade_symbol": "SQQQ"},
    },
  )
  assert spec["execution"]["model"] == "MOC"
  assert float(spec["execution"]["slippage_bps"]) == 5.0
  assert spec["universe"]["trade_symbol"] == "SQQQ"


@pytest.mark.asyncio
async def test_live_llm_generates_executable_strategy_shape() -> None:
  if os.getenv("RUN_LIVE_LLM_TESTS") != "1":
    pytest.skip("Set RUN_LIVE_LLM_TESTS=1 to run live LLM integration test")
  if not llm_client.is_configured:
    pytest.skip("LLM API key/model is not configured")

  spec = await nl_to_strategy_spec(PROMPT, "BACKTEST_ONLY")

  assert spec["timezone"] == "America/New_York"
  assert spec["calendar"]["value"] == "XNYS"
  assert spec["decision"]["decision_time_rule"]["offset"] == "-2m"
  assert spec["execution"]["model"] == "MOC"
  assert "signal_symbol_fallbacks" not in (spec.get("universe") or {})

  dsl = spec.get("dsl") or {}
  signal = (dsl.get("signal") or {}) if isinstance(dsl, dict) else {}
  logic = (dsl.get("logic") or {}) if isinstance(dsl, dict) else {}
  action = (dsl.get("action") or {}) if isinstance(dsl, dict) else {}
  assert isinstance(signal.get("indicators"), list) and len(signal["indicators"]) > 0
  assert isinstance(signal.get("events"), list) and len(signal["events"]) > 0
  assert isinstance(logic.get("rules"), list) and len(logic["rules"]) > 0
  assert isinstance(action.get("actions"), list) and len(action["actions"]) > 0

  assert _has_4h_macd_cross_down(spec), "Expected MACD 4H cross-down semantics"
  sell_fraction = _find_sell_fraction(spec)
  assert sell_fraction is not None, "Expected SELL FRACTION_OF_POSITION action"
  assert abs(sell_fraction - 0.25) <= 0.10, f"Expected ~25% sell fraction, got {sell_fraction}"
