// ============================================================
// REST API Routes for Aipha Backtest System
//
// New strategy-based endpoints:
//   POST /api/strategies/analyze   — NL → five-layer DSL parsing
//   POST /api/strategies/backtest  — Start backtest for a strategy
//   GET  /api/strategies/:id/status — Get strategy + AI log status
//   POST /api/strategies/:id/deploy — Deploy strategy to LIVE
//
// Legacy endpoints (backward compatibility):
//   POST /api/run-backtest         — Direct backtest entry point
//   POST /api/runs                 — Create run (in-memory)
//   GET  /api/runs/:runId/status   — Get run status (DB → memory)
//   GET  /api/runs/:runId/report   — Get run report (DB → memory)
//   POST /api/runs/:runId/deploy   — Deploy run
//   GET  /api/runs/history         — Get history
// ============================================================

import { Router } from "express";
import {
  createRun,
  getRunStatus as getMemoryRunStatus,
  getRunReport as getMemoryRunReport,
  deployRun,
  getHistory,
} from "./lib/mockRunRegistry";
import {
  createBacktestRun,
  getBacktestRunByRunId,
  getTradesByRunId,
  getStrategyById,
  listAiLogs,
  getBacktestRunsByStrategyId,
} from "./db";
import { hashSeed, generateRunId } from "./lib/seed";
import { computeRunStatus } from "./lib/statusEngine";

const mockRouter = Router();

// ============================================================
// POST /api/run-backtest — STANDARD INTERFACE (legacy)
// ============================================================
mockRouter.post("/run-backtest", async (req, res) => {
  try {
    const { prompt, options } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }

    const runId = generateRunId();
    const seed = hashSeed(runId);
    const shouldFail = Math.random() < 0.05;
    const failStep = Math.floor(Math.random() * 4);

    await createBacktestRun({
      runId,
      prompt,
      options: options || {},
      state: "running",
      seed,
      shouldFail: shouldFail ? 1 : 0,
      failStep,
      progress: 0,
      steps: [
        { key: "analysis", title: "STRATEGIC ANALYSIS", status: "queued", durationMs: null, logs: [], tags: [] },
        { key: "data", title: "DATA SYNTHESIS", status: "queued", durationMs: null, logs: [] },
        { key: "logic", title: "LOGIC CONSTRUCTION", status: "queued", durationMs: null, logs: [] },
        { key: "backtest", title: "BACKTEST ENGINE", status: "queued", durationMs: null, logs: [] },
      ],
    });

    return res.json({
      runId,
      status: "accepted",
      message: `Backtest run created. Poll /api/runs/${runId}/status for progress.`,
    });
  } catch (error) {
    console.error("[run-backtest] Error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// New Strategy REST Endpoints (mirror tRPC for REST clients)
// ============================================================

// GET /api/strategies/:id/status — REST wrapper for strategy status
mockRouter.get("/strategies/:strategyId/status", async (req, res) => {
  try {
    const { strategyId } = req.params;
    const strategy = await getStrategyById(strategyId);
    if (!strategy) {
      return res.status(404).json({ error: "Strategy not found" });
    }

    const logs = await listAiLogs(strategyId, 1);
    const latestLog = logs[0] || null;
    const runs = await getBacktestRunsByStrategyId(strategyId);
    const latestRun = runs[0] || null;

    return res.json({
      strategyId,
      strategyStatus: strategy.status,
      isFrozen: strategy.isFrozen,
      aiLog: latestLog
        ? {
            runId: latestLog.runId,
            aiStatus: latestLog.aiStatus,
            stageLogs: latestLog.stageLogs || [],
            indicatorsSnapshot: latestLog.indicatorsSnapshot || {},
            runtimeLogs: latestLog.runtimeLogs || [],
          }
        : null,
      backtestRun: latestRun
        ? {
            runId: latestRun.runId,
            state: latestRun.state,
            progress: latestRun.progress,
            steps: latestRun.steps || [],
          }
        : null,
    });
  } catch (error) {
    console.error("[strategy-status] Error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// Legacy mock endpoints (backward compatibility)
// ============================================================

// POST /api/runs
mockRouter.post("/runs", (req, res) => {
  const { prompt, options } = req.body;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt is required" });
  }
  const run = createRun(prompt, options || {});
  return res.json({ runId: run.runId });
});

// GET /api/runs/:runId/status
mockRouter.get("/runs/:runId/status", async (req, res) => {
  const { runId } = req.params;

  try {
    const dbRun = await getBacktestRunByRunId(runId);
    if (dbRun) {
      const result = await computeRunStatus(dbRun);
      return res.json(result);
    }
  } catch (e) {
    console.error("[status] DB error, falling back to memory:", e);
  }

  const status = getMemoryRunStatus(runId);
  if (!status) {
    return res.status(404).json({ error: "Run not found" });
  }
  return res.json(status);
});

// GET /api/runs/:runId/report
mockRouter.get("/runs/:runId/report", async (req, res) => {
  const { runId } = req.params;

  const dbRun = await getBacktestRunByRunId(runId);
  if (dbRun && dbRun.state === "completed") {
    const trades = await getTradesByRunId(runId);
    const report = {
      kpis: dbRun.kpis || { returnPct: 0, cagrPct: 0, sharpe: 0, maxDdPct: 0 },
      summary: {
        totalReturn: dbRun.totalReturn,
        annualizedReturn: dbRun.annualizedReturn,
        sharpeRatio: dbRun.sharpeRatio,
        maxDrawdown: dbRun.maxDrawdown,
        winRate: dbRun.winRate,
        totalTrades: dbRun.totalTrades,
        regimeAnalysis: dbRun.regimeAnalysis,
        signalHeatmap: dbRun.signalHeatmap,
      },
      equity: dbRun.equity || [],
      trades: trades.map((t) => ({
        id: t.tradeId,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        timestamp: t.tradeTimestamp,
        symbol: t.symbol,
        action: t.action,
        price: t.price,
        pnl: t.pnl,
        pnlPct: t.pnlPct,
        reason: t.reason,
      })),
    };

    if (req.query.format === "csv") {
      const header = "TradeId,EntryTime,Symbol,Side,Price,PnL,PnL%,Reason";
      const rows = report.trades.map(
        (t) =>
          `${t.id ?? ""},${t.entryTime ?? t.timestamp},${t.symbol},${t.action},${t.price},${t.pnl ?? ""},${t.pnlPct ?? ""},${t.reason ?? ""}`
      );
      const csv = [header, ...rows].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="trades-${runId}.csv"`);
      return res.send(csv);
    }

    return res.json(report);
  }

  const report = getMemoryRunReport(runId);
  if (!report) {
    return res.status(404).json({ error: "Run not found" });
  }

  if (req.query.format === "csv") {
    const header = "Timestamp,Symbol,Action,Price,PnL";
    const rows = report.trades.map(
      (t) => `${t.timestamp},${t.symbol},${t.action},${t.price},${t.pnl ?? ""}`
    );
    const csv = [header, ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="trades-${runId}.csv"`);
    return res.send(csv);
  }

  return res.json(report);
});

// GET /api/runs/history
mockRouter.get("/runs/history", (_req, res) => {
  const entries = getHistory();
  return res.json({ history: entries });
});

// POST /api/runs/:runId/deploy
mockRouter.post("/runs/:runId/deploy", (req, res) => {
  const { runId } = req.params;
  const { mode } = req.body;
  if (!mode || !["paper", "live"].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "paper" or "live"' });
  }
  const result = deployRun(runId, mode);
  if (!result) {
    return res.status(404).json({ error: "Run not found" });
  }
  return res.json(result);
});

export default mockRouter;
