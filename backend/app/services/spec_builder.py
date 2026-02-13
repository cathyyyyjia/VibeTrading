from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Literal

from app.core.config import settings
from app.core.errors import AppError
from app.services.llm_client import llm_client
from app.services.spec_validator import enforce_hard_rules, validate_strategy_spec_minimal


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
5) MA5 definition is fixed to LAST_CLOSED_1D.
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


async def nl_to_strategy_spec(
  nl_text: str,
  mode: Literal["BACKTEST_ONLY", "PAPER", "LIVE"],
  overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
  base_prompt = f"""User natural language strategy description: "{nl_text}"
Additional context:
- mode: "{mode}"
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

    spec = _assemble_final_strategy_spec(draft=dict(llm_draft), nl_text=nl_text, mode=mode)
    if overrides and isinstance(overrides, dict):
      spec = _deep_merge(spec, overrides)
    spec["strategy_version"] = "v0"

    try:
      spec = enforce_hard_rules(spec)
      validate_strategy_spec_minimal(spec)
      meta = spec.get("meta")
      if isinstance(meta, dict):
        meta["llm_attempts"] = attempt + 1
      return spec
    except AppError as exc:
      if exc.code != "VALIDATION_ERROR" or attempt >= max_attempts - 1:
        raise
      last_error = exc
      prompt_for_attempt = _build_repair_prompt(nl_text, mode, llm_draft, exc)

  if last_error is not None:
    raise last_error
  raise AppError("INTERNAL", "Unexpected parser state", {})
