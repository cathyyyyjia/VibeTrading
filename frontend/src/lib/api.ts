const baseUrl = (import.meta as any).env?.VITE_API_BASE_URL ?? "";
import { supabase } from "@/lib/supabase";

async function buildHeaders(init?: Record<string, string>): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const h: Record<string, string> = { ...(init || {}) };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export interface CreateRunResponse {
  runId: string;
}

export interface StepInfo {
  key: string;
  title: string;
  status: "queued" | "running" | "done" | "warn" | "error";
  durationMs: number | null;
  logs: string[];
  tags?: string[];
}

export interface RunStatusResponse {
  runId: string;
  state: "idle" | "running" | "completed" | "failed";
  steps: StepInfo[];
  progress: number;
  artifacts: {
    dsl: string;
    reportUrl: string;
    tradesCsvUrl: string;
  };
}

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

export interface LegacyKPIs {
  returnPct: number;
  cagrPct: number;
  sharpe: number;
  maxDdPct: number;
}

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
  status: "queued" | "ok";
}

type V0Mode = "BACKTEST_ONLY" | "PAPER" | "LIVE";
type V0WorkspaceStepState = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";
type V0LogEntry = { ts: string; level: "DEBUG" | "INFO" | "WARN" | "ERROR"; msg: string; kv?: Record<string, unknown> };
type V0WorkspaceStep = { id: "parse" | "plan" | "data" | "backtest" | "report" | "deploy"; state: V0WorkspaceStepState; label: string; logs: V0LogEntry[] };
type V0ArtifactRef = { id: string; type: "json" | "markdown" | "image" | "csv" | "binary"; name: string; uri: string };
type V0RunStatusResponse = { run_id: string; state: "running" | "completed" | "failed"; progress: number; steps: V0WorkspaceStep[]; artifacts: V0ArtifactRef[] };
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
    side: "BUY" | "SELL";
    qty: number;
    fill_price: number;
    cost: Record<string, unknown>;
    why: Record<string, unknown>;
    pnl?: number;
    pnl_pct?: number;
  }>;
};

function formatStepLog(entry: V0LogEntry): string {
  const ts = entry.ts ? new Date(entry.ts).toLocaleTimeString() : "";
  if (entry.msg === "Backtest progress" && entry.kv) {
    const sessionDate = typeof entry.kv.session_date === "string" ? entry.kv.session_date : "";
    const processed = typeof entry.kv.processed === "number" ? entry.kv.processed : undefined;
    const total = typeof entry.kv.total === "number" ? entry.kv.total : undefined;
    const pct = typeof entry.kv.pct === "number" ? entry.kv.pct : undefined;
    const prefix = ts ? `${ts} ` : "";
    if (sessionDate && processed !== undefined && total !== undefined && pct !== undefined) {
      return `${prefix}[${entry.level}] Backtesting ${sessionDate} (${processed}/${total}, ${pct}%)`;
    }
  }
  const kv = entry.kv && Object.keys(entry.kv).length > 0 ? ` ${JSON.stringify(entry.kv)}` : "";
  const prefix = ts ? `${ts} ` : "";
  return `${prefix}[${entry.level}] ${entry.msg}${kv}`;
}

function mapV0StepToStepInfo(step: V0WorkspaceStep): StepInfo {
  const statusMap: Record<V0WorkspaceStepState, StepInfo["status"]> = {
    PENDING: "queued",
    RUNNING: "running",
    DONE: "done",
    FAILED: "error",
    SKIPPED: "queued",
  };
  const logs = (step.logs || []).map(formatStepLog);
  return { key: step.id, title: step.label, status: statusMap[step.state], durationMs: null, logs };
}

function findArtifactUri(artifacts: V0ArtifactRef[], name: string): string | null {
  const a = artifacts.find((x) => x.name === name);
  return a ? a.uri : null;
}

export async function getRunArtifact(runId: string, name: string): Promise<{ name: string; type: string; uri: string; content: any }> {
  const res = await fetch(`${baseUrl}/api/runs/${runId}/artifacts/${encodeURIComponent(name)}`, { headers: await buildHeaders() });
  if (!res.ok) throw new Error(`Failed to get artifact: ${res.statusText}`);
  return res.json();
}

export async function createRun(prompt: string, options?: Record<string, unknown>): Promise<CreateRunResponse> {
  const mode = (options?.mode as V0Mode | undefined) ?? "BACKTEST_ONLY";
  const startDate = typeof options?.startDate === "string" ? options.startDate : "2025-01-01";
  const endDate = typeof options?.endDate === "string" ? options.endDate : "2025-12-31";
  const res = await fetch(`${baseUrl}/api/runs`, {
    method: "POST",
    headers: await buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      input_type: "NATURAL_LANGUAGE",
      nl: prompt,
      mode,
      start_date: startDate,
      end_date: endDate,
    }),
  });
  if (!res.ok) throw new Error(`Failed to create run: ${res.statusText}`);
  const data = (await res.json()) as { run_id: string };
  return { runId: data.run_id };
}

export async function getRunStatus(runId: string): Promise<RunStatusResponse> {
  const res = await fetch(`${baseUrl}/api/runs/${runId}/status`, { headers: await buildHeaders() });
  if (!res.ok) throw new Error(`Failed to get status: ${res.statusText}`);
  const data = (await res.json()) as V0RunStatusResponse;
  const reportUri = findArtifactUri(data.artifacts, "report.json");
  const tradesCsvUri = findArtifactUri(data.artifacts, "trades.csv");
  const dslUri = findArtifactUri(data.artifacts, "dsl.json");
  const reportUrl = reportUri ? `${baseUrl}${reportUri}` : `${baseUrl}/api/runs/${runId}/report`;
  const tradesCsvUrl = tradesCsvUri ? `${baseUrl}${tradesCsvUri}` : "";
  const steps = data.steps.map(mapV0StepToStepInfo);
  return {
    runId: data.run_id,
    state: data.state,
    steps,
    progress: data.progress,
    artifacts: {
      dsl: dslUri ? `${baseUrl}${dslUri}` : "",
      reportUrl,
      tradesCsvUrl,
    },
  };
}

export async function getRunReport(runId: string): Promise<RunReportResponse> {
  const res = await fetch(`${baseUrl}/api/runs/${runId}/report`, { headers: await buildHeaders() });
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
    entryTime: new Date(t.decision_time).toLocaleString(),
    exitTime: new Date(t.fill_time).toLocaleString(),
    symbol: t.symbol,
    action: t.side,
    price: t.fill_price,
    pnl: typeof t.pnl === "number" ? t.pnl : null,
    pnlPct: typeof t.pnl_pct === "number" ? t.pnl_pct : null,
    reason: t.why ? JSON.stringify(t.why) : null,
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

export async function deployRun(runId: string, mode: "paper" | "live"): Promise<DeployResponse> {
  const res = await fetch(`${baseUrl}/api/runs/${runId}/deploy`, {
    method: "POST",
    headers: await buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`Failed to deploy: ${res.statusText}`);
  return res.json();
}

export function getTradesCsvUrl(runId: string): string {
  return `${baseUrl}/api/runs/${runId}/report?format=csv`;
}

export interface HistoryEntry {
  runId: string;
  strategyId?: string;
  prompt: string;
  state: "completed" | "failed";
  completedAt: number;
  kpis: LegacyKPIs | null;
  summary?: BacktestSummary | null;
  equity: RunReportResponse["equity"] | null;
  trades: TradeRecord[] | null;
  dsl: string;
  artifactUris?: Record<string, string>;
}

export interface GetHistoryResponse {
  history: HistoryEntry[];
}

export async function getHistory(): Promise<GetHistoryResponse> {
  type V0HistoryEntry = {
    run_id: string;
    strategy_id: string;
    prompt: string | null;
    state: "completed" | "failed";
    completed_at: string;
    kpis: V0BacktestReportResponse["kpis"] | null;
    artifacts: Record<string, string>;
  };
  type V0HistoryResponse = { history: V0HistoryEntry[] };

  const res = await fetch(`${baseUrl}/api/runs/history`, { headers: await buildHeaders() });
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
      prompt: h.prompt ?? "",
      state: h.state,
      completedAt: Date.parse(h.completed_at),
      kpis,
      summary: null,
      equity: null,
      trades: null,
      dsl: "",
      artifactUris: h.artifacts,
    };
  });

  return { history };
}

export async function deleteStrategy(strategyId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/strategies/${strategyId}`, {
    method: "DELETE",
    headers: await buildHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete strategy: ${res.statusText}`);
}

