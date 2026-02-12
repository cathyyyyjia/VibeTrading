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

Output instructions:
- Output ONLY the JSON object.
- MUST be valid JSON, parsable, with no comments.
"""

STRATEGY_SPEC_JSON_SCHEMA: dict[str, Any] = {
  "type": "object",
  "additionalProperties": True,
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
    "name": {"type": "string", "minLength": 1},
    "timezone": {"type": "string", "const": "America/New_York"},
    "calendar": {
      "type": "object",
      "required": ["type", "value"],
      "additionalProperties": True,
      "properties": {
        "type": {"type": "string", "const": "exchange"},
        "value": {"type": "string", "const": "XNYS"},
      },
    },
    "universe": {
      "type": "object",
      "required": ["signal_symbol", "trade_symbol"],
      "additionalProperties": True,
      "properties": {
        "signal_symbol": {"type": "string", "minLength": 1},
        "signal_symbol_fallbacks": {
          "type": "array",
          "items": {"type": "string", "minLength": 1},
          "minItems": 1,
        },
        "trade_symbol": {"type": "string", "minLength": 1},
      },
    },
    "decision": {
      "type": "object",
      "required": ["decision_time_rule"],
      "additionalProperties": True,
      "properties": {
        "decision_time_rule": {
          "type": "object",
          "required": ["type", "offset"],
          "additionalProperties": True,
          "properties": {
            "type": {"type": "string", "const": "MARKET_CLOSE_OFFSET"},
            "offset": {"type": "string", "const": "-2m"},
          },
        },
      },
    },
    "execution": {
      "type": "object",
      "required": ["model"],
      "additionalProperties": True,
      "properties": {
        "model": {"type": "string", "enum": ["MOC"]},
        "slippage_bps": {"type": "number", "minimum": 0},
        "commission_per_share": {"type": "number", "minimum": 0},
        "commission_per_trade": {"type": "number", "minimum": 0},
      },
    },
    "risk": {
      "type": "object",
      "additionalProperties": True,
      "properties": {
        "cooldown": {
          "type": "object",
          "required": ["scope", "value"],
          "additionalProperties": True,
          "properties": {
            "scope": {"type": "string", "enum": ["SYMBOL_ACTION"]},
            "value": {
              "oneOf": [
                {"type": "string", "pattern": r"^\d+(d|h|m|bars@1m|bars@4h|bars@1d)$"},
                {
                  "type": "object",
                  "required": ["tf", "bars"],
                  "additionalProperties": False,
                  "properties": {
                    "tf": {"type": "string", "enum": ["1m", "4h", "1d"]},
                    "bars": {"type": "integer", "minimum": 1},
                  },
                },
              ]
            },
          },
        },
        "max_orders_per_day": {"type": "integer", "minimum": 1},
      },
    },
    "dsl": {
      "type": "object",
      "required": ["atomic", "time", "signal", "logic", "action"],
      "additionalProperties": True,
      "properties": {
        "atomic": {
          "type": "object",
          "additionalProperties": True,
          "properties": {
            "symbols": {
              "oneOf": [
                {
                  "type": "object",
                  "additionalProperties": {"type": "string", "minLength": 1},
                },
                {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["name", "ticker"],
                    "additionalProperties": True,
                    "properties": {
                      "name": {"type": "string", "minLength": 1},
                      "ticker": {"type": "string", "minLength": 1},
                    },
                  },
                },
              ]
            },
            "constants": {
              "type": "object",
              "additionalProperties": True,
              "properties": {
                "sell_fraction": {"type": "number", "minimum": 0, "maximum": 1},
                "initial_position_qty": {"type": "number", "minimum": 0},
                "initial_cash": {"type": "number", "minimum": 0},
                "lookback": {
                  "oneOf": [
                    {"type": "string", "pattern": r"^\d+(d|h|m|bars@1m|bars@4h|bars@1d)$"},
                    {
                      "type": "object",
                      "required": ["tf", "bars"],
                      "additionalProperties": False,
                      "properties": {
                        "tf": {"type": "string", "enum": ["1m", "4h", "1d"]},
                        "bars": {"type": "integer", "minimum": 1},
                      },
                    },
                  ]
                },
              },
            },
          },
        },
        "time": {
          "type": "object",
          "required": ["primary_tf", "derived_tfs"],
          "additionalProperties": True,
          "properties": {
            "primary_tf": {"type": "string", "enum": ["1m"]},
            "derived_tfs": {
              "type": "array",
              "items": {"type": "string", "enum": ["4h", "1d"]},
              "minItems": 2,
              "uniqueItems": True,
            },
            "aggregation": {
              "type": "object",
              "additionalProperties": True,
              "properties": {
                "4h": {
                  "oneOf": [
                    {"type": "string", "enum": ["SESSION_ALIGNED_4H"]},
                    {
                      "type": "object",
                      "additionalProperties": True,
                      "properties": {
                        "source_tf": {"type": "string", "enum": ["1m"]},
                        "bar_close_rule": {"type": "string", "enum": ["SESSION_ALIGNED_4H"]},
                        "align": {"type": "string", "enum": ["LAST_CLOSED", "CARRY_FORWARD"]},
                      },
                    },
                  ]
                },
                "1d": {
                  "oneOf": [
                    {"type": "string", "enum": ["SESSION_ALIGNED_1D", "EXCHANGE_DAILY"]},
                    {
                      "type": "object",
                      "additionalProperties": True,
                      "properties": {
                        "source_tf": {"type": "string", "enum": ["1m"]},
                        "bar_close_rule": {"type": "string", "enum": ["SESSION_ALIGNED_1D", "EXCHANGE_DAILY"]},
                        "align": {"type": "string", "enum": ["LAST_CLOSED", "CARRY_FORWARD"]},
                      },
                    },
                  ]
                },
              },
            },
          },
        },
        "signal": {
          "type": "object",
          "required": ["indicators", "events"],
          "additionalProperties": True,
          "properties": {
            "indicators": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "required": ["id", "symbol_ref", "tf", "type", "params", "align"],
                "additionalProperties": True,
                "properties": {
                  "id": {"type": "string", "minLength": 1},
                  "symbol_ref": {"type": "string", "minLength": 1},
                  "tf": {"type": "string", "enum": ["1m", "4h", "1d"]},
                  "type": {"type": "string", "enum": ["MACD", "SMA", "MA", "CLOSE"]},
                  "params": {
                    "type": "object",
                    "additionalProperties": True,
                    "properties": {
                      "fast": {"type": "integer", "minimum": 1},
                      "slow": {"type": "integer", "minimum": 1},
                      "signal": {"type": "integer", "minimum": 1},
                      "window": {
                        "oneOf": [
                          {"type": "string", "pattern": r"^\d+(d|h|m|bars@1m|bars@4h|bars@1d)$"},
                          {
                            "type": "object",
                            "required": ["tf", "bars"],
                            "additionalProperties": False,
                            "properties": {
                              "tf": {"type": "string", "enum": ["1m", "4h", "1d"]},
                              "bars": {"type": "integer", "minimum": 1},
                            },
                          },
                        ]
                      },
                      "bar_selection": {"type": "string", "enum": ["LAST_CLOSED_1D"]},
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
                "required": ["id", "type"],
                "additionalProperties": True,
                "properties": {
                  "id": {"type": "string", "minLength": 1},
                  "type": {"type": "string", "enum": ["CROSS", "CROSS_UP", "CROSS_DOWN", "THRESHOLD"]},
                  "a": {"oneOf": [{"type": "string"}, {"type": "object"}]},
                  "b": {"oneOf": [{"type": "string"}, {"type": "object"}]},
                  "left": {"oneOf": [{"type": "string"}, {"type": "object"}]},
                  "right": {"oneOf": [{"type": "string"}, {"type": "object"}]},
                  "direction": {"type": "string", "enum": ["UP", "DOWN", "ANY"]},
                  "op": {"type": "string", "enum": ["<", "<=", ">", ">=", "==", "!="]},
                  "operator": {"type": "string", "enum": ["<", "<=", ">", ">=", "==", "!="]},
                  "value": {"type": "number"},
                  "tf": {"type": "string", "enum": ["1m", "4h", "1d"]},
                },
              },
            },
          },
        },
        "logic": {
          "type": "object",
          "required": ["rules"],
          "additionalProperties": True,
          "properties": {
            "rules": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "required": ["id", "when", "then"],
                "additionalProperties": True,
                "properties": {
                  "id": {"type": "string", "minLength": 1},
                  "when": {"$ref": "#/$defs/LogicCondition"},
                  "then": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                      "oneOf": [
                        {"type": "string", "minLength": 1},
                        {
                          "type": "object",
                          "additionalProperties": True,
                          "properties": {
                            "action_id": {"type": "string", "minLength": 1},
                            "id": {"type": "string", "minLength": 1},
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
        "action": {
          "type": "object",
          "required": ["actions"],
          "additionalProperties": True,
          "properties": {
            "actions": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "required": ["id", "type", "symbol_ref", "side", "qty", "order_type"],
                "additionalProperties": True,
                "properties": {
                  "id": {"type": "string", "minLength": 1},
                  "type": {"type": "string", "enum": ["ORDER"]},
                  "symbol_ref": {"type": "string", "minLength": 1},
                  "side": {"type": "string", "enum": ["BUY", "SELL"]},
                  "qty": {
                    "type": "object",
                    "required": ["mode", "value"],
                    "additionalProperties": True,
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
                      "type": {
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
                      "value": {"type": "number", "minimum": 0},
                      "value_ref": {"type": "string"},
                    },
                  },
                  "order_type": {"type": "string", "enum": ["MOC"]},
                  "time_in_force": {"type": "string", "enum": ["DAY"]},
                  "cooldown": {
                    "oneOf": [
                      {"type": "string", "pattern": r"^\d+(d|h|m|bars@1m|bars@4h|bars@1d)$"},
                      {
                        "type": "object",
                        "required": ["tf", "bars"],
                        "additionalProperties": False,
                        "properties": {
                          "tf": {"type": "string", "enum": ["1m", "4h", "1d"]},
                          "bars": {"type": "integer", "minimum": 1},
                        },
                      },
                    ]
                  },
                  "idempotency_scope": {"type": "string", "enum": ["DECISION_DAY"]},
                },
              },
            },
          },
        },
      },
    },
    "meta": {
      "type": "object",
      "additionalProperties": True,
      "properties": {
        "created_at": {"type": "string", "format": "date-time"},
        "author": {"type": "string"},
        "notes": {"type": "string"},
        "mode": {"type": "string", "enum": ["BACKTEST_ONLY", "PAPER", "LIVE"]},
        "llm_used": {"type": "boolean"},
        "fallback_seed_applied": {"type": "boolean"},
      },
    },
  },
  "$defs": {
    "LogicCondition": {
      "oneOf": [
        {
          "type": "object",
          "required": ["all"],
          "additionalProperties": False,
          "properties": {
            "all": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/LogicCondition"}},
          },
        },
        {
          "type": "object",
          "required": ["any"],
          "additionalProperties": False,
          "properties": {
            "any": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/LogicCondition"}},
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
              "additionalProperties": True,
              "properties": {
                "event_id": {"type": "string", "minLength": 1},
                "lookback": {
                  "oneOf": [
                    {"type": "string", "pattern": r"^\d+(d|h|m|bars@1m|bars@4h|bars@1d)$"},
                    {
                      "type": "object",
                      "required": ["tf", "bars"],
                      "additionalProperties": False,
                      "properties": {
                        "tf": {"type": "string", "enum": ["1m", "4h", "1d"]},
                        "bars": {"type": "integer", "minimum": 1},
                      },
                    },
                  ]
                },
              },
            },
          },
        },
        {
          "type": "object",
          "required": ["event_id"],
          "additionalProperties": True,
          "properties": {
            "event_id": {"type": "string", "minLength": 1},
            "scope": {"type": "string", "enum": ["LAST_CLOSED_4H_BAR", "LAST_CLOSED_1D", "BAR", ""]},
          },
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
                "a": {"oneOf": [{"type": "string"}, {"type": "number"}, {"type": "object"}]},
                "b": {"oneOf": [{"type": "string"}, {"type": "number"}, {"type": "object"}]},
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
                "a": {"oneOf": [{"type": "string"}, {"type": "number"}, {"type": "object"}]},
                "b": {"oneOf": [{"type": "string"}, {"type": "number"}, {"type": "object"}]},
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
            "left": {"oneOf": [{"type": "string"}, {"type": "number"}, {"type": "object"}]},
            "right": {"oneOf": [{"type": "string"}, {"type": "number"}, {"type": "object"}]},
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
    llm_spec = await llm_client.chat_json(
      SYSTEM_PROMPT_V0,
      user_prompt,
      schema_name="strategy_spec",
      json_schema=STRATEGY_SPEC_JSON_SCHEMA,
      strict_schema=True,
    )
    if isinstance(llm_spec, dict):
      spec = _deep_merge(base_spec, llm_spec)
      llm_used = True
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
