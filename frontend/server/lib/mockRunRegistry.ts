// ============================================================
// Mock Run Registry - In-memory store for backtest runs
// Each run tracks creation time and uses time-based progression
// ============================================================

import { hashSeed, generateRunId, generateEquityCurve, generateTrades, generateKPIs, generateFullCode } from './seed';

export interface RunEntry {
  runId: string;
  prompt: string;
  options: Record<string, unknown>;
  createdAt: number; // Date.now()
  seed: number;
  shouldFail: boolean;
  failStep: number; // which step fails (0-3)
  deployId?: string;
  deployStatus?: 'queued' | 'ok';
}

export interface StepInfo {
  key: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'warn' | 'error';
  durationMs: number | null;
  logs: string[];
  tags?: string[];
}

export interface RunStatus {
  runId: string;
  state: 'idle' | 'running' | 'completed' | 'failed';
  steps: StepInfo[];
  progress: number; // 0-100 for backtest engine
  artifacts: {
    dsl: string;
    reportUrl: string;
    tradesCsvUrl: string;
  };
}

export interface RunReport {
  kpis: { returnPct: number; cagrPct: number; sharpe: number; maxDdPct: number };
  equity: Array<{ t: number; v: number }>;
  trades: Array<{ timestamp: string; symbol: string; action: string; price: number; pnl: number | null }>;
}

// History entry for completed/failed runs
export interface HistoryEntry {
  runId: string;
  prompt: string;
  state: 'completed' | 'failed';
  completedAt: number;
  kpis: RunReport['kpis'] | null;
  equity: RunReport['equity'] | null;
  trades: RunReport['trades'] | null;
  dsl: string;
}

// Global in-memory registry
const registry = ((globalThis as any).__runRegistry ??= new Map<string, RunEntry>()) as Map<string, RunEntry>;
const history = ((globalThis as any).__runHistory ??= [] as HistoryEntry[]) as HistoryEntry[];

// Seed some initial history entries so the panel is never empty
function seedHistory() {
  if (history.length > 0) return;
  const seedEntries = [
    { prompt: 'Buy BTC when the 50-day MA crosses above the 200-day MA and RSI < 30', seed: 42 },
    { prompt: 'Mean reversion on ETH: buy when price drops 2 std devs below 20-day VWAP, sell at mean', seed: 137 },
    { prompt: 'Sell 25% TQQQ when QQQ 4H MACD death cross and 2min before close still below 5-day MA', seed: 256 },
  ];
  const now = Date.now();
  seedEntries.forEach((entry, i) => {
    const runId = `hist-${String(i + 1).padStart(4, '0')}`;
    history.push({
      runId,
      prompt: entry.prompt,
      state: 'completed',
      completedAt: now - (3 - i) * 86400000 * (i + 1), // stagger by days
      kpis: generateKPIs(entry.seed),
      equity: generateEquityCurve(entry.seed),
      trades: generateTrades(entry.seed),
      dsl: generateFullCode(entry.prompt),
    });
  });
}
seedHistory();

export function createRun(prompt: string, options: Record<string, unknown> = {}): RunEntry {
  const runId = generateRunId();
  const seed = hashSeed(runId);
  // 5% random failure rate
  const shouldFail = Math.random() < 0.05;
  const failStep = Math.floor(Math.random() * 4);

  const entry: RunEntry = {
    runId,
    prompt,
    options,
    createdAt: Date.now(),
    seed,
    shouldFail,
    failStep,
  };

  registry.set(runId, entry);
  return entry;
}

export function getRun(runId: string): RunEntry | undefined {
  return registry.get(runId);
}

// Time-based step progression:
// 0-2s: analysis running→done
// 2-4s: data synthesis running→done
// 4-6s: logic construction running→done
// 6-12s: backtest engine progress 0-100%
// >12s: completed
export function getRunStatus(runId: string): RunStatus | null {
  const run = registry.get(runId);
  if (!run) return null;

  const elapsed = Date.now() - run.createdAt;
  const elapsedSec = elapsed / 1000;

  const steps: StepInfo[] = [
    {
      key: 'analysis',
      title: 'STRATEGIC ANALYSIS',
      status: 'queued',
      durationMs: null,
      logs: [],
      tags: [],
    },
    {
      key: 'data',
      title: 'DATA SYNTHESIS',
      status: 'queued',
      durationMs: null,
      logs: [],
    },
    {
      key: 'logic',
      title: 'LOGIC CONSTRUCTION',
      status: 'queued',
      durationMs: null,
      logs: [],
    },
    {
      key: 'backtest',
      title: 'BACKTEST ENGINE',
      status: 'queued',
      durationMs: null,
      logs: [],
    },
  ];

  let overallState: 'idle' | 'running' | 'completed' | 'failed' = 'running';
  let backtestProgress = 0;

  // Extract tags from prompt
  const promptLower = run.prompt.toLowerCase();
  const asset = promptLower.includes('btc') ? 'BTC' : promptLower.includes('eth') ? 'ETH' : promptLower.includes('tqqq') ? 'TQQQ' : 'BTC';
  const logic = promptLower.includes('golden cross') || promptLower.includes('ma cross') ? 'Golden Cross'
    : promptLower.includes('mean') ? 'Mean Reversion'
    : promptLower.includes('macd') ? 'MACD Cross'
    : promptLower.includes('death cross') ? 'Death Cross'
    : 'Custom Logic';
  const filter = promptLower.includes('rsi') ? `RSI < 30` : promptLower.includes('close') ? 'Close Filter' : 'None';

  steps[0].tags = [`Asset: ${asset}`, `Logic: ${logic}`, `Filter: ${filter}`];

  // Step 1: Analysis (0-2s)
  if (elapsedSec >= 0) {
    if (run.shouldFail && run.failStep === 0) {
      if (elapsedSec >= 1.5) {
        steps[0].status = 'error';
        steps[0].durationMs = 1500;
        steps[0].logs = ['[ERROR] Failed to parse strategy parameters', '[ERROR] Unsupported asset class detected', '[DEBUG] Input: ' + run.prompt.substring(0, 80)];
        overallState = 'failed';
        return { runId, state: overallState, steps, progress: 0, artifacts: { dsl: '', reportUrl: '', tradesCsvUrl: '' } };
      }
      steps[0].status = 'running';
      steps[0].logs = ['Parsing natural language prompt...', 'Extracting trading parameters...'];
    } else if (elapsedSec < 2) {
      steps[0].status = 'running';
      steps[0].logs = ['Parsing natural language prompt...', 'Extracting trading parameters...'];
    } else {
      steps[0].status = 'done';
      steps[0].durationMs = 400;
      steps[0].logs = ['Parsed successfully', `Detected asset: ${asset}`, `Logic: ${logic}`, `Filter: ${filter}`];
    }
  }

  // Step 2: Data Synthesis (2-4s)
  if (elapsedSec >= 2 && steps[0].status === 'done') {
    if (run.shouldFail && run.failStep === 1) {
      if (elapsedSec >= 3.5) {
        steps[1].status = 'error';
        steps[1].durationMs = 1500;
        steps[1].logs = ['[ERROR] Data feed connection timeout', '[ERROR] Unable to fetch OHLCV data for specified period', '[RETRY] Attempted 3 reconnections'];
        overallState = 'failed';
        return { runId, state: overallState, steps, progress: 0, artifacts: { dsl: '', reportUrl: '', tradesCsvUrl: '' } };
      }
      steps[1].status = 'running';
      steps[1].logs = ['Connecting to data feed...', 'Synchronizing historical data...'];
    } else if (elapsedSec < 4) {
      steps[1].status = 'running';
      steps[1].logs = ['Synchronizing historical price data (1 year OHLCV)...', `Fetching ${asset}-USD feed...`];
    } else {
      steps[1].status = 'done';
      steps[1].durationMs = 1200;
      steps[1].logs = ['Data synchronized successfully', '365 daily candles loaded', 'Data quality check passed'];
    }
  }

  // Step 3: Logic Construction (4-6s)
  if (elapsedSec >= 4 && steps[1].status === 'done') {
    if (run.shouldFail && run.failStep === 2) {
      if (elapsedSec >= 5.5) {
        steps[2].status = 'error';
        steps[2].durationMs = 1500;
        steps[2].logs = ['[ERROR] Code generation failed', '[ERROR] Invalid strategy logic: circular dependency detected', '[DEBUG] Stack trace available'];
        overallState = 'failed';
        return { runId, state: overallState, steps, progress: 0, artifacts: { dsl: '', reportUrl: '', tradesCsvUrl: '' } };
      }
      steps[2].status = 'running';
      steps[2].logs = ['Generating strategy logic...'];
    } else if (elapsedSec < 6) {
      steps[2].status = 'running';
      steps[2].logs = ['Generating strategy logic...', 'Compiling executable code...'];
    } else {
      steps[2].status = 'done';
      steps[2].durationMs = 800;
      steps[2].logs = ['Strategy code generated', 'Syntax validation passed', 'Risk parameters configured'];
    }
  }

  // Step 4: Backtest Engine (6-12s)
  if (elapsedSec >= 6 && steps[2].status === 'done') {
    if (run.shouldFail && run.failStep === 3) {
      if (elapsedSec >= 9) {
        steps[3].status = 'error';
        steps[3].durationMs = 3000;
        steps[3].logs = ['Compiled successfully', '[ERROR] Monte Carlo simulation diverged', '[ERROR] Insufficient data points for statistical significance', '[DEBUG] Iterations completed: 847/10000'];
        backtestProgress = 45;
        overallState = 'failed';
        return { runId, state: overallState, steps, progress: backtestProgress, artifacts: { dsl: '', reportUrl: '', tradesCsvUrl: '' } };
      }
      steps[3].status = 'running';
      backtestProgress = Math.min(45, Math.round(((elapsedSec - 6) / 3) * 45));
      steps[3].logs = ['Compiled successfully', 'Running Monte Carlo simulation...'];
    } else if (elapsedSec < 12) {
      steps[3].status = 'running';
      backtestProgress = Math.min(99, Math.round(((elapsedSec - 6) / 6) * 100));
      steps[3].logs = ['Compiled successfully', 'Processing trade permutations...'];
    } else {
      steps[3].status = 'done';
      steps[3].durationMs = 3200;
      backtestProgress = 100;
      steps[3].logs = ['Compiled successfully', 'Processing trade permutations...', 'Monte Carlo simulation complete', '10,000 iterations processed'];
      overallState = 'completed';
      // Auto-add to history when completed
      addToHistory(run, 'completed');
    }
  }

  const fullCode = generateFullCode(run.prompt);

  return {
    runId,
    state: overallState,
    steps,
    progress: backtestProgress,
    artifacts: overallState === 'completed' ? {
      dsl: fullCode,
      reportUrl: `/api/runs/${runId}/report`,
      tradesCsvUrl: `/api/runs/${runId}/report?format=csv`,
    } : { dsl: '', reportUrl: '', tradesCsvUrl: '' },
  };
}

export function getRunReport(runId: string): RunReport | null {
  const run = registry.get(runId);
  if (!run) return null;

  return {
    kpis: generateKPIs(run.seed),
    equity: generateEquityCurve(run.seed),
    trades: generateTrades(run.seed),
  };
}

// Add a completed run to history
export function addToHistory(run: RunEntry, state: 'completed' | 'failed'): void {
  // Avoid duplicates
  if (history.some(h => h.runId === run.runId)) return;
  const kpis = state === 'completed' ? generateKPIs(run.seed) : null;
  const equity = state === 'completed' ? generateEquityCurve(run.seed) : null;
  const trades = state === 'completed' ? generateTrades(run.seed) : null;
  const dsl = generateFullCode(run.prompt);
  history.push({
    runId: run.runId,
    prompt: run.prompt,
    state,
    completedAt: Date.now(),
    kpis,
    equity,
    trades,
    dsl,
  });
}

// Get history (newest first)
export function getHistory(): HistoryEntry[] {
  return [...history].reverse();
}

export function deployRun(runId: string, mode: 'paper' | 'live'): { deployId: string; status: 'queued' | 'ok' } | null {
  const run = registry.get(runId);
  if (!run) return null;

  const deployId = `deploy-${generateRunId()}`;
  run.deployId = deployId;
  run.deployStatus = mode === 'paper' ? 'ok' : 'queued';

  return { deployId, status: run.deployStatus };
}
