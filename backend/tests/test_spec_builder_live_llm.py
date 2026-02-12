from __future__ import annotations

import os
from typing import Any

import pytest

from app.services.llm_client import llm_client
from app.services.spec_builder import nl_to_strategy_spec


PROMPT = "Sell 25% TQQQ when QQQ has a 4H MACD death cross and at 2 minutes before close it's still below the 5-day MA."


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
    mode = str(qty.get("mode") or qty.get("type") or "").upper()
    if mode == "FRACTION_OF_POSITION":
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
  has_macd_4h = any(
    isinstance(ind, dict)
    and str(ind.get("type") or "").upper() == "MACD"
    and str(ind.get("tf") or "").lower() == "4h"
    for ind in indicators
    if isinstance(indicators, list)
  )

  events = signal.get("events") or []
  has_cross_down = any(
    isinstance(ev, dict)
    and str(ev.get("type") or "").upper() in ("CROSS_DOWN", "CROSS")
    for ev in events
    if isinstance(events, list)
  )
  return has_macd_4h and has_cross_down


def _event_shape_is_executable(spec: dict[str, Any]) -> bool:
  events = ((((spec.get("dsl") or {}).get("signal") or {}).get("events") or []))
  if not isinstance(events, list):
    return False

  has_cross_ok = False
  has_threshold_ok = False
  for ev in events:
    if not isinstance(ev, dict):
      continue
    ev_type = str(ev.get("type") or "").upper()
    if ev_type in ("CROSS", "CROSS_DOWN", "CROSS_UP"):
      a = ev.get("a")
      b = ev.get("b")
      if isinstance(a, str) and "." in a and isinstance(b, str) and "." in b:
        has_cross_ok = True
    if ev_type == "THRESHOLD":
      left = ev.get("left")
      right = ev.get("right")
      op = ev.get("op")
      if isinstance(left, str) and left and isinstance(right, str) and right and op in ("<", "<=", ">", ">=", "==", "!="):
        has_threshold_ok = True
  return has_cross_ok and has_threshold_ok


@pytest.mark.asyncio
async def test_live_llm_generates_expected_strategy_shape() -> None:
  if os.getenv("RUN_LIVE_LLM_TESTS") != "1":
    pytest.skip("Set RUN_LIVE_LLM_TESTS=1 to run live LLM integration test")
  if not llm_client.is_configured:
    pytest.skip("LLM API key/model is not configured")

  spec = await nl_to_strategy_spec(PROMPT, "BACKTEST_ONLY")

  # Hard constraints still enforced by backend.
  assert spec["timezone"] == "America/New_York"
  assert spec["calendar"]["value"] == "XNYS"
  assert spec["decision"]["decision_time_rule"]["offset"] == "-2m"
  assert spec["execution"]["model"] == "MOC"
  assert spec["universe"]["trade_symbol"] == "TQQQ"

  # Semantic checks from the natural-language prompt.
  assert _has_4h_macd_cross_down(spec), "Expected MACD 4H cross-down semantics"
  assert _event_shape_is_executable(spec), "Expected executable event field shape for CROSS and THRESHOLD"

  sell_fraction = _find_sell_fraction(spec)
  assert sell_fraction is not None, "Expected SELL FRACTION_OF_POSITION action"
  assert abs(sell_fraction - 0.25) <= 0.05, f"Expected ~25% sell fraction, got {sell_fraction}"

  # Ensure we did not silently fallback to seed strategy when live LLM is enabled.
  meta = spec.get("meta") or {}
  assert bool(meta.get("llm_used")) is True
  assert bool(meta.get("fallback_seed_applied")) is False
