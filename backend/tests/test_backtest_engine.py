from __future__ import annotations

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
