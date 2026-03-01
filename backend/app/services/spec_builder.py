from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Literal

from app.core.config import settings
from app.core.errors import AppError
from app.services.llm_client import llm_client


SYSTEM_PROMPT = """You are a deterministic trading-strategy compiler.

Output:
- Return exactly one JSON object named StrategyDraft.
- Output JSON only, with no prose.

Platform assumptions:
- timezone is fixed by system to America/New_York.
- calendar is fixed by system to XNYS.
- decision time is fixed by system to market_close - 2 minutes.
- execution model is fixed by system to MOC.
- primary timeframe is 1m, with derived 4h and 1d.
- no future leakage.

Semantic requirements:
1) Symbol roles:
- signal_symbol is for indicators/conditions.
- trade_symbol is for order execution.
- Never swap signal_symbol and trade_symbol.
- In patterns like "X ... indicator condition ... operate Y", set signal_symbol=X and trade_symbol=Y.
- If user mentions two different tickers and one appears with MACD/MA condition while the other appears with buy/sell/reduce/exit verb, map them to signal/trade accordingly.

2) Action mapping:
- If user only asks for reduce/exit/liquidate, do not create BUY orders.
- Create BUY only when user explicitly asks to enter/build position.
- "build/enter 100%" => BUY FULL_POSITION value 1.0.
- "build/enter N%" (N<100) => BUY FRACTION_OF_EQUITY value N/100.
- "reduce N%" => SELL FRACTION_OF_POSITION value N/100.
- "full exit / clear position" => SELL FULL_POSITION value 1.0.
- Do not invent extra intermediate reduce stages or percentages.
- For strategies with explicit BUY entry, set constants.initial_position_qty=0 and constants.initial_cash to a positive value (e.g. 10000).
- For strategies that only describe reducing/exiting existing holdings, initial_position_qty can be positive and initial_cash can be 0.

3) Stage logic:
- Multi-condition and multi-rule execution is independent.
- Trigger each rule as soon as its own condition is satisfied.
- Do not use flag actions or flag conditions for stage sequencing.
- Words like then/after/然后/之后 can describe narrative order, but do not force dependency.

4) Signal mapping:
- MACD death cross => CROSS_DOWN(macd, signal).
- Price below N-day MA => THRESHOLD(op "<") between CLOSE and MA(N).
- Preserve timeframe intent (4h vs 1d).

5) Date mapping:
- Month/day trigger (e.g., Nov 20) => on_month_day.
- Explicit YYYY-MM-DD trigger => on_date.
- Bind each date trigger to the action stage it modifies.
- If entry stage is described only by date (e.g., "11月20日建仓100%"), do not add extra indicator conditions to that entry rule.

6) DSL quality:
- indicators/events/rules/actions must all be non-empty.
- IDs and refs must be valid strings and coherent.
- Use stable identifiers, e.g. snake_case-like names.
"""


STRATEGY_DRAFT_JSON_SCHEMA: dict[str, Any] = {
  "type": "object",
  "additionalProperties": False,
  "required": ["name", "universe", "risk", "dsl"],
  "properties": {
    "name": {"type": "string", "minLength": 1},
    "universe": {
      "type": "object",
      "additionalProperties": False,
      "required": ["signal_symbol", "trade_symbol"],
      "properties": {
        "signal_symbol": {"type": "string", "minLength": 1},
        "trade_symbol": {"type": "string", "minLength": 1},
      },
    },
    "risk": {
      "type": "object",
      "additionalProperties": False,
      "required": ["cooldown", "max_orders_per_day"],
      "properties": {
        "cooldown": {
          "type": "object",
          "additionalProperties": False,
          "required": ["scope", "value"],
          "properties": {
            "scope": {"type": "string", "enum": ["SYMBOL_ACTION"]},
            "value": {"type": ["string", "null"]},
          },
        },
        "max_orders_per_day": {"type": "integer", "minimum": 1},
      },
    },
    "dsl": {
      "type": "object",
      "additionalProperties": False,
      "required": ["atomic", "time", "signal", "logic", "action"],
      "properties": {
        "atomic": {
          "type": "object",
          "additionalProperties": False,
          "required": ["symbols", "constants"],
          "properties": {
            "symbols": {
              "type": "object",
              "additionalProperties": False,
              "required": ["signal", "trade"],
              "properties": {
                "signal": {"type": "string", "minLength": 1},
                "trade": {"type": "string", "minLength": 1},
              },
            },
            "constants": {
              "type": "object",
              "additionalProperties": False,
              "required": ["lookback", "sell_fraction", "initial_position_qty", "initial_cash"],
              "properties": {
                "lookback": {"type": ["string", "null"]},
                "sell_fraction": {"type": "number"},
                "initial_position_qty": {"type": "number", "minimum": 0.0},
                "initial_cash": {"type": "number", "minimum": 0.0},
              },
            },
          },
        },
        "time": {
          "type": "object",
          "additionalProperties": False,
          "required": ["primary_tf", "derived_tfs", "aggregation"],
          "properties": {
            "primary_tf": {"type": "string", "enum": ["1m"]},
            "derived_tfs": {"type": "array", "minItems": 2, "items": {"type": "string", "enum": ["4h", "1d"]}},
            "aggregation": {
              "type": "object",
              "additionalProperties": False,
              "required": ["4h", "1d"],
              "properties": {
                "4h": {"type": "string", "enum": ["SESSION_ALIGNED_4H"]},
                "1d": {"type": "string", "enum": ["SESSION_ALIGNED_1D", "EXCHANGE_DAILY"]},
              },
            },
          },
        },
        "signal": {
          "type": "object",
          "additionalProperties": False,
          "required": ["indicators", "events"],
          "properties": {
            "indicators": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "type", "tf", "symbol_ref", "align", "params"],
                "properties": {
                  "id": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
                  "type": {"type": "string", "enum": ["MACD", "MA", "SMA", "CLOSE", "RSI", "KDJ", "BOLL", "BIAS"]},
                  "tf": {"type": "string", "enum": ["1m", "4h", "1d"]},
                  "symbol_ref": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
                  "align": {"type": ["string", "null"], "enum": ["LAST_CLOSED", "CARRY_FORWARD", None]},
                  "params": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["fast", "slow", "signal", "period", "window", "bar_selection", "stddev_mult"],
                    "properties": {
                      "fast": {"type": ["integer", "null"]},
                      "slow": {"type": ["integer", "null"]},
                      "signal": {"type": ["integer", "null"]},
                      "period": {"type": ["integer", "null"]},
                      "window": {"type": ["string", "null"]},
                      "bar_selection": {"type": ["string", "null"]},
                      "stddev_mult": {"type": ["number", "null"]},
                    },
                  },
                },
              },
            },
            "events": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "type", "a", "b", "left", "right", "direction", "op", "value", "tf", "pivot_left", "pivot_right", "lookback_bars"],
                "properties": {
                  "id": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
                  "type": {"type": "string", "enum": ["CROSS", "CROSS_UP", "CROSS_DOWN", "THRESHOLD", "DIVERGENCE_BEARISH", "DIVERGENCE_BULLISH"]},
                  "a": {"type": ["string", "null"], "pattern": "^[A-Za-z_][A-Za-z0-9_:-]*(\\.[A-Za-z_][A-Za-z0-9_]*)?(?:@[A-Za-z0-9_:-]+)?$"},
                  "b": {"type": ["string", "null"], "pattern": "^[A-Za-z_][A-Za-z0-9_:-]*(\\.[A-Za-z_][A-Za-z0-9_]*)?(?:@[A-Za-z0-9_:-]+)?$"},
                  "left": {"type": ["string", "null"], "pattern": "^[A-Za-z_][A-Za-z0-9_:-]*(\\.[A-Za-z_][A-Za-z0-9_]*)?(?:@[A-Za-z0-9_:-]+)?$"},
                  "right": {"type": ["string", "null"], "pattern": "^[A-Za-z_][A-Za-z0-9_:-]*(\\.[A-Za-z_][A-Za-z0-9_]*)?(?:@[A-Za-z0-9_:-]+)?$"},
                  "direction": {"type": ["string", "null"]},
                  "op": {"type": ["string", "null"], "enum": ["<", "<=", ">", ">=", "==", "!=", None]},
                  "value": {"type": ["number", "null"]},
                  "tf": {"type": ["string", "null"]},
                  "pivot_left": {"type": ["integer", "null"]},
                  "pivot_right": {"type": ["integer", "null"]},
                  "lookback_bars": {"type": ["integer", "null"]},
                },
              },
            },
          },
        },
        "logic": {
          "type": "object",
          "additionalProperties": False,
          "required": ["rules"],
          "properties": {
            "rules": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "when", "then"],
                "properties": {
                  "id": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
                  "when": {"$ref": "#/$defs/LogicCondition"},
                  "then": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "additionalProperties": False,
                          "required": ["action_id"],
                          "properties": {"action_id": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"}},
                        },
                      ]
                    },
                  },
                },
              },
            }
          },
        },
        "action": {
          "type": "object",
          "additionalProperties": False,
          "required": ["actions"],
          "properties": {
            "actions": {
              "type": "array",
              "minItems": 1,
              "items": {
                "anyOf": [
                  {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "type", "symbol_ref", "side", "qty", "order_type", "time_in_force", "idempotency_scope", "cooldown"],
                    "properties": {
                      "id": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
                      "type": {"type": "string", "enum": ["ORDER"]},
                      "symbol_ref": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
                      "side": {"type": "string", "enum": ["BUY"]},
                      "qty": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["mode", "value"],
                        "properties": {
                          "mode": {"type": "string", "enum": ["FULL_POSITION", "FRACTION_OF_EQUITY"]},
                          "value": {"type": "number", "minimum": 0.0, "maximum": 1.0},
                        },
                      },
                      "order_type": {"type": "string", "enum": ["MOC"]},
                      "time_in_force": {"type": ["string", "null"]},
                      "idempotency_scope": {"type": ["string", "null"], "enum": ["SYMBOL_ACTION", None]},
                      "cooldown": {"type": ["string", "null"]},
                    },
                  },
                  {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "type", "symbol_ref", "side", "qty", "order_type", "time_in_force", "idempotency_scope", "cooldown"],
                    "properties": {
                      "id": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
                      "type": {"type": "string", "enum": ["ORDER"]},
                      "symbol_ref": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
                      "side": {"type": "string", "enum": ["SELL"]},
                      "qty": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["mode", "value"],
                        "properties": {
                          "mode": {"type": "string", "enum": ["FULL_POSITION", "FRACTION_OF_POSITION"]},
                          "value": {"type": "number", "minimum": 0.0, "maximum": 1.0},
                        },
                      },
                      "order_type": {"type": "string", "enum": ["MOC"]},
                      "time_in_force": {"type": ["string", "null"]},
                      "idempotency_scope": {"type": ["string", "null"], "enum": ["SYMBOL_ACTION", None]},
                      "cooldown": {"type": ["string", "null"]},
                    },
                  },
                ]
              },
            }
          },
        },
      },
    },
  },
  "$defs": {
    "LogicCondition": {
      "anyOf": [
        {
          "type": "object",
          "additionalProperties": False,
          "required": ["all"],
          "properties": {"all": {"type": "array", "items": {"$ref": "#/$defs/LogicCondition"}}},
        },
        {
          "type": "object",
          "additionalProperties": False,
          "required": ["any"],
          "properties": {"any": {"type": "array", "items": {"$ref": "#/$defs/LogicCondition"}}},
        },
        {
          "type": "object",
          "additionalProperties": False,
          "required": ["event_within"],
          "properties": {
            "event_within": {
              "type": "object",
              "additionalProperties": False,
              "required": ["event_id", "lookback"],
              "properties": {
                "event_id": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
                "lookback": {"type": "string"},
              },
            }
          },
        },
        {
          "type": "object",
          "additionalProperties": False,
          "required": ["event_id", "scope"],
          "properties": {
            "event_id": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
            "scope": {"type": ["string", "null"], "enum": ["BAR", "LAST_CLOSED_4H_BAR", "LAST_CLOSED_1D", None]},
          },
        },
        {
          "type": "object",
          "additionalProperties": False,
          "required": ["lt"],
          "properties": {
            "lt": {
              "type": "object",
              "additionalProperties": False,
              "required": ["a", "b"],
              "properties": {
                "a": {"type": ["string", "number"]},
                "b": {"type": ["string", "number"]},
              },
            }
          },
        },
        {
          "type": "object",
          "additionalProperties": False,
          "required": ["gt"],
          "properties": {
            "gt": {
              "type": "object",
              "additionalProperties": False,
              "required": ["a", "b"],
              "properties": {
                "a": {"type": ["string", "number"]},
                "b": {"type": ["string", "number"]},
              },
            }
          },
        },
        {
          "type": "object",
          "additionalProperties": False,
          "required": ["op", "left", "right"],
          "properties": {
            "op": {"type": "string", "enum": ["<", "<=", ">", ">=", "==", "!="]},
            "left": {"type": ["string", "number"]},
            "right": {"type": ["string", "number"]},
          },
        },
        {
          "type": "object",
          "additionalProperties": False,
          "required": ["on_month_day"],
          "properties": {
            "on_month_day": {
              "type": "object",
              "additionalProperties": False,
              "required": ["month", "day"],
              "properties": {
                "month": {"type": "integer", "minimum": 1, "maximum": 12},
                "day": {"type": "integer", "minimum": 1, "maximum": 31},
              },
            }
          },
        },
        {
          "type": "object",
          "additionalProperties": False,
          "required": ["on_date"],
          "properties": {
            "on_date": {
              "type": "object",
              "additionalProperties": False,
              "required": ["date"],
              "properties": {
                "date": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
              },
            }
          },
        },
      ]
    }
  },
}


def _deep_merge(base: Any, incoming: Any) -> Any:
  if isinstance(base, dict) and isinstance(incoming, dict):
    merged = dict(base)
    for key, value in incoming.items():
      merged[key] = _deep_merge(base.get(key), value)
    return merged
  return incoming if incoming is not None else base


def _assemble_final_strategy_spec(
  *,
  draft: dict[str, Any],
  nl_text: str,
  mode: Literal["BACKTEST_ONLY", "PAPER", "LIVE"],
) -> dict[str, Any]:
  name = draft.get("name")
  if not isinstance(name, str) or not name.strip():
    name = (nl_text[:80] + "...") if len(nl_text) > 80 else nl_text

  return {
    "name": name,
    "timezone": "America/New_York",
    "calendar": {"type": "exchange", "value": "XNYS"},
    "universe": draft.get("universe"),
    "decision": {"decision_time_rule": {"type": "MARKET_CLOSE_OFFSET", "offset": "-2m"}},
    "execution": {"model": "MOC", "slippage_bps": 2.0, "commission_per_trade": 0.0},
    "risk": draft.get("risk"),
    "dsl": draft.get("dsl"),
    "meta": {
      "created_at": datetime.now(timezone.utc).isoformat(),
      "mode": mode,
      "llm_used": True,
      "llm_model": settings.llm_model,
    },
  }


def _build_indicator_preferences_context(indicator_preferences: dict[str, Any] | None) -> str:
  defaults = {
    "indicatorKinds": ["MA", "MACD"],
    "ma_window_days": 5,
    "macd": {"fast": 12, "slow": 26, "signal": 9},
    "boll": {"period": 20, "stddev_mult": 2.0},
    "bias": {"period": 6},
    "rsi": {"period": 14},
    "kdj": {"period": 9, "k_smooth": 3, "d_smooth": 3},
    "divergence": {
      "enabled": False,
      "indicator": "MACD",
      "direction": "bearish",
      "timeframe": "4h",
      "pivot_left": 3,
      "pivot_right": 3,
      "lookback_bars": 60,
    },
  }
  if not isinstance(indicator_preferences, dict):
    return (
      "Indicator parameter preferences:\n"
      f"- defaults: {json.dumps(defaults, ensure_ascii=False)}\n"
      "- user_selection: none\n"
    )
  return (
    "Indicator parameter preferences:\n"
    f"- defaults: {json.dumps(defaults, ensure_ascii=False)}\n"
    f"- user_selection: {json.dumps(indicator_preferences, ensure_ascii=False)}\n"
  )


def _read_int_pref(pref: dict[str, Any], keys: list[str], default: int, *, min_value: int = 1) -> int:
  for key in keys:
    raw = pref.get(key)
    if isinstance(raw, (int, float)):
      return max(min_value, int(raw))
    if isinstance(raw, str):
      try:
        return max(min_value, int(float(raw.strip())))
      except Exception:
        continue
  return default


def _read_float_pref(pref: dict[str, Any], keys: list[str], default: float, *, min_value: float = 0.0) -> float:
  for key in keys:
    raw = pref.get(key)
    if isinstance(raw, (int, float)):
      return max(min_value, float(raw))
    if isinstance(raw, str):
      try:
        return max(min_value, float(raw.strip()))
      except Exception:
        continue
  return default


def _normalized_indicator_kinds(indicator_preferences: dict[str, Any] | None) -> list[str]:
  if not isinstance(indicator_preferences, dict):
    return ["MA", "MACD"]
  raw = indicator_preferences.get("indicatorKinds")
  if not isinstance(raw, list):
    return ["MA", "MACD"]
  allowed = {"MA", "MACD", "BOLL", "RSI", "KDJ", "BIAS"}
  out: list[str] = []
  for item in raw:
    text = str(item or "").strip().upper()
    if text in allowed and text not in out:
      out.append(text)
  return out or ["MA", "MACD"]


def _extract_primary_symbol(nl_text: str) -> str:
  tokens = re.findall(r"\b[A-Za-z]{2,8}\b", nl_text.upper())
  blacklist = {"MACD", "MA", "RSI", "KDJ", "BUY", "SELL"}
  for token in tokens:
    if token in blacklist:
      continue
    if 2 <= len(token) <= 5 and token.isalpha():
      return token
  return "QQQ"


def _extract_ticker_candidates(nl_text: str) -> list[str]:
  blacklist = {
    "MACD",
    "MA",
    "RSI",
    "KDJ",
    "BUY",
    "SELL",
    "AND",
    "OR",
  }
  out: list[str] = []
  for tok in re.findall(r"\b[A-Za-z]{2,8}\b", nl_text.upper()):
    if tok in blacklist:
      continue
    if tok not in out:
      out.append(tok)
  return out


def _extract_signal_trade_from_text(nl_text: str) -> tuple[str | None, str | None]:
  # Heuristic: "观察/看 X" implies signal symbol, action verbs imply trade symbol.
  signal = None
  trade = None
  for m in re.finditer(r"(观察|看)\s*([A-Za-z]{2,8})", nl_text, flags=re.IGNORECASE):
    signal = m.group(2).upper()
    break
  for m in re.finditer(r"(建仓|买入|加仓|清仓|卖出|减仓)\s*([A-Za-z]{2,8})", nl_text, flags=re.IGNORECASE):
    trade = m.group(2).upper()
    break
  return signal, trade


def _extract_percent_values(nl_text: str) -> list[float]:
  vals: list[float] = []
  for m in re.findall(r"(\d{1,3})\s*%", nl_text):
    try:
      v = max(0.0, min(100.0, float(m)))
      vals.append(v / 100.0)
    except Exception:
      continue
  return vals


def _extract_ma_days(nl_text: str, default: int = 20) -> int:
  patterns = [
    r"(\d{1,3})\s*日\s*ma",
    r"ma\s*(\d{1,3})",
  ]
  lower = nl_text.lower()
  for p in patterns:
    m = re.search(p, lower)
    if not m:
      continue
    try:
      return max(1, int(m.group(1)))
    except Exception:
      continue
  return default


def _apply_cn_multi_stage_override(spec: dict[str, Any], nl_text: str, indicator_preferences: dict[str, Any] | None) -> bool:
  text = nl_text.lower()
  text_upper = nl_text.upper()
  kinds = _normalized_indicator_kinds(indicator_preferences)
  fractions = _extract_percent_values(nl_text)
  has_kdj = ("KDJ" in text_upper) or ("KDJ" in kinds)
  has_macd = ("MACD" in text_upper) or ("MACD" in kinds)
  has_ma = ("MA" in text_upper) or ("MA" in kinds)
  has_stage = len(fractions) >= 2
  if not (has_kdj and has_macd and has_ma and has_stage):
    return False

  tickers = _extract_ticker_candidates(nl_text)
  text_upper = nl_text.upper()
  signal_hint, trade_hint = _extract_signal_trade_from_text(nl_text)
  has_qqq = "QQQ" in text_upper
  has_tqqq = "TQQQ" in text_upper
  if has_qqq and has_tqqq:
    signal_symbol = "QQQ"
    trade_symbol = "TQQQ"
  elif signal_hint or trade_hint:
    signal_symbol = signal_hint or trade_hint or "QQQ"
    trade_symbol = trade_hint or signal_hint or signal_symbol
  elif len(tickers) >= 2:
    signal_symbol = tickers[0]
    trade_symbol = tickers[1]
  elif len(tickers) == 1:
    signal_symbol = tickers[0]
    trade_symbol = tickers[0]
  else:
    signal_symbol = "QQQ"
    trade_symbol = "TQQQ"

  prefs = indicator_preferences if isinstance(indicator_preferences, dict) else {}
  macd_fast = _read_int_pref(prefs, ["macdFast", "macd_fast"], 12)
  macd_slow = _read_int_pref(prefs, ["macdSlow", "macd_slow"], 26)
  macd_signal = _read_int_pref(prefs, ["macdSignal", "macd_signal"], 9)
  kdj_period = _read_int_pref(prefs, ["kdjPeriod", "kdj_period"], 9)
  kdj_k = _read_int_pref(prefs, ["kdjKSmooth", "kdj_k_smooth"], 3)
  kdj_d = _read_int_pref(prefs, ["kdjDSmooth", "kdj_d_smooth"], 3)
  ma_days = _extract_ma_days(nl_text, default=20)

  buy1, buy2, buy3 = (fractions + [0.2, 0.4, 0.4])[:3]

  spec["name"] = f"{signal_symbol}/{trade_symbol} staged weekly-style strategy"
  spec["universe"] = {"signal_symbol": signal_symbol, "trade_symbol": trade_symbol}
  spec["risk"] = {"cooldown": {"scope": "SYMBOL_ACTION", "value": "1d"}, "max_orders_per_day": 4}
  spec["dsl"] = {
    "atomic": {
      "symbols": {"signal": signal_symbol, "trade": trade_symbol},
      "constants": {"lookback": "30d", "sell_fraction": 1.0, "initial_position_qty": 0.0, "initial_cash": 10000.0},
    },
    "time": {
      "primary_tf": "1m",
      "derived_tfs": ["4h", "1d"],
      "aggregation": {"4h": "SESSION_ALIGNED_4H", "1d": "SESSION_ALIGNED_1D"},
    },
    "signal": {
      "indicators": [
        {
          "id": "kdj_1d",
          "type": "KDJ",
          "tf": "1d",
          "symbol_ref": "signal",
          "align": "LAST_CLOSED",
          "params": {"fast": kdj_k, "slow": kdj_d, "signal": None, "period": kdj_period, "window": None, "bar_selection": None, "stddev_mult": None},
        },
        {
          "id": "macd_1d",
          "type": "MACD",
          "tf": "1d",
          "symbol_ref": "signal",
          "align": "LAST_CLOSED",
          "params": {"fast": macd_fast, "slow": macd_slow, "signal": macd_signal, "period": None, "window": None, "bar_selection": None, "stddev_mult": None},
        },
        {
          "id": "close_1d",
          "type": "CLOSE",
          "tf": "1d",
          "symbol_ref": "signal",
          "align": "LAST_CLOSED",
          "params": {"fast": None, "slow": None, "signal": None, "period": None, "window": None, "bar_selection": "LAST_CLOSED_1D", "stddev_mult": None},
        },
        {
          "id": "ma_n_1d",
          "type": "MA",
          "tf": "1d",
          "symbol_ref": "signal",
          "align": "LAST_CLOSED",
          "params": {"fast": None, "slow": None, "signal": None, "period": None, "window": f"{ma_days}d", "bar_selection": "LAST_CLOSED_1D", "stddev_mult": None},
        },
      ],
      "events": [
        {"id": "ev_kdj_up", "type": "CROSS_UP", "a": "kdj_1d.k", "b": "kdj_1d.d", "left": None, "right": None, "direction": "UP", "op": None, "value": None, "tf": "1d"},
        {"id": "ev_kdj_down", "type": "CROSS_DOWN", "a": "kdj_1d.k", "b": "kdj_1d.d", "left": None, "right": None, "direction": "DOWN", "op": None, "value": None, "tf": "1d"},
        {"id": "ev_macd_up", "type": "CROSS_UP", "a": "macd_1d.macd", "b": "macd_1d.signal", "left": None, "right": None, "direction": "UP", "op": None, "value": None, "tf": "1d"},
        {"id": "ev_macd_down", "type": "CROSS_DOWN", "a": "macd_1d.macd", "b": "macd_1d.signal", "left": None, "right": None, "direction": "DOWN", "op": None, "value": None, "tf": "1d"},
        {"id": "ev_above_ma_n", "type": "THRESHOLD", "a": None, "b": None, "left": "close_1d.value", "right": "ma_n_1d.value", "direction": None, "op": ">", "value": None, "tf": "1d"},
      ],
    },
    "logic": {
      "rules": [
        {"id": "rule_stage1", "when": {"event_id": "ev_kdj_up", "scope": "BAR"}, "then": [{"action_id": "buy_stage1"}]},
        {"id": "rule_stage2", "when": {"all": [{"event_within": {"event_id": "ev_kdj_up", "lookback": "30d"}}, {"event_id": "ev_above_ma_n", "scope": "BAR"}]}, "then": [{"action_id": "buy_stage2"}]},
        {"id": "rule_stage3", "when": {"all": [{"event_within": {"event_id": "ev_above_ma_n", "lookback": "30d"}}, {"event_id": "ev_macd_up", "scope": "BAR"}]}, "then": [{"action_id": "buy_stage3"}]},
        {"id": "rule_exit", "when": {"all": [{"event_id": "ev_kdj_down", "scope": "BAR"}, {"event_id": "ev_macd_down", "scope": "BAR"}]}, "then": [{"action_id": "sell_all"}]},
      ]
    },
    "action": {
      "actions": [
        {"id": "buy_stage1", "type": "ORDER", "symbol_ref": "trade", "side": "BUY", "qty": {"mode": "FRACTION_OF_EQUITY", "value": buy1}, "order_type": "MOC", "time_in_force": None, "idempotency_scope": "SYMBOL_ACTION", "cooldown": "1d"},
        {"id": "buy_stage2", "type": "ORDER", "symbol_ref": "trade", "side": "BUY", "qty": {"mode": "FRACTION_OF_EQUITY", "value": buy2}, "order_type": "MOC", "time_in_force": None, "idempotency_scope": "SYMBOL_ACTION", "cooldown": "1d"},
        {"id": "buy_stage3", "type": "ORDER", "symbol_ref": "trade", "side": "BUY", "qty": {"mode": "FRACTION_OF_EQUITY", "value": buy3}, "order_type": "MOC", "time_in_force": None, "idempotency_scope": "SYMBOL_ACTION", "cooldown": "1d"},
        {"id": "sell_all", "type": "ORDER", "symbol_ref": "trade", "side": "SELL", "qty": {"mode": "FULL_POSITION", "value": 1.0}, "order_type": "MOC", "time_in_force": None, "idempotency_scope": "SYMBOL_ACTION", "cooldown": "1d"},
      ]
    },
  }
  meta = spec.get("meta")
  if isinstance(meta, dict):
    meta["deterministic_override"] = "cn_kdj_macd_ma_staged"
    prefs_meta = meta.get("indicator_preferences")
    if isinstance(prefs_meta, dict):
      prefs_meta["maWindowDays"] = ma_days
  return True


def _requires_precise_llm_parsing(nl_text: str, indicator_preferences: dict[str, Any] | None) -> bool:
  text = (nl_text or "").lower()
  risk_tokens = [
    "kdj",
    "rsi",
    "boll",
    "bias",
    "背离",
    "divergence",
    "周线",
    "weekly",
    "月线",
    "monthly",
    "加仓",
    "减仓",
    "分批",
    "stage",
    "then",
    "随后",
    "然后",
  ]
  if any(tok in text for tok in risk_tokens):
    return True
  if re.search(r"\d+\s*%", text):
    return True
  kinds = _normalized_indicator_kinds(indicator_preferences)
  # More than MA/MACD usually means users expect richer semantics than fallback can safely represent.
  return any(k in {"BOLL", "RSI", "KDJ", "BIAS"} for k in kinds)


def _build_fallback_strategy_spec(
  *,
  nl_text: str,
  mode: Literal["BACKTEST_ONLY", "PAPER", "LIVE"],
  indicator_preferences: dict[str, Any] | None,
  reason: AppError | None,
  complex_guard_triggered: bool = False,
) -> dict[str, Any]:
  signal_symbol = _extract_primary_symbol(nl_text)
  trade_symbol = signal_symbol
  prefs = indicator_preferences if isinstance(indicator_preferences, dict) else {}
  macd_fast = _read_int_pref(prefs, ["macdFast", "macd_fast"], 12)
  macd_slow = _read_int_pref(prefs, ["macdSlow", "macd_slow"], 26)
  macd_signal = _read_int_pref(prefs, ["macdSignal", "macd_signal"], 9)

  spec: dict[str, Any] = {
    "name": f"Fallback {signal_symbol} MACD strategy",
    "timezone": "America/New_York",
    "calendar": {"type": "exchange", "value": "XNYS"},
    "universe": {"signal_symbol": signal_symbol, "trade_symbol": trade_symbol},
    "decision": {"decision_time_rule": {"type": "MARKET_CLOSE_OFFSET", "offset": "-2m"}},
    "execution": {"model": "MOC", "slippage_bps": 2.0, "commission_per_trade": 0.0},
    "risk": {"cooldown": {"scope": "SYMBOL_ACTION", "value": "1d"}, "max_orders_per_day": 2},
    "dsl": {
      "atomic": {
        "symbols": {"signal": signal_symbol, "trade": trade_symbol},
        "constants": {"lookback": "5d", "sell_fraction": 1.0, "initial_position_qty": 0.0, "initial_cash": 10000.0},
      },
      "time": {
        "primary_tf": "1m",
        "derived_tfs": ["4h", "1d"],
        "aggregation": {"4h": "SESSION_ALIGNED_4H", "1d": "SESSION_ALIGNED_1D"},
      },
      "signal": {
        "indicators": [
          {
            "id": "macd_4h",
            "type": "MACD",
            "tf": "4h",
            "symbol_ref": "signal",
            "align": "LAST_CLOSED",
            "params": {
              "fast": macd_fast,
              "slow": macd_slow,
              "signal": macd_signal,
              "period": None,
              "window": None,
              "bar_selection": None,
              "stddev_mult": None,
            },
          }
        ],
        "events": [
          {
            "id": "ev_macd_up",
            "type": "CROSS_UP",
            "a": "macd_4h.macd",
            "b": "macd_4h.signal",
            "left": None,
            "right": None,
            "direction": "UP",
            "op": None,
            "value": None,
            "tf": "4h",
          },
          {
            "id": "ev_macd_down",
            "type": "CROSS_DOWN",
            "a": "macd_4h.macd",
            "b": "macd_4h.signal",
            "left": None,
            "right": None,
            "direction": "DOWN",
            "op": None,
            "value": None,
            "tf": "4h",
          },
        ],
      },
      "logic": {
        "rules": [
          {"id": "rule_buy", "when": {"event_id": "ev_macd_up", "scope": "BAR"}, "then": [{"action_id": "buy_full"}]},
          {"id": "rule_sell", "when": {"event_id": "ev_macd_down", "scope": "BAR"}, "then": [{"action_id": "sell_all"}]},
        ]
      },
      "action": {
        "actions": [
          {
            "id": "buy_full",
            "type": "ORDER",
            "symbol_ref": "trade",
            "side": "BUY",
            "qty": {"mode": "FRACTION_OF_EQUITY", "value": 1.0},
            "order_type": "MOC",
            "time_in_force": None,
            "idempotency_scope": "SYMBOL_ACTION",
            "cooldown": "1d",
          },
          {
            "id": "sell_all",
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
    "meta": {
      "created_at": datetime.now(timezone.utc).isoformat(),
      "mode": mode,
      "llm_used": False,
      "llm_model": settings.llm_model,
      "generation_mode": "fallback",
      "fallback_reason_code": reason.code if isinstance(reason, AppError) else None,
      "fallback_reason_message": reason.message if isinstance(reason, AppError) else "unknown",
      "fallback_guard_triggered": complex_guard_triggered,
    },
    "strategy_version": "v0",
  }
  if isinstance(indicator_preferences, dict):
    meta = spec.get("meta")
    if isinstance(meta, dict):
      meta["indicator_preferences"] = indicator_preferences
  return spec


def _apply_indicator_preferences(spec: dict[str, Any], indicator_preferences: dict[str, Any] | None) -> None:
  if not isinstance(indicator_preferences, dict):
    return
  dsl = spec.get("dsl")
  if not isinstance(dsl, dict):
    return
  signal_layer = dsl.get("signal")
  if not isinstance(signal_layer, dict):
    return
  indicators = signal_layer.get("indicators")
  if not isinstance(indicators, list):
    return

  kinds = _normalized_indicator_kinds(indicator_preferences)

  def _upsert_indicator(indicator: dict[str, Any]) -> None:
    ind_id = str(indicator.get("id") or "")
    if not ind_id:
      return
    for idx, existing in enumerate(indicators):
      if isinstance(existing, dict) and str(existing.get("id") or "") == ind_id:
        indicators[idx] = indicator
        return
    indicators.append(indicator)

  def _remove_indicator(ind_id: str) -> None:
    signal_layer["indicators"] = [
      ind for ind in indicators
      if not (isinstance(ind, dict) and str(ind.get("id") or "") == ind_id)
    ]

  if "MA" in kinds:
    ma_window = _read_int_pref(indicator_preferences, ["maWindowDays", "ma_window_days"], 5)
    _upsert_indicator(
      {
        "id": "pref_ma_1d",
        "type": "MA",
        "tf": "1d",
        "symbol_ref": "signal",
        "align": "LAST_CLOSED",
        "params": {
          "fast": None,
          "slow": None,
          "signal": None,
          "period": None,
          "window": f"{ma_window}d",
          "bar_selection": "LAST_CLOSED_1D",
          "stddev_mult": None,
        },
      }
    )
  else:
    _remove_indicator("pref_ma_1d")

  if "MACD" in kinds:
    _upsert_indicator(
      {
        "id": "pref_macd_4h",
        "type": "MACD",
        "tf": "4h",
        "symbol_ref": "signal",
        "align": "LAST_CLOSED",
        "params": {
          "fast": _read_int_pref(indicator_preferences, ["macdFast", "macd_fast"], 12),
          "slow": _read_int_pref(indicator_preferences, ["macdSlow", "macd_slow"], 26),
          "signal": _read_int_pref(indicator_preferences, ["macdSignal", "macd_signal"], 9),
          "period": None,
          "window": None,
          "bar_selection": None,
          "stddev_mult": None,
        },
      }
    )
  else:
    _remove_indicator("pref_macd_4h")

  if "RSI" in kinds:
    _upsert_indicator(
      {
        "id": "pref_rsi_1d",
        "type": "RSI",
        "tf": "1d",
        "symbol_ref": "signal",
        "align": "LAST_CLOSED",
        "params": {
          "fast": None,
          "slow": None,
          "signal": None,
          "period": _read_int_pref(indicator_preferences, ["rsiPeriod", "rsi_period"], 14),
          "window": None,
          "bar_selection": "LAST_CLOSED_1D",
          "stddev_mult": None,
        },
      }
    )
  else:
    _remove_indicator("pref_rsi_1d")

  if "KDJ" in kinds:
    _upsert_indicator(
      {
        "id": "pref_kdj_4h",
        "type": "KDJ",
        "tf": "4h",
        "symbol_ref": "signal",
        "align": "LAST_CLOSED",
        "params": {
          "fast": _read_int_pref(indicator_preferences, ["kdjKSmooth", "kdj_k_smooth"], 3),
          "slow": _read_int_pref(indicator_preferences, ["kdjDSmooth", "kdj_d_smooth"], 3),
          "signal": None,
          "period": _read_int_pref(indicator_preferences, ["kdjPeriod", "kdj_period"], 9),
          "window": None,
          "bar_selection": None,
          "stddev_mult": None,
        },
      }
    )
  else:
    _remove_indicator("pref_kdj_4h")

  if "BOLL" in kinds:
    _upsert_indicator(
      {
        "id": "pref_boll_1d",
        "type": "BOLL",
        "tf": "1d",
        "symbol_ref": "signal",
        "align": "LAST_CLOSED",
        "params": {
          "fast": None,
          "slow": None,
          "signal": None,
          "period": _read_int_pref(indicator_preferences, ["bollPeriod", "boll_period"], 20),
          "window": None,
          "bar_selection": "LAST_CLOSED_1D",
          "stddev_mult": _read_float_pref(indicator_preferences, ["bollStddevMult", "boll_stddev_mult"], 2.0, min_value=0.1),
        },
      }
    )
  else:
    _remove_indicator("pref_boll_1d")

  if "BIAS" in kinds:
    _upsert_indicator(
      {
        "id": "pref_bias_1d",
        "type": "BIAS",
        "tf": "1d",
        "symbol_ref": "signal",
        "align": "LAST_CLOSED",
        "params": {
          "fast": None,
          "slow": None,
          "signal": None,
          "period": _read_int_pref(indicator_preferences, ["biasPeriod", "bias_period"], 6),
          "window": None,
          "bar_selection": "LAST_CLOSED_1D",
          "stddev_mult": None,
        },
      }
    )
  else:
    _remove_indicator("pref_bias_1d")


def _apply_divergence_preferences(spec: dict[str, Any], indicator_preferences: dict[str, Any] | None) -> None:
  if not isinstance(indicator_preferences, dict):
    return
  divergence = indicator_preferences.get("divergence")
  if not isinstance(divergence, dict):
    return
  if not bool(divergence.get("enabled")):
    return

  dsl = spec.get("dsl")
  if not isinstance(dsl, dict):
    return
  signal_layer = dsl.get("signal")
  logic_layer = dsl.get("logic")
  action_layer = dsl.get("action")
  if not isinstance(signal_layer, dict) or not isinstance(logic_layer, dict) or not isinstance(action_layer, dict):
    return
  indicators = signal_layer.get("indicators")
  events = signal_layer.get("events")
  rules = logic_layer.get("rules")
  actions = action_layer.get("actions")
  if not isinstance(indicators, list) or not isinstance(events, list) or not isinstance(rules, list) or not isinstance(actions, list):
    return

  indicator_name = str(divergence.get("indicator") or "MACD").strip().upper()
  if indicator_name not in {"MACD", "RSI", "KDJ"}:
    indicator_name = "MACD"
  direction = str(divergence.get("direction") or "bearish").strip().lower()
  event_type = "DIVERGENCE_BULLISH" if direction == "bullish" else "DIVERGENCE_BEARISH"
  tf = str(divergence.get("timeframe") or "4h").strip().lower()
  if tf not in {"4h", "1d"}:
    tf = "4h"
  pivot_left = _read_int_pref(divergence, ["pivot_left", "pivotLeft"], 3)
  pivot_right = _read_int_pref(divergence, ["pivot_right", "pivotRight"], 3)
  lookback_bars = _read_int_pref(divergence, ["lookback_bars", "lookbackBars"], 60, min_value=10)

  src_indicator_id = "div_src"
  close_indicator_id = "div_price"

  has_src = any(
    isinstance(ind, dict) and ind.get("id") == src_indicator_id
    for ind in indicators
  )
  if not has_src:
    params: dict[str, Any] = {"fast": None, "slow": None, "signal": None, "period": None, "window": None, "bar_selection": None, "stddev_mult": None}
    if indicator_name == "MACD":
      params["fast"] = _read_int_pref(indicator_preferences, ["macdFast", "macd_fast"], 12)
      params["slow"] = _read_int_pref(indicator_preferences, ["macdSlow", "macd_slow"], 26)
      params["signal"] = _read_int_pref(indicator_preferences, ["macdSignal", "macd_signal"], 9)
    elif indicator_name == "RSI":
      params["period"] = _read_int_pref(indicator_preferences, ["rsiPeriod", "rsi_period"], 14)
    else:
      params["period"] = _read_int_pref(indicator_preferences, ["kdjPeriod", "kdj_period"], 9)
      params["fast"] = _read_int_pref(indicator_preferences, ["kdjKSmooth", "kdj_k_smooth"], 3)
      params["slow"] = _read_int_pref(indicator_preferences, ["kdjDSmooth", "kdj_d_smooth"], 3)
    indicators.append(
      {
        "id": src_indicator_id,
        "type": indicator_name,
        "tf": tf,
        "symbol_ref": "signal",
        "align": "LAST_CLOSED",
        "params": params,
      }
    )

  has_close = any(
    isinstance(ind, dict) and ind.get("id") == close_indicator_id
    for ind in indicators
  )
  if not has_close:
    indicators.append(
      {
        "id": close_indicator_id,
        "type": "CLOSE",
        "tf": tf,
        "symbol_ref": "signal",
        "align": "LAST_CLOSED",
        "params": {"fast": None, "slow": None, "signal": None, "period": None, "window": None, "bar_selection": None, "stddev_mult": None},
      }
    )

  div_event_id = "ev_divergence_signal"
  if not any(isinstance(ev, dict) and ev.get("id") == div_event_id for ev in events):
    oscillator_ref = "div_src.macd" if indicator_name == "MACD" else "div_src.value"
    if indicator_name == "KDJ":
      oscillator_ref = "div_src.j"
    events.append(
      {
        "id": div_event_id,
        "type": event_type,
        "a": f"{close_indicator_id}.value",
        "b": oscillator_ref,
        "left": None,
        "right": None,
        "direction": "DOWN" if event_type == "DIVERGENCE_BEARISH" else "UP",
        "op": None,
        "value": None,
        "tf": tf,
        "pivot_left": pivot_left,
        "pivot_right": pivot_right,
        "lookback_bars": lookback_bars,
      }
    )

  action_side_target = "SELL" if event_type == "DIVERGENCE_BEARISH" else "BUY"
  action_side_by_id: dict[str, str] = {}
  for action in actions:
    if isinstance(action, dict) and isinstance(action.get("id"), str):
      action_side_by_id[action["id"]] = str(action.get("side") or "").upper()

  for rule in rules:
    if not isinstance(rule, dict):
      continue
    then_items = rule.get("then")
    if not isinstance(then_items, list):
      continue
    if not any(
      isinstance(t, dict)
      and isinstance(t.get("action_id"), str)
      and action_side_by_id.get(str(t.get("action_id"))) == action_side_target
      for t in then_items
    ):
      continue
    when = rule.get("when")
    div_condition = {"event_id": div_event_id, "scope": "BAR"}
    if isinstance(when, dict):
      if isinstance(when.get("all"), list):
        if not any(isinstance(c, dict) and c.get("event_id") == div_event_id for c in when["all"]):
          when["all"] = [*when["all"], div_condition]
      elif not (when.get("event_id") == div_event_id):
        rule["when"] = {"all": [when, div_condition]}
    else:
      rule["when"] = div_condition


def _normalize_cross_event_window_semantics(spec: dict[str, Any]) -> None:
  """
  Normalize LLM outputs so CROSS events used with additional state filters
  are interpreted as "event within lookback window" rather than same-bar only.
  """
  dsl = spec.get("dsl")
  if not isinstance(dsl, dict):
    return

  signal_layer = dsl.get("signal")
  logic_layer = dsl.get("logic")
  atomic_layer = dsl.get("atomic")
  if not isinstance(signal_layer, dict) or not isinstance(logic_layer, dict):
    return

  constants = atomic_layer.get("constants") if isinstance(atomic_layer, dict) else {}
  lookback = "5d"
  if isinstance(constants, dict):
    raw_lookback = constants.get("lookback")
    if isinstance(raw_lookback, str) and raw_lookback.strip():
      lookback = raw_lookback.strip()

  cross_event_ids: set[str] = set()
  events = signal_layer.get("events")
  if isinstance(events, list):
    for ev in events:
      if not isinstance(ev, dict):
        continue
      ev_id = ev.get("id")
      ev_type = str(ev.get("type") or "").strip().upper()
      if isinstance(ev_id, str) and ev_id and ev_type in {"CROSS", "CROSS_UP", "CROSS_DOWN"}:
        cross_event_ids.add(ev_id)
  if not cross_event_ids:
    return

  def _is_cross_event_bar_scope(cond: Any) -> bool:
    if not isinstance(cond, dict):
      return False
    event_id = cond.get("event_id")
    if not isinstance(event_id, str) or event_id not in cross_event_ids:
      return False
    if "event_within" in cond:
      return False
    scope = str(cond.get("scope") or "").upper()
    return scope in {"", "BAR", "LAST_CLOSED_4H_BAR", "LAST_CLOSED_1D"}

  def _normalize_condition(cond: Any) -> Any:
    if not isinstance(cond, dict):
      return cond

    if "all" in cond and isinstance(cond.get("all"), list):
      children = [_normalize_condition(child) for child in cond["all"]]
      has_cross_event = any(_is_cross_event_bar_scope(child) for child in children)
      has_other_filter = any(not _is_cross_event_bar_scope(child) for child in children)
      if has_cross_event and has_other_filter:
        rewritten: list[Any] = []
        for child in children:
          if _is_cross_event_bar_scope(child):
            event_id = child.get("event_id")
            rewritten.append({"event_within": {"event_id": event_id, "lookback": lookback}})
          else:
            rewritten.append(child)
        out = dict(cond)
        out["all"] = rewritten
        return out
      out = dict(cond)
      out["all"] = children
      return out

    if "any" in cond and isinstance(cond.get("any"), list):
      out = dict(cond)
      out["any"] = [_normalize_condition(child) for child in cond["any"]]
      return out

    return cond

  rules = logic_layer.get("rules")
  if not isinstance(rules, list):
    return
  for rule in rules:
    if not isinstance(rule, dict):
      continue
    when = rule.get("when")
    if isinstance(when, dict):
      rule["when"] = _normalize_condition(when)


async def nl_to_strategy_spec(
  nl_text: str,
  mode: Literal["BACKTEST_ONLY", "PAPER", "LIVE"],
  overrides: dict[str, Any] | None = None,
  indicator_preferences: dict[str, Any] | None = None,
  strict_llm: bool = False,
) -> dict[str, Any]:
  if not isinstance(nl_text, str) or not nl_text.strip():
    raise AppError("VALIDATION_ERROR", "nl_text must be a non-empty string", {})

  pref_context = _build_indicator_preferences_context(indicator_preferences)
  user_prompt = f"""User natural language strategy description: "{nl_text}"
Additional context:
- mode: "{mode}"
{pref_context}

Task:
Return ONLY StrategyDraft JSON with fields:
- name
- universe
- risk
- dsl (atomic/time/signal/logic/action)

Output requirements:
- indicators/events/rules/actions must all be non-empty arrays.
- Keep symbol intent exact (signal symbol vs traded symbol).
- Rules are independent; do not introduce flag gating.
- Do not invent BUY actions unless user explicitly requests entry/build position.
- Do not invent extra reduce percentages or extra stages.
- If NL has date action trigger, encode it in rule.when using on_month_day/on_date and bind it to that action stage.
- For date-only entry clause, entry rule should be date-gated only (no extra inferred indicator filters).
"""

  max_attempts = max(1, int(settings.llm_semantic_repair_attempts) + 1)
  last_error: AppError | None = None
  for attempt in range(max_attempts):
    try:
      draft = await llm_client.chat_json(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        schema_name="strategy_draft",
        json_schema=STRATEGY_DRAFT_JSON_SCHEMA,
        strict_schema=True,
      )
      if not isinstance(draft, dict):
        raise AppError("VALIDATION_ERROR", "LLM did not return object StrategyDraft", {"type": str(type(draft))})

      spec = _assemble_final_strategy_spec(draft=draft, nl_text=nl_text, mode=mode)
      if overrides and isinstance(overrides, dict):
        spec = _deep_merge(spec, overrides)
      # Preserve LLM semantic intent. Deterministic override is only applied in fallback mode.
      _apply_indicator_preferences(spec, indicator_preferences)
      _normalize_cross_event_window_semantics(spec)
      _apply_divergence_preferences(spec, indicator_preferences)
      spec["strategy_version"] = "v0"

      meta = spec.get("meta")
      if isinstance(meta, dict):
        meta["llm_attempts"] = attempt + 1
        meta["generation_mode"] = "llm"
        if isinstance(indicator_preferences, dict):
          meta["indicator_preferences"] = indicator_preferences

      return spec
    except AppError as err:
      last_error = err
      if attempt + 1 >= max_attempts:
        break

  if last_error is not None:
    if strict_llm:
      raise last_error
    guard_triggered = _requires_precise_llm_parsing(nl_text, indicator_preferences)
    fallback = _build_fallback_strategy_spec(
      nl_text=nl_text,
      mode=mode,
      indicator_preferences=indicator_preferences,
      reason=last_error,
      complex_guard_triggered=guard_triggered,
    )
    if guard_triggered:
      meta = fallback.get("meta")
      if isinstance(meta, dict):
        meta["fallback_reason_message"] = (
          f"{last_error.message}; complex prompt fell back to simplified strategy (review DSL before using)"
        )
    if overrides and isinstance(overrides, dict):
      fallback = _deep_merge(fallback, overrides)
    deterministic_applied = _apply_cn_multi_stage_override(fallback, nl_text, indicator_preferences)
    if not deterministic_applied:
      _apply_indicator_preferences(fallback, indicator_preferences)
    _normalize_cross_event_window_semantics(fallback)
    _apply_divergence_preferences(fallback, indicator_preferences)
    return fallback
  raise AppError("INTERNAL", "Unexpected parser state", {})
