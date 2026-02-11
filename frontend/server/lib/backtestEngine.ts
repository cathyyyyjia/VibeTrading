// ============================================================
// Clock-Driven Backtest Engine
//
// Core design principles from the Vibe Trading spec:
// 1. Time pointer moves in 1-minute steps through historical data
// 2. At 15:58 ET (or configured trigger time), run DSL logic
// 3. 4H and 1D indicators MUST use offset >= 1 (LAST_CLOSED bars only)
// 4. Outputs: Sharpe Ratio, Max Drawdown, Win Rate, Equity Curve, Trades
// ============================================================

import {
  type Candle,
  generateMarketData,
  aggregateCandles,
  calcSMA,
  calcMACD,
  isMACDDeathCross,
  isMACDGoldenCross,
} from "./marketDataGenerator";
import { seededRandom } from "./seed";

// ============================================================
// Types
// ============================================================

export interface BacktestConfig {
  /** Strategy DSL (five-layer structure) */
  dsl: StrategyDSL;
  /** Seed for deterministic mock data */
  seed?: number;
  /** Number of trading days */
  tradingDays?: number;
  /** Start date for market data */
  startDate?: string;
  /** Initial capital */
  initialCapital?: number;
  /** Commission per trade (fraction, e.g., 0.001 = 0.1%) */
  commission?: number;
  /** Slippage (fraction, e.g., 0.0005 = 5bps) */
  slippage?: number;
}

export interface StrategyDSL {
  /** Target symbol for monitoring (e.g., "QQQ") */
  monitorSymbol: string;
  /** Trading symbol (e.g., "TQQQ") */
  tradeSymbol: string;
  /** Trigger time in HH:MM format (e.g., "15:58") */
  triggerTime: string;
  /** Signal conditions */
  signals: {
    /** MACD death cross on 4H (offset: 1 = last closed bar) */
    macdDeathCross4H?: boolean;
    /** MACD golden cross on 4H */
    macdGoldenCross4H?: boolean;
    /** Price below MA5 on 1D (offset: 1 = last closed bar) */
    priceBelowMA5_1D?: boolean;
    /** Price above MA5 on 1D */
    priceAboveMA5_1D?: boolean;
  };
  /** Logic operator for combining signals */
  logicOperator: "AND" | "OR";
  /** Action to take when triggered */
  action: {
    type: "BUY" | "SELL";
    /** Percentage of position (e.g., 50 = 50%) */
    quantityPct: number;
    /** Order type */
    orderType: "MARKET" | "MOC" | "LIMIT";
  };
  /** Cooldown period in trading days */
  cooldownDays?: number;
}

export interface BacktestTrade {
  id: string;
  entryTime: string;
  exitTime: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  pnl: number | null;
  pnlPct: number | null;
  reason: string;
}

export interface BacktestReport {
  summary: {
    totalReturn: number;
    annualizedReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
    regimeAnalysis: string;
    signalHeatmap: Record<string, number>;
  };
  equityCurve: Array<{ timestamp: string; value: number }>;
  trades: BacktestTrade[];
}

// ============================================================
// Engine
// ============================================================

/**
 * Run a clock-driven backtest simulation.
 *
 * The engine iterates through 1-minute candles, checking at each
 * trigger time (default 15:58 ET) whether the strategy conditions are met.
 *
 * Key time-alignment rules:
 * - 4H indicators use offset:1 (the LAST CLOSED 4H bar, not the current one)
 * - 1D indicators use offset:1 (yesterday's closed daily bar)
 * - 1m price uses the current bar (REALTIME alignment)
 */
export function runBacktest(config: BacktestConfig): BacktestReport {
  const {
    dsl,
    seed = 42,
    tradingDays = 30,
    startDate = "2024-10-01",
    initialCapital = 10000,
    commission = 0.001,
    slippage = 0.0005,
  } = config;

  // 1. Generate 1-minute market data
  const candles1m = generateMarketData(seed, dsl.monitorSymbol, startDate, tradingDays);
  if (candles1m.length === 0) {
    return emptyReport();
  }

  // 2. Aggregate to 4H and 1D timeframes
  const candles4H = aggregateCandles(candles1m, 240);
  const candles1D = aggregateCandles(candles1m, 390); // Full trading day

  // 3. Compute indicators on aggregated data
  const closes4H = candles4H.map((c) => c.c);
  const closes1D = candles1D.map((c) => c.c);

  const macd4H = calcMACD(closes4H, 12, 26, 9);
  const ma5_1D = calcSMA(closes1D, 5);

  // 4. Parse trigger time
  const [triggerHour, triggerMin] = dsl.triggerTime.split(":").map(Number);

  // 5. Clock-driven simulation
  const trades: BacktestTrade[] = [];
  const equityCurve: Array<{ timestamp: string; value: number }> = [];
  let cash = initialCapital;
  let positionQty = 0;
  let positionAvgPrice = 0;
  let lastTriggerDay = -1;
  let cooldownUntilDay = -1;
  let tradeCounter = 0;
  const signalHeatmap: Record<string, number> = {};

  // Track which 4H and 1D bar we're in
  let current4HIdx = 0;
  let current1DIdx = 0;

  // Build index maps for quick lookup
  const candle4HTimes = candles4H.map((c) => c.t);
  const candle1DTimes = candles1D.map((c) => c.t);

  // Process each 1-minute candle
  for (let i = 0; i < candles1m.length; i++) {
    const candle = candles1m[i];

    // Advance 4H index: find the last CLOSED 4H bar before current time
    while (
      current4HIdx < candle4HTimes.length - 1 &&
      candle4HTimes[current4HIdx + 1] <= candle.t
    ) {
      current4HIdx++;
    }

    // Advance 1D index: find the last CLOSED 1D bar before current time
    while (
      current1DIdx < candle1DTimes.length - 1 &&
      candle1DTimes[current1DIdx + 1] <= candle.t
    ) {
      current1DIdx++;
    }

    // Convert timestamp to ET hours/minutes
    // candle.t is UTC, EST = UTC - 5h
    const estTime = new Date(candle.t - 5 * 3600000);
    const h = estTime.getHours();
    const m = estTime.getMinutes();
    const dayOfYear = getDayOfYear(estTime);

    // Record equity at market close (16:00 or last candle of day)
    if (h === 15 && m === 59) {
      const equity = cash + positionQty * candle.c;
      equityCurve.push({
        timestamp: new Date(candle.t).toISOString(),
        value: Math.round(equity * 100) / 100,
      });
    }

    // Check trigger time
    if (h !== triggerHour || m !== triggerMin) continue;
    if (dayOfYear === lastTriggerDay) continue; // Already triggered today
    lastTriggerDay = dayOfYear;

    // Cooldown check
    if (dayOfYear < cooldownUntilDay) continue;

    // ---- OFFSET RULE: Use LAST_CLOSED bars (offset >= 1) ----
    // For 4H: use current4HIdx - 1 (the bar that has already closed)
    const offset4HIdx = Math.max(0, current4HIdx - 1);
    // For 1D: use current1DIdx - 1 (yesterday's closed bar)
    const offset1DIdx = Math.max(0, current1DIdx - 1);

    // Evaluate signals
    const signalResults: boolean[] = [];
    const signalReasons: string[] = [];

    if (dsl.signals.macdDeathCross4H) {
      const triggered = isMACDDeathCross(
        macd4H.macd,
        macd4H.signal,
        offset4HIdx
      );
      signalResults.push(triggered);
      if (triggered) signalReasons.push("MACD 死叉 (4H)");
    }

    if (dsl.signals.macdGoldenCross4H) {
      const triggered = isMACDGoldenCross(
        macd4H.macd,
        macd4H.signal,
        offset4HIdx
      );
      signalResults.push(triggered);
      if (triggered) signalReasons.push("MACD 金叉 (4H)");
    }

    if (dsl.signals.priceBelowMA5_1D) {
      const ma5Val = ma5_1D[offset1DIdx];
      const currentPrice = candle.c;
      const triggered = ma5Val !== null && currentPrice < ma5Val;
      signalResults.push(triggered);
      if (triggered) signalReasons.push(`价格低于 MA5 (${ma5Val?.toFixed(2)})`);
    }

    if (dsl.signals.priceAboveMA5_1D) {
      const ma5Val = ma5_1D[offset1DIdx];
      const currentPrice = candle.c;
      const triggered = ma5Val !== null && currentPrice > ma5Val;
      signalResults.push(triggered);
      if (triggered) signalReasons.push(`价格高于 MA5 (${ma5Val?.toFixed(2)})`);
    }

    // Combine signals
    const allTriggered =
      dsl.logicOperator === "AND"
        ? signalResults.length > 0 && signalResults.every(Boolean)
        : signalResults.some(Boolean);

    // Record in heatmap
    const dateKey = estTime.toISOString().split("T")[0];
    signalHeatmap[dateKey] = (signalHeatmap[dateKey] || 0) + (allTriggered ? 1 : 0);

    if (!allTriggered) continue;

    // ---- Execute trade ----
    const execPrice = candle.c * (1 + (dsl.action.type === "BUY" ? slippage : -slippage));
    const commissionCost = execPrice * commission;
    tradeCounter++;
    const tradeId = `t_${String(tradeCounter).padStart(3, "0")}`;

    if (dsl.action.type === "SELL" && positionQty > 0) {
      const sellQty = Math.floor(positionQty * (dsl.action.quantityPct / 100));
      if (sellQty <= 0) continue;

      const proceeds = sellQty * execPrice - commissionCost * sellQty;
      const cost = sellQty * positionAvgPrice;
      const pnl = proceeds - cost;
      const pnlPct = cost > 0 ? pnl / cost : 0;

      cash += proceeds;
      positionQty -= sellQty;

      trades.push({
        id: tradeId,
        entryTime: new Date(candle.t).toISOString(),
        exitTime: null,
        symbol: dsl.tradeSymbol,
        side: "SELL",
        price: Math.round(execPrice * 100) / 100,
        pnl: Math.round(pnl * 100) / 100,
        pnlPct: Math.round(pnlPct * 10000) / 10000,
        reason: signalReasons.join(" + "),
      });

      cooldownUntilDay = dayOfYear + (dsl.cooldownDays || 1);
    } else if (dsl.action.type === "BUY") {
      const allocCash = cash * (dsl.action.quantityPct / 100);
      const buyQty = Math.floor(allocCash / (execPrice + commissionCost));
      if (buyQty <= 0) continue;

      const totalCost = buyQty * (execPrice + commissionCost);
      positionAvgPrice =
        positionQty > 0
          ? (positionAvgPrice * positionQty + execPrice * buyQty) / (positionQty + buyQty)
          : execPrice;
      positionQty += buyQty;
      cash -= totalCost;

      trades.push({
        id: tradeId,
        entryTime: new Date(candle.t).toISOString(),
        exitTime: null,
        symbol: dsl.tradeSymbol,
        side: "BUY",
        price: Math.round(execPrice * 100) / 100,
        pnl: null,
        pnlPct: null,
        reason: signalReasons.join(" + "),
      });

      cooldownUntilDay = dayOfYear + (dsl.cooldownDays || 1);
    }
  }

  // 6. Final equity
  const lastPrice = candles1m[candles1m.length - 1]?.c || 0;
  const finalEquity = cash + positionQty * lastPrice;

  // Ensure last equity point
  if (equityCurve.length > 0) {
    const lastEq = equityCurve[equityCurve.length - 1];
    if (lastEq.value !== Math.round(finalEquity * 100) / 100) {
      equityCurve.push({
        timestamp: new Date(candles1m[candles1m.length - 1].t).toISOString(),
        value: Math.round(finalEquity * 100) / 100,
      });
    }
  }

  // 7. Compute summary KPIs
  const totalReturn = (finalEquity - initialCapital) / initialCapital;
  const tradingYears = tradingDays / 252;
  const annualizedReturn =
    tradingYears > 0
      ? Math.pow(finalEquity / initialCapital, 1 / tradingYears) - 1
      : totalReturn;

  // Sharpe Ratio (using daily returns from equity curve)
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].value;
    const curr = equityCurve[i].value;
    if (prev > 0) dailyReturns.push((curr - prev) / prev);
  }
  const avgReturn = dailyReturns.length > 0
    ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    : 0;
  const stdReturn = dailyReturns.length > 1
    ? Math.sqrt(
        dailyReturns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) /
          (dailyReturns.length - 1)
      )
    : 1;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  // Max Drawdown
  let peak = initialCapital;
  let maxDD = 0;
  for (const eq of equityCurve) {
    if (eq.value > peak) peak = eq.value;
    const dd = (eq.value - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  // Win Rate
  const closedTrades = trades.filter((t) => t.pnl !== null);
  const winningTrades = closedTrades.filter((t) => t.pnl! > 0);
  const winRate = closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0;

  // Regime Analysis
  const regimeAnalysis = generateRegimeAnalysis(totalReturn, maxDD, winRate, trades.length);

  return {
    summary: {
      totalReturn: round4(totalReturn),
      annualizedReturn: round4(annualizedReturn),
      sharpeRatio: round4(sharpeRatio),
      maxDrawdown: round4(maxDD),
      winRate: round4(winRate),
      totalTrades: trades.length,
      regimeAnalysis,
      signalHeatmap,
    },
    equityCurve,
    trades,
  };
}

// ============================================================
// Helpers
// ============================================================

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function emptyReport(): BacktestReport {
  return {
    summary: {
      totalReturn: 0,
      annualizedReturn: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      winRate: 0,
      totalTrades: 0,
      regimeAnalysis: "Insufficient data for analysis.",
      signalHeatmap: {},
    },
    equityCurve: [],
    trades: [],
  };
}

function generateRegimeAnalysis(
  totalReturn: number,
  maxDD: number,
  winRate: number,
  totalTrades: number
): string {
  const parts: string[] = [];

  if (totalReturn > 0.1) {
    parts.push("该策略在回测期间表现出色，总收益率超过 10%。");
  } else if (totalReturn > 0) {
    parts.push("该策略在回测期间实现了正收益，但幅度有限。");
  } else {
    parts.push("该策略在回测期间出现亏损，需要进一步优化。");
  }

  if (Math.abs(maxDD) > 0.15) {
    parts.push(`最大回撤达到 ${(maxDD * 100).toFixed(1)}%，在极端市场条件下风险较高。`);
  } else if (Math.abs(maxDD) > 0.05) {
    parts.push("最大回撤在可接受范围内。");
  }

  if (winRate > 0.6) {
    parts.push(`胜率 ${(winRate * 100).toFixed(0)}% 表明信号质量较高。`);
  } else if (winRate > 0.4) {
    parts.push("胜率处于中等水平，建议结合仓位管理优化。");
  }

  if (totalTrades < 5) {
    parts.push("交易次数较少，统计显著性不足，建议延长回测周期。");
  }

  return parts.join(" ");
}

/**
 * Build a default StrategyDSL from a natural language prompt.
 * This is a simplified parser for the MVP — in production,
 * this would be handled by the LLM structured output.
 */
export function buildDSLFromPrompt(prompt: string): StrategyDSL {
  const lower = prompt.toLowerCase();

  // Detect monitor symbol
  const monitorSymbol = lower.includes("qqq") ? "QQQ" : lower.includes("spy") ? "SPY" : "QQQ";

  // Detect trade symbol
  const tradeSymbol = lower.includes("tqqq")
    ? "TQQQ"
    : lower.includes("sqqq")
    ? "SQQQ"
    : monitorSymbol;

  // Detect signals
  const macdDeathCross4H =
    lower.includes("macd") && (lower.includes("death") || lower.includes("死叉"));
  const macdGoldenCross4H =
    lower.includes("macd") && (lower.includes("golden") || lower.includes("金叉"));
  const priceBelowMA5_1D =
    (lower.includes("below") || lower.includes("低于")) && lower.includes("ma5");
  const priceAboveMA5_1D =
    (lower.includes("above") || lower.includes("高于")) && lower.includes("ma5");

  // Detect action
  const isSell = lower.includes("sell") || lower.includes("卖");
  const actionType: "BUY" | "SELL" = isSell ? "SELL" : "BUY";

  // Detect quantity
  let quantityPct = 100;
  const pctMatch = lower.match(/(\d+)\s*%/);
  if (pctMatch) quantityPct = parseInt(pctMatch[1], 10);

  // Detect trigger time
  let triggerTime = "15:58";
  const timeMatch = lower.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) triggerTime = `${timeMatch[1]}:${timeMatch[2]}`;

  return {
    monitorSymbol,
    tradeSymbol,
    triggerTime,
    signals: {
      macdDeathCross4H: macdDeathCross4H || (!macdGoldenCross4H && !priceBelowMA5_1D && !priceAboveMA5_1D),
      macdGoldenCross4H,
      priceBelowMA5_1D: priceBelowMA5_1D || (!macdDeathCross4H && !macdGoldenCross4H && !priceAboveMA5_1D),
      priceAboveMA5_1D,
    },
    logicOperator: "AND",
    action: {
      type: actionType,
      quantityPct,
      orderType: "MOC",
    },
    cooldownDays: 1,
  };
}
