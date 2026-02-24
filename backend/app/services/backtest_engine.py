from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
import math

import exchange_calendars as xcals
import numpy as np

from app.core.errors import AppError
from app.services.market_data import MinuteBar, compute_data_health, get_market_data_provider


@dataclass(frozen=True)
class BacktestResult:
  equity: list[dict[str, Any]]
  market: list[dict[str, Any]]
  trades: list[dict[str, Any]]
  kpis: dict[str, Any]
  artifacts: dict[str, Any]


def _ema(values: list[float], span: int) -> list[float]:
  if not values:
    return []
  alpha = 2.0 / (span + 1.0)
  out = [values[0]]
  for v in values[1:]:
    out.append(alpha * v + (1 - alpha) * out[-1])
  return out


def _macd(closes: list[float], fast: int, slow: int, signal: int) -> tuple[list[float], list[float]]:
  ema_fast = _ema(closes, fast)
  ema_slow = _ema(closes, slow)
  macd_line = [a - b for a, b in zip(ema_fast, ema_slow)]
  signal_line = _ema(macd_line, signal)
  return macd_line, signal_line


def _rsi(closes: list[float], period: int) -> list[float | None]:
  if len(closes) < 2:
    return [None] * len(closes)
  n = max(2, int(period))
  out: list[float | None] = [None] * len(closes)
  gains: list[float] = []
  losses: list[float] = []
  for i in range(1, len(closes)):
    delta = closes[i] - closes[i - 1]
    gains.append(max(delta, 0.0))
    losses.append(max(-delta, 0.0))
    if i < n:
      continue
    avg_gain = float(np.mean(gains[i - n : i]))
    avg_loss = float(np.mean(losses[i - n : i]))
    if avg_loss <= 1e-12:
      out[i] = 100.0
    else:
      rs = avg_gain / avg_loss
      out[i] = 100.0 - (100.0 / (1.0 + rs))
  return out


def _kdj(closes: list[float], period: int, k_smooth: int, d_smooth: int) -> tuple[list[float], list[float], list[float]]:
  if not closes:
    return [], [], []
  n = max(2, int(period))
  k_alpha = 1.0 / max(1, int(k_smooth))
  d_alpha = 1.0 / max(1, int(d_smooth))
  k_values: list[float] = []
  d_values: list[float] = []
  j_values: list[float] = []
  prev_k = 50.0
  prev_d = 50.0
  for i in range(len(closes)):
    start = max(0, i - n + 1)
    window = closes[start : i + 1]
    low_n = float(min(window))
    high_n = float(max(window))
    if abs(high_n - low_n) <= 1e-12:
      rsv = 50.0
    else:
      rsv = (float(closes[i]) - low_n) / (high_n - low_n) * 100.0
    k = prev_k * (1.0 - k_alpha) + rsv * k_alpha
    d = prev_d * (1.0 - d_alpha) + k * d_alpha
    j = 3.0 * k - 2.0 * d
    k_values.append(float(k))
    d_values.append(float(d))
    j_values.append(float(j))
    prev_k, prev_d = k, d
  return k_values, d_values, j_values


def _cross_down(macd_line: list[float], signal_line: list[float], idx: int) -> bool:
  if idx <= 0 or idx >= len(macd_line) or idx >= len(signal_line):
    return False
  return macd_line[idx - 1] >= signal_line[idx - 1] and macd_line[idx] < signal_line[idx]


def _last_bar_at_or_before(bars: list[MinuteBar], ts: datetime) -> MinuteBar | None:
  best: MinuteBar | None = None
  for b in bars:
    if b.ts <= ts and (best is None or b.ts > best.ts):
      best = b
  return best


def _session_aligned_4h_segments(session_open: datetime, session_close: datetime) -> list[tuple[datetime, datetime]]:
  seg1_end = session_open + timedelta(hours=4)
  if seg1_end >= session_close:
    return [(session_open, session_close)]
  return [(session_open, seg1_end), (seg1_end, session_close)]


def _group_bars_by_session_date(
  bars: list[MinuteBar],
  session_open_by_date: dict[datetime.date, datetime],
  session_close_by_date: dict[datetime.date, datetime],
) -> dict[datetime.date, list[MinuteBar]]:
  grouped: dict[datetime.date, list[MinuteBar]] = {}
  for b in bars:
    d = b.ts.date()
    so = session_open_by_date.get(d)
    sc = session_close_by_date.get(d)
    if so is None or sc is None:
      continue
    if so <= b.ts <= sc:
      grouped.setdefault(d, []).append(b)
  return grouped


def _parse_lookback_days(raw: Any, default: int = 5) -> int:
  if isinstance(raw, (int, float)):
    return max(1, int(raw))
  if not isinstance(raw, str):
    return default
  txt = raw.strip().lower()
  if txt.endswith("d"):
    txt = txt[:-1]
  try:
    return max(1, int(float(txt)))
  except Exception:
    return default


def _normalize_ref(raw: str) -> tuple[str, str]:
  clean = raw.split("@", 1)[0].strip()
  if "." in clean:
    left, right = clean.split(".", 1)
    return left.strip(), right.strip()
  return clean, "value"


def _read_ref(raw: Any) -> str | None:
  if isinstance(raw, str):
    return raw
  if isinstance(raw, dict):
    candidate = raw.get("ref") or raw.get("value_ref") or raw.get("id")
    if isinstance(candidate, str):
      return candidate
  return None


def _safe_float(value: Any) -> float | None:
  try:
    v = float(value)
    if math.isfinite(v):
      return v
  except Exception:
    return None
  return None


def _parse_iso_date(raw: Any) -> datetime.date | None:
  if not isinstance(raw, str):
    return None
  text = raw.strip()
  if not text:
    return None
  try:
    return datetime.fromisoformat(text).date()
  except Exception:
    return None


def _read_int_pref(source: dict[str, Any], keys: list[str], default: int) -> int:
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


def _extract_indicator_defaults(strategy_spec: dict[str, Any]) -> dict[str, int]:
  defaults = {
    "ma_window_days": 5,
    "macd_fast": 12,
    "macd_slow": 26,
    "macd_signal": 9,
    "rsi_period": 14,
    "kdj_period": 9,
    "kdj_k_smooth": 3,
    "kdj_d_smooth": 3,
  }
  meta = strategy_spec.get("meta")
  if not isinstance(meta, dict):
    return defaults
  prefs = meta.get("indicator_preferences")
  if not isinstance(prefs, dict):
    return defaults

  macd = prefs.get("macd")
  if isinstance(macd, dict):
    defaults["macd_fast"] = _read_int_pref(macd, ["fast"], defaults["macd_fast"])
    defaults["macd_slow"] = _read_int_pref(macd, ["slow"], defaults["macd_slow"])
    defaults["macd_signal"] = _read_int_pref(macd, ["signal"], defaults["macd_signal"])

  defaults["ma_window_days"] = _read_int_pref(prefs, ["ma_window_days", "maWindowDays"], defaults["ma_window_days"])
  defaults["macd_fast"] = _read_int_pref(prefs, ["macd_fast", "macdFast"], defaults["macd_fast"])
  defaults["macd_slow"] = _read_int_pref(prefs, ["macd_slow", "macdSlow"], defaults["macd_slow"])
  defaults["macd_signal"] = _read_int_pref(prefs, ["macd_signal", "macdSignal"], defaults["macd_signal"])
  defaults["rsi_period"] = _read_int_pref(prefs, ["rsi_period", "rsiPeriod"], defaults["rsi_period"])

  kdj = prefs.get("kdj")
  if isinstance(kdj, dict):
    defaults["kdj_period"] = _read_int_pref(kdj, ["period"], defaults["kdj_period"])
    defaults["kdj_k_smooth"] = _read_int_pref(kdj, ["k_smooth", "kSmooth"], defaults["kdj_k_smooth"])
    defaults["kdj_d_smooth"] = _read_int_pref(kdj, ["d_smooth", "dSmooth"], defaults["kdj_d_smooth"])
  defaults["kdj_period"] = _read_int_pref(prefs, ["kdj_period", "kdjPeriod"], defaults["kdj_period"])
  defaults["kdj_k_smooth"] = _read_int_pref(prefs, ["kdj_k_smooth", "kdjKSmooth"], defaults["kdj_k_smooth"])
  defaults["kdj_d_smooth"] = _read_int_pref(prefs, ["kdj_d_smooth", "kdjDSmooth"], defaults["kdj_d_smooth"])
  return defaults


def _compare(op: str, left: float | None, right: float | None) -> bool:
  if left is None or right is None:
    return False
  if op == "<":
    return left < right
  if op == "<=":
    return left <= right
  if op == ">":
    return left > right
  if op == ">=":
    return left >= right
  if op == "==":
    return abs(left - right) < 1e-12
  if op == "!=":
    return abs(left - right) >= 1e-12
  return False


@dataclass
class IndicatorRuntimeContext:
  session_rows: list[dict[str, Any]]
  idx4h_by_session: list[int | None]
  idx1d_by_session: list[int | None]
  four_h_closes: list[float]
  daily_signal_close: list[float]
  daily_trade_close: list[float]
  signal_symbol: str
  trade_symbol: str
  symbol_refs: dict[str, str]
  constants: dict[str, Any]
  indicator_defaults: dict[str, int]
  decision_indicator_values: list[dict[str, dict[str, float | None]]]
  indicator_tf_series: dict[str, dict[str, Any]]

  def daily_series(self, symbol_ref: str) -> list[float]:
    resolved = self.symbol_refs.get(symbol_ref, self.signal_symbol)
    return self.daily_trade_close if resolved == self.trade_symbol else self.daily_signal_close


def _indicator_handler_macd(ind: dict[str, Any], ind_id: str, ctx: IndicatorRuntimeContext) -> None:
  tf = str(ind.get("tf") or "").strip().lower()
  if tf not in ("4h", "1d"):
    return

  params = ind.get("params") if isinstance(ind.get("params"), dict) else {}
  symbol_ref = str(ind.get("symbol_ref") or "signal").strip()
  fast = _read_int_pref(params, ["fast"], ctx.indicator_defaults["macd_fast"])
  slow = _read_int_pref(params, ["slow"], ctx.indicator_defaults["macd_slow"])
  signal_n = _read_int_pref(params, ["signal"], ctx.indicator_defaults["macd_signal"])

  source_series = ctx.four_h_closes if tf == "4h" else ctx.daily_series(symbol_ref)
  macd_line, signal_line = _macd(source_series, fast, slow, signal_n)
  ctx.indicator_tf_series[ind_id] = {"tf": tf, "series": {"macd": macd_line, "signal": signal_line}}

  idx_by_session = ctx.idx4h_by_session if tf == "4h" else ctx.idx1d_by_session
  for i, idx_tf in enumerate(idx_by_session):
    values = {"macd": None, "signal": None, "value": None}
    if idx_tf is not None and idx_tf < len(macd_line):
      values["macd"] = float(macd_line[idx_tf])
      values["signal"] = float(signal_line[idx_tf]) if idx_tf < len(signal_line) else None
      values["value"] = values["macd"]
    ctx.decision_indicator_values[i][ind_id] = values


def _indicator_handler_ma(ind: dict[str, Any], ind_id: str, ctx: IndicatorRuntimeContext) -> None:
  tf = str(ind.get("tf") or "").strip().lower()
  if tf != "1d":
    return
  params = ind.get("params") if isinstance(ind.get("params"), dict) else {}
  symbol_ref = str(ind.get("symbol_ref") or "signal").strip()
  window = _parse_lookback_days(params.get("window") or ctx.constants.get("lookback"), default=ctx.indicator_defaults["ma_window_days"])
  series = ctx.daily_series(symbol_ref)
  for i in range(len(ctx.session_rows)):
    val: float | None = None
    if i >= window and i <= len(series):
      val = float(np.mean(series[i - window : i]))
    ctx.decision_indicator_values[i][ind_id] = {"value": val}


def _indicator_handler_close(ind: dict[str, Any], ind_id: str, ctx: IndicatorRuntimeContext) -> None:
  tf = str(ind.get("tf") or "").strip().lower()
  symbol_ref = str(ind.get("symbol_ref") or "signal").strip()
  if tf == "4h":
    ctx.indicator_tf_series[ind_id] = {"tf": "4h", "series": {"value": list(ctx.four_h_closes)}}
  elif tf == "1d":
    ctx.indicator_tf_series[ind_id] = {"tf": "1d", "series": {"value": list(ctx.daily_series(symbol_ref))}}
  for i, row in enumerate(ctx.session_rows):
    val: float | None = None
    if tf == "1m":
      val = float(row["decision_price_trade"] if ctx.symbol_refs.get(symbol_ref) == ctx.trade_symbol else row["decision_price_signal"])
    elif tf == "1d":
      series = ctx.daily_series(symbol_ref)
      if i > 0 and i - 1 < len(series):
        val = float(series[i - 1])
    elif tf == "4h":
      idx4h = ctx.idx4h_by_session[i]
      if idx4h is not None and idx4h < len(ctx.four_h_closes):
        val = float(ctx.four_h_closes[idx4h])
    ctx.decision_indicator_values[i][ind_id] = {"value": val}


def _indicator_handler_rsi(ind: dict[str, Any], ind_id: str, ctx: IndicatorRuntimeContext) -> None:
  tf = str(ind.get("tf") or "").strip().lower()
  if tf != "1d":
    return
  params = ind.get("params") if isinstance(ind.get("params"), dict) else {}
  symbol_ref = str(ind.get("symbol_ref") or "signal").strip()
  period = _read_int_pref(params, ["period", "window"], ctx.indicator_defaults["rsi_period"])
  rsi_series = _rsi(ctx.daily_series(symbol_ref), period)
  numeric_series = [float(v) if v is not None else None for v in rsi_series]
  ctx.indicator_tf_series[ind_id] = {"tf": "1d", "series": {"value": numeric_series}}
  for i, idx1d in enumerate(ctx.idx1d_by_session):
    value = None
    if idx1d is not None and 0 <= idx1d < len(rsi_series):
      value = rsi_series[idx1d]
    ctx.decision_indicator_values[i][ind_id] = {"value": float(value) if value is not None else None}


def _indicator_handler_kdj(ind: dict[str, Any], ind_id: str, ctx: IndicatorRuntimeContext) -> None:
  tf = str(ind.get("tf") or "").strip().lower()
  if tf not in ("4h", "1d"):
    return
  params = ind.get("params") if isinstance(ind.get("params"), dict) else {}
  symbol_ref = str(ind.get("symbol_ref") or "signal").strip()
  period = _read_int_pref(params, ["period"], ctx.indicator_defaults["kdj_period"])
  k_smooth = _read_int_pref(params, ["fast"], ctx.indicator_defaults["kdj_k_smooth"])
  d_smooth = _read_int_pref(params, ["slow"], ctx.indicator_defaults["kdj_d_smooth"])
  src = ctx.four_h_closes if tf == "4h" else ctx.daily_series(symbol_ref)
  k_values, d_values, j_values = _kdj(src, period, k_smooth, d_smooth)
  ctx.indicator_tf_series[ind_id] = {"tf": tf, "series": {"k": k_values, "d": d_values, "j": j_values, "value": j_values}}
  idx_by_session = ctx.idx4h_by_session if tf == "4h" else ctx.idx1d_by_session
  for i, idx_tf in enumerate(idx_by_session):
    values = {"k": None, "d": None, "j": None, "value": None}
    if idx_tf is not None and idx_tf < len(j_values):
      values["k"] = float(k_values[idx_tf])
      values["d"] = float(d_values[idx_tf])
      values["j"] = float(j_values[idx_tf])
      values["value"] = float(j_values[idx_tf])
    ctx.decision_indicator_values[i][ind_id] = values


INDICATOR_HANDLERS: dict[str, Callable[[dict[str, Any], str, IndicatorRuntimeContext], None]] = {
  "MACD": _indicator_handler_macd,
  "SMA": _indicator_handler_ma,
  "MA": _indicator_handler_ma,
  "CLOSE": _indicator_handler_close,
  "RSI": _indicator_handler_rsi,
  "KDJ": _indicator_handler_kdj,
}


@dataclass
class EventRuntimeContext:
  session_rows: list[dict[str, Any]]
  idx4h_by_session: list[int | None]
  idx1d_by_session: list[int | None]
  indicator_tf_series: dict[str, dict[str, Any]]
  decision_indicator_values: list[dict[str, dict[str, float | None]]]

  def resolve_operand(self, operand: Any, session_idx: int) -> float | None:
    if isinstance(operand, (int, float)):
      return _safe_float(operand)
    ref = _read_ref(operand)
    if isinstance(ref, str):
      ind_id, field = _normalize_ref(ref)
      bucket = self.decision_indicator_values[session_idx].get(ind_id) or {}
      return _safe_float(bucket.get(field))
    if isinstance(operand, dict):
      return _safe_float(operand.get("value"))
    return None


def _event_handler_cross(ev: dict[str, Any], ctx: EventRuntimeContext) -> list[bool]:
  hits = [False] * len(ctx.session_rows)
  event_type = str(ev.get("type") or "").strip().upper()
  direction = str(ev.get("direction") or "").upper()
  if event_type == "CROSS_DOWN":
    direction = "DOWN"
  elif event_type == "CROSS_UP":
    direction = "UP"
  if direction not in ("UP", "DOWN", "ANY"):
    direction = "DOWN"

  a_ref = _read_ref(ev.get("a")) or _read_ref(ev.get("left")) or ""
  b_ref = _read_ref(ev.get("b")) or _read_ref(ev.get("right")) or ""
  a_id, a_field = _normalize_ref(a_ref)
  b_id, b_field = _normalize_ref(b_ref)
  a_meta = ctx.indicator_tf_series.get(a_id) or {}
  b_meta = ctx.indicator_tf_series.get(b_id) or {}
  a_series = ((a_meta.get("series") or {}) if isinstance(a_meta, dict) else {}).get(a_field)
  b_series = ((b_meta.get("series") or {}) if isinstance(b_meta, dict) else {}).get(b_field)

  event_tf = str(ev.get("tf") or "").strip().lower()
  selected_tf = event_tf or str(a_meta.get("tf") or b_meta.get("tf") or "").lower()
  idx_by_session = ctx.idx4h_by_session if selected_tf == "4h" else ctx.idx1d_by_session if selected_tf == "1d" else None
  if not isinstance(a_series, list) or not isinstance(b_series, list) or not isinstance(idx_by_session, list):
    return hits

  for i, idx_tf in enumerate(idx_by_session):
    if idx_tf is None or idx_tf <= 0 or idx_tf >= len(a_series) or idx_tf >= len(b_series):
      continue
    a_prev, a_cur = a_series[idx_tf - 1], a_series[idx_tf]
    b_prev, b_cur = b_series[idx_tf - 1], b_series[idx_tf]
    cross_down = a_prev >= b_prev and a_cur < b_cur
    cross_up = a_prev <= b_prev and a_cur > b_cur
    if direction == "DOWN":
      hits[i] = cross_down
    elif direction == "UP":
      hits[i] = cross_up
    else:
      hits[i] = cross_down or cross_up
  return hits


def _event_handler_threshold(ev: dict[str, Any], ctx: EventRuntimeContext) -> list[bool]:
  hits = [False] * len(ctx.session_rows)
  op = str(ev.get("op") or ev.get("operator") or "<").strip()
  left_ref = _read_ref(ev.get("left")) or ""
  right_ref = _read_ref(ev.get("right"))
  right_const = _safe_float(ev.get("value") if right_ref is None else None)
  for i in range(len(ctx.session_rows)):
    left_v = ctx.resolve_operand(left_ref, i) if left_ref else None
    right_v = ctx.resolve_operand(right_ref, i) if right_ref else right_const
    hits[i] = _compare(op, left_v, right_v)
  return hits


def _find_pivot_indices(
  values: list[float | None],
  *,
  end_idx: int,
  lookback: int,
  left: int,
  right: int,
  kind: str,
) -> list[int]:
  start = max(left, end_idx - lookback + 1)
  out: list[int] = []
  max_i = min(end_idx - right, len(values) - right - 1)
  if max_i < start:
    return out
  for i in range(start, max_i + 1):
    center = values[i]
    if center is None:
      continue
    ok = True
    for j in range(1, left + 1):
      lv = values[i - j]
      if lv is None:
        ok = False
        break
      if kind == "high" and not (center > lv):
        ok = False
        break
      if kind == "low" and not (center < lv):
        ok = False
        break
    if not ok:
      continue
    for j in range(1, right + 1):
      rv = values[i + j]
      if rv is None:
        ok = False
        break
      if kind == "high" and not (center >= rv):
        ok = False
        break
      if kind == "low" and not (center <= rv):
        ok = False
        break
    if ok:
      out.append(i)
  return out


def _event_handler_divergence(ev: dict[str, Any], ctx: EventRuntimeContext) -> list[bool]:
  hits = [False] * len(ctx.session_rows)
  event_type = str(ev.get("type") or "").strip().upper()
  bearish = event_type == "DIVERGENCE_BEARISH"
  bullish = event_type == "DIVERGENCE_BULLISH"
  if not bearish and not bullish:
    return hits

  price_ref = _read_ref(ev.get("a")) or _read_ref(ev.get("left")) or ""
  osc_ref = _read_ref(ev.get("b")) or _read_ref(ev.get("right")) or ""
  price_id, price_field = _normalize_ref(price_ref)
  osc_id, osc_field = _normalize_ref(osc_ref)
  price_meta = ctx.indicator_tf_series.get(price_id) or {}
  osc_meta = ctx.indicator_tf_series.get(osc_id) or {}
  price_series = ((price_meta.get("series") or {}) if isinstance(price_meta, dict) else {}).get(price_field)
  osc_series = ((osc_meta.get("series") or {}) if isinstance(osc_meta, dict) else {}).get(osc_field)
  tf = str(ev.get("tf") or "").strip().lower() or str(price_meta.get("tf") or osc_meta.get("tf") or "").lower()
  idx_by_session = ctx.idx4h_by_session if tf == "4h" else ctx.idx1d_by_session if tf == "1d" else None
  if not isinstance(price_series, list) or not isinstance(osc_series, list) or not isinstance(idx_by_session, list):
    return hits

  left = max(1, int(_safe_float(ev.get("pivot_left")) or 3))
  right = max(1, int(_safe_float(ev.get("pivot_right")) or 3))
  lookback = max(10, int(_safe_float(ev.get("lookback_bars")) or 60))
  pivot_kind = "high" if bearish else "low"

  for i, idx_tf in enumerate(idx_by_session):
    if idx_tf is None:
      continue
    price_pivots = _find_pivot_indices(price_series, end_idx=idx_tf, lookback=lookback, left=left, right=right, kind=pivot_kind)
    osc_pivots = _find_pivot_indices(osc_series, end_idx=idx_tf, lookback=lookback, left=left, right=right, kind=pivot_kind)
    if len(price_pivots) < 2 or len(osc_pivots) < 2:
      continue

    p1, p2 = price_pivots[-2], price_pivots[-1]
    o1, o2 = osc_pivots[-2], osc_pivots[-1]
    p1v, p2v = _safe_float(price_series[p1]), _safe_float(price_series[p2])
    o1v, o2v = _safe_float(osc_series[o1]), _safe_float(osc_series[o2])
    if p1v is None or p2v is None or o1v is None or o2v is None:
      continue

    if bearish and p2v > p1v and o2v < o1v:
      hits[i] = True
    if bullish and p2v < p1v and o2v > o1v:
      hits[i] = True
  return hits


EVENT_HANDLERS: dict[str, Callable[[dict[str, Any], EventRuntimeContext], list[bool]]] = {
  "CROSS": _event_handler_cross,
  "CROSS_DOWN": _event_handler_cross,
  "CROSS_UP": _event_handler_cross,
  "THRESHOLD": _event_handler_threshold,
  "DIVERGENCE_BEARISH": _event_handler_divergence,
  "DIVERGENCE_BULLISH": _event_handler_divergence,
}


async def run_backtest_from_spec(
  strategy_spec: dict[str, Any],
  start_date: str,
  end_date: str,
  progress_hook: Callable[[int, int, datetime], Awaitable[None]] | None = None,
) -> BacktestResult:
  if strategy_spec.get("timezone") != "America/New_York":
    raise AppError("VALIDATION_ERROR", "timezone must be America/New_York", {"timezone": strategy_spec.get("timezone")})
  if (strategy_spec.get("calendar") or {}).get("value") != "XNYS":
    raise AppError("VALIDATION_ERROR", "calendar must be XNYS", {"calendar": strategy_spec.get("calendar")})
  if (strategy_spec.get("execution") or {}).get("model") != "MOC":
    raise AppError("VALIDATION_ERROR", "execution.model must be MOC", {"execution": strategy_spec.get("execution")})

  universe = strategy_spec.get("universe") or {}
  signal_symbol = str(universe.get("signal_symbol") or "").strip().upper()
  trade_symbol = str(universe.get("trade_symbol") or "").strip().upper()
  if not signal_symbol:
    raise AppError("VALIDATION_ERROR", "universe.signal_symbol is required", {"universe": universe})
  if not trade_symbol:
    raise AppError("VALIDATION_ERROR", "universe.trade_symbol is required", {"universe": universe})

  cal = xcals.get_calendar("XNYS")
  sessions = cal.sessions_in_range(start_date, end_date)
  if len(sessions) == 0:
    raise AppError("DATA_UNAVAILABLE", "No trading sessions in range", {"start": start_date, "end": end_date})

  provider = get_market_data_provider()

  slippage_bps = float((strategy_spec.get("execution") or {}).get("slippage_bps") or 0.0)
  commission_per_trade = float((strategy_spec.get("execution") or {}).get("commission_per_trade") or 0.0)
  session_rows: list[dict[str, Any]] = []
  market_candles: list[dict[str, Any]] = []
  total_sessions = len(sessions)
  skipped_sessions: list[dict[str, Any]] = []

  four_h_ends: list[datetime] = []
  four_h_closes: list[float] = []

  daily_signal_close: list[float] = []
  daily_trade_close: list[float] = []
  daily_close_ts: list[datetime] = []

  session_meta: list[dict[str, Any]] = []
  session_open_by_date: dict[datetime.date, datetime] = {}
  session_close_by_date: dict[datetime.date, datetime] = {}
  for session in sessions:
    session_open = cal.session_open(session).to_pydatetime().replace(tzinfo=timezone.utc)
    session_close = cal.session_close(session).to_pydatetime().replace(tzinfo=timezone.utc)
    d = session_close.date()
    session_open_by_date[d] = session_open
    session_close_by_date[d] = session_close
    session_meta.append({"session_open": session_open, "session_close": session_close, "decision_ts": session_close - timedelta(minutes=2), "session_date": d})

  trade_bars_all = await provider.get_minute_bars(trade_symbol, session_meta[0]["session_open"], session_meta[-1]["session_close"])
  trade_bars_by_date = _group_bars_by_session_date(trade_bars_all, session_open_by_date, session_close_by_date)

  signal_bars_cache: dict[str, dict[datetime.date, list[MinuteBar]]] = {}

  async def _get_signal_bars_by_date(symbol: str) -> dict[datetime.date, list[MinuteBar]]:
    cached = signal_bars_cache.get(symbol)
    if cached is not None:
      return cached
    raw = await provider.get_minute_bars(symbol, session_meta[0]["session_open"], session_meta[-1]["session_close"])
    grouped = _group_bars_by_session_date(raw, session_open_by_date, session_close_by_date)
    signal_bars_cache[symbol] = grouped
    return grouped

  primary_signal_bars = await _get_signal_bars_by_date(signal_symbol)

  for session_idx, meta in enumerate(session_meta, start=1):
    session_open = meta["session_open"]
    session_close = meta["session_close"]
    decision_ts = meta["decision_ts"]
    session_date = meta["session_date"]

    bars_signal: list[MinuteBar] | None = primary_signal_bars.get(session_date)

    if not bars_signal:
      skipped_sessions.append(
        {
          "session_date": session_close.date().isoformat(),
          "reason": "missing_signal_bars",
          "symbol": signal_symbol,
          "errors": ["no bars"],
        }
      )
      if progress_hook:
        try:
          await progress_hook(session_idx, total_sessions, session_close)
        except Exception:
          pass
      continue

    bars_trade = trade_bars_by_date.get(session_date)
    if not bars_trade:
      skipped_sessions.append(
        {
          "session_date": session_date.isoformat(),
          "reason": "missing_trade_bars",
          "symbol": trade_symbol,
          "errors": ["no bars"],
        }
      )
      if progress_hook:
        try:
          await progress_hook(session_idx, total_sessions, session_close)
        except Exception:
          pass
      continue

    session_open_trade = float(bars_trade[0].o)
    session_high_trade = float(max(b.h for b in bars_trade))
    session_low_trade = float(min(b.l for b in bars_trade))
    session_close_trade = float(bars_trade[-1].c)

    decision_bar_signal = _last_bar_at_or_before(bars_signal, decision_ts)
    decision_bar_trade = _last_bar_at_or_before(bars_trade, decision_ts)
    close_bar_signal = _last_bar_at_or_before(bars_signal, session_close)
    close_bar_trade = _last_bar_at_or_before(bars_trade, session_close)
    if decision_bar_signal is None or decision_bar_trade is None or close_bar_signal is None or close_bar_trade is None:
      skipped_sessions.append(
        {
          "session_date": session_date.isoformat(),
          "reason": "missing_decision_or_close_bar",
          "session_open": session_open.isoformat(),
          "session_close": session_close.isoformat(),
        }
      )
      if progress_hook:
        try:
          await progress_hook(session_idx, total_sessions, session_close)
        except Exception:
          pass
      continue

    market_candles.append(
      {
        "t": session_close,
        "o": session_open_trade,
        "h": session_high_trade,
        "l": session_low_trade,
        "c": session_close_trade,
      }
    )

    daily_signal_close.append(float(close_bar_signal.c))
    daily_trade_close.append(float(close_bar_trade.c))
    daily_close_ts.append(session_close)

    for seg_start, seg_end in _session_aligned_4h_segments(session_open, session_close):
      seg_bars = [b for b in bars_signal if seg_start <= b.ts <= seg_end]
      if not seg_bars:
        continue
      seg_close = seg_bars[-1].c
      four_h_ends.append(seg_end)
      four_h_closes.append(float(seg_close))

    session_rows.append(
      {
        "session_open": session_open,
        "session_close": session_close,
        "decision_ts": decision_ts,
        "decision_price_signal": float(decision_bar_signal.c),
        "decision_price_trade": float(decision_bar_trade.c),
        "close_price_trade": float(close_bar_trade.c),
        "close_price_signal": float(close_bar_signal.c),
      }
    )
    if progress_hook:
      try:
        await progress_hook(session_idx, total_sessions, session_close)
      except Exception:
        pass

  def last_closed_4h_idx(decision_ts: datetime) -> int | None:
    idx: int | None = None
    for j, end_ts in enumerate(four_h_ends):
      if end_ts <= decision_ts:
        idx = j
    return idx

  if not daily_trade_close or not session_rows:
    raise AppError(
      "DATA_UNAVAILABLE",
      "Insufficient market data for requested range",
      {
        "start_date": start_date,
        "end_date": end_date,
        "total_sessions": total_sessions,
        "skipped_sessions": skipped_sessions[:20],
      },
    )

  dsl = strategy_spec.get("dsl") or {}
  atomic = (dsl.get("atomic") or {})
  signal_layer = (dsl.get("signal") or {})
  logic_layer = (dsl.get("logic") or {})
  action_layer = (dsl.get("action") or {})
  constants = (atomic.get("constants") or {})
  risk = strategy_spec.get("risk") or {}
  indicator_defaults = _extract_indicator_defaults(strategy_spec)
  default_cooldown = ((risk.get("cooldown") or {}).get("value")) if isinstance(risk.get("cooldown"), dict) else None

  symbol_refs: dict[str, str] = {"signal": signal_symbol, "trade": trade_symbol}
  raw_symbols = atomic.get("symbols")
  if isinstance(raw_symbols, dict):
    for key, val in raw_symbols.items():
      if isinstance(key, str) and isinstance(val, str) and val.strip():
        symbol_refs[key] = val.strip().upper()
  elif isinstance(raw_symbols, list):
    for item in raw_symbols:
      if isinstance(item, dict):
        name = item.get("name")
        ticker = item.get("ticker")
        if isinstance(name, str) and isinstance(ticker, str) and name.strip() and ticker.strip():
          symbol_refs[name.strip()] = ticker.strip().upper()

  def _daily_series(symbol_ref: str) -> list[float]:
    resolved = symbol_refs.get(symbol_ref, signal_symbol)
    return daily_trade_close if resolved == trade_symbol else daily_signal_close

  idx4h_by_session: list[int | None] = [last_closed_4h_idx(row["decision_ts"]) for row in session_rows]
  idx1d_by_session: list[int | None] = [i - 1 if i > 0 else None for i in range(len(session_rows))]
  decision_indicator_values: list[dict[str, dict[str, float | None]]] = [{} for _ in session_rows]
  indicator_tf_series: dict[str, dict[str, Any]] = {}

  def _resolve_operand(operand: Any, session_idx: int) -> float | None:
    if isinstance(operand, (int, float)):
      return _safe_float(operand)
    ref = _read_ref(operand)
    if isinstance(ref, str):
      ind_id, field = _normalize_ref(ref)
      bucket = decision_indicator_values[session_idx].get(ind_id) or {}
      return _safe_float(bucket.get(field))
    if isinstance(operand, dict):
      return _safe_float(operand.get("value"))
    return None

  indicators = signal_layer.get("indicators") if isinstance(signal_layer, dict) else None
  indicator_ctx = IndicatorRuntimeContext(
    session_rows=session_rows,
    idx4h_by_session=idx4h_by_session,
    idx1d_by_session=idx1d_by_session,
    four_h_closes=four_h_closes,
    daily_signal_close=daily_signal_close,
    daily_trade_close=daily_trade_close,
    signal_symbol=signal_symbol,
    trade_symbol=trade_symbol,
    symbol_refs=symbol_refs,
    constants=constants,
    indicator_defaults=indicator_defaults,
    decision_indicator_values=decision_indicator_values,
    indicator_tf_series=indicator_tf_series,
  )
  if isinstance(indicators, list):
    for ind in indicators:
      if not isinstance(ind, dict):
        continue
      ind_id = str(ind.get("id") or "").strip()
      if not ind_id:
        continue
      ind_type = str(ind.get("type") or "").strip().upper()
      handler = INDICATOR_HANDLERS.get(ind_type)
      if handler is None:
        continue
      handler(ind, ind_id, indicator_ctx)

  event_hits: dict[str, list[bool]] = {}
  event_type_by_id: dict[str, str] = {}
  event_ctx = EventRuntimeContext(
    session_rows=session_rows,
    idx4h_by_session=idx4h_by_session,
    idx1d_by_session=idx1d_by_session,
    indicator_tf_series=indicator_tf_series,
    decision_indicator_values=decision_indicator_values,
  )
  events = signal_layer.get("events") if isinstance(signal_layer, dict) else None
  if isinstance(events, list):
    for ev in events:
      if not isinstance(ev, dict):
        continue
      event_id = str(ev.get("id") or "").strip()
      if not event_id:
        continue
      event_type = str(ev.get("type") or "").strip().upper()
      event_type_by_id[event_id] = event_type
      handler = EVENT_HANDLERS.get(event_type)
      hits = handler(ev, event_ctx) if handler else [False] * len(session_rows)
      event_hits[event_id] = hits

  def _eval_condition(cond: Any, session_idx: int) -> bool:
    if not isinstance(cond, dict):
      return False
    if "all" in cond and isinstance(cond.get("all"), list):
      return all(_eval_condition(c, session_idx) for c in cond["all"])
    if "any" in cond and isinstance(cond.get("any"), list):
      return any(_eval_condition(c, session_idx) for c in cond["any"])
    if "event_within" in cond and isinstance(cond.get("event_within"), dict):
      ev_info = cond["event_within"]
      event_id = str(ev_info.get("event_id") or "")
      hits = event_hits.get(event_id) or []
      if not hits:
        return False
      lookback = _parse_lookback_days(ev_info.get("lookback") or constants.get("lookback"), default=5)
      start_idx = max(0, session_idx - lookback + 1)
      return any(hits[start_idx : session_idx + 1])
    if isinstance(cond.get("event_id"), str):
      event_id = str(cond.get("event_id"))
      hits = event_hits.get(event_id) or []
      if not hits:
        return False
      scope = str(cond.get("scope") or "").upper()
      event_type = event_type_by_id.get(event_id, "")
      if scope in ("LAST_CLOSED_4H_BAR", "LAST_CLOSED_1D", "BAR", ""):
        if scope == "" and event_type in ("CROSS", "CROSS_UP", "CROSS_DOWN"):
          lookback = _parse_lookback_days(constants.get("lookback"), default=5)
          start_idx = max(0, session_idx - lookback + 1)
          return any(hits[start_idx : session_idx + 1])
        return bool(hits[session_idx]) if session_idx < len(hits) else False
      lookback = _parse_lookback_days(scope if scope else constants.get("lookback"), default=1)
      start_idx = max(0, session_idx - lookback + 1)
      return any(hits[start_idx : session_idx + 1])
    if "flag_is_true" in cond and isinstance(cond.get("flag_is_true"), dict):
      flag_name = str((cond.get("flag_is_true") or {}).get("flag") or "").strip()
      return bool(flag_name) and bool(state_flags.get(flag_name))
    if "on_month_day" in cond and isinstance(cond.get("on_month_day"), dict):
      gate = cond.get("on_month_day") or {}
      month_raw = gate.get("month")
      day_raw = gate.get("day")
      if not isinstance(month_raw, int) or not isinstance(day_raw, int):
        return False
      if session_idx < 0 or session_idx >= len(session_rows):
        return False
      d = session_rows[session_idx]["session_close"].date()
      return d.month == month_raw and d.day == day_raw
    if "on_date" in cond and isinstance(cond.get("on_date"), dict):
      gate = cond.get("on_date") or {}
      target_date = _parse_iso_date(gate.get("date"))
      if target_date is None:
        return False
      if session_idx < 0 or session_idx >= len(session_rows):
        return False
      d = session_rows[session_idx]["session_close"].date()
      return d == target_date
    if "lt" in cond and isinstance(cond.get("lt"), dict):
      left = _resolve_operand(cond["lt"].get("a"), session_idx)
      right = _resolve_operand(cond["lt"].get("b"), session_idx)
      return left is not None and right is not None and left < right
    if "gt" in cond and isinstance(cond.get("gt"), dict):
      left = _resolve_operand(cond["gt"].get("a"), session_idx)
      right = _resolve_operand(cond["gt"].get("b"), session_idx)
      return left is not None and right is not None and left > right
    if isinstance(cond.get("op"), str):
      op = str(cond.get("op"))
      left = _resolve_operand(cond.get("left"), session_idx)
      right = _resolve_operand(cond.get("right"), session_idx)
      return _compare(op, left, right)
    return False

  action_map: dict[str, dict[str, Any]] = {}
  raw_actions = action_layer.get("actions") if isinstance(action_layer, dict) else None
  if isinstance(raw_actions, list):
    for action in raw_actions:
      if isinstance(action, dict):
        action_id = str(action.get("id") or "").strip()
        if action_id:
          action_map[action_id] = action

  initial_position_qty = max(0.0, float(constants.get("initial_position_qty") or 100.0))
  initial_cash = max(0.0, float(constants.get("initial_cash") or 0.0))
  if initial_position_qty <= 0 and initial_cash <= 0:
    initial_cash = 10000.0

  position_qty = initial_position_qty
  avg_cost = daily_trade_close[0] if position_qty > 0 else 0.0
  cash = initial_cash
  initial_equity = cash + position_qty * daily_trade_close[0]

  trades: list[dict[str, Any]] = []
  equity: list[dict[str, Any]] = []
  state_flags: dict[str, bool] = {}
  action_last_exec: dict[str, int] = {}
  rules = logic_layer.get("rules") if isinstance(logic_layer, dict) else None
  rules_list = rules if isinstance(rules, list) else []

  for i, row in enumerate(session_rows):
    session_close = row["session_close"]
    decision_ts = row["decision_ts"]
    session_equity_px = float(row["close_price_trade"])
    equity.append({"t": session_close, "v": float(cash + position_qty * session_equity_px)})

    for rule in rules_list:
      if not isinstance(rule, dict):
        continue
      rule_id = str(rule.get("id") or "rule")
      when_block = rule.get("when") or {}
      if not _eval_condition(when_block, i):
        continue
      then_actions = rule.get("then") if isinstance(rule.get("then"), list) else []
      for action_item in then_actions:
        if isinstance(action_item, dict):
          action_id = str(action_item.get("action_id") or action_item.get("id") or "").strip()
        else:
          action_id = str(action_item or "").strip()
        if not action_id:
          continue
        action = action_map.get(action_id)
        if not action:
          continue

        cooldown_days = _parse_lookback_days(action.get("cooldown") or default_cooldown, default=1)
        last_idx = action_last_exec.get(action_id)
        if last_idx is not None and i - last_idx < cooldown_days:
          continue

        action_type = str(action.get("type") or "ORDER").upper()
        if action_type == "SET_FLAG":
          flag_name = str(action.get("flag") or action.get("value") or "").strip()
          if flag_name:
            state_flags[flag_name] = True
            action_last_exec[action_id] = i
          continue

        side = str(action.get("side") or "SELL").upper()
        symbol_ref = str(action.get("symbol_ref") or "trade")
        symbol = symbol_refs.get(symbol_ref, trade_symbol)
        is_trade_symbol = symbol == trade_symbol
        fill_px_raw = float(row["close_price_trade"] if is_trade_symbol else row["close_price_signal"])

        qty_cfg = action.get("qty") if isinstance(action.get("qty"), dict) else {}
        mode = str((qty_cfg or {}).get("mode") or (qty_cfg or {}).get("type") or "FRACTION_OF_POSITION").upper()
        qty_val = _safe_float((qty_cfg or {}).get("value"))
        if qty_val is None:
          qty_val = 0.0

        qty = 0.0
        if side == "SELL":
          if mode == "FULL_POSITION":
            qty = float(int(position_qty))
          elif mode == "FRACTION_OF_POSITION":
            qty = float(int(position_qty * qty_val))
          elif mode in ("FIXED", "FIXED_SHARES", "SHARES", "ABSOLUTE"):
            qty = float(int(qty_val))
          elif mode == "NOTIONAL_USD":
            qty = float(int(max(qty_val, 0.0) / fill_px_raw)) if fill_px_raw > 0 else 0.0
          else:
            qty = float(int(qty_val))
          qty = min(qty, position_qty)
        elif side == "BUY":
          if mode == "FULL_POSITION":
            qty = float(int(max(cash - commission_per_trade, 0.0) / fill_px_raw)) if fill_px_raw > 0 else 0.0
          elif mode in ("FRACTION_OF_CASH", "FRACTION_OF_EQUITY"):
            budget = cash * max(0.0, qty_val)
            qty = float(int(budget / fill_px_raw)) if fill_px_raw > 0 else 0.0
          elif mode == "NOTIONAL_USD":
            qty = float(int(max(qty_val, 0.0) / fill_px_raw)) if fill_px_raw > 0 else 0.0
          elif mode in ("ABSOLUTE", "FIXED", "FIXED_SHARES", "SHARES"):
            qty = float(int(qty_val))
          elif mode == "FRACTION_OF_POSITION":
            qty = float(int(max(position_qty, 1.0) * qty_val))
          else:
            qty = float(int(qty_val))
        if qty < 1:
          continue

        if side == "SELL":
          fill_px = fill_px_raw * (1.0 - (slippage_bps / 10000.0))
          proceeds = qty * fill_px - commission_per_trade
          realized = (fill_px - avg_cost) * qty if avg_cost > 0 else 0.0
          pnl_pct = ((fill_px / avg_cost) - 1.0) * 100.0 if avg_cost > 0 else 0.0
          cash += proceeds
          position_qty -= qty
          if position_qty < 1e-9:
            position_qty = 0.0
          trade_pnl = float(realized)
          trade_pnl_pct = float(pnl_pct)
        else:
          fill_px = fill_px_raw * (1.0 + (slippage_bps / 10000.0))
          total_cost = qty * fill_px + commission_per_trade
          if total_cost > cash:
            max_qty = float(int(max((cash - commission_per_trade), 0.0) / fill_px)) if fill_px > 0 else 0.0
            qty = max_qty
            if qty < 1:
              continue
            total_cost = qty * fill_px + commission_per_trade
          prev_pos = position_qty
          cash -= total_cost
          position_qty += qty
          avg_cost = ((avg_cost * prev_pos) + (fill_px * qty)) / position_qty if position_qty > 0 else 0.0
          trade_pnl = None
          trade_pnl_pct = None

        action_last_exec[action_id] = i
        trades.append(
          {
            "decision_time": decision_ts,
            "fill_time": session_close,
            "symbol": symbol,
            "side": side,
            "qty": qty,
            "fill_price": float(fill_px),
            "cost": {"slippage_bps": slippage_bps, "commission_per_trade": commission_per_trade},
            "why": {
              "rule_id": rule_id,
              "action_id": action_id,
              "signal_symbol": signal_symbol,
              "indicators": decision_indicator_values[i],
            },
            "pnl": trade_pnl,
            "pnl_pct": trade_pnl_pct,
          }
        )

  final_equity = float(cash + position_qty * daily_trade_close[-1])
  returns = []
  for i in range(1, len(equity)):
    prev = equity[i - 1]["v"]
    cur = equity[i]["v"]
    if prev > 0:
      returns.append((cur / prev) - 1.0)

  returns_arr = np.array(returns, dtype=float) if returns else np.array([], dtype=float)
  sharpe = 0.0
  if returns_arr.size > 2 and returns_arr.std() > 1e-12:
    sharpe = float((returns_arr.mean() / returns_arr.std()) * np.sqrt(252))

  eq_vals = np.array([p["v"] for p in equity], dtype=float) if equity else np.array([initial_equity], dtype=float)
  peaks = np.maximum.accumulate(eq_vals)
  drawdowns = (eq_vals / peaks) - 1.0
  max_dd = float(drawdowns.min()) if drawdowns.size else 0.0

  wins = [1 for t in trades if float(t.get("pnl") or 0.0) > 0.0]
  win_rate = float(sum(wins) / len(trades)) if trades else 0.0

  kpis = {
    "return_pct": (final_equity / initial_equity - 1.0) * 100.0 if initial_equity > 0 else 0.0,
    "cagr_pct": 0.0,
    "sharpe": sharpe,
    "max_dd_pct": max_dd * 100.0,
    "trades": len(trades),
    "win_rate": win_rate,
    "avg_holding_days": 0.0,
  }

  artifacts = {
    "resolved": {
      "universe": {"signal_symbol": signal_symbol, "trade_symbol": trade_symbol},
      "calendar": {"type": "exchange", "value": "XNYS"},
      "execution": {"model": "MOC"},
    },
    "data_health": {
      **compute_data_health(provider, signal_symbol),
      "total_sessions": total_sessions,
      "used_sessions": len(session_rows),
      "skipped_sessions_count": len(skipped_sessions),
      "missing_ratio": (len(skipped_sessions) / total_sessions) if total_sessions > 0 else 1.0,
      "gaps": skipped_sessions[:50],
    },
  }

  return BacktestResult(equity=equity, market=market_candles, trades=trades, kpis=kpis, artifacts=artifacts)
