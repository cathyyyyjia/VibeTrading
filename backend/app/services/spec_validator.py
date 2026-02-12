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
    universe = {"signal_symbol": symbols[0], "signal_symbol_fallbacks": symbols} if symbols else {}
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
  universe.setdefault("signal_symbol", "QQQ")
  universe.setdefault("signal_symbol_fallbacks", ["NDX", "QQQ"])
  universe.setdefault("trade_symbol", "TQQQ")
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
  required = ["strategy_id", "strategy_version", "name", "timezone", "calendar", "universe", "decision", "execution", "risk", "dsl", "meta"]
  missing = [k for k in required if k not in spec]
  if missing:
    raise AppError("VALIDATION_ERROR", "StrategySpec missing required fields", {"missing": missing})

  offset = (((spec.get("decision") or {}).get("decision_time_rule") or {}).get("offset"))
  if offset != "-2m":
    raise AppError("VALIDATION_ERROR", "decision offset must be -2m", {"offset": offset})

  dsl = spec.get("dsl") or {}
  for layer in ["atomic", "time", "signal", "logic", "action"]:
    if layer not in dsl:
      raise AppError("VALIDATION_ERROR", "DSL missing layer", {"layer": layer})

  atomic = (dsl.get("atomic") or {})
  constants = (atomic.get("constants") or {})
  lookback = constants.get("lookback")
  if isinstance(lookback, str) and not _LOOKBACK_RE.match(lookback.replace(" ", "")):
    raise AppError("VALIDATION_ERROR", "lookback must include units", {"lookback": lookback})
