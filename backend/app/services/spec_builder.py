from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Literal

from app.core.config import settings
from app.core.errors import AppError
from app.services.llm_client import llm_client


SYSTEM_PROMPT_V0 = """You are a trading strategy compiler.
Your job:
- Convert natural language trading strategy descriptions into a STRICT JSON object called StrategyDraft.
- StrategyDraft contains ONLY user-variant strategy fields.
- Do NOT output system-managed fields.

Hard Rules (Vibe Trading v0):
1) Timezone is fixed to America/New_York (system-managed).
2) Calendar is fixed to XNYS (system-managed).
3) Decision time is fixed to market_close - 2 minutes (system-managed).
4) Execution model is fixed to MOC (system-managed).
5) MA/SMA window should follow user preference when provided; otherwise use sensible defaults.
6) Primary timeframe is 1m; 4h and 1d are aggregated from 1m.
7) No future leak: only fully closed bars at decision time.
8) Lookback must include units, e.g. 5d, 20bars@4h.

Output instructions:
- Output ONLY valid JSON StrategyDraft.
- StrategyDraft must include:
  - name
  - universe(signal_symbol, trade_symbol)
  - risk
  - dsl (atomic/time/signal/logic/action)
- indicators/events/rules/actions must all be non-empty.
"""


STRATEGY_DRAFT_JSON_SCHEMA: dict[str, Any] = {
  "type": "object",
  "additionalProperties": False,
  "required": ["name", "universe", "risk", "dsl"],
  "properties": {
    "name": {"type": "string"},
    "universe": {
      "type": "object",
      "additionalProperties": False,
      "required": ["signal_symbol", "trade_symbol"],
      "properties": {
        "signal_symbol": {"type": "string"},
        "trade_symbol": {"type": "string"},
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
        "max_orders_per_day": {"type": "integer"},
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
                "signal": {"type": "string"},
                "trade": {"type": "string"},
              },
            },
            "constants": {
              "type": "object",
              "additionalProperties": False,
              "required": ["lookback", "sell_fraction", "initial_position_qty", "initial_cash"],
              "properties": {
                "lookback": {"type": ["string", "null"]},
                "sell_fraction": {"type": "number"},
                "initial_position_qty": {"type": ["number", "null"]},
                "initial_cash": {"type": ["number", "null"]},
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
            "derived_tfs": {"type": "array", "items": {"type": "string", "enum": ["4h", "1d"]}},
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
                  "id": {"type": "string"},
                  "type": {"type": "string", "enum": ["MACD", "SMA", "MA", "CLOSE"]},
                  "tf": {"type": "string", "enum": ["1m", "4h", "1d"]},
                  "symbol_ref": {"type": "string"},
                  "align": {"type": ["string", "null"], "enum": ["LAST_CLOSED", "CARRY_FORWARD", None]},
                  "params": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["fast", "slow", "signal", "window", "bar_selection"],
                    "properties": {
                      "fast": {"type": ["integer", "null"]},
                      "slow": {"type": ["integer", "null"]},
                      "signal": {"type": ["integer", "null"]},
                      "window": {"type": ["string", "null"]},
                      "bar_selection": {"type": ["string", "null"]},
                    },
                  },
                },
              },
            },
            "events": {
              "type": "array",
              "minItems": 1,
              "items": {
                "anyOf": [
                  {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "type", "a", "b", "left", "right", "direction", "op", "value", "tf"],
                    "properties": {
                      "id": {"type": "string"},
                      "type": {"type": "string", "enum": ["CROSS", "CROSS_UP", "CROSS_DOWN"]},
                      "a": {"type": "string"},
                      "b": {"type": "string"},
                      "left": {"type": "null"},
                      "right": {"type": "null"},
                      "direction": {"type": ["string", "null"], "enum": ["UP", "DOWN", "ANY", None]},
                      "op": {"type": "null"},
                      "value": {"type": "null"},
                      "tf": {"type": ["string", "null"]},
                    },
                  },
                  {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "type", "a", "b", "left", "right", "direction", "op", "value", "tf"],
                    "properties": {
                      "id": {"type": "string"},
                      "type": {"type": "string", "enum": ["THRESHOLD"]},
                      "a": {"type": "null"},
                      "b": {"type": "null"},
                      "left": {"type": "string"},
                      "right": {"type": "string"},
                      "direction": {"type": "null"},
                      "op": {"type": "string", "enum": ["<", "<=", ">", ">=", "==", "!="]},
                      "value": {"type": ["number", "null"]},
                      "tf": {"type": ["string", "null"]},
                    },
                  },
                ]
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
                  "id": {"type": "string"},
                  "when": {"$ref": "#/$defs/LogicCondition"},
                  "then": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                      "anyOf": [
                        {"type": "string"},
                        {
                          "type": "object",
                          "additionalProperties": False,
                          "required": ["action_id"],
                          "properties": {"action_id": {"type": "string"}},
                        },
                      ]
                    },
                  },
                },
              },
            },
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
                    "required": [
                      "id",
                      "type",
                      "symbol_ref",
                      "side",
                      "qty",
                      "order_type",
                      "time_in_force",
                      "idempotency_scope",
                      "cooldown",
                    ],
                    "properties": {
                      "id": {"type": "string"},
                      "type": {"type": "string", "enum": ["ORDER"]},
                      "symbol_ref": {"type": "string"},
                      "side": {"type": "string", "enum": ["BUY", "SELL"]},
                      "order_type": {"type": "string", "enum": ["MOC"]},
                      "time_in_force": {"type": ["string", "null"]},
                      "idempotency_scope": {"type": ["string", "null"]},
                      "cooldown": {"type": ["string", "null"]},
                      "qty": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["mode", "value"],
                        "properties": {
                          "mode": {
                            "type": "string",
                            "enum": [
                              "FRACTION_OF_POSITION",
                              "ABSOLUTE",
                              "NOTIONAL_USD",
                              "FIXED",
                              "FIXED_SHARES",
                              "SHARES",
                              "FRACTION_OF_CASH",
                              "FRACTION_OF_EQUITY",
                              "FULL_POSITION",
                            ],
                          },
                          "value": {"type": "number"},
                        },
                      },
                    },
                  },
                  {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "type", "flag", "cooldown"],
                    "properties": {
                      "id": {"type": "string"},
                      "type": {"type": "string", "enum": ["SET_FLAG"]},
                      "flag": {"type": "string"},
                      "cooldown": {"type": ["string", "null"]},
                    },
                  },
                ]
              },
            },
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
                "event_id": {"type": "string"},
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
            "event_id": {"type": "string"},
            "scope": {"type": ["string", "null"]},
          },
        },
        {
          "type": "object",
          "additionalProperties": False,
          "required": ["flag_is_true"],
          "properties": {
            "flag_is_true": {
              "type": "object",
              "additionalProperties": False,
              "required": ["flag"],
              "properties": {
                "flag": {"type": "string"},
              },
            }
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

  spec: dict[str, Any] = {
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
  return spec


def _build_repair_prompt(
  nl_text: str,
  mode: Literal["BACKTEST_ONLY", "PAPER", "LIVE"],
  previous_draft: dict[str, Any],
  validation_error: AppError,
) -> str:
  return (
    f'User natural language strategy description: "{nl_text}"\n'
    f'Additional context:\n- mode: "{mode}"\n\n'
    "Your previous StrategyDraft did not pass backend semantic validation.\n"
    "Fix the JSON and return a complete StrategyDraft.\n"
    "Do not output explanations. Output JSON only.\n\n"
    f"Validation message: {validation_error.message}\n"
    f"Validation details: {validation_error.details or {}}\n\n"
    "Previous StrategyDraft JSON:\n"
    f"{json.dumps(previous_draft, ensure_ascii=False)}\n"
  )


def _build_indicator_preferences_context(indicator_preferences: dict[str, Any] | None) -> str:
  defaults = {"ma_window_days": 5, "macd": {"fast": 12, "slow": 26, "signal": 9}}
  if not isinstance(indicator_preferences, dict):
    return (
      "Indicator parameter preferences:\n"
      f"- defaults: {json.dumps(defaults, ensure_ascii=False)}\n"
      "- user_selection: none (use defaults unless user NL explicitly asks otherwise)\n"
    )
  return (
    "Indicator parameter preferences:\n"
    f"- defaults: {json.dumps(defaults, ensure_ascii=False)}\n"
    f"- user_selection: {json.dumps(indicator_preferences, ensure_ascii=False)}\n"
    "- If user_selection exists, prioritize it unless it conflicts with explicit NL intent.\n"
  )


def _read_pref_int(source: dict[str, Any], keys: list[str], default: int) -> int:
  for key in keys:
    raw = source.get(key)
    if isinstance(raw, (int, float)):
      return max(1, int(raw))
    if isinstance(raw, str):
      try:
        return max(1, int(float(raw.strip())))
      except Exception:
        continue
  return default


def _apply_indicator_preferences_to_draft(draft: dict[str, Any], indicator_preferences: dict[str, Any] | None) -> dict[str, Any]:
  if not isinstance(indicator_preferences, dict):
    return draft

  ma_days = _read_pref_int(indicator_preferences, ["maWindowDays", "ma_window_days"], 5)
  macd_fast = _read_pref_int(indicator_preferences, ["macdFast", "macd_fast"], 12)
  macd_slow = _read_pref_int(indicator_preferences, ["macdSlow", "macd_slow"], 26)
  macd_signal = _read_pref_int(indicator_preferences, ["macdSignal", "macd_signal"], 9)

  macd_obj = indicator_preferences.get("macd")
  if isinstance(macd_obj, dict):
    macd_fast = _read_pref_int(macd_obj, ["fast"], macd_fast)
    macd_slow = _read_pref_int(macd_obj, ["slow"], macd_slow)
    macd_signal = _read_pref_int(macd_obj, ["signal"], macd_signal)

  dsl = draft.get("dsl")
  if not isinstance(dsl, dict):
    return draft
  signal = dsl.get("signal")
  if not isinstance(signal, dict):
    return draft
  indicators = signal.get("indicators")
  if not isinstance(indicators, list):
    return draft

  for ind in indicators:
    if not isinstance(ind, dict):
      continue
    ind_type = str(ind.get("type") or "").upper()
    params = ind.get("params")
    if not isinstance(params, dict):
      params = {}
      ind["params"] = params

    if ind_type in ("SMA", "MA"):
      params["window"] = f"{ma_days}d"
    elif ind_type == "MACD":
      params["fast"] = macd_fast
      params["slow"] = macd_slow
      params["signal"] = macd_signal

  return draft


def _rewrite_ref_id(raw: Any, id_map: dict[str, str]) -> Any:
  if not isinstance(raw, str):
    return raw
  base_and_field, *at_tf = raw.split("@", 1)
  base, *field = base_and_field.split(".", 1)
  new_base = id_map.get(base, base)
  out = new_base
  if field:
    out += f".{field[0]}"
  if at_tf:
    out += f"@{at_tf[0]}"
  return out


def _normalize_indicator_ids(draft: dict[str, Any]) -> dict[str, Any]:
  dsl = draft.get("dsl")
  if not isinstance(dsl, dict):
    return draft
  signal = dsl.get("signal")
  if not isinstance(signal, dict):
    return draft
  indicators = signal.get("indicators")
  events = signal.get("events")
  if not isinstance(indicators, list):
    return draft

  id_map: dict[str, str] = {}
  used: set[str] = set()

  for ind in indicators:
    if not isinstance(ind, dict):
      continue
    old_id = str(ind.get("id") or "").strip()
    ind_type = str(ind.get("type") or "").strip().upper()
    tf = str(ind.get("tf") or "").strip().lower() or "na"
    params = ind.get("params")
    if not isinstance(params, dict):
      params = {}
    candidate = old_id or "indicator"
    if ind_type in ("SMA", "MA"):
      window = str(params.get("window") or "").strip().lower() or "na"
      candidate = f"{ind_type.lower()}_{window}_{tf}"
    elif ind_type == "MACD":
      fast = int(params.get("fast") or 12)
      slow = int(params.get("slow") or 26)
      signal_n = int(params.get("signal") or 9)
      candidate = f"macd_{fast}_{slow}_{signal_n}_{tf}"
    elif ind_type == "CLOSE":
      symbol_ref = str(ind.get("symbol_ref") or "signal").strip().lower() or "signal"
      candidate = f"close_{symbol_ref}_{tf}"

    base = candidate.replace(" ", "_")
    new_id = base
    seq = 2
    while new_id in used:
      new_id = f"{base}_{seq}"
      seq += 1
    used.add(new_id)
    ind["id"] = new_id
    if old_id and old_id != new_id:
      id_map[old_id] = new_id

  if id_map and isinstance(events, list):
    for ev in events:
      if not isinstance(ev, dict):
        continue
      for key in ("a", "b", "left", "right"):
        ev[key] = _rewrite_ref_id(ev.get(key), id_map)

  return draft


def _split_ref(raw: str) -> tuple[str, str | None, str | None]:
  base_and_field, *at_tf = raw.split("@", 1)
  base, *field = base_and_field.split(".", 1)
  return base, (field[0] if field else None), (at_tf[0] if at_tf else None)


def _join_ref(base: str, field: str | None, at_tf: str | None) -> str:
  out = base
  if field:
    out = f"{out}.{field}"
  if at_tf:
    out = f"{out}@{at_tf}"
  return out


def _normalize_macd_cross_events(draft: dict[str, Any]) -> dict[str, Any]:
  dsl = draft.get("dsl")
  if not isinstance(dsl, dict):
    return draft
  signal = dsl.get("signal")
  if not isinstance(signal, dict):
    return draft
  indicators = signal.get("indicators")
  events = signal.get("events")
  if not isinstance(indicators, list) or not isinstance(events, list):
    return draft

  ind_by_id: dict[str, dict[str, Any]] = {}
  macd_canonical_by_sig: dict[tuple[str, str, int, int, int], str] = {}
  for ind in indicators:
    if not isinstance(ind, dict):
      continue
    ind_id = str(ind.get("id") or "").strip()
    if not ind_id:
      continue
    ind_by_id[ind_id] = ind
    if str(ind.get("type") or "").upper() != "MACD":
      continue
    params = ind.get("params") if isinstance(ind.get("params"), dict) else {}
    sig = (
      str(ind.get("tf") or "").lower(),
      str(ind.get("symbol_ref") or "signal").lower(),
      int(params.get("fast") or 12),
      int(params.get("slow") or 26),
      int(params.get("signal") or 9),
    )
    if sig not in macd_canonical_by_sig:
      macd_canonical_by_sig[sig] = ind_id

  for ev in events:
    if not isinstance(ev, dict):
      continue
    ev_type = str(ev.get("type") or "").upper()
    if ev_type not in ("CROSS", "CROSS_UP", "CROSS_DOWN"):
      continue
    a_raw = ev.get("a")
    b_raw = ev.get("b")
    if not isinstance(a_raw, str) or not isinstance(b_raw, str):
      continue

    a_base, a_field, a_tf = _split_ref(a_raw)
    b_base, b_field, b_tf = _split_ref(b_raw)
    a_ind = ind_by_id.get(a_base)
    b_ind = ind_by_id.get(b_base)

    def _canonical_id(ind: dict[str, Any], fallback: str) -> str:
      params = ind.get("params") if isinstance(ind.get("params"), dict) else {}
      sig = (
        str(ind.get("tf") or "").lower(),
        str(ind.get("symbol_ref") or "signal").lower(),
        int(params.get("fast") or 12),
        int(params.get("slow") or 26),
        int(params.get("signal") or 9),
      )
      return macd_canonical_by_sig.get(sig, fallback)

    if isinstance(a_ind, dict) and str(a_ind.get("type") or "").upper() == "MACD":
      a_base = _canonical_id(a_ind, a_base)
      if not a_field:
        a_field = "macd"
    if isinstance(b_ind, dict) and str(b_ind.get("type") or "").upper() == "MACD":
      b_base = _canonical_id(b_ind, b_base)
      if not b_field:
        b_field = "signal"

    if a_base == b_base and a_field == b_field:
      # ensure cross compares two distinct MACD components
      b_field = "signal" if a_field != "signal" else "macd"

    ev["a"] = _join_ref(a_base, a_field, a_tf)
    ev["b"] = _join_ref(b_base, b_field, b_tf)

  return draft


def _extract_core_symbols(nl_text: str) -> tuple[str, str]:
  text = nl_text.upper()
  tokens = re.findall(r"[A-Z]{2,6}", text)
  ignored = {"MACD", "MA", "AND", "OR", "THEN", "SELL", "BUY", "WHEN"}
  candidates = [t for t in tokens if t not in ignored]

  trade_match = re.search(r"(?:清仓|减仓|卖出|SELL|LIQUIDATE)(?:\s*\d+(?:\.\d+)?%?)?\s*([A-Z]{2,6})", text, flags=re.IGNORECASE)
  trade_symbol = trade_match.group(1).upper() if trade_match else (candidates[1] if len(candidates) > 1 else (candidates[0] if candidates else "QQQ"))
  signal_match = re.search(r"([A-Z]{2,6})\s*(?:4H|4小时|日线|1D)\s*MACD", text, flags=re.IGNORECASE)
  if signal_match:
    signal_symbol = signal_match.group(1).upper()
  else:
    signal_symbol = next((c for c in candidates if c != trade_symbol), candidates[0] if candidates else "QQQ")

  if not trade_symbol:
    trade_symbol = signal_symbol
  return signal_symbol, trade_symbol


def _extract_ma_windows(nl_text: str) -> list[int]:
  matches = re.findall(r"(\d+)\s*(?:日|DAY)\s*MA", nl_text, flags=re.IGNORECASE)
  out: list[int] = []
  for item in matches:
    try:
      out.append(max(1, int(item)))
    except Exception:
      continue
  return out


def _extract_reduce_pct(nl_text: str) -> float:
  m = re.search(r"(?:减仓|SELL)\s*(\d{1,3})\s*%", nl_text, flags=re.IGNORECASE)
  if not m:
    return 0.35
  try:
    pct = float(m.group(1)) / 100.0
    return min(max(pct, 0.01), 1.0)
  except Exception:
    return 0.35


def _make_indicator(*, ind_id: str, ind_type: str, tf: str, symbol_ref: str, **params: Any) -> dict[str, Any]:
  return {
    "id": ind_id,
    "type": ind_type,
    "tf": tf,
    "symbol_ref": symbol_ref,
    "align": "LAST_CLOSED",
    "params": {
      "fast": params.get("fast"),
      "slow": params.get("slow"),
      "signal": params.get("signal"),
      "window": params.get("window"),
      "bar_selection": params.get("bar_selection"),
    },
  }


def _make_cross_event(*, event_id: str, a: str, b: str, direction: str, tf: str) -> dict[str, Any]:
  return {
    "id": event_id,
    "type": "CROSS_DOWN" if direction == "DOWN" else "CROSS_UP" if direction == "UP" else "CROSS",
    "a": a,
    "b": b,
    "left": None,
    "right": None,
    "direction": direction,
    "op": None,
    "value": None,
    "tf": tf,
  }


def _make_threshold_event(*, event_id: str, left: str, right: str, op: str = "<", tf: str = "1d") -> dict[str, Any]:
  return {
    "id": event_id,
    "type": "THRESHOLD",
    "a": None,
    "b": None,
    "left": left,
    "right": right,
    "direction": None,
    "op": op,
    "value": None,
    "tf": tf,
  }


def _make_order_action(*, action_id: str, side: str, qty_mode: str, qty_value: float) -> dict[str, Any]:
  return {
    "id": action_id,
    "type": "ORDER",
    "symbol_ref": "trade",
    "side": side,
    "qty": {"mode": qty_mode, "value": qty_value},
    "order_type": "MOC",
    "time_in_force": None,
    "idempotency_scope": "SYMBOL_ACTION",
    "cooldown": "1d",
  }


def _make_set_flag_action(*, action_id: str, flag: str) -> dict[str, Any]:
  return {
    "id": action_id,
    "type": "SET_FLAG",
    "flag": flag,
    "cooldown": None,
  }


def _build_semantic_template_draft(
  nl_text: str,
  indicator_preferences: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
  text = nl_text.strip()
  text_lower = text.lower()
  if "macd" not in text_lower:
    return None
  if not any(k in text for k in ["清仓", "减仓"]) and not any(k in text_lower for k in ["liquidate", "sell"]):
    return None

  signal_symbol, trade_symbol = _extract_core_symbols(text)
  ma_windows = _extract_ma_windows(text)
  first_ma = ma_windows[0] if ma_windows else 5
  second_ma = ma_windows[1] if len(ma_windows) > 1 else 20
  reduce_pct = _extract_reduce_pct(text)
  has_then = ("然后" in text) or (" then " in f" {text_lower} ")

  draft: dict[str, Any] = {
    "name": text[:80] if len(text) <= 80 else f"{text[:77]}...",
    "universe": {"signal_symbol": signal_symbol, "trade_symbol": trade_symbol},
    "risk": {"cooldown": {"scope": "SYMBOL_ACTION", "value": "1d"}, "max_orders_per_day": 4},
    "dsl": {
      "atomic": {
        "symbols": {"signal": signal_symbol, "trade": trade_symbol},
        "constants": {"lookback": "5d", "sell_fraction": reduce_pct, "initial_position_qty": 100.0, "initial_cash": 0.0},
      },
      "time": {
        "primary_tf": "1m",
        "derived_tfs": ["4h", "1d"],
        "aggregation": {"4h": "SESSION_ALIGNED_4H", "1d": "SESSION_ALIGNED_1D"},
      },
      "signal": {"indicators": [], "events": []},
      "logic": {"rules": []},
      "action": {"actions": []},
    },
  }

  indicators = [
    _make_indicator(ind_id="macd_4h", ind_type="MACD", tf="4h", symbol_ref="signal", fast=12, slow=26, signal=9),
    _make_indicator(ind_id=f"ma_{first_ma}_1d", ind_type="MA", tf="1d", symbol_ref="signal", window=f"{first_ma}d", bar_selection="LAST_CLOSED_1D"),
    _make_indicator(ind_id="close_1d", ind_type="CLOSE", tf="1d", symbol_ref="signal", bar_selection="LAST_CLOSED_1D"),
  ]
  events = [
    _make_cross_event(event_id="ev_macd_4h_dead_cross", a="macd_4h.macd", b="macd_4h.signal", direction="DOWN", tf="4h"),
    _make_threshold_event(event_id=f"ev_below_ma_{first_ma}", left="close_1d.value", right=f"ma_{first_ma}_1d.value", op="<", tf="1d"),
  ]

  actions = []
  rules = []

  if has_then and ("减仓" in text or "sell" in text_lower):
    indicators.extend(
      [
        _make_indicator(ind_id="macd_1d", ind_type="MACD", tf="1d", symbol_ref="signal", fast=12, slow=26, signal=9),
        _make_indicator(ind_id=f"ma_{second_ma}_1d", ind_type="MA", tf="1d", symbol_ref="signal", window=f"{second_ma}d", bar_selection="LAST_CLOSED_1D"),
      ]
    )
    events.extend(
      [
        _make_cross_event(event_id="ev_macd_1d_dead_cross", a="macd_1d.macd", b="macd_1d.signal", direction="DOWN", tf="1d"),
        _make_threshold_event(event_id=f"ev_below_ma_{second_ma}", left="close_1d.value", right=f"ma_{second_ma}_1d.value", op="<", tf="1d"),
      ]
    )
    actions.extend(
      [
        _make_order_action(action_id="sell_partial", side="SELL", qty_mode="FRACTION_OF_POSITION", qty_value=reduce_pct),
        _make_set_flag_action(action_id="set_stage1_done", flag="stage1_done"),
        _make_order_action(action_id="sell_all", side="SELL", qty_mode="FULL_POSITION", qty_value=1.0),
      ]
    )
    rules.extend(
      [
        {
          "id": "rule_stage1_partial_reduce",
          "when": {"all": [{"event_id": "ev_macd_4h_dead_cross", "scope": "BAR"}, {"event_id": f"ev_below_ma_{first_ma}", "scope": "BAR"}]},
          "then": [{"action_id": "sell_partial"}, {"action_id": "set_stage1_done"}],
        },
        {
          "id": "rule_stage2_full_exit",
          "when": {
            "all": [
              {"flag_is_true": {"flag": "stage1_done"}},
              {"event_id": "ev_macd_1d_dead_cross", "scope": "BAR"},
              {"event_id": f"ev_below_ma_{second_ma}", "scope": "BAR"},
            ]
          },
          "then": [{"action_id": "sell_all"}],
        },
      ]
    )
  else:
    actions.append(_make_order_action(action_id="sell_all", side="SELL", qty_mode="FULL_POSITION", qty_value=1.0))
    rules.append(
      {
        "id": "rule_single_full_exit",
        "when": {"all": [{"event_id": "ev_macd_4h_dead_cross", "scope": "BAR"}, {"event_id": f"ev_below_ma_{first_ma}", "scope": "BAR"}]},
        "then": [{"action_id": "sell_all"}],
      }
    )

  draft["dsl"]["signal"]["indicators"] = indicators
  draft["dsl"]["signal"]["events"] = events
  draft["dsl"]["logic"]["rules"] = rules
  draft["dsl"]["action"]["actions"] = actions

  return _apply_indicator_preferences_to_draft(draft, indicator_preferences)


def _canonicalize_draft_shape(draft: dict[str, Any]) -> dict[str, Any]:
  out = dict(draft)
  out.setdefault("name", "Untitled Strategy")
  out.setdefault("universe", {"signal_symbol": "QQQ", "trade_symbol": "TQQQ"})
  out.setdefault("risk", {"cooldown": {"scope": "SYMBOL_ACTION", "value": "1d"}, "max_orders_per_day": 1})

  dsl = out.get("dsl")
  if not isinstance(dsl, dict):
    dsl = {}
  atomic = dsl.get("atomic") if isinstance(dsl.get("atomic"), dict) else {}
  time_layer = dsl.get("time") if isinstance(dsl.get("time"), dict) else {}
  signal = dsl.get("signal") if isinstance(dsl.get("signal"), dict) else {}
  logic = dsl.get("logic") if isinstance(dsl.get("logic"), dict) else {}
  action = dsl.get("action") if isinstance(dsl.get("action"), dict) else {}

  atomic.setdefault("symbols", {"signal": (out.get("universe") or {}).get("signal_symbol", "QQQ"), "trade": (out.get("universe") or {}).get("trade_symbol", "TQQQ")})
  atomic.setdefault("constants", {"lookback": "5d", "sell_fraction": 0.25, "initial_position_qty": 100.0, "initial_cash": 0.0})
  time_layer.setdefault("primary_tf", "1m")
  time_layer.setdefault("derived_tfs", ["4h", "1d"])
  time_layer.setdefault("aggregation", {"4h": "SESSION_ALIGNED_4H", "1d": "SESSION_ALIGNED_1D"})

  indicators = signal.get("indicators") if isinstance(signal.get("indicators"), list) else []
  for ind in indicators:
    if not isinstance(ind, dict):
      continue
    ind.setdefault("align", "LAST_CLOSED")
    params = ind.get("params") if isinstance(ind.get("params"), dict) else {}
    params.setdefault("fast", None)
    params.setdefault("slow", None)
    params.setdefault("signal", None)
    params.setdefault("window", None)
    params.setdefault("bar_selection", None)
    ind["params"] = params

  events = signal.get("events") if isinstance(signal.get("events"), list) else []
  for ev in events:
    if not isinstance(ev, dict):
      continue
    ev.setdefault("a", None)
    ev.setdefault("b", None)
    ev.setdefault("left", None)
    ev.setdefault("right", None)
    ev.setdefault("direction", None)
    ev.setdefault("op", None)
    ev.setdefault("value", None)
    ev.setdefault("tf", None)

  actions = action.get("actions") if isinstance(action.get("actions"), list) else []
  for act in actions:
    if not isinstance(act, dict):
      continue
    act.setdefault("type", "ORDER")
    if str(act.get("type") or "").upper() == "ORDER":
      act.setdefault("symbol_ref", "trade")
      act.setdefault("side", "SELL")
      qty = act.get("qty") if isinstance(act.get("qty"), dict) else {}
      qty.setdefault("mode", "FRACTION_OF_POSITION")
      qty.setdefault("value", 0.25)
      act["qty"] = qty
      act.setdefault("order_type", "MOC")
      act.setdefault("time_in_force", None)
      act.setdefault("idempotency_scope", "SYMBOL_ACTION")
    act.setdefault("cooldown", "1d")

  signal["indicators"] = indicators
  signal["events"] = events
  logic.setdefault("rules", logic.get("rules") if isinstance(logic.get("rules"), list) else [])
  action["actions"] = actions
  dsl["atomic"] = atomic
  dsl["time"] = time_layer
  dsl["signal"] = signal
  dsl["logic"] = logic
  dsl["action"] = action
  out["dsl"] = dsl
  return out


def _validate_compiled_spec(spec: dict[str, Any]) -> None:
  universe = spec.get("universe") if isinstance(spec.get("universe"), dict) else {}
  if not str(universe.get("signal_symbol") or "").strip() or not str(universe.get("trade_symbol") or "").strip():
    raise AppError("VALIDATION_ERROR", "universe.signal_symbol and universe.trade_symbol are required", {})

  dsl = spec.get("dsl") if isinstance(spec.get("dsl"), dict) else {}
  signal = dsl.get("signal") if isinstance(dsl.get("signal"), dict) else {}
  logic = dsl.get("logic") if isinstance(dsl.get("logic"), dict) else {}
  action = dsl.get("action") if isinstance(dsl.get("action"), dict) else {}
  indicators = signal.get("indicators") if isinstance(signal.get("indicators"), list) else []
  events = signal.get("events") if isinstance(signal.get("events"), list) else []
  rules = logic.get("rules") if isinstance(logic.get("rules"), list) else []
  actions = action.get("actions") if isinstance(action.get("actions"), list) else []
  if not indicators or not events or not rules or not actions:
    raise AppError("VALIDATION_ERROR", "dsl indicators/events/rules/actions must be non-empty", {})

  indicator_ids = {str(i.get("id") or "").strip() for i in indicators if isinstance(i, dict)}
  indicator_ids = {x for x in indicator_ids if x}
  event_ids = {str(e.get("id") or "").strip() for e in events if isinstance(e, dict)}
  event_ids = {x for x in event_ids if x}
  action_ids = {str(a.get("id") or "").strip() for a in actions if isinstance(a, dict)}
  action_ids = {x for x in action_ids if x}
  if not indicator_ids or not event_ids or not action_ids:
    raise AppError("VALIDATION_ERROR", "dsl ids are missing", {})

  for ev in events:
    if not isinstance(ev, dict):
      continue
    ev_type = str(ev.get("type") or "").upper()
    if ev_type in ("CROSS", "CROSS_UP", "CROSS_DOWN"):
      for key in ("a", "b"):
        ref = str(ev.get(key) or "").strip()
        ref_id = ref.split("@", 1)[0].split(".", 1)[0]
        if not ref_id or ref_id not in indicator_ids:
          raise AppError("VALIDATION_ERROR", "cross event references unknown indicator", {"event_id": ev.get("id"), "ref": ref})
    if ev_type == "THRESHOLD":
      left_ref = str(ev.get("left") or "").strip()
      right_ref = str(ev.get("right") or "").strip()
      for ref in (left_ref, right_ref):
        if not ref:
          continue
        ref_id = ref.split("@", 1)[0].split(".", 1)[0]
        if ref_id not in indicator_ids:
          raise AppError("VALIDATION_ERROR", "threshold event references unknown indicator", {"event_id": ev.get("id"), "ref": ref})

  def _validate_condition_node(node: Any) -> None:
    if not isinstance(node, dict):
      raise AppError("VALIDATION_ERROR", "invalid rule condition node", {"condition": node})
    if "all" in node and isinstance(node.get("all"), list):
      for child in node["all"]:
        _validate_condition_node(child)
      return
    if "any" in node and isinstance(node.get("any"), list):
      for child in node["any"]:
        _validate_condition_node(child)
      return
    if "event_within" in node and isinstance(node.get("event_within"), dict):
      event_id = str((node.get("event_within") or {}).get("event_id") or "").strip()
      if event_id not in event_ids:
        raise AppError("VALIDATION_ERROR", "event_within references unknown event", {"event_id": event_id})
      return
    if "event_id" in node:
      event_id = str(node.get("event_id") or "").strip()
      if event_id not in event_ids:
        raise AppError("VALIDATION_ERROR", "condition references unknown event", {"event_id": event_id})
      return
    if "flag_is_true" in node and isinstance(node.get("flag_is_true"), dict):
      if not str((node.get("flag_is_true") or {}).get("flag") or "").strip():
        raise AppError("VALIDATION_ERROR", "flag condition requires non-empty flag", {})
      return
    if "lt" in node or "gt" in node or "op" in node:
      return
    raise AppError("VALIDATION_ERROR", "unsupported condition structure", {"condition": node})

  for rule in rules:
    if not isinstance(rule, dict):
      continue
    _validate_condition_node(rule.get("when"))
    then = rule.get("then")
    if not isinstance(then, list) or not then:
      raise AppError("VALIDATION_ERROR", "rule.then must be non-empty", {"rule_id": rule.get("id")})
    for item in then:
      action_id = str(item.get("action_id") if isinstance(item, dict) else item or "").strip()
      if action_id not in action_ids:
        raise AppError("VALIDATION_ERROR", "rule references unknown action", {"rule_id": rule.get("id"), "action_id": action_id})


async def nl_to_strategy_spec(
  nl_text: str,
  mode: Literal["BACKTEST_ONLY", "PAPER", "LIVE"],
  overrides: dict[str, Any] | None = None,
  indicator_preferences: dict[str, Any] | None = None,
) -> dict[str, Any]:
  semantic_draft = _build_semantic_template_draft(nl_text, indicator_preferences)
  if isinstance(semantic_draft, dict):
    semantic_draft = _canonicalize_draft_shape(semantic_draft)
    semantic_draft = _normalize_indicator_ids(semantic_draft)
    semantic_draft = _normalize_macd_cross_events(semantic_draft)
    spec = _assemble_final_strategy_spec(draft=semantic_draft, nl_text=nl_text, mode=mode)
    if overrides and isinstance(overrides, dict):
      spec = _deep_merge(spec, overrides)
    spec["strategy_version"] = "v0"
    meta = spec.get("meta")
    if isinstance(meta, dict):
      meta["llm_attempts"] = 0
      meta["generation_mode"] = "semantic_template"
      if isinstance(indicator_preferences, dict):
        meta["indicator_preferences"] = indicator_preferences
    _validate_compiled_spec(spec)
    return spec

  pref_context = _build_indicator_preferences_context(indicator_preferences)
  base_prompt = f"""User natural language strategy description: "{nl_text}"
Additional context:
- mode: "{mode}"
{pref_context}
Task:
Return ONLY StrategyDraft JSON with fields: name, universe, risk, dsl.
Do not include system fields like timezone/calendar/decision/execution/meta/strategy_id/strategy_version.
The output MUST be executable and must not contain empty indicators/events/rules/actions arrays.
"""
  max_attempts = max(1, int(settings.llm_semantic_repair_attempts) + 1)
  prompt_for_attempt = base_prompt
  last_error: AppError | None = None

  for attempt in range(max_attempts):
    llm_draft = await llm_client.chat_json(
      SYSTEM_PROMPT_V0,
      prompt_for_attempt,
      schema_name="strategy_draft",
      json_schema=STRATEGY_DRAFT_JSON_SCHEMA,
      strict_schema=True,
    )
    if not isinstance(llm_draft, dict):
      raise AppError("VALIDATION_ERROR", "LLM did not return object StrategyDraft", {"type": str(type(llm_draft))})

    adjusted_draft = _canonicalize_draft_shape(dict(llm_draft))
    adjusted_draft = _apply_indicator_preferences_to_draft(adjusted_draft, indicator_preferences)
    adjusted_draft = _normalize_indicator_ids(adjusted_draft)
    adjusted_draft = _normalize_macd_cross_events(adjusted_draft)
    spec = _assemble_final_strategy_spec(draft=adjusted_draft, nl_text=nl_text, mode=mode)
    if overrides and isinstance(overrides, dict):
      spec = _deep_merge(spec, overrides)
    spec["strategy_version"] = "v0"
    meta = spec.get("meta")
    if isinstance(meta, dict):
      meta["llm_attempts"] = attempt + 1
      meta["generation_mode"] = "llm"
      if isinstance(indicator_preferences, dict):
        meta["indicator_preferences"] = indicator_preferences
    try:
      _validate_compiled_spec(spec)
      return spec
    except AppError as err:
      last_error = err
      if attempt + 1 >= max_attempts:
        raise
      prompt_for_attempt = _build_repair_prompt(nl_text, mode, adjusted_draft, err)
      continue

  if last_error is not None:
    raise last_error
  raise AppError("INTERNAL", "Unexpected parser state", {})
