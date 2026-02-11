// ============================================================
// Mock Market Data Generator
// Generates realistic 1-minute OHLCV candles for QQQ
// covering 30 trading days (approximately 6 weeks calendar)
// ============================================================

import { seededRandom } from "./seed";

export interface Candle {
  t: number; // Unix timestamp in milliseconds
  o: number; // Open
  h: number; // High
  l: number; // Low
  c: number; // Close
  v: number; // Volume
  vwap: number; // Volume-weighted average price
}

/**
 * US Eastern Time market hours:
 * Regular session: 09:30 - 16:00 ET
 * Pre-close buffer: 15:58 ET (2 minutes before close)
 */
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MIN = 30;
const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MIN = 0;
const MINUTES_PER_DAY = (MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MIN) - (MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MIN); // 390

/**
 * Generate 30 trading days of 1-minute QQQ candles.
 *
 * @param seed - Deterministic seed for reproducibility
 * @param symbol - Symbol name (default "QQQ")
 * @param startDate - Start date string (default "2024-10-01")
 * @param tradingDays - Number of trading days (default 30)
 * @returns Array of Candle objects
 */
export function generateMarketData(
  seed: number = 42,
  symbol: string = "QQQ",
  startDate: string = "2024-10-01",
  tradingDays: number = 30
): Candle[] {
  const rng = seededRandom(seed);
  const candles: Candle[] = [];

  // QQQ base price around $480 (Oct 2024 level)
  let basePrice = 480.0;
  // Daily drift and volatility
  const dailyDrift = 0.0003; // slight upward bias
  const intraMinVol = 0.0004; // per-minute volatility
  const dailyGapVol = 0.005; // overnight gap volatility

  let currentDate = new Date(startDate + "T00:00:00-05:00"); // EST

  for (let day = 0; day < tradingDays; ) {
    // Skip weekends
    const dow = currentDate.getDay();
    if (dow === 0 || dow === 6) {
      currentDate = new Date(currentDate.getTime() + 86400000);
      continue;
    }

    // Overnight gap
    const gapReturn = (rng() - 0.48) * dailyGapVol * 2;
    basePrice *= 1 + gapReturn;

    // Intraday pattern: U-shaped volume, slight morning dip then recovery
    let price = basePrice;
    const dayCandles: Candle[] = [];

    for (let min = 0; min < MINUTES_PER_DAY; min++) {
      const hour = MARKET_OPEN_HOUR + Math.floor((MARKET_OPEN_MIN + min) / 60);
      const minute = (MARKET_OPEN_MIN + min) % 60;

      // Time of day factor (0-1)
      const tod = min / MINUTES_PER_DAY;

      // U-shaped volume pattern
      const volFactor =
        1.5 * Math.exp(-10 * tod) + // opening surge
        0.5 + // base
        2.0 * Math.exp(-10 * (1 - tod)); // closing surge

      // Intraday momentum: slight drift
      const minuteReturn =
        dailyDrift / MINUTES_PER_DAY +
        (rng() - 0.5) * intraMinVol * 2;

      const open = price;
      price *= 1 + minuteReturn;

      // High/Low spread
      const spread = Math.abs(minuteReturn) + intraMinVol * rng() * 0.5;
      const high = Math.max(open, price) * (1 + spread * rng());
      const low = Math.min(open, price) * (1 - spread * rng());

      // Volume: base ~50k shares/min for QQQ, modulated by U-shape
      const volume = Math.round((30000 + rng() * 40000) * volFactor);

      // VWAP approximation: weighted toward close
      const vwap = (open * 0.2 + high * 0.2 + low * 0.2 + price * 0.4);

      // Compute timestamp in EST
      const ts = new Date(currentDate);
      ts.setHours(hour, minute, 0, 0);
      // Convert EST to UTC by adding 5 hours
      const utcTs = ts.getTime() + 5 * 3600000;

      dayCandles.push({
        t: utcTs,
        o: round4(open),
        h: round4(high),
        l: round4(low),
        c: round4(price),
        v: volume,
        vwap: round4(vwap),
      });
    }

    candles.push(...dayCandles);
    basePrice = price; // carry forward closing price
    day++;
    currentDate = new Date(currentDate.getTime() + 86400000);
  }

  return candles;
}

/**
 * Aggregate 1-minute candles into higher timeframes.
 *
 * @param candles - Array of 1-minute candles (must be sorted by t)
 * @param intervalMinutes - Target interval in minutes (e.g., 240 for 4H, 390 for 1D)
 * @returns Aggregated candles
 */
export function aggregateCandles(
  candles: Candle[],
  intervalMinutes: number
): Candle[] {
  if (candles.length === 0) return [];

  const intervalMs = intervalMinutes * 60 * 1000;
  const result: Candle[] = [];
  let bucket: Candle[] = [];
  let bucketStart = Math.floor(candles[0].t / intervalMs) * intervalMs;

  for (const c of candles) {
    const cBucket = Math.floor(c.t / intervalMs) * intervalMs;
    if (cBucket !== bucketStart && bucket.length > 0) {
      result.push(mergeBucket(bucket, bucketStart));
      bucket = [];
      bucketStart = cBucket;
    }
    bucket.push(c);
  }
  if (bucket.length > 0) {
    result.push(mergeBucket(bucket, bucketStart));
  }

  return result;
}

function mergeBucket(bucket: Candle[], bucketStart: number): Candle {
  const o = bucket[0].o;
  const c = bucket[bucket.length - 1].c;
  const h = Math.max(...bucket.map((b) => b.h));
  const l = Math.min(...bucket.map((b) => b.l));
  const totalVol = bucket.reduce((s, b) => s + b.v, 0);
  const vwapSum = bucket.reduce((s, b) => s + b.vwap * b.v, 0);
  const vwap = totalVol > 0 ? vwapSum / totalVol : (o + c) / 2;

  return {
    t: bucketStart,
    o: round4(o),
    h: round4(h),
    l: round4(l),
    c: round4(c),
    v: totalVol,
    vwap: round4(vwap),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ============================================================
// Indicator Calculations
// ============================================================

/**
 * Simple Moving Average
 */
export function calcSMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += closes[j];
      }
      result.push(round4(sum / period));
    }
  }
  return result;
}

/**
 * Exponential Moving Average
 */
export function calcEMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      // First EMA = SMA
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[j];
      result.push(round4(sum / period));
    } else {
      const prev = result[i - 1]!;
      result.push(round4(closes[i] * k + prev * (1 - k)));
    }
  }
  return result;
}

/**
 * MACD (Moving Average Convergence Divergence)
 * Returns { macd, signal, histogram } arrays
 */
export function calcMACD(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
  signalPeriod: number = 9
): {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
} {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);

  const macdLine: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdLine.push(round4(emaFast[i]! - emaSlow[i]!));
    } else {
      macdLine.push(null);
    }
  }

  // Signal line = EMA of MACD line
  const validMacd = macdLine.filter((v) => v !== null) as number[];
  const signalLine = calcEMA(validMacd, signalPeriod);

  // Align signal back to full array
  const signal: (number | null)[] = [];
  const histogram: (number | null)[] = [];
  let sigIdx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null) {
      signal.push(null);
      histogram.push(null);
    } else {
      const sig = signalLine[sigIdx] ?? null;
      signal.push(sig);
      histogram.push(
        sig !== null ? round4(macdLine[i]! - sig) : null
      );
      sigIdx++;
    }
  }

  return { macd: macdLine, signal, histogram };
}

/**
 * Detect MACD death cross (main crosses below signal)
 * Returns true if cross happened at the given index
 */
export function isMACDDeathCross(
  macd: (number | null)[],
  signal: (number | null)[],
  idx: number
): boolean {
  if (idx < 1) return false;
  const prevM = macd[idx - 1];
  const prevS = signal[idx - 1];
  const currM = macd[idx];
  const currS = signal[idx];
  if (prevM === null || prevS === null || currM === null || currS === null) return false;
  return prevM >= prevS && currM < currS;
}

/**
 * Detect MACD golden cross (main crosses above signal)
 */
export function isMACDGoldenCross(
  macd: (number | null)[],
  signal: (number | null)[],
  idx: number
): boolean {
  if (idx < 1) return false;
  const prevM = macd[idx - 1];
  const prevS = signal[idx - 1];
  const currM = macd[idx];
  const currS = signal[idx];
  if (prevM === null || prevS === null || currM === null || currS === null) return false;
  return prevM <= prevS && currM > currS;
}
