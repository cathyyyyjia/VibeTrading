from __future__ import annotations

import re
from typing import Any

from app.core.errors import AppError


_LOOKBACK_RE = re.compile(r"^\d+\s*(d|h|m|bars@4h|bars@1d|bars@1m)$", re.IGNORECASE)


def _require(cond: bool, code: str, message: str, details: dict[str, Any] | None = None) -> None:
  if not cond:
    raise AppError(code, message, details or {})


def _coerce_universe(raw: Any) -> dict[str, Any]:
  if isinstance(raw, dict):
    universe = dict(raw)
  elif isinstance(raw, str):
    symbol = raw.strip().upper()
    universe = {"signal_symbol": symbol} if symbol else {}
  elif isinstance(raw, (list, tuple, set)):
    symbols = [str(x).strip().upper() for x in raw if str(x).strip()]
    universe = {"signal_symbol": symbols[0]} if symbols else {}
  else:
    universe = {}

  return universe


def enforce_hard_rules(spec: dict[str, Any]) -> dict[str, Any]:
  spec = dict(spec)

  spec["timezone"] = "America/New_York"
  spec["calendar"] = {"type": "exchange", "value": "XNYS"}
  spec.setdefault("decision", {})
  spec["decision"]["decision_time_rule"] = {"type": "MARKET_CLOSE_OFFSET", "offset": "-2m"}
  spec.setdefault("execution", {})
  spec["execution"]["model"] = "MOC"

  universe = _coerce_universe(spec.get("universe"))
  _require(bool(universe.get("signal_symbol")), "VALIDATION_ERROR", "universe.signal_symbol is required")
  _require(bool(universe.get("trade_symbol")), "VALIDATION_ERROR", "universe.trade_symbol is required")
  spec["universe"] = universe

  dsl = dict(spec.get("dsl") or {})
  time_layer = dict(dsl.get("time") or {})
  time_layer["primary_tf"] = "1m"
  derived = list(time_layer.get("derived_tfs") or [])
  for tf in ["4h", "1d"]:
    if tf not in derived:
      derived.append(tf)
  time_layer["derived_tfs"] = derived
  dsl["time"] = time_layer

  signal_layer = dict(dsl.get("signal") or {})
  indicators = list(signal_layer.get("indicators") or [])
  for ind in indicators:
    if isinstance(ind, dict) and ind.get("type") in ("SMA", "MA") and str((ind.get("params") or {}).get("window", "")).lower() in ("5", "5d", "5days", "5-day"):
      params = dict(ind.get("params") or {})
      params["window"] = "5d"
      params["bar_selection"] = "LAST_CLOSED_1D"
      ind["params"] = params
      ind["tf"] = "1d"
      ind["align"] = "CARRY_FORWARD"
  signal_layer["indicators"] = indicators
  dsl["signal"] = signal_layer
  spec["dsl"] = dsl

  _require(spec.get("timezone") == "America/New_York", "VALIDATION_ERROR", "timezone must be America/New_York")
  _require((spec.get("calendar") or {}).get("value") == "XNYS", "VALIDATION_ERROR", "calendar must be XNYS")
  _require((spec.get("execution") or {}).get("model") == "MOC", "VALIDATION_ERROR", "execution.model must be MOC")

  return spec


def validate_strategy_spec_minimal(spec: dict[str, Any]) -> None:
  required = ["strategy_version", "name", "timezone", "calendar", "universe", "decision", "execution", "risk", "dsl", "meta"]
  missing = [k for k in required if k not in spec]
  if missing:
    raise AppError("VALIDATION_ERROR", "StrategySpec missing required fields", {"missing": missing})

  offset = (((spec.get("decision") or {}).get("decision_time_rule") or {}).get("offset"))
  if offset != "-2m":
    raise AppError("VALIDATION_ERROR", "decision offset must be -2m", {"offset": offset})

  dsl_raw = spec.get("dsl") or {}
  dsl = dsl_raw if isinstance(dsl_raw, dict) else {}
  for layer in ["atomic", "time", "signal", "logic", "action"]:
    if layer not in dsl:
      raise AppError("VALIDATION_ERROR", "DSL missing layer", {"layer": layer})

  atomic_raw = dsl.get("atomic") or {}
  atomic = atomic_raw if isinstance(atomic_raw, dict) else {}
  constants_raw = atomic.get("constants") or {}
  constants = constants_raw if isinstance(constants_raw, dict) else {}
  lookback = constants.get("lookback")
  if isinstance(lookback, str) and not _LOOKBACK_RE.match(lookback.replace(" ", "")):
    raise AppError("VALIDATION_ERROR", "lookback must include units", {"lookback": lookback})

  signal_raw = dsl.get("signal") or {}
  signal = signal_raw if isinstance(signal_raw, dict) else {}
  logic_raw = dsl.get("logic") or {}
  logic = logic_raw if isinstance(logic_raw, dict) else {}
  action_raw = dsl.get("action") or {}
  action = action_raw if isinstance(action_raw, dict) else {}

  indicators = signal.get("indicators")
  events = signal.get("events")
  rules = logic.get("rules")
  actions = action.get("actions")
  if not isinstance(indicators, list) or len(indicators) == 0:
    raise AppError("VALIDATION_ERROR", "dsl.signal.indicators must be non-empty", {})
  if not isinstance(events, list) or len(events) == 0:
    raise AppError("VALIDATION_ERROR", "dsl.signal.events must be non-empty", {})
  if not isinstance(rules, list) or len(rules) == 0:
    raise AppError("VALIDATION_ERROR", "dsl.logic.rules must be non-empty", {})
  if not isinstance(actions, list) or len(actions) == 0:
    raise AppError("VALIDATION_ERROR", "dsl.action.actions must be non-empty", {})

  indicator_ids = {str(i.get("id") or "").strip() for i in indicators if isinstance(i, dict)}
  indicator_ids = {i for i in indicator_ids if i}
  event_ids = {str(e.get("id") or "").strip() for e in events if isinstance(e, dict)}
  event_ids = {e for e in event_ids if e}
  action_ids = {str(a.get("id") or "").strip() for a in actions if isinstance(a, dict)}
  action_ids = {a for a in action_ids if a}

  if not indicator_ids:
    raise AppError("VALIDATION_ERROR", "indicators must have valid ids", {})
  if not event_ids:
    raise AppError("VALIDATION_ERROR", "events must have valid ids", {})
  if not action_ids:
    raise AppError("VALIDATION_ERROR", "actions must have valid ids", {})

  for event in events:
    if not isinstance(event, dict):
      continue
    et = str(event.get("type") or "").upper()
    eid = str(event.get("id") or "unknown")
    if et in ("CROSS", "CROSS_DOWN", "CROSS_UP"):
      for key in ("a", "b"):
        ref = event.get(key)
        if not isinstance(ref, str) or "." not in ref:
          raise AppError("VALIDATION_ERROR", f"event {eid} missing {key} ref", {"event_id": eid, "field": key})
        ref_id = ref.split("@", 1)[0].split(".", 1)[0].strip()
        if ref_id not in indicator_ids:
          raise AppError("VALIDATION_ERROR", f"event {eid} references unknown indicator", {"event_id": eid, "indicator_id": ref_id})
    elif et == "THRESHOLD":
      for key in ("left", "right"):
        ref = event.get(key)
        if not isinstance(ref, str) or not ref.strip():
          raise AppError("VALIDATION_ERROR", f"event {eid} missing {key} ref", {"event_id": eid, "field": key})
        ref_id = ref.split("@", 1)[0].split(".", 1)[0].strip()
        if ref_id not in indicator_ids:
          raise AppError("VALIDATION_ERROR", f"event {eid} references unknown indicator", {"event_id": eid, "indicator_id": ref_id})
      if str(event.get("op") or "") not in ("<", "<=", ">", ">=", "==", "!="):
        raise AppError("VALIDATION_ERROR", f"event {eid} has invalid threshold op", {"event_id": eid})

  for rule in rules:
    if not isinstance(rule, dict):
      continue
    rid = str(rule.get("id") or "unknown")
    then = rule.get("then")
    if not isinstance(then, list) or len(then) == 0:
      raise AppError("VALIDATION_ERROR", f"rule {rid} then is empty", {"rule_id": rid})
    for item in then:
      action_id = ""
      if isinstance(item, str):
        action_id = item.strip()
      elif isinstance(item, dict):
        action_id = str(item.get("action_id") or item.get("id") or "").strip()
      if not action_id or action_id not in action_ids:
        raise AppError("VALIDATION_ERROR", f"rule {rid} references unknown action", {"rule_id": rid, "action_id": action_id})
