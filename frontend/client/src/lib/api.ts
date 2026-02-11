// ============================================================
// API Client - fetch wrapper for Aipha backtest endpoints
// Types aligned with the five-layer DSL and enhanced Report Schema
// ============================================================

const baseUrl = (import.meta as any).env?.VITE_API_BASE_URL ?? '';

// ============================================================
// Strategy Types — Five-layer DSL
// ============================================================

export interface DSLAtomLayer {
  atoms: Array<{
    id: string;
    symbol: string;
    timeframe_ref: string;
    indicator: string;
    params?: Record<string, number>;
  }>;
}

export interface DSLTimeframeLayer {
  units: Array<{
    id: string;
    granularity: string;
    alignment: 'REALTIME' | 'LAST_CLOSED';
  }>;
  market_session?: {
    timezone: string;
    pre_close_buffer: string;
  };
}

export interface DSLSignalLayer {
  signals: Array<{
    id: string;
    type: 'EVENT' | 'STATE' | 'TIME_EVENT';
    expression: string;
    description: string;
  }>;
}

export interface DSLLogicLayer {
  root: {
    operator: 'AND' | 'OR';
    conditions: Array<{
      signal_id: string;
      lookback_window?: number;
      min_confirmations?: number;
    }>;
    cooldown_period?: string;
    priority?: number;
  };
}

export interface DSLActionLayer {
  actions: Array<{
    symbol: string;
    action_type: 'BUY' | 'SELL';
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
}

export interface FiveLayerDSL {
  atom: DSLAtomLayer;
  timeframe: DSLTimeframeLayer;
  signal: DSLSignalLayer;
  logic: DSLLogicLayer;
  action: DSLActionLayer;
}

export interface AnalyzeResponse {
  strategyId: string;
  name: string;
  status: string;
  dsl: FiveLayerDSL;
  parsedConfig: Record<string, unknown>;
}

// ============================================================
// Backtest Types
// ============================================================

export interface CreateRunResponse {
  runId: string;
}

export interface StartBacktestResponse {
  strategyId: string;
  runId: string;
  status: string;
  message: string;
}

export interface StepInfo {
  key: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'warn' | 'error';
  durationMs: number | null;
  logs: string[];
  tags?: string[];
}

export interface RunStatusResponse {
  runId: string;
  state: 'idle' | 'running' | 'completed' | 'failed';
  steps: StepInfo[];
  progress: number;
  artifacts: {
    dsl: string;
    reportUrl: string;
    tradesCsvUrl: string;
  };
}

/** Enhanced KPI summary matching the document schema */
export interface BacktestSummary {
  totalReturn: number | null;
  annualizedReturn: number | null;
  sharpeRatio: number | null;
  maxDrawdown: number | null;
  winRate: number | null;
  totalTrades: number | null;
  regimeAnalysis?: string | null;
  signalHeatmap?: Record<string, unknown> | null;
}

/** Legacy KPI format (backward compatible) */
export interface LegacyKPIs {
  returnPct: number;
  cagrPct: number;
  sharpe: number;
  maxDdPct: number;
}

/** Enhanced trade record with pnl_pct and reason */
export interface TradeRecord {
  id?: string;
  entryTime?: string;
  exitTime?: string;
  timestamp: string;
  symbol: string;
  action: string;
  price: number;
  pnl: number | null;
  pnlPct?: number | null;
  reason?: string | null;
}

export interface RunReportResponse {
  kpis: LegacyKPIs;
  summary?: BacktestSummary;
  equity: Array<{ t?: number; v?: number; timestamp?: string; value?: number }>;
  trades: TradeRecord[];
}

export interface DeployResponse {
  deployId: string;
  status: 'queued' | 'ok';
}

// ============================================================
// Strategy Status Types
// ============================================================

export interface StrategyStatusResponse {
  strategyId: string;
  strategyStatus: string;
  isFrozen: boolean;
  aiLog: {
    runId: string;
    aiStatus: string;
    stageLogs: Array<{
      stage: string;
      status: string;
      msg: string;
      durationMs?: number;
    }>;
    indicatorsSnapshot: Record<string, unknown>;
    runtimeLogs: Array<{ time: string; msg: string }>;
  } | null;
  backtestRun: {
    runId: string;
    state: string;
    progress: number;
    steps: StepInfo[];
  } | null;
}

// ============================================================
// REST API Functions
// ============================================================

type V0Mode = 'BACKTEST_ONLY' | 'PAPER' | 'LIVE';

type V0WorkspaceStepState = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';

type V0LogEntry = { ts: string; level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'; msg: string; kv?: Record<string, unknown> };

type V0WorkspaceStep = { id: 'parse' | 'plan' | 'data' | 'backtest' | 'report' | 'deploy'; state: V0WorkspaceStepState; label: string; logs: V0LogEntry[] };

type V0ArtifactRef = { id: string; type: 'json' | 'markdown' | 'image' | 'csv' | 'binary'; name: string; uri: string };

type V0RunStatusResponse = { run_id: string; state: 'running' | 'completed' | 'failed'; progress: number; steps: V0WorkspaceStep[]; artifacts: V0ArtifactRef[] };

type V0BacktestReportResponse = {
  kpis: {
    return_pct: number;
    cagr_pct: number;
    sharpe: number;
    max_dd_pct: number;
    trades: number;
    win_rate: number;
    avg_holding_days: number;
  };
  equity: Array<{ t: string; v: number }>;
  trades: Array<{
    decision_time: string;
    fill_time: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    qty: number;
    fill_price: number;
    cost: Record<string, unknown>;
    why: Record<string, unknown>;
  }>;
};

function mapV0StepToStepInfo(step: V0WorkspaceStep): StepInfo {
  const statusMap: Record<V0WorkspaceStepState, StepInfo['status']> = {
    PENDING: 'queued',
    RUNNING: 'running',
    DONE: 'done',
    FAILED: 'error',
    SKIPPED: 'queued',
  };

  const logs = (step.logs || []).map((l) => {
    const kv = l.kv && Object.keys(l.kv).length > 0 ? ` ${JSON.stringify(l.kv)}` : '';
    return `[${l.level}] ${l.msg}${kv}`;
  });

  return { key: step.id, title: step.label, status: statusMap[step.state], durationMs: null, logs };
}

function findArtifactUri(artifacts: V0ArtifactRef[], name: string): string | null {
  const a = artifacts.find((x) => x.name === name);
  return a ? a.uri : null;
}

export async function getRunArtifact(runId: string, name: string): Promise<{ name: string; type: string; uri: string; content: any }> {
  const res = await fetch(`${baseUrl}/api/runs/${runId}/artifacts/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Failed to get artifact: ${res.statusText}`);
  return res.json();
}

// POST /api/runs (v0)
export async function createRun(prompt: string, options?: Record<string, unknown>): Promise<CreateRunResponse> {
  const mode = (options?.mode as V0Mode | undefined) ?? 'BACKTEST_ONLY';
  const res = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_type: 'NATURAL_LANGUAGE', nl: prompt, mode }),
  });
  if (!res.ok) throw new Error(`Failed to create run: ${res.statusText}`);
  const data = (await res.json()) as { run_id: string };
  return { runId: data.run_id };
}

// GET /api/runs/:runId/status
export async function getRunStatus(runId: string): Promise<RunStatusResponse> {
  const res = await fetch(`${baseUrl}/api/runs/${runId}/status`);
  if (!res.ok) throw new Error(`Failed to get status: ${res.statusText}`);
  const data = (await res.json()) as V0RunStatusResponse;
  const reportUrl = `${baseUrl}/api/runs/${runId}/report`;
  const tradesCsvUrl = findArtifactUri(data.artifacts, 'trades.csv') ? `${baseUrl}${findArtifactUri(data.artifacts, 'trades.csv')}` : '';
  const steps = data.steps.map(mapV0StepToStepInfo);
  return {
    runId: data.run_id,
    state: data.state,
    steps,
    progress: data.progress,
    artifacts: {
      dsl: '',
      reportUrl,
      tradesCsvUrl,
    },
  };
}

// GET /api/runs/:runId/report
export async function getRunReport(runId: string): Promise<RunReportResponse> {
  const res = await fetch(`${baseUrl}/api/runs/${runId}/report`);
  if (!res.ok) throw new Error(`Failed to get report: ${res.statusText}`);
  const data = (await res.json()) as V0BacktestReportResponse;
  const kpis: LegacyKPIs = {
    returnPct: Number(data.kpis.return_pct.toFixed(4)),
    cagrPct: Number(data.kpis.cagr_pct.toFixed(4)),
    sharpe: Number(data.kpis.sharpe.toFixed(4)),
    maxDdPct: Number(data.kpis.max_dd_pct.toFixed(4)),
  };

  const equity = data.equity.map((p) => ({ timestamp: p.t, value: p.v }));
  const trades: TradeRecord[] = data.trades.map((t) => ({
    timestamp: new Date(t.fill_time).toLocaleString(),
    symbol: t.symbol,
    action: t.side,
    price: t.fill_price,
    pnl: null,
    reason: JSON.stringify(t.why ?? {}),
  }));

  const summary: BacktestSummary = {
    totalReturn: data.kpis.return_pct,
    annualizedReturn: data.kpis.cagr_pct,
    sharpeRatio: data.kpis.sharpe,
    maxDrawdown: data.kpis.max_dd_pct,
    winRate: data.kpis.win_rate,
    totalTrades: data.kpis.trades,
  };

  return { kpis, summary, equity, trades };
}

// POST /api/runs/:runId/deploy
export async function deployRun(runId: string, mode: 'paper' | 'live'): Promise<DeployResponse> {
  const res = await fetch(`${baseUrl}/api/runs/${runId}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`Failed to deploy: ${res.statusText}`);
  return res.json();
}

// GET /api/strategies/:id/status (REST)
export async function getStrategyStatus(strategyId: string): Promise<StrategyStatusResponse> {
  const res = await fetch(`${baseUrl}/api/strategies/${strategyId}/status`);
  if (!res.ok) throw new Error(`Failed to get strategy status: ${res.statusText}`);
  return res.json();
}

// Download trades CSV
export function getTradesCsvUrl(runId: string): string {
  return `${baseUrl}/api/runs/${runId}/report?format=csv`;
}

// ============================================================
// History Types
// ============================================================

export interface HistoryEntry {
  runId: string;
  strategyId?: string;
  prompt: string;
  state: 'completed' | 'failed';
  completedAt: number;
  kpis: LegacyKPIs | null;
  summary?: BacktestSummary | null;
  equity: RunReportResponse['equity'] | null;
  trades: TradeRecord[] | null;
  dsl: string;
  artifactUris?: Record<string, string>;
}

export interface GetHistoryResponse {
  history: HistoryEntry[];
}

// GET /api/runs/history
export async function getHistory(): Promise<GetHistoryResponse> {
  type V0HistoryEntry = {
    run_id: string;
    strategy_id: string;
    prompt: string | null;
    state: 'completed' | 'failed';
    completed_at: string;
    kpis: V0BacktestReportResponse['kpis'] | null;
    artifacts: Record<string, string>;
  };
  type V0HistoryResponse = { history: V0HistoryEntry[] };

  const res = await fetch(`${baseUrl}/api/runs/history`);
  if (!res.ok) throw new Error(`Failed to get history: ${res.statusText}`);
  const data = (await res.json()) as V0HistoryResponse;

  const history: HistoryEntry[] = data.history.map((h) => {
    const kpis: LegacyKPIs | null = h.kpis
      ? {
          returnPct: Number(h.kpis.return_pct.toFixed(4)),
          cagrPct: Number(h.kpis.cagr_pct.toFixed(4)),
          sharpe: Number(h.kpis.sharpe.toFixed(4)),
          maxDdPct: Number(h.kpis.max_dd_pct.toFixed(4)),
        }
      : null;
    return {
      runId: h.run_id,
      strategyId: h.strategy_id,
      prompt: h.prompt ?? '',
      state: h.state,
      completedAt: Date.parse(h.completed_at),
      kpis,
      summary: null,
      equity: null,
      trades: null,
      dsl: '',
      artifactUris: h.artifacts,
    };
  });

  return { history };
}
