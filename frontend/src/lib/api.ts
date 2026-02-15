const baseUrl = (import.meta as any).env?.VITE_API_BASE_URL ?? "";
import { supabase } from "@/lib/supabase";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const API_MAX_RETRIES = 2;
const API_TIMEOUT_MS_DEFAULT = Number((import.meta as any).env?.VITE_API_TIMEOUT_MS ?? 45000);

async function buildHeaders(init?: Record<string, string>, tokenOverride?: string | null): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = tokenOverride ?? data.session?.access_token;
  const h: Record<string, string> = { ...(init || {}) };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

type ApiFetchOptions = {
  timeoutMs?: number;
};

async function parseApiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body === "object") {
      const code = typeof (body as any).code === "string" ? (body as any).code : "";
      const message = typeof (body as any).message === "string" ? (body as any).message : "";
      if (code && message) return `${code}: ${message}`;
      if (message) return message;
      if (code) return code;
    }
  } catch {
    // ignore JSON parse errors; use fallback below
  }
  return `${fallback} (${res.status})`;
}

async function apiFetch(path: string, init?: RequestInit, opts?: ApiFetchOptions): Promise<Response> {
  let refreshedToken: string | null = null;
  const timeoutMs = Number.isFinite(opts?.timeoutMs) ? Number(opts?.timeoutMs) : API_TIMEOUT_MS_DEFAULT;
  for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt += 1) {
    const headers = await buildHeaders(init?.headers as Record<string, string> | undefined, refreshedToken);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal });
      clearTimeout(timeout);

      if (res.status === 401 && attempt === 0) {
        const refreshed = await supabase.auth.refreshSession();
        refreshedToken = refreshed.data.session?.access_token ?? null;
        if (refreshedToken) {
          continue;
        }
      }

      if (attempt < API_MAX_RETRIES && RETRYABLE_STATUS.has(res.status)) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      if (attempt >= API_MAX_RETRIES) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw new Error("Request failed after retries");
}

export interface CreateRunResponse {
  runId: string;
}

export interface IndicatorPreferences {
  maWindowDays: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
}

export interface CreateRunOptions {
  mode?: V0Mode;
  startDate?: string;
  endDate?: string;
  llmIndicatorPreferences?: IndicatorPreferences;
  [key: string]: unknown;
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
  market?: Array<{ t: string; o: number; h: number; l: number; c: number }>;
  trades: TradeRecord[];
  aiSummary?: { en: string; zh: string } | null;
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
type V0RunStatusResponse = { run_id: string; state: "running" | "completed" | "failed"; steps: V0WorkspaceStep[]; artifacts: V0ArtifactRef[] };
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
  market?: Array<{ t: string; o: number; h: number; l: number; c: number }>;
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
  ai_summary?: { en?: string; zh?: string } | null;
};

function formatStepLog(stepId: V0WorkspaceStep["id"], entry: V0LogEntry): string {
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
  const kv = entry.kv && typeof entry.kv === "object" ? entry.kv : undefined;
  if (stepId === "parse" && entry.msg === "Parsing strategy spec" && kv) {
    const model = typeof kv.model === "string" ? kv.model : undefined;
    const modelSuffix = model ? ` (LLM: ${model})` : "";
    const prefix = ts ? `${ts} ` : "";
    return `${prefix}[${entry.level}] Parsing strategy${modelSuffix}`;
  }
  if (stepId === "parse" && entry.msg === "StrategySpec ready" && kv) {
    const model = typeof kv.model === "string" ? kv.model : "-";
    const attemptsRaw = typeof kv.llm_attempts === "number" ? kv.llm_attempts : 1;
    const attempts = Math.max(1, Math.floor(attemptsRaw));
    const prefix = ts ? `${ts} ` : "";
    return `${prefix}[${entry.level}] Strategy ready (LLM: ${model}, attempts: ${attempts})`;
  }
  if (stepId === "data" && entry.msg === "Data ready" && kv) {
    const start = typeof kv.start_date === "string" ? kv.start_date : "";
    const end = typeof kv.end_date === "string" ? kv.end_date : "";
    const range = start && end ? ` (${start} -> ${end})` : "";
    const prefix = ts ? `${ts} ` : "";
    return `${prefix}[${entry.level}] Data ready${range}`;
  }
  const prefix = ts ? `${ts} ` : "";
  return `${prefix}[${entry.level}] ${entry.msg}`;
}

function mapV0StepToStepInfo(step: V0WorkspaceStep): StepInfo {
  const statusMap: Record<V0WorkspaceStepState, StepInfo["status"]> = {
    PENDING: "queued",
    RUNNING: "running",
    DONE: "done",
    FAILED: "error",
    SKIPPED: "queued",
  };
  const logs = (step.logs || []).map((entry) => formatStepLog(step.id, entry));
  return { key: step.id, title: step.label, status: statusMap[step.state], durationMs: null, logs };
}

function findArtifactUri(artifacts: V0ArtifactRef[], name: string): string | null {
  const a = artifacts.find((x) => x.name === name);
  return a ? a.uri : null;
}

function toAbsoluteApiUrl(uri: string): string {
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  if (uri.startsWith("/")) return `${baseUrl}${uri}`;
  return uri;
}

export async function getRunArtifact(runId: string, name: string): Promise<{ name: string; type: string; uri: string; content: any }> {
  const res = await apiFetch(`/api/runs/${runId}/artifacts/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(await parseApiErrorMessage(res, "Failed to get artifact"));
  return res.json();
}

export async function downloadRunArtifact(runId: string, name: string): Promise<Blob> {
  const res = await apiFetch(`/api/runs/${runId}/artifacts/${encodeURIComponent(name)}?download=true`);
  if (!res.ok) throw new Error(await parseApiErrorMessage(res, "Failed to download artifact"));
  return await res.blob();
}

export async function createRun(prompt: string, options?: CreateRunOptions): Promise<CreateRunResponse> {
  const mode = (options?.mode as V0Mode | undefined) ?? "BACKTEST_ONLY";
  const startDate = typeof options?.startDate === "string" ? options.startDate : "2025-01-01";
  const endDate = typeof options?.endDate === "string" ? options.endDate : "2025-12-31";
  const llmIndicatorPreferences = options?.llmIndicatorPreferences;
  const res = await apiFetch(`/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input_type: "NATURAL_LANGUAGE",
      nl: prompt,
      mode,
      start_date: startDate,
      end_date: endDate,
      llm_indicator_preferences: llmIndicatorPreferences ?? null,
    }),
  }, { timeoutMs: 180000 });
  if (!res.ok) throw new Error(await parseApiErrorMessage(res, "Failed to create run"));
  const data = (await res.json()) as { run_id: string };
  return { runId: data.run_id };
}

export async function getRunStatus(runId: string): Promise<RunStatusResponse> {
  const res = await apiFetch(`/api/runs/${runId}/status`, undefined, { timeoutMs: 20000 });
  if (!res.ok) throw new Error(await parseApiErrorMessage(res, "Failed to get status"));
  const data = (await res.json()) as V0RunStatusResponse;
  const dslUri = findArtifactUri(data.artifacts, "dsl.json");
  const reportUrl = `${baseUrl}/api/runs/${runId}/artifacts/report.json?download=true`;
  const tradesCsvUrl = `${baseUrl}/api/runs/${runId}/artifacts/trades.csv?download=true`;
  const steps = data.steps.map(mapV0StepToStepInfo);
  return {
    runId: data.run_id,
    state: data.state,
    steps,
    artifacts: {
      dsl: dslUri ? toAbsoluteApiUrl(dslUri) : "",
      reportUrl,
      tradesCsvUrl,
    },
  };
}

export async function getRunReport(runId: string): Promise<RunReportResponse> {
  const res = await apiFetch(`/api/runs/${runId}/report`, undefined, { timeoutMs: 30000 });
  if (!res.ok) throw new Error(await parseApiErrorMessage(res, "Failed to get report"));
  const data = (await res.json()) as V0BacktestReportResponse;
  const kpis: LegacyKPIs = {
    returnPct: Number(data.kpis.return_pct.toFixed(4)),
    cagrPct: Number(data.kpis.cagr_pct.toFixed(4)),
    sharpe: Number(data.kpis.sharpe.toFixed(4)),
    maxDdPct: Number(data.kpis.max_dd_pct.toFixed(4)),
  };

  const equity = data.equity.map((p) => ({ timestamp: p.t, value: p.v }));
  const trades: TradeRecord[] = data.trades.map((t) => ({
    timestamp: t.fill_time,
    entryTime: t.decision_time,
    exitTime: t.fill_time,
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

  const market = Array.isArray(data.market)
    ? data.market
        .filter((c) => c && typeof c.t === "string")
        .map((c) => ({
          t: c.t,
          o: Number(c.o),
          h: Number(c.h),
          l: Number(c.l),
          c: Number(c.c),
        }))
    : [];

  const aiSummary =
    data.ai_summary && typeof data.ai_summary === "object"
      ? {
          en: typeof data.ai_summary.en === "string" ? data.ai_summary.en : "",
          zh: typeof data.ai_summary.zh === "string" ? data.ai_summary.zh : "",
        }
      : null;

  return { kpis, summary, equity, market, trades, aiSummary };
}

export async function deployRun(runId: string, mode: "paper" | "live"): Promise<DeployResponse> {
  const res = await apiFetch(`/api/runs/${runId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(await parseApiErrorMessage(res, "Failed to deploy"));
  return res.json();
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
  market?: RunReportResponse["market"] | null;
  trades: TradeRecord[] | null;
  aiSummary?: RunReportResponse["aiSummary"] | null;
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

  const res = await apiFetch(`/api/runs/history`);
  if (!res.ok) throw new Error(await parseApiErrorMessage(res, "Failed to get history"));
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
      market: null,
      trades: null,
      aiSummary: null,
      dsl: "",
      artifactUris: h.artifacts,
    };
  });

  return { history };
}

export async function deleteStrategy(strategyId: string): Promise<void> {
  const res = await apiFetch(`/api/strategies/${strategyId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await parseApiErrorMessage(res, "Failed to delete strategy"));
}

export interface UserProfile {
  userId: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  lastSignedInAt: string | null;
}

type V0UserProfileResponse = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  last_signed_in_at: string | null;
};

function mapUserProfile(data: V0UserProfileResponse): UserProfile {
  return {
    userId: data.user_id,
    email: data.email,
    displayName: data.display_name,
    createdAt: data.created_at,
    lastSignedInAt: data.last_signed_in_at,
  };
}

export async function getMyProfile(): Promise<UserProfile> {
  const res = await apiFetch(`/api/users/me`);
  if (!res.ok) throw new Error(await parseApiErrorMessage(res, "Failed to get profile"));
  const data = (await res.json()) as V0UserProfileResponse;
  return mapUserProfile(data);
}

export async function updateMyProfile(payload: { displayName: string | null }): Promise<UserProfile> {
  const res = await apiFetch(`/api/users/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: payload.displayName }),
  });
  if (!res.ok) throw new Error(await parseApiErrorMessage(res, "Failed to update profile"));
  const data = (await res.json()) as V0UserProfileResponse;
  return mapUserProfile(data);
}
