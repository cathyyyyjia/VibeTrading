from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Literal

from app.services.llm_client import llm_client
from app.services.spec_validator import enforce_hard_rules, validate_strategy_spec_minimal


SYSTEM_PROMPT_V0 = """You are a trading strategy compiler.
Your job:
- Convert natural language trading strategy descriptions into a STRICT JSON object called StrategySpec.
- StrategySpec MUST be fully specified and valid according to the provided rules.
- You are NOT allowed to leave fields ambiguous or "to be defined later".

VERY IMPORTANT:
- You MUST obey all "Hard Rules" below, even if the user's description is ambiguous or contradicts them.
- If the user description conflicts with a Hard Rule, you MUST follow the Hard Rule and still produce a consistent StrategySpec.

Hard Rules (Vibe Trading v0):
1) Timezone is always "America/New_York".
2) Exchange calendar is always "XNYS" (US equities).
3) Decision time is always "market_close - 2 minutes".
4) Execution model is always "MOC" (Market-On-Close).
5) MA5 definition is FIXED: based on LAST_CLOSED 1D bars (end of yesterday's session). Never use today's partially formed 1D bar for MA5.
6) Timeframes:
   - Primary timeframe: 1m.
   - 4h and 1d bars MUST be aggregated from 1m data.
   - 4h bars are aligned to the trading session (SESSION_ALIGNED_4H), starting from session open.
7) Multi-timeframe alignment at decision time:
   - 1m values use the last closed 1m bar at or before decision time.
   - 4h indicators use the last CLOSED 4h bar (carry-forward semantics).
   - 1d indicators use LAST_CLOSED_1D (yesterday's close).
8) Lookback windows MUST always include units, such as "5d", "20bars@4h", or { "tf": "4h", "bars": 5 }. Bare integers without units are NOT allowed.
9) Signals MUST NOT use future information: only fully closed bars as of decision time.

Events:
- CROSS events are edge-triggered: a MACD bearish cross is TRUE only at the bar where MACD crosses below its signal.
- It is NOT a persistent boolean state.
- For CROSS/CROSS_DOWN/CROSS_UP events:
  - Use event.a and event.b as indicator field refs, e.g. "macd_4h.macd" and "macd_4h.signal".
  - Set left/right/op/value to null.
- For THRESHOLD events:
  - Use event.left, event.right, and event.op.
  - Set a/b/direction/value to null.

Output instructions:
- Output ONLY the JSON object.
- MUST be valid JSON, parsable, with no comments.
"""

STRATEGY_SPEC_JSON_SCHEMA: dict[str, Any] = {
  "type": "object",
  "additionalProperties": False,
  "required": [
    "name",
    "timezone",
    "calendar",
    "universe",
    "decision",
    "execution",
    "risk",
    "dsl",
    "meta",
  ],
  "properties": {
    "name": {"type": "string"},
    "timezone": {"type": "string", "const": "America/New_York"},
    "calendar": {
      "type": "object",
      "required": ["type", "value"],
      "additionalProperties": False,
      "properties": {
        "type": {"type": "string", "const": "exchange"},
        "value": {"type": "string", "const": "XNYS"},
      },
    },
    "universe": {
      "type": "object",
      "required": ["signal_symbol", "trade_symbol"],
      "additionalProperties": False,
      "properties": {
        "signal_symbol": {"type": "string"},
        "signal_symbol_fallbacks": {
          "type": "array",
          "items": {"type": "string"},
        },
        "trade_symbol": {"type": "string"},
      },
      "required": ["signal_symbol", "signal_symbol_fallbacks", "trade_symbol"],
    },
    "decision": {
      "type": "object",
      "required": ["decision_time_rule"],
      "additionalProperties": False,
      "properties": {
        "decision_time_rule": {
          "type": "object",
          "required": ["type", "offset"],
          "additionalProperties": False,
          "properties": {
            "type": {"type": "string", "const": "MARKET_CLOSE_OFFSET"},
            "offset": {"type": "string", "const": "-2m"},
          },
        },
      },
    },
    "execution": {
      "type": "object",
      "required": ["model", "slippage_bps", "commission_per_trade"],
      "additionalProperties": False,
      "properties": {
        "model": {"type": "string", "enum": ["MOC"]},
        "slippage_bps": {"type": "number"},
        "commission_per_trade": {"type": "number"},
      },
    },
    "risk": {
      "type": "object",
      "additionalProperties": False,
      "required": ["cooldown", "max_orders_per_day"],
      "properties": {
        "cooldown": {
          "type": "object",
          "required": ["scope", "value"],
          "additionalProperties": False,
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
      "required": ["atomic", "time", "signal", "logic", "action"],
      "additionalProperties": False,
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
              "required": ["sell_fraction", "lookback"],
              "properties": {
                "sell_fraction": {"type": "number"},
                "lookback": {"type": ["string", "null"]},
              },
            },
          },
        },
        "time": {
          "type": "object",
          "required": ["primary_tf", "derived_tfs", "aggregation"],
          "additionalProperties": False,
          "properties": {
            "primary_tf": {"type": "string", "enum": ["1m"]},
            "derived_tfs": {
              "type": "array",
              "items": {"type": "string", "enum": ["4h", "1d"]},
            },
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
          "required": ["indicators", "events"],
          "additionalProperties": False,
          "properties": {
            "indicators": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["id", "symbol_ref", "tf", "type", "params", "align"],
                "additionalProperties": False,
                "properties": {
                  "id": {"type": "string"},
                  "symbol_ref": {"type": "string"},
                  "tf": {"type": "string", "enum": ["1m", "4h", "1d"]},
                  "type": {"type": "string", "enum": ["MACD", "SMA", "MA", "CLOSE"]},
                  "params": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["fast", "slow", "signal", "window", "bar_selection"],
                    "properties": {
                      "fast": {"type": ["integer", "null"]},
                      "slow": {"type": ["integer", "null"]},
                      "signal": {"type": ["integer", "null"]},
                      "window": {"type": ["string", "null"]},
                      "bar_selection": {"type": ["string", "null"], "enum": ["LAST_CLOSED_1D", None]},
                    },
                  },
                  "align": {"type": "string", "enum": ["LAST_CLOSED", "CARRY_FORWARD"]},
                },
              },
            },
            "events": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["id", "type", "a", "b", "left", "right", "direction", "op", "tf"],
                "additionalProperties": False,
                "properties": {
                  "id": {"type": "string"},
                  "type": {"type": "string", "enum": ["CROSS", "CROSS_UP", "CROSS_DOWN", "THRESHOLD"]},
                  "a": {"type": ["string", "null"]},
                  "b": {"type": ["string", "null"]},
                  "left": {"type": ["string", "null"]},
                  "right": {"type": ["string", "null"]},
                  "direction": {"type": ["string", "null"], "enum": ["UP", "DOWN", "ANY", None]},
                  "op": {"type": ["string", "null"], "enum": ["<", "<=", ">", ">=", "==", "!=", None]},
                  "tf": {"type": ["string", "null"], "enum": ["1m", "4h", "1d", None]},
                },
              },
            },
          },
        },
        "logic": {
          "type": "object",
          "required": ["rules"],
          "additionalProperties": False,
          "properties": {
            "rules": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["id", "when", "then"],
                "additionalProperties": False,
                "properties": {
                  "id": {"type": "string"},
                  "when": {"$ref": "#/$defs/LogicCondition"},
                  "then": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "required": ["action_id"],
                      "additionalProperties": False,
                      "properties": {
                        "action_id": {"type": "string"},
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "action": {
          "type": "object",
          "required": ["actions"],
          "additionalProperties": False,
          "properties": {
            "actions": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["id", "type", "symbol_ref", "side", "qty", "order_type"],
                "additionalProperties": False,
                "properties": {
                  "id": {"type": "string"},
                  "type": {"type": "string", "enum": ["ORDER"]},
                  "symbol_ref": {"type": "string"},
                  "side": {"type": "string", "enum": ["BUY", "SELL"]},
                  "qty": {
                    "type": "object",
                    "required": ["mode", "value"],
                    "additionalProperties": False,
                    "properties": {
                      "mode": {
                        "type": ["string", "null"],
                        "enum": [
                          "FRACTION_OF_POSITION",
                          "ABSOLUTE",
                          "NOTIONAL_USD",
                          "FIXED",
                          "FIXED_SHARES",
                          "SHARES",
                          "FRACTION_OF_CASH",
                          "FRACTION_OF_EQUITY",
                          None,
                        ],
                      },
                      "value": {"type": ["number", "null"]},
                    },
                  },
                  "order_type": {"type": "string", "enum": ["MOC"]},
                  "time_in_force": {"type": ["string", "null"], "enum": ["DAY", None]},
                  "cooldown": {"type": ["string", "null"]},
                  "idempotency_scope": {"type": ["string", "null"], "enum": ["DECISION_DAY", None]},
                },
                "required": ["id", "type", "symbol_ref", "side", "qty", "order_type", "time_in_force", "cooldown", "idempotency_scope"],
              },
            },
          },
        },
      },
    },
    "meta": {
      "type": "object",
      "additionalProperties": False,
      "required": ["created_at", "author", "notes", "mode"],
      "properties": {
        "created_at": {"type": ["string", "null"]},
        "author": {"type": ["string", "null"]},
        "notes": {"type": ["string", "null"]},
        "mode": {"type": "string", "enum": ["BACKTEST_ONLY", "PAPER", "LIVE"]},
      },
    },
  },
  "$defs": {
    "LogicCondition": {
      "anyOf": [
        {
          "type": "object",
          "required": ["all"],
          "additionalProperties": False,
          "properties": {
            "all": {"type": "array", "items": {"$ref": "#/$defs/LogicCondition"}},
          },
        },
        {
          "type": "object",
          "required": ["any"],
          "additionalProperties": False,
          "properties": {
            "any": {"type": "array", "items": {"$ref": "#/$defs/LogicCondition"}},
          },
        },
        {
          "type": "object",
          "required": ["event_within"],
          "additionalProperties": False,
          "properties": {
            "event_within": {
              "type": "object",
              "required": ["event_id", "lookback"],
              "additionalProperties": False,
              "properties": {
                "event_id": {"type": "string"},
                "lookback": {"type": "string"},
              },
            },
          },
        },
        {
          "type": "object",
          "required": ["event_id"],
          "additionalProperties": False,
          "properties": {
            "event_id": {"type": "string"},
            "scope": {"type": ["string", "null"], "enum": ["LAST_CLOSED_4H_BAR", "LAST_CLOSED_1D", "BAR", "", None]},
          },
          "required": ["event_id", "scope"],
        },
        {
          "type": "object",
          "required": ["lt"],
          "additionalProperties": False,
          "properties": {
            "lt": {
              "type": "object",
              "required": ["a", "b"],
              "additionalProperties": False,
              "properties": {
                "a": {"type": ["string", "number"]},
                "b": {"type": ["string", "number"]},
              },
            },
          },
        },
        {
          "type": "object",
          "required": ["gt"],
          "additionalProperties": False,
          "properties": {
            "gt": {
              "type": "object",
              "required": ["a", "b"],
              "additionalProperties": False,
              "properties": {
                "a": {"type": ["string", "number"]},
                "b": {"type": ["string", "number"]},
              },
            },
          },
        },
        {
          "type": "object",
          "required": ["op", "left", "right"],
          "additionalProperties": False,
          "properties": {
            "op": {"type": "string", "enum": ["<", "<=", ">", ">=", "==", "!="]},
            "left": {"type": ["string", "number"]},
            "right": {"type": ["string", "number"]},
          },
        },
      ]
    },
  },
}


def _canonical_json(obj: Any) -> str:
  return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_strategy_version(spec: dict[str, Any]) -> str:
  raw = _canonical_json(spec).encode("utf-8")
  return hashlib.sha256(raw).hexdigest()[:32]


def _deep_merge(base: Any, incoming: Any) -> Any:
  if isinstance(base, dict) and isinstance(incoming, dict):
    merged = dict(base)
    for key, value in incoming.items():
      merged[key] = _deep_merge(base.get(key), value)
    return merged
  return incoming if incoming is not None else base


def _normalize_event_shape(spec: dict[str, Any]) -> dict[str, Any]:
  dsl = spec.get("dsl")
  if not isinstance(dsl, dict):
    return spec
  signal = dsl.get("signal")
  if not isinstance(signal, dict):
    return spec

  indicators = signal.get("indicators")
  events = signal.get("events")
  logic = dsl.get("logic")
  action = dsl.get("action")
  rules = logic.get("rules") if isinstance(logic, dict) else None
  actions = action.get("actions") if isinstance(action, dict) else None

  if not isinstance(indicators, list) or not isinstance(events, list):
    return spec

  indicator_ids: set[str] = set()
  action_ids: list[str] = []

  macd_4h_id: str | None = None
  close_1m_id: str | None = None
  ma_1d_id: str | None = None
  for ind in indicators:
    if not isinstance(ind, dict):
      continue
    ind_id = str(ind.get("id") or "").strip()
    ind_type = str(ind.get("type") or "").strip().upper()
    tf = str(ind.get("tf") or "").strip().lower()
    if not ind_id:
      continue
    indicator_ids.add(ind_id)
    if ind_type == "MACD" and tf == "4h" and macd_4h_id is None:
      macd_4h_id = ind_id
    if ind_type == "CLOSE" and tf == "1m" and close_1m_id is None:
      close_1m_id = ind_id
    if ind_type in ("SMA", "MA") and tf == "1d" and ma_1d_id is None:
      ma_1d_id = ind_id

  if isinstance(actions, list):
    for a in actions:
      if isinstance(a, dict):
        aid = str(a.get("id") or "").strip()
        if aid:
          action_ids.append(aid)

  for ev in events:
    if not isinstance(ev, dict):
      continue
    ev_type = str(ev.get("type") or "").strip().upper()

    if ev_type in ("CROSS", "CROSS_DOWN", "CROSS_UP"):
      if macd_4h_id:
        a_raw = str(ev.get("a") or "").strip()
        b_raw = str(ev.get("b") or "").strip()
        if "." not in a_raw:
          ev["a"] = f"{macd_4h_id}.macd"
        if "." not in b_raw:
          ev["b"] = f"{macd_4h_id}.signal"
      ev["left"] = None
      ev["right"] = None
      ev["op"] = None
      ev["value"] = None
      if ev_type == "CROSS_DOWN":
        ev["direction"] = "DOWN"
      elif ev_type == "CROSS_UP":
        ev["direction"] = "UP"

    if ev_type == "THRESHOLD":
      left_raw = ev.get("left")
      right_raw = ev.get("right")
      a_raw = ev.get("a")
      b_raw = ev.get("b")
      if left_raw in (None, "") and isinstance(a_raw, str) and a_raw.strip():
        ev["left"] = a_raw.strip()
      if right_raw in (None, "") and isinstance(b_raw, str) and b_raw.strip():
        ev["right"] = b_raw.strip()
      if ev.get("left") in (None, "") and close_1m_id:
        ev["left"] = close_1m_id
      if ev.get("right") in (None, "") and ma_1d_id:
        ev["right"] = ma_1d_id
      # Ensure refs point to existing indicator ids to avoid always-false signals.
      for key, fallback_id in (("left", close_1m_id), ("right", ma_1d_id)):
        raw = ev.get(key)
        if isinstance(raw, str) and raw:
          ref_id = raw.split("@", 1)[0].split(".", 1)[0].strip()
          if ref_id not in indicator_ids and fallback_id:
            field = "value"
            if "." in raw:
              _, field = raw.split(".", 1)
            ev[key] = f"{fallback_id}.{field}"
          elif ref_id in indicator_ids and "." in raw:
            _, field = raw.split(".", 1)
            if field.strip().lower() not in ("value",):
              ev[key] = f"{ref_id}.value"
      if ev.get("op") in (None, ""):
        ev["op"] = "<"
      ev["a"] = None
      ev["b"] = None
      ev["direction"] = None
      ev["value"] = None

  # Normalize logic.then so action dispatch is always executable.
  if isinstance(rules, list):
    for rule in rules:
      if not isinstance(rule, dict):
        continue
      then_raw = rule.get("then")
      normalized_then: list[dict[str, str]] = []
      if isinstance(then_raw, list):
        for item in then_raw:
          if isinstance(item, str) and item.strip():
            normalized_then.append({"action_id": item.strip()})
          elif isinstance(item, dict):
            aid = str(item.get("action_id") or item.get("id") or "").strip()
            if aid:
              normalized_then.append({"action_id": aid})
      if not normalized_then and action_ids:
        normalized_then = [{"action_id": action_ids[0]}]
      rule["then"] = normalized_then

      when = rule.get("when")
      if isinstance(when, dict):
        all_conditions = when.get("all")
        if isinstance(all_conditions, list):
          for c in all_conditions:
            if not isinstance(c, dict):
              continue
            ew = c.get("event_within")
            if isinstance(ew, dict):
              lb = ew.get("lookback")
              if isinstance(lb, str) and "bar@" in lb and "bars@" not in lb:
                ew["lookback"] = lb.replace("bar@", "bars@")

  return spec


def _semantic_errors(spec: dict[str, Any]) -> list[str]:
  errs: list[str] = []
  dsl = spec.get("dsl")
  if not isinstance(dsl, dict):
    return ["dsl must be object"]
  signal = dsl.get("signal")
  logic = dsl.get("logic")
  action = dsl.get("action")
  if not isinstance(signal, dict) or not isinstance(logic, dict) or not isinstance(action, dict):
    return ["dsl.signal/dsl.logic/dsl.action must be objects"]

  indicators = signal.get("indicators")
  events = signal.get("events")
  rules = logic.get("rules")
  actions = action.get("actions")
  if not isinstance(indicators, list) or not isinstance(events, list):
    errs.append("signal.indicators/events must be arrays")
    return errs
  if not isinstance(rules, list):
    errs.append("logic.rules must be array")
    return errs
  if not isinstance(actions, list):
    errs.append("action.actions must be array")
    return errs

  indicator_ids: set[str] = set()
  action_ids: set[str] = set()
  for ind in indicators:
    if isinstance(ind, dict):
      iid = str(ind.get("id") or "").strip()
      if iid:
        indicator_ids.add(iid)
  for a in actions:
    if isinstance(a, dict):
      aid = str(a.get("id") or "").strip()
      if aid:
        action_ids.add(aid)

  for ev in events:
    if not isinstance(ev, dict):
      continue
    eid = str(ev.get("id") or "unknown")
    et = str(ev.get("type") or "").upper()
    if et in ("CROSS", "CROSS_DOWN", "CROSS_UP"):
      for key in ("a", "b"):
        raw = ev.get(key)
        if not isinstance(raw, str) or "." not in raw:
          errs.append(f"event[{eid}] {et} requires {key} as 'indicator_id.field'")
          continue
        rid = raw.split("@", 1)[0].split(".", 1)[0].strip()
        if rid not in indicator_ids:
          errs.append(f"event[{eid}] {key} indicator id '{rid}' not found")
    if et == "THRESHOLD":
      for key in ("left", "right"):
        raw = ev.get(key)
        if not isinstance(raw, str) or "." not in raw:
          errs.append(f"event[{eid}] THRESHOLD requires {key} as 'indicator_id.value'")
          continue
        rid, field = raw.split("@", 1)[0].split(".", 1)
        if rid.strip() not in indicator_ids:
          errs.append(f"event[{eid}] {key} indicator id '{rid.strip()}' not found")
        if field.strip() != "value":
          errs.append(f"event[{eid}] {key} field must be 'value'")
      if str(ev.get("op") or "") not in ("<", "<=", ">", ">=", "==", "!="):
        errs.append(f"event[{eid}] THRESHOLD op invalid")

  for r in rules:
    if not isinstance(r, dict):
      continue
    rid = str(r.get("id") or "unknown")
    then = r.get("then")
    if not isinstance(then, list) or len(then) == 0:
      errs.append(f"rule[{rid}] then must be non-empty array")
      continue
    for item in then:
      if isinstance(item, str):
        aid = item.strip()
      elif isinstance(item, dict):
        aid = str(item.get("action_id") or item.get("id") or "").strip()
      else:
        aid = ""
      if not aid:
        errs.append(f"rule[{rid}] then has empty action ref")
      elif aid not in action_ids:
        errs.append(f"rule[{rid}] then action_id '{aid}' not found in actions")

  return errs


def _build_repair_prompt(
  nl_text: str,
  mode: Literal["BACKTEST_ONLY", "PAPER", "LIVE"],
  draft_spec: dict[str, Any],
  semantic_errors: list[str],
) -> str:
  return (
    f'User natural language strategy description: "{nl_text}"\n'
    f'Additional context:\n- mode: "{mode}"\n\n'
    "Your previous StrategySpec failed semantic validation for this execution engine.\n"
    "Please fix ONLY the listed errors and return a full corrected StrategySpec JSON.\n"
    "Keep hard rules unchanged.\n\n"
    "Semantic errors:\n"
    + "\n".join([f"- {e}" for e in semantic_errors[:20]])
    + "\n\nPrevious StrategySpec JSON:\n"
    + json.dumps(draft_spec, ensure_ascii=False)
  )


def build_default_mvp_spec(nl_text: str, mode: Literal["BACKTEST_ONLY", "PAPER", "LIVE"]) -> dict[str, Any]:
  now = datetime.now(timezone.utc).isoformat()
  spec: dict[str, Any] = {
    "strategy_id": "stg_auto_v0",
    "strategy_version": "",
    "name": (nl_text[:80] + "...") if len(nl_text) > 80 else nl_text,
    "timezone": "America/New_York",
    "calendar": {"type": "exchange", "value": "XNYS"},
    "universe": {
      "signal_symbol": "QQQ",
      "signal_symbol_fallbacks": ["NDX", "QQQ"],
      "trade_symbol": "TQQQ",
    },
    "decision": {"decision_time_rule": {"type": "MARKET_CLOSE_OFFSET", "offset": "-2m"}},
    "execution": {"model": "MOC", "slippage_bps": 2, "commission_per_share": 0.0, "commission_per_trade": 0.0},
    "risk": {"cooldown": {"scope": "SYMBOL_ACTION", "value": "1d"}, "max_orders_per_day": 1},
    "dsl": {
      "atomic": {
        "symbols": {"signal": "QQQ", "trade": "TQQQ"},
        "constants": {"sell_fraction": 0.3, "lookback": "5d"},
      },
      "time": {"primary_tf": "1m", "derived_tfs": ["4h", "1d"], "aggregation": {"4h": "SESSION_ALIGNED_4H", "1d": "SESSION_ALIGNED_1D"}},
      "signal": {
        "indicators": [
          {"id": "macd_4h", "symbol_ref": "signal", "tf": "4h", "type": "MACD", "params": {"fast": 12, "slow": 26, "signal": 9}, "align": "LAST_CLOSED"},
          {"id": "ma5_1d", "symbol_ref": "signal", "tf": "1d", "type": "SMA", "params": {"window": "5d", "bar_selection": "LAST_CLOSED_1D"}, "align": "CARRY_FORWARD"},
          {"id": "close_1m", "symbol_ref": "signal", "tf": "1m", "type": "CLOSE", "params": {}, "align": "LAST_CLOSED"},
        ],
        "events": [
          {"id": "macd_bear_cross", "type": "CROSS_DOWN", "a": "macd_4h.macd", "b": "macd_4h.signal", "tf": "4h"},
        ],
      },
      "logic": {
        "rules": [
          {
            "id": "r0",
            "when": {
              "all": [
                {"event_within": {"event_id": "macd_bear_cross", "lookback": "5d"}},
                {"lt": {"a": "close_1m.value@decision", "b": "ma5_1d.value@decision"}},
              ]
            },
            "then": ["sell_trade_symbol_partial"],
          }
        ]
      },
      "action": {
        "actions": [
          {
            "id": "sell_trade_symbol_partial",
            "type": "ORDER",
            "symbol_ref": "trade",
            "side": "SELL",
            "qty": {"mode": "FRACTION_OF_POSITION", "value": 0.3},
            "order_type": "MOC",
            "time_in_force": "DAY",
            "cooldown": "1d",
            "idempotency_scope": "DECISION_DAY",
          }
        ]
      },
    },
    "meta": {"created_at": now, "author": "nl_user", "notes": "", "mode": mode},
  }

  spec["strategy_version"] = compute_strategy_version({k: v for k, v in spec.items() if k != "strategy_version"})
  return spec


async def nl_to_strategy_spec(
  nl_text: str,
  mode: Literal["BACKTEST_ONLY", "PAPER", "LIVE"],
  overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
  user_prompt = f"""User natural language strategy description: "{nl_text}"
Additional context:
- mode: "{mode}"
Task:
Return ONLY the JSON of StrategySpec. The JSON MUST be syntactically valid.
The output MUST include a fully runnable five-layer DSL:
- dsl.atomic
- dsl.time
- dsl.signal (indicators + events)
- dsl.logic (rules)
- dsl.action (actions)
"""

  def _minimal_base_spec() -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
      "strategy_id": "stg_auto_v0",
      "strategy_version": "",
      "name": (nl_text[:80] + "...") if len(nl_text) > 80 else nl_text,
      "timezone": "America/New_York",
      "calendar": {"type": "exchange", "value": "XNYS"},
      "universe": {
        "signal_symbol": "QQQ",
        "signal_symbol_fallbacks": ["NDX", "QQQ"],
        "trade_symbol": "TQQQ",
      },
      "decision": {"decision_time_rule": {"type": "MARKET_CLOSE_OFFSET", "offset": "-2m"}},
      "execution": {"model": "MOC", "slippage_bps": 2, "commission_per_share": 0.0, "commission_per_trade": 0.0},
      "risk": {"cooldown": {"scope": "SYMBOL_ACTION", "value": "1d"}, "max_orders_per_day": 1},
      "dsl": {
        "atomic": {},
        "time": {"primary_tf": "1m", "derived_tfs": ["4h", "1d"]},
        "signal": {"indicators": [], "events": []},
        "logic": {"rules": []},
        "action": {"actions": []},
      },
      "meta": {"created_at": now, "author": "nl_user", "notes": "", "mode": mode},
    }

  def _is_runnable(spec: dict[str, Any]) -> bool:
    dsl = spec.get("dsl")
    if not isinstance(dsl, dict):
      return False
    signal = dsl.get("signal") if isinstance(dsl.get("signal"), dict) else {}
    logic = dsl.get("logic") if isinstance(dsl.get("logic"), dict) else {}
    action = dsl.get("action") if isinstance(dsl.get("action"), dict) else {}
    indicators = signal.get("indicators") if isinstance(signal, dict) else None
    rules = logic.get("rules") if isinstance(logic, dict) else None
    actions = action.get("actions") if isinstance(action, dict) else None
    return isinstance(indicators, list) and len(indicators) > 0 and isinstance(rules, list) and len(rules) > 0 and isinstance(actions, list) and len(actions) > 0

  base_spec = _minimal_base_spec()
  fallback_seed = build_default_mvp_spec(nl_text, mode)
  spec: dict[str, Any] = dict(base_spec)
  llm_used = False

  if llm_client.is_configured:
    semantic_errors: list[str] = []
    last_candidate: dict[str, Any] | None = None
    accepted = False
    for attempt in range(3):
      prompt_for_attempt = user_prompt if attempt == 0 or last_candidate is None else _build_repair_prompt(nl_text, mode, last_candidate, semantic_errors)
      llm_spec = await llm_client.chat_json(
        SYSTEM_PROMPT_V0,
        prompt_for_attempt,
        schema_name="strategy_spec",
        json_schema=STRATEGY_SPEC_JSON_SCHEMA,
        strict_schema=True,
      )
      if not isinstance(llm_spec, dict):
        continue
      candidate = _deep_merge(base_spec, llm_spec)
      semantic_errors = _semantic_errors(candidate)
      last_candidate = candidate
      llm_used = True
      if not semantic_errors:
        spec = candidate
        accepted = True
        break

    if not accepted and last_candidate is not None:
      # Final fallback: one-time normalization, only when all repair attempts failed.
      spec = _normalize_event_shape(last_candidate)
      spec.setdefault("meta", {})
      if isinstance(spec["meta"], dict):
        spec["meta"]["semantic_repair_failed"] = True
        spec["meta"]["semantic_errors"] = semantic_errors[:20]
  else:
    spec = _deep_merge(base_spec, fallback_seed)

  if not _is_runnable(spec):
    spec = _deep_merge(fallback_seed, spec)
    spec.setdefault("meta", {})
    if isinstance(spec["meta"], dict):
      spec["meta"]["fallback_seed_applied"] = True

  if overrides and isinstance(overrides, dict):
    spec = _deep_merge(spec, overrides)

  if not isinstance(spec.get("name"), str) or not spec["name"].strip():
    spec["name"] = (nl_text[:80] + "...") if len(nl_text) > 80 else nl_text

  # System-managed fields: never trust/generate from LLM output directly.
  id_basis = {k: v for k, v in spec.items() if k not in ("strategy_id", "strategy_version")}
  spec["strategy_id"] = f"stg_{compute_strategy_version(id_basis)[:12]}"

  spec.setdefault("meta", {})
  if isinstance(spec["meta"], dict):
    spec["meta"]["llm_used"] = llm_used

  spec["strategy_version"] = compute_strategy_version({k: v for k, v in spec.items() if k != "strategy_version"})
  spec = enforce_hard_rules(spec)
  validate_strategy_spec_minimal(spec)
  return spec
