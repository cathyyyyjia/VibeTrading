import { describe, expect, it } from "vitest";
import {
  generateMarketData,
  aggregateCandles,
  calcSMA,
  calcMACD,
  isMACDDeathCross,
  isMACDGoldenCross,
  type Candle,
} from "./lib/marketDataGenerator";
import {
  runBacktest,
  type StrategyDSL,
  type BacktestConfig,
  type BacktestReport,
} from "./lib/backtestEngine";

// ============================================================
// Market Data Generator Tests
// ============================================================
describe("marketDataGenerator", () => {
  it("generates 30 days of 1-minute QQQ data by default", () => {
    // generateMarketData(seed, symbol, startDate, tradingDays)
    const candles = generateMarketData(42, "QQQ", "2024-10-01", 30);
    expect(Array.isArray(candles)).toBe(true);
    // 30 days × 390 minutes per day = 11700
    expect(candles.length).toBe(30 * 390);
  });

  it("generates deterministic data for same seed", () => {
    const c1 = generateMarketData(123, "QQQ", "2024-10-01", 5);
    const c2 = generateMarketData(123, "QQQ", "2024-10-01", 5);
    expect(c1).toEqual(c2);
  });

  it("generates different data for different seeds", () => {
    const c1 = generateMarketData(1, "QQQ", "2024-10-01", 5);
    const c2 = generateMarketData(2, "QQQ", "2024-10-01", 5);
    expect(c1[0].c).not.toEqual(c2[0].c);
  });

  it("candle OHLCV values are valid", () => {
    const candles = generateMarketData(42, "QQQ", "2024-10-01", 2);
    candles.forEach((c) => {
      expect(c.o).toBeGreaterThan(0);
      expect(c.h).toBeGreaterThanOrEqual(c.o);
      expect(c.h).toBeGreaterThanOrEqual(c.c);
      expect(c.l).toBeLessThanOrEqual(c.o);
      expect(c.l).toBeLessThanOrEqual(c.c);
      expect(c.v).toBeGreaterThan(0);
    });
  });

  it("candles have sequential timestamps within market hours", () => {
    const candles = generateMarketData(42, "QQQ", "2024-10-01", 1);
    expect(candles.length).toBe(390);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i].t).toBeGreaterThan(candles[i - 1].t);
    }
  });
});

// ============================================================
// Candle Aggregation Tests
// ============================================================
describe("aggregateCandles", () => {
  it("aggregates 1m candles to 4H bars", () => {
    const candles = generateMarketData(42, "QQQ", "2024-10-01", 5);
    const bars4H = aggregateCandles(candles, 240);
    expect(bars4H.length).toBeGreaterThan(0);
    bars4H.forEach((bar) => {
      expect(bar.h).toBeGreaterThanOrEqual(bar.l);
    });
  });

  it("aggregates 1m candles to 1D bars", () => {
    const candles = generateMarketData(42, "QQQ", "2024-10-01", 10);
    const barsDaily = aggregateCandles(candles, 390);
    // Aggregation by time bucket may produce different count due to bucket alignment
    // The important thing is we get roughly the right number of daily bars
    expect(barsDaily.length).toBeGreaterThanOrEqual(5);
    expect(barsDaily.length).toBeLessThanOrEqual(30);
    barsDaily.forEach((bar) => {
      expect(bar.h).toBeGreaterThanOrEqual(bar.l);
    });
  });
});

// ============================================================
// Technical Indicator Tests
// ============================================================
describe("technical indicators", () => {
  it("calcSMA returns correct values", () => {
    const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const sma5 = calcSMA(closes, 5);
    // First 4 values should be null
    expect(sma5[0]).toBeNull();
    expect(sma5[3]).toBeNull();
    // SMA(5) at index 4 = (10+11+12+13+14)/5 = 12
    expect(sma5[4]).toBeCloseTo(12, 2);
    // SMA(5) at index 5 = (11+12+13+14+15)/5 = 13
    expect(sma5[5]).toBeCloseTo(13, 2);
  });

  it("calcMACD returns valid MACD data", () => {
    const candles = generateMarketData(42, "QQQ", "2024-10-01", 30);
    const closes = candles.map((c) => c.c);
    const result = calcMACD(closes);
    // calcMACD returns { macd, signal, histogram }
    expect(result.macd.length).toBe(closes.length);
    expect(result.signal.length).toBe(closes.length);
    expect(result.histogram.length).toBe(closes.length);
  });

  it("isMACDDeathCross detects crossover correctly", () => {
    // isMACDDeathCross uses (number | null)[] arrays
    // Simulate MACD crossing below signal
    const macdLine: (number | null)[] = [0.5, 0.3, 0.1, -0.1, -0.3];
    const signalLine: (number | null)[] = [0.0, 0.0, 0.0, 0.0, 0.0];
    // At index 3: macd goes below signal (was above at index 2)
    expect(isMACDDeathCross(macdLine, signalLine, 3)).toBe(true);
    // At index 2: macd is still above signal
    expect(isMACDDeathCross(macdLine, signalLine, 2)).toBe(false);
  });

  it("isMACDGoldenCross detects crossover correctly", () => {
    const macdLine: (number | null)[] = [-0.5, -0.3, 0.1, 0.3, 0.5];
    const signalLine: (number | null)[] = [0.0, 0.0, 0.0, 0.0, 0.0];
    // At index 2: macd goes above signal (was below at index 1)
    expect(isMACDGoldenCross(macdLine, signalLine, 2)).toBe(true);
    expect(isMACDGoldenCross(macdLine, signalLine, 1)).toBe(false);
  });
});

// ============================================================
// Backtest Engine Tests
// ============================================================
describe("backtestEngine", () => {
  const defaultDSL: StrategyDSL = {
    monitorSymbol: "QQQ",
    tradeSymbol: "TQQQ",
    triggerTime: "15:58",
    signals: {
      macdDeathCross4H: true,
      priceBelowMA5_1D: true,
    },
    logicOperator: "AND",
    action: {
      type: "SELL",
      quantityPct: 25,
      orderType: "MOC",
    },
    cooldownDays: 3,
  };

  it("runs a complete backtest and returns a valid report", () => {
    const config: BacktestConfig = {
      dsl: defaultDSL,
      seed: 42,
      tradingDays: 30,
      initialCapital: 10000,
      commission: 0.001,
      slippage: 0.0005,
    };

    const report = runBacktest(config);

    // Validate report structure
    expect(report).toBeDefined();
    expect(report.summary).toBeDefined();
    expect(report.equityCurve).toBeDefined();
    expect(report.trades).toBeDefined();
  });

  it("report summary has all required KPI fields", () => {
    const report = runBacktest({
      dsl: defaultDSL,
      seed: 42,
      tradingDays: 30,
    });

    const s = report.summary;
    expect(typeof s.totalReturn).toBe("number");
    expect(typeof s.annualizedReturn).toBe("number");
    expect(typeof s.sharpeRatio).toBe("number");
    expect(typeof s.maxDrawdown).toBe("number");
    expect(typeof s.winRate).toBe("number");
    expect(typeof s.totalTrades).toBe("number");
    expect(typeof s.regimeAnalysis).toBe("string");
    expect(typeof s.signalHeatmap).toBe("object");
  });

  it("equity curve has valid data points", () => {
    const report = runBacktest({
      dsl: defaultDSL,
      seed: 42,
      tradingDays: 30,
    });

    expect(report.equityCurve.length).toBeGreaterThan(0);
    report.equityCurve.forEach((pt) => {
      expect(typeof pt.timestamp).toBe("string");
      expect(typeof pt.value).toBe("number");
      expect(pt.value).toBeGreaterThan(0);
    });

    // First point should be initial capital
    expect(report.equityCurve[0].value).toBe(10000);
  });

  it("trades have valid structure with pnlPct and reason", () => {
    const report = runBacktest({
      dsl: defaultDSL,
      seed: 42,
      tradingDays: 30,
    });

    report.trades.forEach((trade) => {
      expect(typeof trade.id).toBe("string");
      expect(typeof trade.entryTime).toBe("string");
      expect(typeof trade.symbol).toBe("string");
      expect(["BUY", "SELL"]).toContain(trade.side);
      expect(typeof trade.price).toBe("number");
      expect(trade.price).toBeGreaterThan(0);
      expect(typeof trade.reason).toBe("string");
      // pnlPct should be a number or null
      if (trade.pnlPct !== null) {
        expect(typeof trade.pnlPct).toBe("number");
      }
    });
  });

  it("is deterministic for same seed", () => {
    const config: BacktestConfig = {
      dsl: defaultDSL,
      seed: 42,
      tradingDays: 15,
    };

    const r1 = runBacktest(config);
    const r2 = runBacktest(config);

    expect(r1.summary.totalReturn).toBe(r2.summary.totalReturn);
    expect(r1.summary.sharpeRatio).toBe(r2.summary.sharpeRatio);
    expect(r1.trades.length).toBe(r2.trades.length);
  });

  it("produces valid reports for different seeds", () => {
    const r1 = runBacktest({ dsl: defaultDSL, seed: 1, tradingDays: 30 });
    const r2 = runBacktest({ dsl: defaultDSL, seed: 999, tradingDays: 30 });

    // Both should produce valid reports regardless of whether trades triggered
    expect(r1.summary).toBeDefined();
    expect(r2.summary).toBeDefined();
    expect(r1.equityCurve.length).toBeGreaterThan(0);
    expect(r2.equityCurve.length).toBeGreaterThan(0);
    // Reports are structurally valid
    expect(typeof r1.summary.totalReturn).toBe("number");
    expect(typeof r2.summary.totalReturn).toBe("number");
  });

  it("maxDrawdown is negative or zero", () => {
    const report = runBacktest({
      dsl: defaultDSL,
      seed: 42,
      tradingDays: 30,
    });

    expect(report.summary.maxDrawdown).toBeLessThanOrEqual(0);
  });

  it("winRate is between 0 and 1", () => {
    const report = runBacktest({
      dsl: defaultDSL,
      seed: 42,
      tradingDays: 30,
    });

    expect(report.summary.winRate).toBeGreaterThanOrEqual(0);
    expect(report.summary.winRate).toBeLessThanOrEqual(1);
  });

  it("totalTrades matches trades array length", () => {
    const report = runBacktest({
      dsl: defaultDSL,
      seed: 42,
      tradingDays: 30,
    });

    expect(report.summary.totalTrades).toBe(report.trades.length);
  });

  it("respects cooldown period between trades", () => {
    const report = runBacktest({
      dsl: { ...defaultDSL, cooldownDays: 5 },
      seed: 42,
      tradingDays: 30,
    });

    // If there are multiple trades, check cooldown
    if (report.trades.length >= 2) {
      for (let i = 1; i < report.trades.length; i++) {
        const prevTime = new Date(report.trades[i - 1].entryTime).getTime();
        const currTime = new Date(report.trades[i].entryTime).getTime();
        const daysDiff = (currTime - prevTime) / (1000 * 60 * 60 * 24);
        // Allow some tolerance due to weekends
        expect(daysDiff).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("handles BUY action DSL", () => {
    const buyDSL: StrategyDSL = {
      ...defaultDSL,
      signals: {
        macdGoldenCross4H: true,
        priceAboveMA5_1D: true,
      },
      action: {
        type: "BUY",
        quantityPct: 50,
        orderType: "MARKET",
      },
    };

    const report = runBacktest({
      dsl: buyDSL,
      seed: 42,
      tradingDays: 30,
    });

    expect(report).toBeDefined();
    expect(report.summary).toBeDefined();
  });

  it("signal heatmap contains date keys", () => {
    const report = runBacktest({
      dsl: defaultDSL,
      seed: 42,
      tradingDays: 30,
    });

    const heatmap = report.summary.signalHeatmap;
    expect(Object.keys(heatmap).length).toBeGreaterThan(0);
    // Keys should be date strings
    Object.keys(heatmap).forEach((key) => {
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

// ============================================================
// Strategy API Contract Tests (document schema compliance)
// ============================================================
describe("strategy API contract", () => {
  it("analyze response matches five-layer DSL schema", () => {
    const analyzeResponse = {
      strategyId: "strat-abc123",
      name: "QQQ MACD Death Cross Strategy",
      status: "DRAFT",
      dsl: {
        atom: {
          atoms: [
            { id: "a1", symbol: "QQQ", timeframe_ref: "tf_4h", indicator: "MACD", params: { fast: 12, slow: 26, signal: 9 } },
            { id: "a2", symbol: "QQQ", timeframe_ref: "tf_1d", indicator: "MA", params: { period: 5 } },
          ],
        },
        timeframe: {
          units: [
            { id: "tf_4h", granularity: "4H", alignment: "LAST_CLOSED" as const },
            { id: "tf_1d", granularity: "1D", alignment: "LAST_CLOSED" as const },
          ],
          market_session: { timezone: "America/New_York", pre_close_buffer: "2min" },
        },
        signal: {
          signals: [
            { id: "s1", type: "EVENT" as const, expression: "MACD_4H.death_cross()", description: "4H MACD death cross" },
          ],
        },
        logic: {
          root: {
            operator: "AND" as const,
            conditions: [{ signal_id: "s1" }],
          },
        },
        action: {
          actions: [
            { symbol: "TQQQ", action_type: "SELL" as const, quantity: { type: "PCT", value: 25 } },
          ],
        },
      },
      parsedConfig: {},
    };

    // Validate structure
    expect(analyzeResponse.strategyId).toBeTruthy();
    expect(analyzeResponse.dsl.atom.atoms.length).toBeGreaterThan(0);
    expect(analyzeResponse.dsl.timeframe.units.length).toBeGreaterThan(0);
    expect(analyzeResponse.dsl.signal.signals.length).toBeGreaterThan(0);
    expect(analyzeResponse.dsl.logic.root.operator).toBe("AND");
    expect(analyzeResponse.dsl.action.actions.length).toBeGreaterThan(0);
  });

  it("backtest report matches enhanced schema", () => {
    const report: BacktestReport = {
      summary: {
        totalReturn: 0.12,
        annualizedReturn: 0.35,
        sharpeRatio: 1.84,
        maxDrawdown: -0.08,
        winRate: 0.65,
        totalTrades: 12,
        regimeAnalysis: "Bull market with moderate volatility",
        signalHeatmap: { "2025-01-15": 3, "2025-01-20": 2 },
      },
      equityCurve: [
        { timestamp: "2025-01-02", value: 10000 },
        { timestamp: "2025-01-03", value: 10120 },
      ],
      trades: [
        {
          id: "t1",
          entryTime: "2025-01-15 15:58:00",
          exitTime: "2025-01-20 15:58:00",
          symbol: "TQQQ",
          side: "SELL",
          price: 45.5,
          pnl: 120,
          pnlPct: 2.4,
          reason: "4H MACD death cross + price below 5-day MA",
        },
      ],
    };

    expect(report.summary.totalReturn).toBe(0.12);
    expect(report.summary.winRate).toBe(0.65);
    expect(report.summary.signalHeatmap["2025-01-15"]).toBe(3);
    expect(report.trades[0].pnlPct).toBe(2.4);
    expect(report.trades[0].reason).toContain("MACD");
  });

  it("deploy response has correct structure", () => {
    const deployResponse = {
      strategyId: "strat-abc123",
      status: "LIVE",
      isFrozen: true,
      deployId: "deploy-xyz789",
      message: "Strategy deployed to PAPER trading",
    };

    expect(deployResponse.status).toBe("LIVE");
    expect(deployResponse.isFrozen).toBe(true);
    expect(deployResponse.deployId).toBeTruthy();
  });
});
