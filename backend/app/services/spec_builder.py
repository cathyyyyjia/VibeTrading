from __future__ import annotations

import json
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
                        ],
                      },
                      "value": {"type": "number"},
                    },
                  },
                },
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


async def nl_to_strategy_spec(
  nl_text: str,
  mode: Literal["BACKTEST_ONLY", "PAPER", "LIVE"],
  overrides: dict[str, Any] | None = None,
  indicator_preferences: dict[str, Any] | None = None,
) -> dict[str, Any]:
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

    adjusted_draft = _apply_indicator_preferences_to_draft(dict(llm_draft), indicator_preferences)
    adjusted_draft = _normalize_indicator_ids(adjusted_draft)
    adjusted_draft = _normalize_macd_cross_events(adjusted_draft)
    spec = _assemble_final_strategy_spec(draft=adjusted_draft, nl_text=nl_text, mode=mode)
    if overrides and isinstance(overrides, dict):
      spec = _deep_merge(spec, overrides)
    spec["strategy_version"] = "v0"
    meta = spec.get("meta")
    if isinstance(meta, dict):
      meta["llm_attempts"] = attempt + 1
      if isinstance(indicator_preferences, dict):
        meta["indicator_preferences"] = indicator_preferences
    return spec

  if last_error is not None:
    raise last_error
  raise AppError("INTERNAL", "Unexpected parser state", {})
