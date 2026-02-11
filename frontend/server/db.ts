import { eq, desc, and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  backtestRuns,
  backtestTrades,
  strategies,
  aiLogs,
  portfolios,
  positions,
  orders,
  type InsertBacktestRun,
  type InsertBacktestTrade,
  type BacktestRun,
  type BacktestTrade,
  type InsertStrategy,
  type Strategy,
  type InsertAiLog,
  type AiLog,
  type InsertPortfolio,
  type Portfolio,
  type InsertPosition,
  type Position,
  type InsertOrder,
  type Order,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  const url = process.env.DATABASE_URL;
  const isMysql = typeof url === "string" && (url.startsWith("mysql://") || url.startsWith("mysql2://"));
  if (!_db && isMysql) {
    try {
      _db = drizzle(url);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============================================================
// User helpers (unchanged)
// ============================================================

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============================================================
// Strategy helpers
// ============================================================

/** Create a new strategy record */
export async function createStrategy(data: InsertStrategy): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create strategy: database not available");
    return;
  }
  await db.insert(strategies).values(data);
}

/** Get a strategy by strategyId */
export async function getStrategyById(
  strategyId: string
): Promise<Strategy | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(strategies)
    .where(eq(strategies.strategyId, strategyId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/** Update a strategy (partial update) */
export async function updateStrategy(
  strategyId: string,
  data: Partial<InsertStrategy>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(strategies)
    .set(data)
    .where(eq(strategies.strategyId, strategyId));
}

/** List strategies for a user (newest first) */
export async function listStrategies(
  userId?: number,
  limit: number = 50
): Promise<Strategy[]> {
  const db = await getDb();
  if (!db) return [];

  const query = userId
    ? db
        .select()
        .from(strategies)
        .where(eq(strategies.userId, userId))
        .orderBy(desc(strategies.createdAt))
        .limit(limit)
    : db
        .select()
        .from(strategies)
        .orderBy(desc(strategies.createdAt))
        .limit(limit);

  return query;
}

// ============================================================
// AI Log helpers
// ============================================================

/** Create a new AI log entry */
export async function createAiLog(data: InsertAiLog): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(aiLogs).values(data);
}

/** Get AI log by strategyId and runId */
export async function getAiLog(
  strategyId: string,
  runId: string
): Promise<AiLog | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(aiLogs)
    .where(
      and(eq(aiLogs.strategyId, strategyId), eq(aiLogs.runId, runId))
    )
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/** Update an AI log entry */
export async function updateAiLog(
  strategyId: string,
  runId: string,
  data: Partial<InsertAiLog>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(aiLogs)
    .set(data)
    .where(
      and(eq(aiLogs.strategyId, strategyId), eq(aiLogs.runId, runId))
    );
}

/** List AI logs for a strategy (newest first) */
export async function listAiLogs(
  strategyId: string,
  limit: number = 20
): Promise<AiLog[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(aiLogs)
    .where(eq(aiLogs.strategyId, strategyId))
    .orderBy(desc(aiLogs.createdAt))
    .limit(limit);
}

// ============================================================
// Backtest Run helpers
// ============================================================

/** Create a new backtest run record */
export async function createBacktestRun(
  data: InsertBacktestRun
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create run: database not available");
    return;
  }
  await db.insert(backtestRuns).values(data);
}

/** Get a backtest run by runId */
export async function getBacktestRunByRunId(
  runId: string
): Promise<BacktestRun | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.runId, runId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/** Update a backtest run (partial update) */
export async function updateBacktestRun(
  runId: string,
  data: Partial<InsertBacktestRun>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(backtestRuns)
    .set(data)
    .where(eq(backtestRuns.runId, runId));
}

/** List completed/failed runs for history (newest first) */
export async function listBacktestHistory(
  userId?: number,
  limit: number = 50
): Promise<BacktestRun[]> {
  const db = await getDb();
  if (!db) return [];

  const query = db
    .select()
    .from(backtestRuns)
    .orderBy(desc(backtestRuns.createdAt))
    .limit(limit);

  const result = await query;

  // Filter for completed/failed runs
  return result.filter(
    (r) => r.state === "completed" || r.state === "failed"
  );
}

/** Get backtest runs by strategyId */
export async function getBacktestRunsByStrategyId(
  strategyId: string
): Promise<BacktestRun[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.strategyId, strategyId))
    .orderBy(desc(backtestRuns.createdAt));
}

// ============================================================
// Backtest Trade helpers
// ============================================================

/** Insert multiple trades for a run */
export async function insertBacktestTrades(
  trades: InsertBacktestTrade[]
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  if (trades.length === 0) return;

  await db.insert(backtestTrades).values(trades);
}

/** Get all trades for a run (ordered by sortOrder) */
export async function getTradesByRunId(
  runId: string
): Promise<BacktestTrade[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(backtestTrades)
    .where(eq(backtestTrades.runId, runId))
    .orderBy(backtestTrades.sortOrder);
}

// ============================================================
// Portfolio helpers
// ============================================================

/** Create or update a portfolio */
export async function upsertPortfolio(data: InsertPortfolio): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(portfolios).values(data).onDuplicateKeyUpdate({
    set: {
      cash: data.cash,
      buyingPower: data.buyingPower,
      equity: data.equity,
      totalPnl: data.totalPnl,
      dailyPnl: data.dailyPnl,
      pnlPct: data.pnlPct,
      accountStatus: data.accountStatus,
    },
  });
}

/** Get portfolio by accountId */
export async function getPortfolioByAccountId(
  accountId: string
): Promise<Portfolio | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.accountId, accountId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/** List portfolios for a user */
export async function listPortfolios(userId: number): Promise<Portfolio[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, userId))
    .orderBy(desc(portfolios.createdAt));
}

// ============================================================
// Position helpers
// ============================================================

/** Upsert a position */
export async function upsertPosition(data: InsertPosition): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(positions).values(data).onDuplicateKeyUpdate({
    set: {
      qty: data.qty,
      avgPrice: data.avgPrice,
      currentPrice: data.currentPrice,
      marketValue: data.marketValue,
      unrealizedPnl: data.unrealizedPnl,
      unrealizedPnlPct: data.unrealizedPnlPct,
    },
  });
}

/** Get positions for an account */
export async function getPositionsByAccountId(
  accountId: string
): Promise<Position[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(positions)
    .where(eq(positions.accountId, accountId));
}

// ============================================================
// Order helpers
// ============================================================

/** Create an order */
export async function createOrder(data: InsertOrder): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(orders).values(data);
}

/** Update an order */
export async function updateOrder(
  orderId: string,
  data: Partial<InsertOrder>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(orders)
    .set(data)
    .where(eq(orders.orderId, orderId));
}

/** List orders for an account */
export async function listOrdersByAccountId(
  accountId: string,
  limit: number = 50
): Promise<Order[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(orders)
    .where(eq(orders.accountId, accountId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}
