import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
  float,
  bigint,
  uniqueIndex,
  boolean,
  double,
  index,
} from "drizzle-orm/mysql-core";

// ============================================================
// Users Table (unchanged)
// ============================================================

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================================
// Strategies Table — Five-layer DSL, status lifecycle, versioning
// ============================================================

export const strategies = mysqlTable("strategies", {
  id: int("id").autoincrement().primaryKey(),
  /** UUID v4 unique identifier */
  strategyId: varchar("strategyId", { length: 64 }).notNull().unique(),
  /** Foreign key to users table */
  userId: int("userId"),
  /** Human-readable strategy name */
  name: varchar("name", { length: 256 }).notNull(),
  /** Original natural language prompt from user */
  prompt: text("prompt").notNull(),
  /** Strategy lifecycle status */
  status: mysqlEnum("status", [
    "DRAFT",
    "BACKTESTING",
    "BACKTESTED",
    "PENDING_DEPLOY",
    "LIVE",
    "ARCHIVED",
  ])
    .default("DRAFT")
    .notNull(),
  /** Frozen flag: true when PENDING_DEPLOY or LIVE, prevents modifications */
  isFrozen: boolean("isFrozen").default(false).notNull(),
  /** Version string for tracking strategy evolution */
  version: varchar("version", { length: 16 }).default("1.0").notNull(),
  /** Parent strategy ID for version lineage tracking */
  parentId: varchar("parentId", { length: 64 }),

  // ---- Five-layer DSL JSON fields ----
  /** Layer 1: Atom — indicator definitions (MACD, MA, PRICE_CLOSE) */
  atomLayer: json("atomLayer").$type<{
    atoms: Array<{
      id: string;
      symbol: string;
      timeframe_ref: string;
      indicator: string;
      params?: Record<string, number>;
    }>;
  }>(),
  /** Layer 2: Timeframe — granularity & alignment rules */
  timeframeLayer: json("timeframeLayer").$type<{
    units: Array<{
      id: string;
      granularity: string;
      alignment: "REALTIME" | "LAST_CLOSED";
    }>;
    market_session?: {
      timezone: string;
      pre_close_buffer: string;
    };
  }>(),
  /** Layer 3: Signal — event/state/time triggers */
  signalLayer: json("signalLayer").$type<{
    signals: Array<{
      id: string;
      type: "EVENT" | "STATE" | "TIME_EVENT";
      expression: string;
      description: string;
    }>;
  }>(),
  /** Layer 4: Logic — signal combination rules */
  logicLayer: json("logicLayer").$type<{
    root: {
      operator: "AND" | "OR";
      conditions: Array<{
        signal_id: string;
        lookback_window?: number;
        min_confirmations?: number;
      }>;
      cooldown_period?: string;
      priority?: number;
    };
  }>(),
  /** Layer 5: Action — execution instructions */
  actionLayer: json("actionLayer").$type<{
    actions: Array<{
      symbol: string;
      action_type: "BUY" | "SELL";
      quantity: { type: string; value: number };
      order_config?: {
        type: string;
        limit_protection?: number;
        slippage_max?: string;
      };
      safety_shield?: {
        max_position_loss?: string;
        cancel_unfilled_after?: string;
      };
    }>;
  }>(),

  /** Timestamp when strategy was deployed to LIVE */
  deployedAt: timestamp("deployedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Strategy = typeof strategies.$inferSelect;
export type InsertStrategy = typeof strategies.$inferInsert;

// ============================================================
// AI Logs Table — Real-time monitoring, stage progress, indicator snapshots
// ============================================================

export const aiLogs = mysqlTable("ai_logs", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to strategies.strategyId */
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  /** Distinguishes multiple generation attempts for the same strategy */
  runId: varchar("runId", { length: 64 }).notNull(),
  /** Foreign key to users table */
  userId: int("userId"),
  /** Last check timestamp */
  lastCheckTime: timestamp("lastCheckTime"),
  /** AI monitoring status */
  aiStatus: mysqlEnum("aiStatus", [
    "MONITORING",
    "TRIGGERED",
    "EXECUTING",
    "COMPLETED",
    "FAILED",
  ])
    .default("MONITORING")
    .notNull(),
  /** Indicator snapshot at check time */
  indicatorsSnapshot: json("indicatorsSnapshot").$type<Record<string, unknown>>(),
  /** Stage-by-stage progress logs driving the AI Workspace cards */
  stageLogs: json("stageLogs").$type<
    Array<{
      stage: string;
      status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
      msg: string;
      durationMs?: number;
    }>
  >(),
  /** Detailed runtime logs for the scrolling log stream */
  runtimeLogs: json("runtimeLogs").$type<
    Array<{
      time: string;
      msg: string;
    }>
  >(),
  /** Link to the associated backtest run */
  backtestRunId: varchar("backtestRunId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiLog = typeof aiLogs.$inferSelect;
export type InsertAiLog = typeof aiLogs.$inferInsert;

// ============================================================
// Backtest Runs Table — Enhanced with full report schema
// ============================================================

export const backtestRuns = mysqlTable("backtest_runs", {
  id: int("id").autoincrement().primaryKey(),
  /** Unique run identifier */
  runId: varchar("runId", { length: 64 }).notNull().unique(),
  /** Foreign key to strategies.strategyId (nullable for standalone runs) */
  strategyId: varchar("strategyId", { length: 64 }),
  /** Foreign key to users table */
  userId: int("userId"),
  /** The user's natural language strategy prompt */
  prompt: text("prompt").notNull(),
  /** Run configuration (transactionCosts, dateRange, maxDrawdown, etc.) */
  options: json("options").$type<Record<string, unknown>>(),
  /** Current run state */
  state: mysqlEnum("state", ["idle", "running", "completed", "failed"])
    .default("idle")
    .notNull(),

  // ---- Full Backtest Report KPIs (matching document schema) ----
  /** Total return percentage (e.g., 0.25 = 25%) */
  totalReturn: double("totalReturn"),
  /** Annualized return percentage */
  annualizedReturn: double("annualizedReturn"),
  /** Sharpe ratio */
  sharpeRatio: double("sharpeRatio"),
  /** Maximum drawdown (negative, e.g., -0.08) */
  maxDrawdown: double("maxDrawdown"),
  /** Win rate (e.g., 0.65 = 65%) */
  winRate: double("winRate"),
  /** Total number of trades */
  totalTrades: int("totalTrades"),
  /** Regime analysis text */
  regimeAnalysis: text("regimeAnalysis"),
  /** Signal heatmap data (frequency of 15:58 triggers) */
  signalHeatmap: json("signalHeatmap").$type<Record<string, unknown>>(),

  /** Legacy KPI format (kept for backward compatibility) */
  kpis: json("kpis").$type<{
    returnPct: number;
    cagrPct: number;
    sharpe: number;
    maxDdPct: number;
  }>(),
  /** Equity curve data points */
  equity: json("equity").$type<
    Array<{ timestamp: string; value: number }>
  >(),
  /** AI-generated strategy DSL/code */
  dsl: text("dsl"),
  /** Full five-layer DSL snapshot at backtest time */
  dslSnapshot: json("dslSnapshot").$type<Record<string, unknown>>(),

  /** Seed for deterministic mock data generation */
  seed: int("seed"),
  /** Whether this run should simulate failure */
  shouldFail: int("shouldFail").default(0),
  /** Which step should fail (0-3) */
  failStep: int("failStep").default(0),
  /** Backtest progress percentage (0-100) */
  progress: int("progress").default(0),
  /** Current step statuses */
  steps: json("steps").$type<
    Array<{
      key: string;
      title: string;
      status: "queued" | "running" | "done" | "warn" | "error";
      durationMs: number | null;
      logs: string[];
      tags?: string[];
    }>
  >(),

  /** Deployment info */
  deployId: varchar("deployId", { length: 64 }),
  deployMode: mysqlEnum("deployMode", ["paper", "live"]),
  deployStatus: mysqlEnum("deployStatus", ["queued", "ok"]),
  /** Error message if failed */
  errorMessage: text("errorMessage"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type BacktestRun = typeof backtestRuns.$inferSelect;
export type InsertBacktestRun = typeof backtestRuns.$inferInsert;

// ============================================================
// Backtest Trades Table — Enhanced with pnl_pct and reason
// ============================================================

export const backtestTrades = mysqlTable("backtest_trades", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to backtestRuns.runId */
  runId: varchar("runId", { length: 64 }).notNull(),
  /** Trade unique identifier */
  tradeId: varchar("tradeId", { length: 64 }),
  /** Entry timestamp (ISO format) */
  entryTime: varchar("entryTime", { length: 64 }),
  /** Exit timestamp (ISO format) */
  exitTime: varchar("exitTime", { length: 64 }),
  /** Legacy: human-readable timestamp */
  tradeTimestamp: varchar("tradeTimestamp", { length: 64 }).notNull(),
  /** Trading symbol (e.g., "TQQQ", "QQQ") */
  symbol: varchar("symbol", { length: 32 }).notNull(),
  /** Trade side: BUY or SELL */
  action: mysqlEnum("action", ["BUY", "SELL"]).notNull(),
  /** Execution price */
  price: double("price").notNull(),
  /** Profit/Loss amount */
  pnl: double("pnl"),
  /** Profit/Loss percentage */
  pnlPct: double("pnlPct"),
  /** Reason for the trade (signal description) */
  reason: text("reason"),
  /** Order within the run for consistent display */
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BacktestTrade = typeof backtestTrades.$inferSelect;
export type InsertBacktestTrade = typeof backtestTrades.$inferInsert;

// ============================================================
// Market Data Table — 1-minute OHLCV candles
// ============================================================

export const marketData = mysqlTable(
  "market_data",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Trading symbol (e.g., "QQQ", "TQQQ") */
    symbol: varchar("symbol", { length: 16 }).notNull(),
    /** Timeframe (always "1m" for base data) */
    timeframe: varchar("timeframe", { length: 8 }).default("1m").notNull(),
    /** Unix timestamp in milliseconds */
    t: bigint("t", { mode: "number" }).notNull(),
    /** Open price */
    o: double("o").notNull(),
    /** High price */
    h: double("h").notNull(),
    /** Low price */
    l: double("l").notNull(),
    /** Close price */
    c: double("c").notNull(),
    /** Volume */
    v: bigint("v", { mode: "number" }).notNull(),
    /** Volume-weighted average price */
    vwap: double("vwap"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_symbol_timeframe_t").on(
      table.symbol,
      table.timeframe,
      table.t
    ),
    index("idx_symbol_t").on(table.symbol, table.t),
  ]
);

export type MarketDataRow = typeof marketData.$inferSelect;
export type InsertMarketData = typeof marketData.$inferInsert;

// ============================================================
// Portfolios Table — Account info, balances, performance
// ============================================================

export const portfolios = mysqlTable("portfolios", {
  id: int("id").autoincrement().primaryKey(),
  /** Unique account identifier */
  accountId: varchar("accountId", { length: 64 }).notNull().unique(),
  /** Foreign key to users table */
  userId: int("userId"),
  /** Account type: PAPER or LIVE */
  accountType: mysqlEnum("accountType", ["PAPER", "LIVE"])
    .default("PAPER")
    .notNull(),
  /** Broker provider identifier */
  brokerProvider: varchar("brokerProvider", { length: 64 }).default("MOCK"),
  /** Currency */
  currency: varchar("currency", { length: 8 }).default("USD").notNull(),
  /** Account status */
  accountStatus: mysqlEnum("accountStatus", ["ACTIVE", "INACTIVE", "SUSPENDED"])
    .default("ACTIVE")
    .notNull(),
  /** Cash balance */
  cash: double("cash").default(10000).notNull(),
  /** Buying power (including leverage) */
  buyingPower: double("buyingPower").default(20000).notNull(),
  /** Total equity (cash + positions market value) */
  equity: double("equity").default(10000).notNull(),
  /** Initial deposit amount */
  initialDeposit: double("initialDeposit").default(10000).notNull(),
  /** Total realized PnL */
  totalPnl: double("totalPnl").default(0).notNull(),
  /** Daily PnL */
  dailyPnl: double("dailyPnl").default(0).notNull(),
  /** PnL percentage */
  pnlPct: double("pnlPct").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Portfolio = typeof portfolios.$inferSelect;
export type InsertPortfolio = typeof portfolios.$inferInsert;

// ============================================================
// Positions Table — Current holdings per strategy
// ============================================================

export const positions = mysqlTable("positions", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to portfolios.accountId */
  accountId: varchar("accountId", { length: 64 }).notNull(),
  /** Foreign key to strategies.strategyId */
  strategyId: varchar("strategyId", { length: 64 }),
  /** Trading symbol */
  symbol: varchar("symbol", { length: 32 }).notNull(),
  /** Quantity held */
  qty: double("qty").notNull(),
  /** Average entry price */
  avgPrice: double("avgPrice").notNull(),
  /** Current market price */
  currentPrice: double("currentPrice"),
  /** Current market value */
  marketValue: double("marketValue"),
  /** Unrealized PnL */
  unrealizedPnl: double("unrealizedPnl"),
  /** Unrealized PnL percentage */
  unrealizedPnlPct: double("unrealizedPnlPct"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Position = typeof positions.$inferSelect;
export type InsertPosition = typeof positions.$inferInsert;

// ============================================================
// Orders Table — Trade execution records
// ============================================================

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  /** Unique order identifier */
  orderId: varchar("orderId", { length: 64 }).notNull().unique(),
  /** Foreign key to portfolios.accountId */
  accountId: varchar("accountId", { length: 64 }).notNull(),
  /** Foreign key to strategies.strategyId */
  strategyId: varchar("strategyId", { length: 64 }),
  /** Trading symbol */
  symbol: varchar("symbol", { length: 32 }).notNull(),
  /** Order side */
  side: mysqlEnum("side", ["BUY", "SELL"]).notNull(),
  /** Order type */
  orderType: mysqlEnum("orderType", ["MARKET", "LIMIT", "MOC"])
    .default("MARKET")
    .notNull(),
  /** Order status */
  orderStatus: mysqlEnum("orderStatus", [
    "PENDING",
    "FILLED",
    "REJECTED",
    "CANCELLED",
  ])
    .default("PENDING")
    .notNull(),
  /** Requested quantity */
  requestQty: double("requestQty").notNull(),
  /** Filled quantity */
  filledQty: double("filledQty"),
  /** Filled price */
  filledPrice: double("filledPrice"),
  /** Commission */
  commission: double("commission").default(0),
  /** Error message if rejected */
  errorMessage: text("errorMessage"),
  filledAt: timestamp("filledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;
