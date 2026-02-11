from __future__ import annotations

import pytest

from app.services.backtest_engine import run_backtest_from_spec
from app.services.spec_builder import build_default_mvp_spec


@pytest.mark.asyncio
async def test_backtest_has_moc_fill_time_at_close() -> None:
  spec = build_default_mvp_spec("mvp", "BACKTEST_ONLY")
  result = await run_backtest_from_spec(spec, start_date="2024-01-02", end_date="2024-01-31")
  import exchange_calendars as xcals

  cal = xcals.get_calendar("XNYS")
  for t in result.trades:
    assert t["fill_time"] >= t["decision_time"]
    session = cal.date_to_session(t["fill_time"].date(), direction="none")
    close_ts = cal.session_close(session).to_pydatetime()
    assert t["fill_time"].replace(tzinfo=None) == close_ts.replace(tzinfo=None)
