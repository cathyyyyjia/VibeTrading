from __future__ import annotations

from datetime import date

import pytest

from app.core.config import settings
from app.services.backtest_engine import run_backtest_from_spec


def _minimal_strategy_spec() -> dict:
  return {
    "name": "test-moc-timing",
    "strategy_version": "v0",
    "timezone": "America/New_York",
    "calendar": {"type": "exchange", "value": "XNYS"},
    "universe": {"signal_symbol": "QQQ", "trade_symbol": "TQQQ"},
    "decision": {"decision_time_rule": {"type": "MARKET_CLOSE_OFFSET", "offset": "-2m"}},
    "execution": {"model": "MOC", "slippage_bps": 0.0, "commission_per_trade": 0.0},
    "risk": {"cooldown": {"scope": "SYMBOL_ACTION", "value": "1d"}, "max_orders_per_day": 1},
    "dsl": {
      "atomic": {
        "symbols": {"signal": "QQQ", "trade": "TQQQ"},
        "constants": {"lookback": "5d", "sell_fraction": 0.25, "initial_position_qty": 100, "initial_cash": 0},
      },
      "time": {
        "primary_tf": "1m",
        "derived_tfs": ["4h", "1d"],
        "aggregation": {"4h": "SESSION_ALIGNED_4H", "1d": "SESSION_ALIGNED_1D"},
      },
      "signal": {
        "indicators": [
          {"id": "close_1m", "type": "CLOSE", "tf": "1m", "symbol_ref": "signal", "align": "LAST_CLOSED", "params": {}},
        ],
        "events": [
          {
            "id": "always_sell",
            "type": "THRESHOLD",
            "a": None,
            "b": None,
            "left": "close_1m.value@decision",
            "right": None,
            "direction": None,
            "op": ">=",
            "value": 0,
            "tf": "1m",
          }
        ],
      },
      "logic": {
        "rules": [
          {"id": "sell_rule", "when": {"event_id": "always_sell", "scope": "BAR"}, "then": [{"action_id": "sell_25pct"}]}
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
            "time_in_force": None,
            "idempotency_scope": None,
            "cooldown": "1d",
          }
        ]
      },
    },
    "meta": {"mode": "BACKTEST_ONLY", "llm_used": False},
  }


@pytest.mark.asyncio
async def test_backtest_has_moc_fill_time_at_close(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.setattr(settings, "market_data_provider", "synthetic")
  spec = _minimal_strategy_spec()
  result = await run_backtest_from_spec(spec, start_date="2024-01-02", end_date="2024-01-31")
  import exchange_calendars as xcals

  cal = xcals.get_calendar("XNYS")
  for t in result.trades:
    assert t["fill_time"] >= t["decision_time"]
    session = cal.date_to_session(t["fill_time"].date(), direction="none")
    close_ts = cal.session_close(session).to_pydatetime()
    assert t["fill_time"].replace(tzinfo=None) == close_ts.replace(tzinfo=None)


def _rsi_strategy_spec() -> dict:
  return {
    "name": "test-rsi-threshold",
    "strategy_version": "v0",
    "timezone": "America/New_York",
    "calendar": {"type": "exchange", "value": "XNYS"},
    "universe": {"signal_symbol": "QQQ", "trade_symbol": "TQQQ"},
    "decision": {"decision_time_rule": {"type": "MARKET_CLOSE_OFFSET", "offset": "-2m"}},
    "execution": {"model": "MOC", "slippage_bps": 0.0, "commission_per_trade": 0.0},
    "risk": {"cooldown": {"scope": "SYMBOL_ACTION", "value": "1d"}, "max_orders_per_day": 1},
    "dsl": {
      "atomic": {
        "symbols": {"signal": "QQQ", "trade": "TQQQ"},
        "constants": {"lookback": "5d", "sell_fraction": 0.2, "initial_position_qty": 100, "initial_cash": 0},
      },
      "time": {
        "primary_tf": "1m",
        "derived_tfs": ["4h", "1d"],
        "aggregation": {"4h": "SESSION_ALIGNED_4H", "1d": "SESSION_ALIGNED_1D"},
      },
      "signal": {
        "indicators": [
          {"id": "rsi_1d", "type": "RSI", "tf": "1d", "symbol_ref": "signal", "align": "LAST_CLOSED", "params": {"period": 14}},
        ],
        "events": [
          {
            "id": "rsi_below_45",
            "type": "THRESHOLD",
            "a": None,
            "b": None,
            "left": "rsi_1d.value",
            "right": None,
            "direction": None,
            "op": ">=",
            "value": 0,
            "tf": "1d",
          }
        ],
      },
      "logic": {
        "rules": [
          {"id": "sell_rule", "when": {"event_id": "rsi_below_45", "scope": "BAR"}, "then": [{"action_id": "sell_20pct"}]}
        ]
      },
      "action": {
        "actions": [
          {
            "id": "sell_20pct",
            "type": "ORDER",
            "symbol_ref": "trade",
            "side": "SELL",
            "qty": {"mode": "FRACTION_OF_POSITION", "value": 0.2},
            "order_type": "MOC",
            "time_in_force": None,
            "idempotency_scope": None,
            "cooldown": "1d",
          }
        ]
      },
    },
    "meta": {"mode": "BACKTEST_ONLY", "llm_used": False},
  }


@pytest.mark.asyncio
async def test_backtest_supports_rsi_indicator_via_registry(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.setattr(settings, "market_data_provider", "synthetic")
  spec = _rsi_strategy_spec()
  result = await run_backtest_from_spec(spec, start_date="2024-01-02", end_date="2024-03-29")
  assert isinstance(result.trades, list)
  assert len(result.trades) > 0
  assert all(t["side"] == "SELL" for t in result.trades)


def _date_gated_staged_strategy_spec() -> dict:
  return {
    "name": "date-gated-entry-then-reduce-and-exit",
    "strategy_version": "v0",
    "timezone": "America/New_York",
    "calendar": {"type": "exchange", "value": "XNYS"},
    "universe": {"signal_symbol": "SOXX", "trade_symbol": "SOXL"},
    "decision": {"decision_time_rule": {"type": "MARKET_CLOSE_OFFSET", "offset": "-2m"}},
    "execution": {"model": "MOC", "slippage_bps": 0.0, "commission_per_trade": 0.0},
    "risk": {"cooldown": {"scope": "SYMBOL_ACTION", "value": "1d"}, "max_orders_per_day": 4},
    "dsl": {
      "atomic": {
        "symbols": {"signal": "SOXX", "trade": "SOXL"},
        "constants": {"lookback": "5d", "sell_fraction": 0.3, "initial_position_qty": 0, "initial_cash": 10000},
      },
      "time": {
        "primary_tf": "1m",
        "derived_tfs": ["4h", "1d"],
        "aggregation": {"4h": "SESSION_ALIGNED_4H", "1d": "SESSION_ALIGNED_1D"},
      },
      "signal": {
        "indicators": [
          {"id": "close_1m", "type": "CLOSE", "tf": "1m", "symbol_ref": "signal", "align": "LAST_CLOSED", "params": {"fast": None, "slow": None, "signal": None, "period": None, "window": None, "bar_selection": None}},
        ],
        "events": [
          {
            "id": "always_true",
            "type": "THRESHOLD",
            "a": None,
            "b": None,
            "left": "close_1m.value@decision",
            "right": None,
            "direction": None,
            "op": ">=",
            "value": 0,
            "tf": "1m",
          }
        ],
      },
      "logic": {
        "rules": [
          {
            "id": "entry_on_nov_20",
            "when": {"on_month_day": {"month": 11, "day": 20}},
            "then": [{"action_id": "buy_full"}, {"action_id": "set_entered"}],
          },
          {
            "id": "reduce_after_entry",
            "when": {"all": [{"flag_is_true": {"flag": "entered"}}, {"event_id": "always_true", "scope": "BAR"}]},
            "then": [{"action_id": "sell_30"}, {"action_id": "set_reduced"}],
          },
          {
            "id": "exit_after_reduce",
            "when": {"all": [{"flag_is_true": {"flag": "reduced"}}, {"event_id": "always_true", "scope": "BAR"}]},
            "then": [{"action_id": "sell_full"}],
          },
        ]
      },
      "action": {
        "actions": [
          {
            "id": "buy_full",
            "type": "ORDER",
            "symbol_ref": "trade",
            "side": "BUY",
            "qty": {"mode": "FULL_POSITION", "value": 1.0},
            "order_type": "MOC",
            "time_in_force": None,
            "idempotency_scope": "SYMBOL_ACTION",
            "cooldown": "1d",
          },
          {"id": "set_entered", "type": "SET_FLAG", "flag": "entered", "cooldown": None},
          {
            "id": "sell_30",
            "type": "ORDER",
            "symbol_ref": "trade",
            "side": "SELL",
            "qty": {"mode": "FRACTION_OF_POSITION", "value": 0.3},
            "order_type": "MOC",
            "time_in_force": None,
            "idempotency_scope": "SYMBOL_ACTION",
            "cooldown": "1d",
          },
          {"id": "set_reduced", "type": "SET_FLAG", "flag": "reduced", "cooldown": None},
          {
            "id": "sell_full",
            "type": "ORDER",
            "symbol_ref": "trade",
            "side": "SELL",
            "qty": {"mode": "FULL_POSITION", "value": 1.0},
            "order_type": "MOC",
            "time_in_force": None,
            "idempotency_scope": "SYMBOL_ACTION",
            "cooldown": "1d",
          },
        ]
      },
    },
    "meta": {"mode": "BACKTEST_ONLY", "llm_used": False},
  }


@pytest.mark.asyncio
async def test_backtest_executes_date_gated_entry_and_staged_exits(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.setattr(settings, "market_data_provider", "synthetic")
  spec = _date_gated_staged_strategy_spec()
  result = await run_backtest_from_spec(spec, start_date="2024-11-01", end_date="2024-12-10")

  assert len(result.trades) >= 3
  first = result.trades[0]
  assert first["side"] == "BUY"
  assert first["fill_time"].date() == date(2024, 11, 20)

  # Ensure staged SELL actions happen only after entry.
  sell_times = [t["fill_time"] for t in result.trades if t["side"] == "SELL"]
  assert len(sell_times) >= 2
  assert all(ts >= first["fill_time"] for ts in sell_times)
