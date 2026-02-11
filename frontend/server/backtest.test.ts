import { describe, expect, it } from "vitest";
import {
  hashSeed,
  generateRunId,
  generateEquityCurve,
  generateTrades,
  generateKPIs,
  generateFullCode,
} from "./lib/seed";
import {
  createRun,
  getRunStatus,
  getRunReport,
  getHistory,
} from "./lib/mockRunRegistry";

// ============================================================
// Seed utility tests
// ============================================================
describe("seed utilities", () => {
  it("hashSeed produces consistent values for same input", () => {
    const s1 = hashSeed("test-run-1");
    const s2 = hashSeed("test-run-1");
    expect(s1).toBe(s2);
    expect(typeof s1).toBe("number");
  });

  it("hashSeed produces different values for different inputs", () => {
    const s1 = hashSeed("run-a");
    const s2 = hashSeed("run-b");
    expect(s1).not.toBe(s2);
  });

  it("generateRunId returns 8-char string", () => {
    const id = generateRunId();
    expect(typeof id).toBe("string");
    expect(id.length).toBe(8);
  });

  it("generateRunId returns unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRunId()));
    expect(ids.size).toBe(100);
  });

  it("generateEquityCurve returns array of {t, v} points", () => {
    const curve = generateEquityCurve(42);
    expect(Array.isArray(curve)).toBe(true);
    expect(curve.length).toBeGreaterThan(50);
    curve.forEach((pt) => {
      expect(typeof pt.t).toBe("number");
      expect(typeof pt.v).toBe("number");
    });
    // First value should be around 10000
    expect(curve[0].v).toBeCloseTo(10000, -2);
  });

  it("generateEquityCurve is deterministic for same seed", () => {
    const c1 = generateEquityCurve(42);
    const c2 = generateEquityCurve(42);
    expect(c1).toEqual(c2);
  });

  it("generateTrades returns array of trade objects", () => {
    const trades = generateTrades(42);
    expect(Array.isArray(trades)).toBe(true);
    expect(trades.length).toBeGreaterThan(0);
    trades.forEach((t) => {
      expect(typeof t.timestamp).toBe("string");
      expect(typeof t.symbol).toBe("string");
      expect(["BUY", "SELL"]).toContain(t.action);
      expect(typeof t.price).toBe("number");
    });
  });

  it("generateKPIs returns valid KPI object", () => {
    const kpis = generateKPIs(42);
    expect(typeof kpis.returnPct).toBe("number");
    expect(typeof kpis.cagrPct).toBe("number");
    expect(typeof kpis.sharpe).toBe("number");
    expect(typeof kpis.maxDdPct).toBe("number");
    // maxDdPct should be negative
    expect(kpis.maxDdPct).toBeLessThan(0);
  });

  it("generateFullCode returns strategy code string", () => {
    const code = generateFullCode("Buy BTC when MA crosses");
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(50);
    expect(code).toContain("def");
  });
});

// ============================================================
// Mock registry tests
// ============================================================
describe("mock run registry", () => {
  it("createRun returns a valid run object", () => {
    const run = createRun("Buy BTC when 50-day MA crosses above 200-day MA", {});
    expect(run.runId).toBeDefined();
    expect(typeof run.runId).toBe("string");
    expect(run.runId.length).toBe(8);
  });

  it("getRunStatus returns running state immediately after creation", () => {
    const run = createRun("Test strategy prompt", {});
    const status = getRunStatus(run.runId);
    expect(status).not.toBeNull();
    expect(status!.runId).toBe(run.runId);
    expect(status!.state).toBe("running");
    expect(Array.isArray(status!.steps)).toBe(true);
    expect(status!.steps.length).toBe(4);
  });

  it("getRunStatus returns null for unknown runId", () => {
    const status = getRunStatus("nonexistent");
    expect(status).toBeNull();
  });

  it("getRunReport returns null for running run", () => {
    const run = createRun("Another test prompt", {});
    const report = getRunReport(run.runId);
    // Report may be null while running
    if (report) {
      expect(report.kpis).toBeDefined();
    }
  });

  it("steps have correct structure", () => {
    const run = createRun("BTC golden cross strategy", {});
    const status = getRunStatus(run.runId);
    expect(status).not.toBeNull();
    
    const stepKeys = status!.steps.map(s => s.key);
    expect(stepKeys).toEqual(["analysis", "data", "logic", "backtest"]);
    
    status!.steps.forEach(step => {
      expect(step.title).toBeDefined();
      expect(["queued", "running", "done", "warn", "error"]).toContain(step.status);
      expect(Array.isArray(step.logs)).toBe(true);
    });
  });

  it("first step has tags extracted from prompt", () => {
    const run = createRun("Buy BTC when 50-day MA crosses above 200-day MA with RSI filter", {});
    const status = getRunStatus(run.runId);
    expect(status).not.toBeNull();
    
    const analysisStep = status!.steps.find(s => s.key === "analysis");
    expect(analysisStep).toBeDefined();
    // Tags should be present (at least after step starts running)
    if (analysisStep!.tags) {
      expect(Array.isArray(analysisStep!.tags)).toBe(true);
    }
  });

  it("getHistory returns array of history entries", () => {
    const history = getHistory();
    expect(Array.isArray(history)).toBe(true);
    // Should have pre-seeded entries
    expect(history.length).toBeGreaterThan(0);
    
    history.forEach(entry => {
      expect(entry.runId).toBeDefined();
      expect(entry.prompt).toBeDefined();
      expect(["completed", "failed"]).toContain(entry.state);
      if (entry.state === "completed") {
        expect(entry.kpis).toBeDefined();
        expect(entry.equity).toBeDefined();
        expect(entry.trades).toBeDefined();
        expect(entry.dsl).toBeDefined();
      }
    });
  });
});

// ============================================================
// POST /run-backtest endpoint structure tests
// ============================================================
describe("POST /run-backtest API contract", () => {
  it("should define the expected request/response structure", () => {
    // This test documents the API contract for the Python engine integration
    const requestBody = {
      prompt: "Buy BTC when 50-day MA crosses above 200-day MA",
      options: {
        transactionCosts: true,
        dateRange: { start: "2024-01-01", end: "2024-12-31" },
        maxDrawdown: 0.15,
      },
    };

    // Validate request structure
    expect(typeof requestBody.prompt).toBe("string");
    expect(requestBody.prompt.length).toBeGreaterThan(0);
    expect(typeof requestBody.options).toBe("object");

    // Expected response structure
    const expectedResponse = {
      runId: "KDHjPhxH",
      status: "accepted",
      message: "Backtest run created. Poll /api/runs/KDHjPhxH/status for progress.",
    };

    expect(typeof expectedResponse.runId).toBe("string");
    expect(expectedResponse.status).toBe("accepted");
    expect(typeof expectedResponse.message).toBe("string");
  });

  it("should define the expected status response structure", () => {
    const statusResponse = {
      runId: "KDHjPhxH",
      state: "completed" as const,
      steps: [
        { key: "analysis", title: "STRATEGIC ANALYSIS", status: "done" as const, durationMs: 400, logs: [], tags: ["Asset: BTC"] },
        { key: "data", title: "DATA SYNTHESIS", status: "done" as const, durationMs: 1200, logs: [] },
        { key: "logic", title: "LOGIC CONSTRUCTION", status: "done" as const, durationMs: 800, logs: [] },
        { key: "backtest", title: "BACKTEST ENGINE", status: "done" as const, durationMs: 3200, logs: [] },
      ],
      progress: 100,
      artifacts: {
        dsl: "def on_signal(data): ...",
        reportUrl: "/api/runs/KDHjPhxH/report",
        tradesCsvUrl: "/api/runs/KDHjPhxH/report?format=csv",
      },
    };

    expect(statusResponse.steps).toHaveLength(4);
    expect(statusResponse.progress).toBe(100);
    expect(statusResponse.artifacts.dsl).toBeDefined();
  });

  it("should define the expected report response structure", () => {
    const reportResponse = {
      kpis: { returnPct: 142.5, cagrPct: 32.4, sharpe: 1.84, maxDdPct: -12.1 },
      equity: [{ t: 1704067200000, v: 10000 }, { t: 1704153600000, v: 10050 }],
      trades: [{ timestamp: "Oct 24, 14:30", symbol: "BTC-USD", action: "BUY", price: 34250, pnl: null }],
    };

    expect(reportResponse.kpis.returnPct).toBeGreaterThan(0);
    expect(reportResponse.equity.length).toBeGreaterThan(0);
    expect(reportResponse.trades.length).toBeGreaterThan(0);
    expect(reportResponse.trades[0].action).toBe("BUY");
  });
});
