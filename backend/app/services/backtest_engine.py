from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import exchange_calendars as xcals
import numpy as np

from app.core.errors import AppError
from app.services.market_data import MinuteBar, compute_data_health, get_market_data_provider


@dataclass(frozen=True)
class BacktestResult:
  equity: list[dict[str, Any]]
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
  signal_symbol = str(universe.get("signal_symbol") or "QQQ")
  trade_symbol = str(universe.get("trade_symbol") or "TQQQ")
  fallbacks = universe.get("signal_symbol_fallbacks") or ["NDX", "QQQ"]

  cal = xcals.get_calendar("XNYS")
  sessions = cal.sessions_in_range(start_date, end_date)
  if len(sessions) == 0:
    raise AppError("DATA_UNAVAILABLE", "No trading sessions in range", {"start": start_date, "end": end_date})

  provider = get_market_data_provider()

  slippage_bps = float((strategy_spec.get("execution") or {}).get("slippage_bps") or 0.0)
  commission_per_trade = float((strategy_spec.get("execution") or {}).get("commission_per_trade") or 0.0)
  sell_fraction = float((((strategy_spec.get("dsl") or {}).get("atomic") or {}).get("constants") or {}).get("sell_fraction") or 0.3)
  lookback_days = 5

  session_rows: list[dict[str, Any]] = []
  used_fallback = False
  resolved_signal_symbol = signal_symbol
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

  primary_signal_bars = await _get_signal_bars_by_date(resolved_signal_symbol)

  for session_idx, meta in enumerate(session_meta, start=1):
    session_open = meta["session_open"]
    session_close = meta["session_close"]
    decision_ts = meta["decision_ts"]
    session_date = meta["session_date"]

    bars_signal: list[MinuteBar] | None = primary_signal_bars.get(session_date)
    load_errors: list[str] = []
    chosen_signal = resolved_signal_symbol
    if not bars_signal:
      for s in [resolved_signal_symbol] + [x for x in fallbacks if x != resolved_signal_symbol]:
        try:
          grouped = await _get_signal_bars_by_date(s)
          candidate = grouped.get(session_date)
          if candidate:
            bars_signal = candidate
            chosen_signal = s
            break
          load_errors.append(f"{s}: no bars")
        except Exception as e:
          load_errors.append(f"{s}: {str(e)}")
          continue

    if not bars_signal:
      skipped_sessions.append(
        {
          "session_date": session_close.date().isoformat(),
          "reason": "missing_signal_bars",
          "symbol": resolved_signal_symbol,
          "errors": load_errors[-5:],
        }
      )
      if progress_hook:
        try:
          await progress_hook(session_idx, total_sessions, session_close)
        except Exception:
          pass
      continue

    if chosen_signal != resolved_signal_symbol:
      used_fallback = True
      resolved_signal_symbol = chosen_signal
      primary_signal_bars = signal_bars_cache.get(resolved_signal_symbol, primary_signal_bars)

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

    decision_bar_signal = _last_bar_at_or_before(bars_signal, decision_ts)
    close_bar_signal = _last_bar_at_or_before(bars_signal, session_close)
    close_bar_trade = _last_bar_at_or_before(bars_trade, session_close)
    if decision_bar_signal is None or close_bar_signal is None or close_bar_trade is None:
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
        "close_price_trade": float(close_bar_trade.c),
      }
    )
    if progress_hook:
      try:
        await progress_hook(session_idx, total_sessions, session_close)
      except Exception:
        pass

  macd_line, macd_sig = _macd(four_h_closes, 12, 26, 9)
  cross_down = [_cross_down(macd_line, macd_sig, i) for i in range(len(four_h_closes))]
  session_index_by_date = {ts.date(): idx for idx, ts in enumerate(daily_close_ts)}
  cross_events_per_session = [0] * len(daily_close_ts)
  for idx_4h, end_ts in enumerate(four_h_ends):
    if not cross_down[idx_4h]:
      continue
    session_idx = session_index_by_date.get(end_ts.date())
    if session_idx is not None:
      cross_events_per_session[session_idx] += 1
  cross_events_prefix: list[int] = []
  running_cross_count = 0
  for c in cross_events_per_session:
    running_cross_count += c
    cross_events_prefix.append(running_cross_count)

  def has_cross_down_in_window(start_idx: int, end_idx: int) -> bool:
    if end_idx < 0 or start_idx > end_idx or not cross_events_prefix:
      return False
    left = cross_events_prefix[start_idx - 1] if start_idx > 0 else 0
    return (cross_events_prefix[end_idx] - left) > 0

  def last_closed_4h_idx(decision_ts: datetime) -> int | None:
    idx: int | None = None
    for i, end_ts in enumerate(four_h_ends):
      if end_ts <= decision_ts:
        idx = i
    return idx

  def ma5_last_closed_1d(session_idx: int) -> float | None:
    if session_idx < 5:
      return None
    window = daily_signal_close[session_idx - 5 : session_idx]
    if len(window) < 5:
      return None
    return float(np.mean(window))

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

  position_qty = 100.0
  avg_cost = daily_trade_close[0]
  cash = 0.0
  initial_equity = position_qty * daily_trade_close[0]

  trades: list[dict[str, Any]] = []
  equity: list[dict[str, Any]] = []

  cooldown_until_session_idx: int = -1

  for i, row in enumerate(session_rows):
    session_close = row["session_close"]
    decision_ts = row["decision_ts"]
    decision_px = float(row["decision_price_signal"])
    fill_px_raw = float(row["close_price_trade"])

    equity.append({"t": session_close, "v": float(cash + position_qty * fill_px_raw)})

    if i <= cooldown_until_session_idx:
      continue

    ma5 = ma5_last_closed_1d(i)
    if ma5 is None:
      continue

    idx4h = last_closed_4h_idx(decision_ts)
    if idx4h is None:
      continue

    lookback_start = max(0, i - lookback_days + 1)
    event_ok = has_cross_down_in_window(lookback_start, i)

    state_ok = decision_px < ma5
    if not (event_ok and state_ok):
      continue

    qty = float(int(position_qty * sell_fraction))
    if qty < 1:
      continue

    slip_mult = 1.0 - (slippage_bps / 10000.0)
    fill_px = fill_px_raw * slip_mult
    proceeds = qty * fill_px - commission_per_trade
    realized = (fill_px - avg_cost) * qty
    pnl_pct = ((fill_px / avg_cost) - 1.0) * 100.0 if avg_cost > 0 else 0.0

    cash += proceeds
    position_qty -= qty

    trades.append(
      {
        "decision_time": decision_ts,
        "fill_time": session_close,
        "symbol": trade_symbol,
        "side": "SELL",
        "qty": qty,
        "fill_price": float(fill_px),
        "cost": {"slippage_bps": slippage_bps, "commission_per_trade": commission_per_trade},
        "why": {
          "macd_4h_cross": True,
          "close_15_58": decision_px,
          "ma5_last_closed": ma5,
          "signal_symbol": resolved_signal_symbol,
          "is_fallback": used_fallback,
        },
        "pnl": float(realized),
        "pnl_pct": float(pnl_pct),
      }
    )

    cooldown_until_session_idx = i + 1

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
      "universe": {"signal_symbol": resolved_signal_symbol, "trade_symbol": trade_symbol},
      "calendar": {"type": "exchange", "value": "XNYS"},
      "execution": {"model": "MOC"},
      "fallback": {"is_fallback": used_fallback},
    },
    "data_health": {
      **compute_data_health(provider, resolved_signal_symbol, used_fallback),
      "total_sessions": total_sessions,
      "used_sessions": len(session_rows),
      "skipped_sessions_count": len(skipped_sessions),
      "missing_ratio": (len(skipped_sessions) / total_sessions) if total_sessions > 0 else 1.0,
      "gaps": skipped_sessions[:50],
    },
  }

  return BacktestResult(equity=equity, trades=trades, kpis=kpis, artifacts=artifacts)
