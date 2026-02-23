from __future__ import annotations

import json
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
- For sequence semantics (then/after/之后/然后), split into explicit stages.
- Use SET_FLAG and flag_is_true for stage transitions.
- If user states exactly one reduce stage then full exit stage, keep exactly those stages.

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
                  "type": {"type": "string", "enum": ["MACD", "MA", "SMA", "CLOSE"]},
                  "tf": {"type": "string", "enum": ["1m", "4h", "1d"]},
                  "symbol_ref": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
                  "align": {"type": ["string", "null"], "enum": ["LAST_CLOSED", "CARRY_FORWARD", None]},
                  "params": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["fast", "slow", "signal", "period", "window", "bar_selection"],
                    "properties": {
                      "fast": {"type": ["integer", "null"]},
                      "slow": {"type": ["integer", "null"]},
                      "signal": {"type": ["integer", "null"]},
                      "period": {"type": ["integer", "null"]},
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
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "type", "a", "b", "left", "right", "direction", "op", "value", "tf"],
                "properties": {
                  "id": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
                  "type": {"type": "string", "enum": ["CROSS", "CROSS_UP", "CROSS_DOWN", "THRESHOLD"]},
                  "a": {"type": ["string", "null"], "pattern": "^[A-Za-z_][A-Za-z0-9_:-]*(\\.[A-Za-z_][A-Za-z0-9_]*)?(?:@[A-Za-z0-9_:-]+)?$"},
                  "b": {"type": ["string", "null"], "pattern": "^[A-Za-z_][A-Za-z0-9_:-]*(\\.[A-Za-z_][A-Za-z0-9_]*)?(?:@[A-Za-z0-9_:-]+)?$"},
                  "left": {"type": ["string", "null"], "pattern": "^[A-Za-z_][A-Za-z0-9_:-]*(\\.[A-Za-z_][A-Za-z0-9_]*)?(?:@[A-Za-z0-9_:-]+)?$"},
                  "right": {"type": ["string", "null"], "pattern": "^[A-Za-z_][A-Za-z0-9_:-]*(\\.[A-Za-z_][A-Za-z0-9_]*)?(?:@[A-Za-z0-9_:-]+)?$"},
                  "direction": {"type": ["string", "null"]},
                  "op": {"type": ["string", "null"], "enum": ["<", "<=", ">", ">=", "==", "!=", None]},
                  "value": {"type": ["number", "null"]},
                  "tf": {"type": ["string", "null"]},
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
                  {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "type", "flag", "cooldown"],
                    "properties": {
                      "id": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
                      "type": {"type": "string", "enum": ["SET_FLAG"]},
                      "flag": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"},
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
          "required": ["flag_is_true"],
          "properties": {
            "flag_is_true": {
              "type": "object",
              "additionalProperties": False,
              "required": ["flag"],
              "properties": {"flag": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_:-]{0,63}$"}},
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
  defaults = {"ma_window_days": 5, "macd": {"fast": 12, "slow": 26, "signal": 9}}
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


async def nl_to_strategy_spec(
  nl_text: str,
  mode: Literal["BACKTEST_ONLY", "PAPER", "LIVE"],
  overrides: dict[str, Any] | None = None,
  indicator_preferences: dict[str, Any] | None = None,
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
- Make multi-stage logic explicit with SET_FLAG + flag_is_true when needed.
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
    raise last_error
  raise AppError("INTERNAL", "Unexpected parser state", {})
