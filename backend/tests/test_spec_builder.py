from __future__ import annotations

import copy
from typing import Any

import pytest

from app.core.errors import AppError
from app.services.llm_client import llm_client
from app.services.spec_builder import nl_to_strategy_spec


PROMPT = "Sell 25% TQQQ when QQQ has a 4H MACD death cross and at 2 minutes before close it's still below the 5-day MA."
PROMPT_EXAMPLE_1 = "QQQ4小时macd死叉，且日线级别MA跌破5日ma的时候清仓TQQQ。"
PROMPT_EXAMPLE_2 = "QQQ4小时macd死叉，且MA跌破5日ma的时候减仓35%TQQQ，然后日线级别macd死叉且确认跌破20日ma的时候完全清仓TQQQ。"
PROMPT_SOX_MULTI = "在11月20日建仓100%的soxl，soxx四小时macd死叉，且MA同时跌破5日ma的时候减仓30%soxl，之后在日线级别macd死叉且确认跌破20日ma的时候完全清仓soxl。"


def _draft_single_partial() -> dict[str, Any]:
  return {
    "name": "QQQ bearish partial reduce",
    "universe": {"signal_symbol": "QQQ", "trade_symbol": "TQQQ"},
    "risk": {"cooldown": {"scope": "SYMBOL_ACTION", "value": "1d"}, "max_orders_per_day": 2},
    "dsl": {
      "atomic": {
        "symbols": {"signal": "QQQ", "trade": "TQQQ"},
        "constants": {"lookback": "5d", "sell_fraction": 0.25, "initial_position_qty": 100.0, "initial_cash": 0.0},
      },
      "time": {"primary_tf": "1m", "derived_tfs": ["4h", "1d"], "aggregation": {"4h": "SESSION_ALIGNED_4H", "1d": "SESSION_ALIGNED_1D"}},
      "signal": {
        "indicators": [
          {"id": "macd_4h", "type": "MACD", "tf": "4h", "symbol_ref": "signal", "align": "LAST_CLOSED", "params": {"fast": 12, "slow": 26, "signal": 9}},
          {"id": "close_1d", "type": "CLOSE", "tf": "1d", "symbol_ref": "signal", "align": "LAST_CLOSED", "params": {"bar_selection": "LAST_CLOSED_1D"}},
          {"id": "ma_5d", "type": "MA", "tf": "1d", "symbol_ref": "signal", "align": "LAST_CLOSED", "params": {"window": "5d", "bar_selection": "LAST_CLOSED_1D"}},
        ],
        "events": [
          {"id": "ev_macd_4h_dead_cross", "type": "CROSS_DOWN", "a": "macd_4h.macd", "b": "macd_4h.signal", "left": None, "right": None, "direction": "DOWN", "op": None, "value": None, "tf": "4h"},
          {"id": "ev_below_ma5", "type": "THRESHOLD", "a": None, "b": None, "left": "close_1d.value", "right": "ma_5d.value", "direction": None, "op": "<", "value": None, "tf": "1d"},
        ],
      },
      "logic": {"rules": [{"id": "rule_reduce", "when": {"all": [{"event_id": "ev_macd_4h_dead_cross", "scope": "BAR"}, {"event_id": "ev_below_ma5", "scope": "BAR"}]}, "then": [{"action_id": "sell_25pct"}]}]},
      "action": {
        "actions": [
          {"id": "sell_25pct", "type": "ORDER", "symbol_ref": "trade", "side": "SELL", "qty": {"mode": "FRACTION_OF_POSITION", "value": 0.25}, "order_type": "MOC", "time_in_force": None, "idempotency_scope": "SYMBOL_ACTION", "cooldown": "1d"}
        ]
      },
    },
  }


def _draft_single_full_exit() -> dict[str, Any]:
  draft = copy.deepcopy(_draft_single_partial())
  draft["name"] = "QQQ single-stage full exit"
  draft["dsl"]["atomic"]["constants"]["sell_fraction"] = 1.0
  draft["dsl"]["logic"]["rules"][0]["then"] = [{"action_id": "sell_all"}]
  draft["dsl"]["action"]["actions"] = [
    {"id": "sell_all", "type": "ORDER", "symbol_ref": "trade", "side": "SELL", "qty": {"mode": "FULL_POSITION", "value": 1.0}, "order_type": "MOC", "time_in_force": None, "idempotency_scope": "SYMBOL_ACTION", "cooldown": "1d"}
  ]
  return draft


def _draft_multi_stage_tqqq() -> dict[str, Any]:
  return {
    "name": "QQQ multi-stage reduce then exit",
    "universe": {"signal_symbol": "QQQ", "trade_symbol": "TQQQ"},
    "risk": {"cooldown": {"scope": "SYMBOL_ACTION", "value": "1d"}, "max_orders_per_day": 4},
    "dsl": {
      "atomic": {
        "symbols": {"signal": "QQQ", "trade": "TQQQ"},
        "constants": {"lookback": "5d", "sell_fraction": 0.35, "initial_position_qty": 100.0, "initial_cash": 0.0},
      },
      "time": {"primary_tf": "1m", "derived_tfs": ["4h", "1d"], "aggregation": {"4h": "SESSION_ALIGNED_4H", "1d": "SESSION_ALIGNED_1D"}},
      "signal": {
        "indicators": [
          {"id": "macd_4h", "type": "MACD", "tf": "4h", "symbol_ref": "signal", "align": "LAST_CLOSED", "params": {"fast": 12, "slow": 26, "signal": 9}},
          {"id": "macd_1d", "type": "MACD", "tf": "1d", "symbol_ref": "signal", "align": "LAST_CLOSED", "params": {"fast": 12, "slow": 26, "signal": 9}},
          {"id": "close_1d", "type": "CLOSE", "tf": "1d", "symbol_ref": "signal", "align": "LAST_CLOSED", "params": {"bar_selection": "LAST_CLOSED_1D"}},
          {"id": "ma_5d", "type": "MA", "tf": "1d", "symbol_ref": "signal", "align": "LAST_CLOSED", "params": {"window": "5d", "bar_selection": "LAST_CLOSED_1D"}},
          {"id": "ma_20d", "type": "MA", "tf": "1d", "symbol_ref": "signal", "align": "LAST_CLOSED", "params": {"window": "20d", "bar_selection": "LAST_CLOSED_1D"}},
        ],
        "events": [
          {"id": "ev_cross_4h", "type": "CROSS_DOWN", "a": "macd_4h.macd", "b": "macd_4h.signal", "left": None, "right": None, "direction": "DOWN", "op": None, "value": None, "tf": "4h"},
          {"id": "ev_cross_1d", "type": "CROSS_DOWN", "a": "macd_1d.macd", "b": "macd_1d.signal", "left": None, "right": None, "direction": "DOWN", "op": None, "value": None, "tf": "1d"},
          {"id": "ev_below_ma5", "type": "THRESHOLD", "a": None, "b": None, "left": "close_1d.value", "right": "ma_5d.value", "direction": None, "op": "<", "value": None, "tf": "1d"},
          {"id": "ev_below_ma20", "type": "THRESHOLD", "a": None, "b": None, "left": "close_1d.value", "right": "ma_20d.value", "direction": None, "op": "<", "value": None, "tf": "1d"},
        ],
      },
      "logic": {
        "rules": [
          {"id": "rule_stage1", "when": {"all": [{"event_id": "ev_cross_4h", "scope": "BAR"}, {"event_id": "ev_below_ma5", "scope": "BAR"}]}, "then": [{"action_id": "sell_partial"}]},
          {"id": "rule_stage2", "when": {"all": [{"event_id": "ev_cross_1d", "scope": "BAR"}, {"event_id": "ev_below_ma20", "scope": "BAR"}]}, "then": [{"action_id": "sell_all"}]},
        ]
      },
      "action": {
        "actions": [
          {"id": "sell_partial", "type": "ORDER", "symbol_ref": "trade", "side": "SELL", "qty": {"mode": "FRACTION_OF_POSITION", "value": 0.35}, "order_type": "MOC", "time_in_force": None, "idempotency_scope": "SYMBOL_ACTION", "cooldown": "1d"},
          {"id": "sell_all", "type": "ORDER", "symbol_ref": "trade", "side": "SELL", "qty": {"mode": "FULL_POSITION", "value": 1.0}, "order_type": "MOC", "time_in_force": None, "idempotency_scope": "SYMBOL_ACTION", "cooldown": "1d"},
        ]
      },
    },
  }


def _draft_multi_stage_sox() -> dict[str, Any]:
  draft = copy.deepcopy(_draft_multi_stage_tqqq())
  draft["name"] = "SOXX/SOXL multi-stage"
  draft["universe"] = {"signal_symbol": "SOXX", "trade_symbol": "SOXL"}
  draft["dsl"]["atomic"]["symbols"] = {"signal": "SOXX", "trade": "SOXL"}
  draft["dsl"]["atomic"]["constants"]["sell_fraction"] = 0.30
  for action in draft["dsl"]["action"]["actions"]:
    if action["id"] == "sell_partial":
      action["qty"]["value"] = 0.30
  return draft


def _assert_base_spec_shape(spec: dict[str, Any]) -> None:
  assert spec["timezone"] == "America/New_York"
  assert spec["calendar"]["value"] == "XNYS"
  assert spec["decision"]["decision_time_rule"]["offset"] == "-2m"
  assert spec["execution"]["model"] == "MOC"
  assert spec["strategy_version"] == "v0"
  assert (spec.get("meta") or {}).get("generation_mode") == "llm"


@pytest.mark.asyncio
async def test_prompt_1_partial_sell_semantics(monkeypatch: pytest.MonkeyPatch) -> None:
  async def _fake_chat_json(*args: Any, **kwargs: Any) -> dict[str, Any]:
    return _draft_single_partial()

  monkeypatch.setattr(llm_client, "chat_json", _fake_chat_json)
  spec = await nl_to_strategy_spec(PROMPT, "BACKTEST_ONLY")

  _assert_base_spec_shape(spec)
  assert spec["universe"] == {"signal_symbol": "QQQ", "trade_symbol": "TQQQ"}
  actions = (((spec.get("dsl") or {}).get("action") or {}).get("actions") or [])
  sell = next(a for a in actions if isinstance(a, dict) and a.get("id") == "sell_25pct")
  assert sell["qty"]["mode"] == "FRACTION_OF_POSITION"
  assert float(sell["qty"]["value"]) == pytest.approx(0.25)


@pytest.mark.asyncio
async def test_prompt_2_single_stage_full_exit(monkeypatch: pytest.MonkeyPatch) -> None:
  async def _fake_chat_json(*args: Any, **kwargs: Any) -> dict[str, Any]:
    return _draft_single_full_exit()

  monkeypatch.setattr(llm_client, "chat_json", _fake_chat_json)
  spec = await nl_to_strategy_spec(PROMPT_EXAMPLE_1, "BACKTEST_ONLY")

  _assert_base_spec_shape(spec)
  assert spec["universe"] == {"signal_symbol": "QQQ", "trade_symbol": "TQQQ"}
  actions = (((spec.get("dsl") or {}).get("action") or {}).get("actions") or [])
  assert any(
    isinstance(a, dict)
    and (a.get("qty") or {}).get("mode") == "FULL_POSITION"
    and float((a.get("qty") or {}).get("value") or 0.0) == pytest.approx(1.0)
    for a in actions
  )


@pytest.mark.asyncio
async def test_prompt_3_multi_stage_reduce_then_exit(monkeypatch: pytest.MonkeyPatch) -> None:
  async def _fake_chat_json(*args: Any, **kwargs: Any) -> dict[str, Any]:
    return _draft_multi_stage_tqqq()

  monkeypatch.setattr(llm_client, "chat_json", _fake_chat_json)
  spec = await nl_to_strategy_spec(PROMPT_EXAMPLE_2, "BACKTEST_ONLY")

  _assert_base_spec_shape(spec)
  assert spec["universe"] == {"signal_symbol": "QQQ", "trade_symbol": "TQQQ"}
  dsl = spec.get("dsl") or {}
  rules = (((dsl.get("logic") or {}).get("rules")) or [])
  actions = (((dsl.get("action") or {}).get("actions")) or [])

  assert len(rules) == 2
  assert not any(isinstance(a, dict) and str(a.get("type") or "").upper() == "SET_FLAG" for a in actions)
  partial = next(a for a in actions if isinstance(a, dict) and a.get("id") == "sell_partial")
  assert partial["qty"]["mode"] == "FRACTION_OF_POSITION"
  assert float(partial["qty"]["value"]) == pytest.approx(0.35)

  stage2 = next(r for r in rules if isinstance(r, dict) and r.get("id") == "rule_stage2")
  assert "flag_is_true" not in str(stage2.get("when"))


@pytest.mark.asyncio
async def test_cross_event_in_all_rule_is_normalized_to_event_within(monkeypatch: pytest.MonkeyPatch) -> None:
  async def _fake_chat_json(*args: Any, **kwargs: Any) -> dict[str, Any]:
    return _draft_single_partial()

  monkeypatch.setattr(llm_client, "chat_json", _fake_chat_json)
  spec = await nl_to_strategy_spec(PROMPT, "BACKTEST_ONLY")

  rules = ((((spec.get("dsl") or {}).get("logic")) or {}).get("rules") or [])
  reduce_rule = next(r for r in rules if isinstance(r, dict) and r.get("id") == "rule_reduce")
  when = reduce_rule.get("when") or {}
  all_conditions = when.get("all") if isinstance(when, dict) else []
  assert isinstance(all_conditions, list)

  cross_window = next(
    c for c in all_conditions
    if isinstance(c, dict)
    and isinstance(c.get("event_within"), dict)
    and (c.get("event_within") or {}).get("event_id") == "ev_macd_4h_dead_cross"
  )
  assert (cross_window.get("event_within") or {}).get("lookback") == "5d"


@pytest.mark.asyncio
async def test_prompt_4_multi_symbol_stage_semantics(monkeypatch: pytest.MonkeyPatch) -> None:
  async def _fake_chat_json(*args: Any, **kwargs: Any) -> dict[str, Any]:
    return _draft_multi_stage_sox()

  monkeypatch.setattr(llm_client, "chat_json", _fake_chat_json)
  spec = await nl_to_strategy_spec(PROMPT_SOX_MULTI, "BACKTEST_ONLY")

  _assert_base_spec_shape(spec)
  assert spec["universe"] == {"signal_symbol": "SOXX", "trade_symbol": "SOXL"}
  actions = (((spec.get("dsl") or {}).get("action") or {}).get("actions") or [])
  partial = next(a for a in actions if isinstance(a, dict) and a.get("id") == "sell_partial")
  assert partial["qty"]["mode"] == "FRACTION_OF_POSITION"
  assert float(partial["qty"]["value"]) == pytest.approx(0.30)


@pytest.mark.asyncio
async def test_divergence_preferences_inject_divergence_event(monkeypatch: pytest.MonkeyPatch) -> None:
  async def _fake_chat_json(*args: Any, **kwargs: Any) -> dict[str, Any]:
    return _draft_single_partial()

  monkeypatch.setattr(llm_client, "chat_json", _fake_chat_json)
  spec = await nl_to_strategy_spec(
    PROMPT,
    "BACKTEST_ONLY",
    indicator_preferences={
      "maWindowDays": 5,
      "macdFast": 12,
      "macdSlow": 26,
      "macdSignal": 9,
      "divergence": {
        "enabled": True,
        "indicator": "MACD",
        "direction": "bearish",
        "timeframe": "4h",
        "pivotLeft": 3,
        "pivotRight": 3,
        "lookbackBars": 50,
      },
    },
  )

  dsl = spec.get("dsl") or {}
  events = (((dsl.get("signal") or {}).get("events")) or [])
  rules = (((dsl.get("logic") or {}).get("rules")) or [])

  div_event = next(e for e in events if isinstance(e, dict) and e.get("id") == "ev_divergence_signal")
  assert div_event["type"] == "DIVERGENCE_BEARISH"
  assert int(div_event["lookback_bars"]) == 50

  reduce_rule = next(r for r in rules if isinstance(r, dict) and r.get("id") == "rule_reduce")
  all_conditions = (reduce_rule.get("when") or {}).get("all") if isinstance(reduce_rule.get("when"), dict) else []
  assert isinstance(all_conditions, list)
  assert any(
    isinstance(c, dict)
    and c.get("event_id") == "ev_divergence_signal"
    and c.get("scope") == "BAR"
    for c in all_conditions
  )


@pytest.mark.asyncio
async def test_llm_failure_falls_back_to_local_spec(monkeypatch: pytest.MonkeyPatch) -> None:
  async def _fail_chat_json(*args: Any, **kwargs: Any) -> dict[str, Any]:
    raise AppError("INTERNAL", "LLM request failed", {"status": 502}, http_status=502)

  monkeypatch.setattr(llm_client, "chat_json", _fail_chat_json)
  spec = await nl_to_strategy_spec(
    "build QQQ and use 4h macd divergence",
    "BACKTEST_ONLY",
    indicator_preferences={
      "macdFast": 12,
      "macdSlow": 26,
      "macdSignal": 9,
      "divergence": {
        "enabled": True,
        "indicator": "MACD",
        "direction": "bullish",
        "timeframe": "4h",
        "pivotLeft": 3,
        "pivotRight": 3,
        "lookbackBars": 40,
      },
    },
  )

  meta = spec.get("meta") or {}
  assert meta.get("generation_mode") == "fallback"
  assert meta.get("fallback_reason_code") == "INTERNAL"
  assert spec.get("strategy_version") == "v0"

  events = ((((spec.get("dsl") or {}).get("signal")) or {}).get("events") or [])
  assert any(isinstance(e, dict) and e.get("id") == "ev_divergence_signal" for e in events)


@pytest.mark.asyncio
async def test_indicator_kinds_are_injected_into_dsl(monkeypatch: pytest.MonkeyPatch) -> None:
  async def _fake_chat_json(*args: Any, **kwargs: Any) -> dict[str, Any]:
    return _draft_single_partial()

  monkeypatch.setattr(llm_client, "chat_json", _fake_chat_json)
  spec = await nl_to_strategy_spec(
    PROMPT,
    "BACKTEST_ONLY",
    indicator_preferences={
      "indicatorKinds": ["MA", "MACD", "BOLL", "RSI", "KDJ", "BIAS"],
      "maWindowDays": 10,
      "macdFast": 8,
      "macdSlow": 17,
      "macdSignal": 5,
      "bollPeriod": 20,
      "bollStddevMult": 2.2,
      "rsiPeriod": 14,
      "kdjPeriod": 9,
      "kdjKSmooth": 3,
      "kdjDSmooth": 3,
      "biasPeriod": 6,
    },
  )

  indicators = ((((spec.get("dsl") or {}).get("signal")) or {}).get("indicators") or [])
  ids = {str(ind.get("id")) for ind in indicators if isinstance(ind, dict)}
  assert "pref_ma_1d" in ids
  assert "pref_macd_4h" in ids
  assert "pref_boll_1d" in ids
  assert "pref_rsi_1d" in ids
  assert "pref_kdj_4h" in ids
  assert "pref_bias_1d" in ids


@pytest.mark.asyncio
async def test_complex_prompt_marks_guard_when_llm_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
  async def _fail_chat_json(*args: Any, **kwargs: Any) -> dict[str, Any]:
    raise AppError("INTERNAL", "LLM request failed", {"status": 502}, http_status=502)

  monkeypatch.setattr(llm_client, "chat_json", _fail_chat_json)
  spec = await nl_to_strategy_spec(
    "观察QQQ，周线KDJ金叉建仓20%，随后再加仓40%",
    "BACKTEST_ONLY",
    indicator_preferences={
      "indicatorKinds": ["KDJ", "MA"],
      "kdjPeriod": 9,
    },
  )
  meta = spec.get("meta") or {}
  assert meta.get("generation_mode") == "fallback"
  assert meta.get("fallback_guard_triggered") is True
