import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  createBacktestRun,
  getBacktestRunByRunId,
  updateBacktestRun,
  listBacktestHistory,
  getTradesByRunId,
  insertBacktestTrades,
  createStrategy,
  getStrategyById,
  updateStrategy,
  listStrategies,
  createAiLog,
  getAiLog,
  updateAiLog,
  listAiLogs,
  getBacktestRunsByStrategyId,
} from "./db";
import { hashSeed, generateRunId } from "./lib/seed";
import { computeRunStatus } from "./lib/statusEngine";
import { runBacktest, buildDSLFromPrompt, type BacktestReport } from "./lib/backtestEngine";

// ============================================================
// Strategy Router — Five-layer DSL lifecycle
// ============================================================

const strategyRouter = router({
  /**
   * POST /api/strategies/analyze
   * Accepts natural language, returns parsed five-layer DSL structure.
   * In production, this would call the LLM for structured output.
   */
  analyze: publicProcedure
    .input(
      z.object({
        prompt: z.string().min(1, "Prompt is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const strategyId = uuidv4();
      const dsl = buildDSLFromPrompt(input.prompt);

      // Build five-layer DSL structure from parsed result
      const atomLayer = {
        atoms: [
          ...(dsl.signals.macdDeathCross4H || dsl.signals.macdGoldenCross4H
            ? [
                {
                  id: "macd_4h",
                  symbol: dsl.monitorSymbol,
                  timeframe_ref: "tf_4h",
                  indicator: "MACD",
                  params: { fast: 12, slow: 26, signal: 9 } as Record<string, number>,
                },
              ]
            : []),
          ...(dsl.signals.priceBelowMA5_1D || dsl.signals.priceAboveMA5_1D
            ? [
                {
                  id: "ma5_1d",
                  symbol: dsl.monitorSymbol,
                  timeframe_ref: "tf_1d",
                  indicator: "MA",
                  params: { period: 5 } as Record<string, number>,
                },
                {
                  id: "price_close_1m",
                  symbol: dsl.monitorSymbol,
                  timeframe_ref: "tf_1m",
                  indicator: "PRICE_CLOSE",
                },
              ]
            : []),
        ],
      };

      const timeframeLayer = {
        units: [
          { id: "tf_1m", granularity: "1m", alignment: "REALTIME" as const },
          { id: "tf_4h", granularity: "4h", alignment: "LAST_CLOSED" as const },
          { id: "tf_1d", granularity: "1d", alignment: "LAST_CLOSED" as const },
        ],
        market_session: {
          timezone: "America/New_York",
          pre_close_buffer: "2min",
        },
      };

      const signalLayer = {
        signals: [
          ...(dsl.signals.macdDeathCross4H
            ? [
                {
                  id: "sig_macd_death",
                  type: "EVENT" as const,
                  expression: "CROSS_DOWN(macd_4h.macd_line, macd_4h.signal_line)",
                  description: "MACD 死叉 (4H, offset:1)",
                },
              ]
            : []),
          ...(dsl.signals.macdGoldenCross4H
            ? [
                {
                  id: "sig_macd_golden",
                  type: "EVENT" as const,
                  expression: "CROSS_UP(macd_4h.macd_line, macd_4h.signal_line)",
                  description: "MACD 金叉 (4H, offset:1)",
                },
              ]
            : []),
          ...(dsl.signals.priceBelowMA5_1D
            ? [
                {
                  id: "sig_price_below_ma5",
                  type: "STATE" as const,
                  expression: "price_close_1m.value < ma5_1d.value",
                  description: "当前价格低于日线 MA5 (offset:1)",
                },
              ]
            : []),
          ...(dsl.signals.priceAboveMA5_1D
            ? [
                {
                  id: "sig_price_above_ma5",
                  type: "STATE" as const,
                  expression: "price_close_1m.value > ma5_1d.value",
                  description: "当前价格高于日线 MA5 (offset:1)",
                },
              ]
            : []),
          {
            id: "sig_time_trigger",
            type: "TIME_EVENT" as const,
            expression: `IS_MARKET_TIME("${dsl.triggerTime}", "America/New_York")`,
            description: `在 ${dsl.triggerTime} ET 触发判定`,
          },
        ],
      };

      const signalIds = signalLayer.signals.map((s) => s.id);
      const logicLayer = {
        root: {
          operator: dsl.logicOperator,
          conditions: signalIds.map((id) => ({
            signal_id: id,
            lookback_window: id.includes("time") ? undefined : 1,
            min_confirmations: 1,
          })),
          cooldown_period: `${dsl.cooldownDays || 1}d`,
          priority: 1,
        },
      };

      const actionLayer = {
        actions: [
          {
            symbol: dsl.tradeSymbol,
            action_type: dsl.action.type,
            quantity: {
              type: "PERCENT_OF_POSITION",
              value: dsl.action.quantityPct,
            },
            order_config: {
              type: dsl.action.orderType,
              limit_protection: 0.005,
              slippage_max: "5bps",
            },
            safety_shield: {
              max_position_loss: "5%",
              cancel_unfilled_after: "5min",
            },
          },
        ],
      };

      // Generate strategy name from prompt
      const name =
        input.prompt.length > 60
          ? input.prompt.substring(0, 57) + "..."
          : input.prompt;

      // Save strategy to database
      await createStrategy({
        strategyId,
        userId: ctx.user?.id ?? null,
        name,
        prompt: input.prompt,
        status: "DRAFT",
        isFrozen: false,
        version: "1.0",
        atomLayer,
        timeframeLayer,
        signalLayer,
        logicLayer,
        actionLayer,
      });

      return {
        strategyId,
        name,
        status: "DRAFT",
        dsl: {
          atom: atomLayer,
          timeframe: timeframeLayer,
          signal: signalLayer,
          logic: logicLayer,
          action: actionLayer,
        },
        parsedConfig: dsl as unknown as Record<string, unknown>,
      };
    }),

  /**
   * POST /api/strategies/backtest
   * Starts a backtest task for a strategy.
   * Uses the Clock-Driven engine with 15:58 ET trigger time.
   */
  startBacktest: publicProcedure
    .input(
      z.object({
        strategyId: z.string(),
        options: z
          .object({
            tradingDays: z.number().optional(),
            startDate: z.string().optional(),
            initialCapital: z.number().optional(),
            commission: z.number().optional(),
            slippage: z.number().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const strategy = await getStrategyById(input.strategyId);
      if (!strategy) throw new Error("Strategy not found");
      if (strategy.isFrozen) throw new Error("Strategy is frozen and cannot be modified");

      // Update strategy status
      await updateStrategy(input.strategyId, { status: "BACKTESTING" });

      const runId = generateRunId();
      const seed = hashSeed(runId);

      // Create AI log entry for this run
      await createAiLog({
        strategyId: input.strategyId,
        runId,
        userId: ctx.user?.id ?? null,
        aiStatus: "MONITORING",
        stageLogs: [
          { stage: "STRATEGY_ANALYSIS", status: "PENDING", msg: "等待开始" },
          { stage: "DATA_SYNTHESIS", status: "PENDING", msg: "等待开始" },
          { stage: "LOGIC_CONSTRUCTION", status: "PENDING", msg: "等待开始" },
          { stage: "BACKTEST_ENGINE", status: "PENDING", msg: "等待开始" },
        ],
        runtimeLogs: [],
        backtestRunId: runId,
      });

      // Create backtest run record
      await createBacktestRun({
        runId,
        strategyId: input.strategyId,
        userId: ctx.user?.id ?? null,
        prompt: strategy.prompt,
        options: input.options || {},
        state: "running",
        seed,
        shouldFail: 0,
        failStep: 0,
        progress: 0,
        steps: [
          { key: "analysis", title: "STRATEGIC ANALYSIS", status: "queued", durationMs: null, logs: [], tags: [] },
          { key: "data", title: "DATA SYNTHESIS", status: "queued", durationMs: null, logs: [] },
          { key: "logic", title: "LOGIC CONSTRUCTION", status: "queued", durationMs: null, logs: [] },
          { key: "backtest", title: "BACKTEST ENGINE", status: "queued", durationMs: null, logs: [] },
        ],
        dslSnapshot: {
          atom: strategy.atomLayer,
          timeframe: strategy.timeframeLayer,
          signal: strategy.signalLayer,
          logic: strategy.logicLayer,
          action: strategy.actionLayer,
        },
      });

      // Run backtest asynchronously (simulate async processing)
      // In production, this would be a background job
      const dsl = buildDSLFromPrompt(strategy.prompt);
      const opts = input.options || {};

      // Execute backtest in background (non-blocking)
      setImmediate(async () => {
        try {
          // Stage 1: Analysis
          await updateAiLog(input.strategyId, runId, {
            aiStatus: "MONITORING",
            stageLogs: [
              { stage: "STRATEGY_ANALYSIS", status: "RUNNING", msg: "解析自然语言策略..." },
              { stage: "DATA_SYNTHESIS", status: "PENDING", msg: "等待开始" },
              { stage: "LOGIC_CONSTRUCTION", status: "PENDING", msg: "等待开始" },
              { stage: "BACKTEST_ENGINE", status: "PENDING", msg: "等待开始" },
            ],
          });
          await updateBacktestRun(runId, {
            progress: 5,
            steps: [
              { key: "analysis", title: "STRATEGIC ANALYSIS", status: "running", durationMs: null, logs: ["解析自然语言策略..."], tags: [`Asset: ${dsl.monitorSymbol}`, `Trade: ${dsl.tradeSymbol}`] },
              { key: "data", title: "DATA SYNTHESIS", status: "queued", durationMs: null, logs: [] },
              { key: "logic", title: "LOGIC CONSTRUCTION", status: "queued", durationMs: null, logs: [] },
              { key: "backtest", title: "BACKTEST ENGINE", status: "queued", durationMs: null, logs: [] },
            ],
          });
          await sleep(500);

          // Stage 2: Data Synthesis
          await updateAiLog(input.strategyId, runId, {
            stageLogs: [
              { stage: "STRATEGY_ANALYSIS", status: "SUCCESS", msg: "策略解析完成", durationMs: 500 },
              { stage: "DATA_SYNTHESIS", status: "RUNNING", msg: "生成市场数据..." },
              { stage: "LOGIC_CONSTRUCTION", status: "PENDING", msg: "等待开始" },
              { stage: "BACKTEST_ENGINE", status: "PENDING", msg: "等待开始" },
            ],
          });
          await updateBacktestRun(runId, {
            progress: 20,
            steps: [
              { key: "analysis", title: "STRATEGIC ANALYSIS", status: "done", durationMs: 500, logs: ["策略解析完成", `监控: ${dsl.monitorSymbol}`, `交易: ${dsl.tradeSymbol}`], tags: [`Asset: ${dsl.monitorSymbol}`] },
              { key: "data", title: "DATA SYNTHESIS", status: "running", durationMs: null, logs: ["生成 30 天分钟线数据..."] },
              { key: "logic", title: "LOGIC CONSTRUCTION", status: "queued", durationMs: null, logs: [] },
              { key: "backtest", title: "BACKTEST ENGINE", status: "queued", durationMs: null, logs: [] },
            ],
          });
          await sleep(800);

          // Stage 3: Logic Construction
          await updateAiLog(input.strategyId, runId, {
            stageLogs: [
              { stage: "STRATEGY_ANALYSIS", status: "SUCCESS", msg: "策略解析完成", durationMs: 500 },
              { stage: "DATA_SYNTHESIS", status: "SUCCESS", msg: "数据合成完成", durationMs: 800 },
              { stage: "LOGIC_CONSTRUCTION", status: "RUNNING", msg: "构建交易逻辑..." },
              { stage: "BACKTEST_ENGINE", status: "PENDING", msg: "等待开始" },
            ],
          });
          await updateBacktestRun(runId, {
            progress: 40,
            steps: [
              { key: "analysis", title: "STRATEGIC ANALYSIS", status: "done", durationMs: 500, logs: ["策略解析完成"], tags: [`Asset: ${dsl.monitorSymbol}`] },
              { key: "data", title: "DATA SYNTHESIS", status: "done", durationMs: 800, logs: ["数据合成完成", `${opts.tradingDays || 30} 个交易日`] },
              { key: "logic", title: "LOGIC CONSTRUCTION", status: "running", durationMs: null, logs: ["构建交易逻辑...", "编译 DSL 代码..."] },
              { key: "backtest", title: "BACKTEST ENGINE", status: "queued", durationMs: null, logs: [] },
            ],
          });
          await sleep(600);

          // Stage 4: Backtest Engine — Run the actual engine
          await updateAiLog(input.strategyId, runId, {
            aiStatus: "EXECUTING",
            stageLogs: [
              { stage: "STRATEGY_ANALYSIS", status: "SUCCESS", msg: "策略解析完成", durationMs: 500 },
              { stage: "DATA_SYNTHESIS", status: "SUCCESS", msg: "数据合成完成", durationMs: 800 },
              { stage: "LOGIC_CONSTRUCTION", status: "SUCCESS", msg: "逻辑构建完成", durationMs: 600 },
              { stage: "BACKTEST_ENGINE", status: "RUNNING", msg: "运行 Clock-Driven 回测引擎..." },
            ],
          });
          await updateBacktestRun(runId, {
            progress: 60,
            steps: [
              { key: "analysis", title: "STRATEGIC ANALYSIS", status: "done", durationMs: 500, logs: ["策略解析完成"], tags: [`Asset: ${dsl.monitorSymbol}`] },
              { key: "data", title: "DATA SYNTHESIS", status: "done", durationMs: 800, logs: ["数据合成完成"] },
              { key: "logic", title: "LOGIC CONSTRUCTION", status: "done", durationMs: 600, logs: ["逻辑构建完成"] },
              { key: "backtest", title: "BACKTEST ENGINE", status: "running", durationMs: null, logs: ["运行 Clock-Driven 回测引擎...", "15:58 ET 触发判定逻辑..."] },
            ],
          });

          // Actually run the backtest engine
          const report = runBacktest({
            dsl,
            seed,
            tradingDays: opts.tradingDays || 30,
            startDate: opts.startDate || "2024-10-01",
            initialCapital: opts.initialCapital || 10000,
            commission: opts.commission || 0.001,
            slippage: opts.slippage || 0.0005,
          });

          // Generate DSL code
          const { generateFullCode } = await import("./lib/seed");
          const dslCode = generateFullCode(strategy.prompt);

          // Store results
          const legacyKpis = {
            returnPct: Math.round(report.summary.totalReturn * 1000) / 10,
            cagrPct: Math.round(report.summary.annualizedReturn * 1000) / 10,
            sharpe: report.summary.sharpeRatio,
            maxDdPct: Math.round(report.summary.maxDrawdown * 1000) / 10,
          };

          await updateBacktestRun(runId, {
            state: "completed",
            progress: 100,
            dsl: dslCode,
            kpis: legacyKpis,
            equity: report.equityCurve,
            totalReturn: report.summary.totalReturn,
            annualizedReturn: report.summary.annualizedReturn,
            sharpeRatio: report.summary.sharpeRatio,
            maxDrawdown: report.summary.maxDrawdown,
            winRate: report.summary.winRate,
            totalTrades: report.summary.totalTrades,
            regimeAnalysis: report.summary.regimeAnalysis,
            signalHeatmap: report.summary.signalHeatmap,
            completedAt: new Date(),
            steps: [
              { key: "analysis", title: "STRATEGIC ANALYSIS", status: "done", durationMs: 500, logs: ["策略解析完成"], tags: [`Asset: ${dsl.monitorSymbol}`] },
              { key: "data", title: "DATA SYNTHESIS", status: "done", durationMs: 800, logs: ["数据合成完成"] },
              { key: "logic", title: "LOGIC CONSTRUCTION", status: "done", durationMs: 600, logs: ["逻辑构建完成"] },
              { key: "backtest", title: "BACKTEST ENGINE", status: "done", durationMs: 3200, logs: ["回测引擎运行完成", `${report.summary.totalTrades} 笔交易`, `Sharpe: ${report.summary.sharpeRatio.toFixed(2)}`] },
            ],
          });

          // Insert trades
          if (report.trades.length > 0) {
            const tradeRecords = report.trades.map((t, i) => ({
              runId,
              tradeId: t.id,
              entryTime: t.entryTime,
              exitTime: t.exitTime,
              tradeTimestamp: t.entryTime,
              symbol: t.symbol,
              action: t.side as "BUY" | "SELL",
              price: t.price,
              pnl: t.pnl,
              pnlPct: t.pnlPct,
              reason: t.reason,
              sortOrder: i,
            }));
            try {
              await insertBacktestTrades(tradeRecords);
            } catch (e) {
              // Trades may already exist
            }
          }

          // Update AI log
          await updateAiLog(input.strategyId, runId, {
            aiStatus: "COMPLETED",
            indicatorsSnapshot: {
              macd_4h: report.summary.signalHeatmap,
              sharpe: report.summary.sharpeRatio,
              maxDD: report.summary.maxDrawdown,
              winRate: report.summary.winRate,
            },
            stageLogs: [
              { stage: "STRATEGY_ANALYSIS", status: "SUCCESS", msg: "策略解析完成", durationMs: 500 },
              { stage: "DATA_SYNTHESIS", status: "SUCCESS", msg: "数据合成完成", durationMs: 800 },
              { stage: "LOGIC_CONSTRUCTION", status: "SUCCESS", msg: "逻辑构建完成", durationMs: 600 },
              { stage: "BACKTEST_ENGINE", status: "SUCCESS", msg: `回测完成: ${report.summary.totalTrades} 笔交易, Sharpe ${report.summary.sharpeRatio.toFixed(2)}`, durationMs: 3200 },
            ],
          });

          // Update strategy status
          await updateStrategy(input.strategyId, { status: "BACKTESTED" });
        } catch (error) {
          console.error("[Backtest Engine] Error:", error);
          await updateBacktestRun(runId, {
            state: "failed",
            errorMessage: String(error),
            completedAt: new Date(),
          });
          await updateAiLog(input.strategyId, runId, {
            aiStatus: "FAILED",
            stageLogs: [
              { stage: "BACKTEST_ENGINE", status: "FAILED", msg: `回测失败: ${String(error)}` },
            ],
          });
          await updateStrategy(input.strategyId, { status: "DRAFT" });
        }
      });

      return {
        strategyId: input.strategyId,
        runId,
        status: "accepted",
        message: "回测任务已启动，请轮询状态接口获取进度。",
      };
    }),

  /**
   * GET /api/strategies/{id}/status
   * Returns stage_logs format progress for the AI Workspace.
   */
  getStatus: publicProcedure
    .input(z.object({ strategyId: z.string() }))
    .query(async ({ input }) => {
      const strategy = await getStrategyById(input.strategyId);
      if (!strategy) throw new Error("Strategy not found");

      // Get latest AI log
      const logs = await listAiLogs(input.strategyId, 1);
      const latestLog = logs[0] || null;

      // Get latest backtest run
      const runs = await getBacktestRunsByStrategyId(input.strategyId);
      const latestRun = runs[0] || null;

      return {
        strategyId: input.strategyId,
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
      };
    }),

  /**
   * POST /api/strategies/{id}/deploy
   * Confirm & Deploy: transitions strategy to LIVE and freezes modifications.
   */
  deploy: publicProcedure
    .input(
      z.object({
        strategyId: z.string(),
        mode: z.enum(["paper", "live"]),
      })
    )
    .mutation(async ({ input }) => {
      const strategy = await getStrategyById(input.strategyId);
      if (!strategy) throw new Error("Strategy not found");
      if (strategy.status !== "BACKTESTED" && strategy.status !== "PENDING_DEPLOY") {
        throw new Error(`Cannot deploy strategy in ${strategy.status} status. Must be BACKTESTED first.`);
      }

      // Get latest completed backtest run
      const runs = await getBacktestRunsByStrategyId(input.strategyId);
      const completedRun = runs.find((r) => r.state === "completed");
      if (!completedRun) {
        throw new Error("No completed backtest found for this strategy.");
      }

      const deployId = `deploy-${generateRunId()}`;
      const deployStatus = input.mode === "paper" ? "ok" : "queued";

      // Update backtest run with deploy info
      await updateBacktestRun(completedRun.runId, {
        deployId,
        deployMode: input.mode,
        deployStatus: deployStatus as "queued" | "ok",
      });

      // Transition strategy to LIVE and freeze
      await updateStrategy(input.strategyId, {
        status: "LIVE",
        isFrozen: true,
        deployedAt: new Date(),
      });

      return {
        strategyId: input.strategyId,
        deployId,
        mode: input.mode,
        status: deployStatus,
        message: input.mode === "paper"
          ? "策略已部署到模拟交易环境。"
          : "策略已提交到实盘交易队列，等待确认。",
      };
    }),

  /** List all strategies for the current user */
  list: publicProcedure.query(async ({ ctx }) => {
    const strats = await listStrategies(ctx.user?.id);
    return {
      strategies: strats.map((s) => ({
        strategyId: s.strategyId,
        name: s.name,
        status: s.status,
        isFrozen: s.isFrozen,
        version: s.version,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    };
  }),

  /** Get full strategy details including DSL */
  getDetail: publicProcedure
    .input(z.object({ strategyId: z.string() }))
    .query(async ({ input }) => {
      const strategy = await getStrategyById(input.strategyId);
      if (!strategy) throw new Error("Strategy not found");

      return {
        ...strategy,
        dsl: {
          atom: strategy.atomLayer,
          timeframe: strategy.timeframeLayer,
          signal: strategy.signalLayer,
          logic: strategy.logicLayer,
          action: strategy.actionLayer,
        },
      };
    }),
});

// ============================================================
// Backtest Router — Legacy + enhanced endpoints
// ============================================================

const backtestRouter = router({
  /**
   * Create a new backtest run (legacy — direct run without strategy).
   * Stores the user's natural language intent in the database.
   * Returns a runId that can be used to poll status.
   */
  createRun: publicProcedure
    .input(
      z.object({
        prompt: z.string().min(1, "Prompt is required"),
        options: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const runId = generateRunId();
      const seed = hashSeed(runId);
      // 5% random failure rate for mock mode
      const shouldFail = Math.random() < 0.05;
      const failStep = Math.floor(Math.random() * 4);

      await createBacktestRun({
        runId,
        userId: ctx.user?.id ?? null,
        prompt: input.prompt,
        options: input.options ?? {},
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

      return { runId };
    }),

  /**
   * Get the current status of a backtest run.
   * Uses shared statusEngine for time-based progression.
   */
  getStatus: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input }) => {
      const run = await getBacktestRunByRunId(input.runId);
      if (!run) {
        // Fall back to in-memory registry for backward compatibility
        const { getRunStatus } = await import("./lib/mockRunRegistry");
        const memStatus = getRunStatus(input.runId);
        if (!memStatus) throw new Error("Run not found");
        return memStatus;
      }

      return computeRunStatus(run);
    }),

  /**
   * Get the backtest report (KPIs, equity curve, trades).
   * Now returns enhanced report with win_rate, total_trades, etc.
   */
  getReport: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input }) => {
      const run = await getBacktestRunByRunId(input.runId);
      if (run && run.state === "completed") {
        const trades = await getTradesByRunId(run.runId);
        return {
          kpis: run.kpis || { returnPct: 0, cagrPct: 0, sharpe: 0, maxDdPct: 0 },
          // Enhanced KPIs
          summary: {
            totalReturn: run.totalReturn,
            annualizedReturn: run.annualizedReturn,
            sharpeRatio: run.sharpeRatio,
            maxDrawdown: run.maxDrawdown,
            winRate: run.winRate,
            totalTrades: run.totalTrades,
            regimeAnalysis: run.regimeAnalysis,
            signalHeatmap: run.signalHeatmap,
          },
          equity: run.equity || [],
          trades: trades.length > 0
            ? trades.map((t) => ({
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
              }))
            : [],
        };
      }

      // Fall back to in-memory registry
      const { getRunReport } = await import("./lib/mockRunRegistry");
      const report = getRunReport(input.runId);
      if (!report) throw new Error("Report not found");
      return report;
    }),

  /**
   * List backtest history (completed/failed runs, newest first).
   */
  listHistory: publicProcedure.query(async ({ ctx }) => {
    const dbHistory = await listBacktestHistory(ctx.user?.id);

    if (dbHistory.length > 0) {
      const entries = await Promise.all(
        dbHistory.map(async (run) => {
          const trades = await getTradesByRunId(run.runId);
          return {
            runId: run.runId,
            strategyId: run.strategyId,
            prompt: run.prompt,
            state: run.state as "completed" | "failed",
            completedAt: run.completedAt
              ? new Date(run.completedAt).getTime()
              : new Date(run.updatedAt).getTime(),
            kpis: run.kpis || null,
            summary: {
              totalReturn: run.totalReturn,
              annualizedReturn: run.annualizedReturn,
              sharpeRatio: run.sharpeRatio,
              maxDrawdown: run.maxDrawdown,
              winRate: run.winRate,
              totalTrades: run.totalTrades,
            },
            equity: run.equity || null,
            trades: trades.length > 0
              ? trades.map((t) => ({
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
                }))
              : null,
            dsl: run.dsl || "",
          };
        })
      );
      return { history: entries };
    }

    // Fall back to in-memory history
    const { getHistory } = await import("./lib/mockRunRegistry");
    return { history: getHistory() };
  }),

  /**
   * Deploy a completed strategy to paper or live trading.
   */
  deploy: publicProcedure
    .input(
      z.object({
        runId: z.string(),
        mode: z.enum(["paper", "live"]),
      })
    )
    .mutation(async ({ input }) => {
      const deployId = `deploy-${generateRunId()}`;
      const status = input.mode === "paper" ? "ok" : "queued";

      const run = await getBacktestRunByRunId(input.runId);
      if (run) {
        await updateBacktestRun(input.runId, {
          deployId,
          deployMode: input.mode,
          deployStatus: status as "queued" | "ok",
        });
      } else {
        const { deployRun } = await import("./lib/mockRunRegistry");
        const result = deployRun(input.runId, input.mode);
        if (!result) throw new Error("Run not found");
        return result;
      }

      return { deployId, status };
    }),
});

// ============================================================
// App Router
// ============================================================

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  strategy: strategyRouter,
  backtest: backtestRouter,
});

export type AppRouter = typeof appRouter;

// ============================================================
// Helpers
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
