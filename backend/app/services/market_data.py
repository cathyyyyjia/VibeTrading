from __future__ import annotations

import random
import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import httpx

from app.core.config import settings
from app.core.errors import AppError


@dataclass(frozen=True)
class MinuteBar:
  ts: datetime
  o: float
  h: float
  l: float
  c: float
  v: float


class MarketDataProvider:
  async def get_minute_bars(self, symbol: str, start: datetime, end: datetime) -> list[MinuteBar]:
    raise NotImplementedError


class SyntheticProvider(MarketDataProvider):
  async def get_minute_bars(self, symbol: str, start: datetime, end: datetime) -> list[MinuteBar]:
    seed = hash((symbol, start.date().isoformat(), end.date().isoformat())) & 0xFFFFFFFF
    rng = random.Random(seed)

    bars: list[MinuteBar] = []
    t = start
    price = 100.0 + (seed % 50)
    while t <= end:
      drift = 0.00002
      shock = rng.gauss(0, 0.0012)
      ret = drift + shock
      next_price = max(1.0, price * (1.0 + ret))
      o = price
      c = next_price
      h = max(o, c) * (1.0 + abs(rng.gauss(0, 0.0006)))
      l = min(o, c) * (1.0 - abs(rng.gauss(0, 0.0006)))
      v = float(1000 + int(abs(rng.gauss(0, 250))))
      bars.append(MinuteBar(ts=t, o=o, h=h, l=l, c=c, v=v))
      price = next_price
      t += timedelta(minutes=1)
    return bars


class PolygonProvider(MarketDataProvider):
  def __init__(self, api_key: str) -> None:
    self._api_key = api_key

  async def get_minute_bars(self, symbol: str, start: datetime, end: datetime) -> list[MinuteBar]:
    if not self._api_key:
      raise AppError("DATA_UNAVAILABLE", "POLYGON_API_KEY is missing", http_status=400)

    start_s = start.date().isoformat()
    end_s = end.date().isoformat()
    url = f"https://api.polygon.io/v2/aggs/ticker/{symbol}/range/1/minute/{start_s}/{end_s}"
    params = {"adjusted": "true", "sort": "asc", "limit": "50000", "apiKey": self._api_key}

    timeout = httpx.Timeout(30.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
      resp = await client.get(url, params=params)
      if resp.status_code >= 400:
        raise AppError(
          "DATA_UNAVAILABLE",
          "Polygon request failed",
          {"status": resp.status_code, "body": resp.text[:2000]},
          http_status=502,
        )
      payload = resp.json()

    results = payload.get("results") or []
    bars: list[MinuteBar] = []
    for r in results:
      ts = datetime.fromtimestamp(r["t"] / 1000, tz=timezone.utc)
      bars.append(
        MinuteBar(
          ts=ts,
          o=float(r["o"]),
          h=float(r["h"]),
          l=float(r["l"]),
          c=float(r["c"]),
          v=float(r.get("v") or 0),
        )
      )
    if not bars:
      raise AppError("DATA_UNAVAILABLE", "No bars returned", {"symbol": symbol, "start": start_s, "end": end_s}, http_status=404)
    return bars


class AlpacaProvider(MarketDataProvider):
  def __init__(self, base_url: str, api_key: str, api_secret: str, feed: str) -> None:
    self._base_url = base_url.rstrip("/")
    self._api_key = api_key
    self._api_secret = api_secret
    self._feed = feed

  async def get_minute_bars(self, symbol: str, start: datetime, end: datetime) -> list[MinuteBar]:
    if not self._api_key or not self._api_secret:
      raise AppError("CONFIG_ERROR", "Alpaca credentials are missing", {"required": ["ALPACA_PAPER_API_KEY", "ALPACA_PAPER_API_SECRET"]}, http_status=500)

    headers = {
      "APCA-API-KEY-ID": self._api_key,
      "APCA-API-SECRET-KEY": self._api_secret,
    }
    bars: list[MinuteBar] = []
    next_page_token: str | None = None

    start_s = start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    end_s = end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    timeout = httpx.Timeout(30.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
      for _ in range(20):
        params: dict[str, str] = {
          "symbols": symbol,
          "timeframe": "1Min",
          "start": start_s,
          "end": end_s,
          "adjustment": "all",
          "sort": "asc",
          "limit": "10000",
          "feed": self._feed,
        }
        if next_page_token:
          params["page_token"] = next_page_token

        resp: httpx.Response | None = None
        for attempt in range(5):
          resp = await client.get(f"{self._base_url}/v2/stocks/bars", params=params, headers=headers)
          if resp.status_code < 400:
            break
          # Handle transient throttling/server errors with bounded retries.
          if resp.status_code in (429, 500, 502, 503, 504) and attempt < 4:
            await asyncio.sleep(min(0.5 * (2**attempt), 5.0))
            continue
          raise AppError(
            "DATA_UNAVAILABLE",
            "Alpaca request failed",
            {"status": resp.status_code, "body": resp.text[:2000], "symbol": symbol},
            http_status=502,
          )
        if resp is None:
          raise AppError("DATA_UNAVAILABLE", "Alpaca request failed", {"symbol": symbol}, http_status=502)
        payload = resp.json()
        raw = (payload.get("bars") or {}).get(symbol) or []
        for r in raw:
          bars.append(
            MinuteBar(
              ts=datetime.fromisoformat(str(r["t"]).replace("Z", "+00:00")).astimezone(timezone.utc),
              o=float(r["o"]),
              h=float(r["h"]),
              l=float(r["l"]),
              c=float(r["c"]),
              v=float(r.get("v") or 0),
            )
          )

        next_page_token = payload.get("next_page_token")
        if not next_page_token:
          break

    if not bars:
      raise AppError("DATA_UNAVAILABLE", "No Alpaca bars returned", {"symbol": symbol, "start": start_s, "end": end_s}, http_status=404)
    bars.sort(key=lambda b: b.ts)
    return bars


def get_market_data_provider() -> MarketDataProvider:
  provider = settings.market_data_provider.lower()
  if provider == "alpaca":
    if not settings.alpaca_paper_api_key or not settings.alpaca_paper_api_secret:
      raise AppError(
        "CONFIG_ERROR",
        "Alpaca provider selected but credentials are missing",
        {"required": ["ALPACA_PAPER_API_KEY", "ALPACA_PAPER_API_SECRET"]},
        http_status=500,
      )
    return AlpacaProvider(
      base_url=str(settings.alpaca_data_base_url),
      api_key=settings.alpaca_paper_api_key,
      api_secret=settings.alpaca_paper_api_secret,
      feed=settings.alpaca_data_feed,
    )
  if provider == "polygon":
    if settings.polygon_api_key:
      return PolygonProvider(settings.polygon_api_key)
    return SyntheticProvider()
  if provider == "synthetic":
    return SyntheticProvider()
  return SyntheticProvider()


def compute_data_health(provider: MarketDataProvider, signal_symbol: str, used_fallback: bool) -> dict[str, Any]:
  source: Literal["primary", "fallback"] = "fallback" if used_fallback else "primary"
  return {"source": source, "is_fallback": used_fallback, "missing_ratio": 0.0, "gaps": []}
