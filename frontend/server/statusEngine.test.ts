import { describe, expect, it } from "vitest";
import { computeRunStatus } from "./lib/statusEngine";

// ============================================================
// Status Engine Tests
// Verifies the shared time-based progression logic
// ============================================================

// Helper to create a mock DB run record
function makeMockRun(overrides: Partial<{
  runId: string;
  prompt: string;
  createdAt: Date;
  seed: number;
  shouldFail: number;
  failStep: number;
  state: string;
  steps: any;
  progress: number;
  dsl: string;
  kpis: any;
  equity: any;
}> = {}) {
  return {
    runId: overrides.runId ?? "test-run-1",
    prompt: overrides.prompt ?? "Buy BTC when 50-day MA crosses above 200-day MA",
    createdAt: overrides.createdAt ?? new Date(),
    seed: overrides.seed ?? 42,
    shouldFail: overrides.shouldFail ?? 0,
    failStep: overrides.failStep ?? 0,
    state: overrides.state ?? "running",
    steps: overrides.steps ?? [],
    progress: overrides.progress ?? 0,
    dsl: overrides.dsl ?? null,
    kpis: overrides.kpis ?? null,
    equity: overrides.equity ?? null,
  };
}

describe("computeRunStatus", () => {
  it("returns running state for a freshly created run", async () => {
    const run = makeMockRun({ createdAt: new Date() });
    const result = await computeRunStatus(run);

    expect(result.runId).toBe("test-run-1");
    expect(result.state).toBe("running");
    expect(result.steps).toHaveLength(4);
    expect(result.steps[0].status).toBe("running"); // analysis should be running
  });

  it("returns completed state for a run created 15s ago", async () => {
    const run = makeMockRun({
      createdAt: new Date(Date.now() - 15000), // 15 seconds ago
      shouldFail: 0,
    });
    const result = await computeRunStatus(run);

    expect(result.state).toBe("completed");
    expect(result.progress).toBe(100);
    expect(result.steps.every((s) => s.status === "done")).toBe(true);
    expect(result.artifacts.dsl).toBeTruthy();
    expect(result.artifacts.reportUrl).toContain("/report");
  });

  it("returns already-completed state from DB without recomputing", async () => {
    const kpis = { returnPct: 100, cagrPct: 30, sharpe: 1.5, maxDdPct: -10 };
    const run = makeMockRun({
      state: "completed",
      steps: [
        { key: "analysis", title: "STRATEGIC ANALYSIS", status: "done", durationMs: 400, logs: [] },
        { key: "data", title: "DATA SYNTHESIS", status: "done", durationMs: 1200, logs: [] },
        { key: "logic", title: "LOGIC CONSTRUCTION", status: "done", durationMs: 800, logs: [] },
        { key: "backtest", title: "BACKTEST ENGINE", status: "done", durationMs: 3200, logs: [] },
      ],
      progress: 100,
      kpis,
      dsl: "def on_signal(): pass",
    });

    const result = await computeRunStatus(run);
    expect(result.state).toBe("completed");
    expect(result.progress).toBe(100);
    expect(result.artifacts.dsl).toBe("def on_signal(): pass");
  });

  it("returns already-failed state from DB without recomputing", async () => {
    const run = makeMockRun({
      state: "failed",
      steps: [
        { key: "analysis", title: "STRATEGIC ANALYSIS", status: "error", durationMs: 1500, logs: ["[ERROR] Parse failed"] },
      ],
      progress: 0,
    });

    const result = await computeRunStatus(run);
    expect(result.state).toBe("failed");
    expect(result.artifacts.dsl).toBe("");
  });

  it("progresses through steps based on elapsed time", async () => {
    // 3 seconds ago - should have analysis done, data running
    const run = makeMockRun({
      createdAt: new Date(Date.now() - 3000),
      shouldFail: 0,
    });
    const result = await computeRunStatus(run);

    expect(result.state).toBe("running");
    expect(result.steps[0].status).toBe("done"); // analysis done at 2s
    expect(result.steps[1].status).toBe("running"); // data running at 2-4s
    expect(result.steps[2].status).toBe("queued"); // logic not started
    expect(result.steps[3].status).toBe("queued"); // backtest not started
  });

  it("shows backtest progress during engine phase", async () => {
    // 9 seconds ago - should be in backtest phase
    const run = makeMockRun({
      createdAt: new Date(Date.now() - 9000),
      shouldFail: 0,
    });
    const result = await computeRunStatus(run);

    expect(result.state).toBe("running");
    expect(result.steps[0].status).toBe("done");
    expect(result.steps[1].status).toBe("done");
    expect(result.steps[2].status).toBe("done");
    expect(result.steps[3].status).toBe("running");
    expect(result.progress).toBeGreaterThan(0);
    expect(result.progress).toBeLessThan(100);
  });

  it("extracts correct tags from BTC prompt", async () => {
    const run = makeMockRun({
      prompt: "Buy BTC when 50-day MA crosses above 200-day MA with RSI < 30",
      createdAt: new Date(Date.now() - 1000),
    });
    const result = await computeRunStatus(run);

    const analysisStep = result.steps.find((s) => s.key === "analysis");
    expect(analysisStep).toBeDefined();
    expect(analysisStep!.tags).toBeDefined();
    expect(analysisStep!.tags!.some((t) => t.includes("BTC"))).toBe(true);
    expect(analysisStep!.tags!.some((t) => t.includes("RSI"))).toBe(true);
  });

  it("extracts correct tags from ETH prompt", async () => {
    const run = makeMockRun({
      prompt: "Mean reversion on ETH: buy when price drops 2 std devs",
      createdAt: new Date(Date.now() - 1000),
    });
    const result = await computeRunStatus(run);

    const analysisStep = result.steps.find((s) => s.key === "analysis");
    expect(analysisStep!.tags!.some((t) => t.includes("ETH"))).toBe(true);
    expect(analysisStep!.tags!.some((t) => t.includes("Mean Reversion"))).toBe(true);
  });
});
