// ============================================================
// Status Engine - Shared time-based progression logic
// Used by both tRPC procedures and REST endpoints
// ============================================================

import {
  generateKPIs,
  generateEquityCurve,
  generateTrades,
  generateFullCode,
} from './seed';
import {
  updateBacktestRun,
  insertBacktestTrades,
} from '../db';

export interface StepData {
  key: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'warn' | 'error';
  durationMs: number | null;
  logs: string[];
  tags?: string[];
}

export interface StatusResult {
  runId: string;
  state: 'idle' | 'running' | 'completed' | 'failed';
  steps: StepData[];
  progress: number;
  artifacts: {
    dsl: string;
    reportUrl: string;
    tradesCsvUrl: string;
  };
}

/**
 * Compute the current status of a run based on elapsed time.
 * This is the core mock progression engine.
 *
 * @param run - The database run record
 * @returns StatusResult with current state, steps, progress, and artifacts
 */
export async function computeRunStatus(run: {
  runId: string;
  prompt: string;
  createdAt: Date | string;
  seed: number | null;
  shouldFail: number | null;
  failStep: number | null;
  state: string;
  steps: any;
  progress: number | null;
  dsl: string | null;
  kpis: any;
  equity: any;
}): Promise<StatusResult> {
  // If already completed/failed in DB, return stored data
  if (run.state === 'completed' || run.state === 'failed') {
    return {
      runId: run.runId,
      state: run.state as 'completed' | 'failed',
      steps: (run.steps as StepData[]) || [],
      progress: run.progress ?? (run.state === 'completed' ? 100 : 0),
      artifacts:
        run.state === 'completed'
          ? {
              dsl: run.dsl || '',
              reportUrl: `/api/runs/${run.runId}/report`,
              tradesCsvUrl: `/api/runs/${run.runId}/report?format=csv`,
            }
          : { dsl: '', reportUrl: '', tradesCsvUrl: '' },
    };
  }

  // Time-based progression for mock mode
  const elapsed = Date.now() - new Date(run.createdAt).getTime();
  const elapsedSec = elapsed / 1000;
  const shouldFail = run.shouldFail === 1;
  const failStepIdx = run.failStep ?? 0;

  // Extract tags from prompt
  const promptLower = run.prompt.toLowerCase();
  const asset = promptLower.includes('btc')
    ? 'BTC'
    : promptLower.includes('eth')
    ? 'ETH'
    : promptLower.includes('tqqq')
    ? 'TQQQ'
    : 'BTC';
  const logic =
    promptLower.includes('golden cross') || promptLower.includes('ma cross')
      ? 'Golden Cross'
      : promptLower.includes('mean')
      ? 'Mean Reversion'
      : promptLower.includes('macd')
      ? 'MACD Cross'
      : promptLower.includes('death cross')
      ? 'Death Cross'
      : 'Custom Logic';
  const filter = promptLower.includes('rsi')
    ? 'RSI < 30'
    : promptLower.includes('close')
    ? 'Close Filter'
    : 'None';

  const steps: StepData[] = [
    { key: 'analysis', title: 'STRATEGIC ANALYSIS', status: 'queued', durationMs: null, logs: [], tags: [`Asset: ${asset}`, `Logic: ${logic}`, `Filter: ${filter}`] },
    { key: 'data', title: 'DATA SYNTHESIS', status: 'queued', durationMs: null, logs: [] },
    { key: 'logic', title: 'LOGIC CONSTRUCTION', status: 'queued', durationMs: null, logs: [] },
    { key: 'backtest', title: 'BACKTEST ENGINE', status: 'queued', durationMs: null, logs: [] },
  ];

  let overallState: 'idle' | 'running' | 'completed' | 'failed' = 'running';
  let backtestProgress = 0;

  // Step 1: Analysis (0-2s)
  if (elapsedSec >= 0) {
    if (shouldFail && failStepIdx === 0 && elapsedSec >= 1.5) {
      steps[0].status = 'error';
      steps[0].durationMs = 1500;
      steps[0].logs = [
        '[ERROR] Failed to parse strategy parameters',
        '[ERROR] Unsupported asset class detected',
        '[DEBUG] Input: ' + run.prompt.substring(0, 80),
      ];
      overallState = 'failed';
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
  if (overallState !== 'failed' && elapsedSec >= 2 && steps[0].status === 'done') {
    if (shouldFail && failStepIdx === 1 && elapsedSec >= 3.5) {
      steps[1].status = 'error';
      steps[1].durationMs = 1500;
      steps[1].logs = [
        '[ERROR] Data feed connection timeout',
        '[ERROR] Unable to fetch OHLCV data for specified period',
      ];
      overallState = 'failed';
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
  if (overallState !== 'failed' && elapsedSec >= 4 && steps[1].status === 'done') {
    if (shouldFail && failStepIdx === 2 && elapsedSec >= 5.5) {
      steps[2].status = 'error';
      steps[2].durationMs = 1500;
      steps[2].logs = [
        '[ERROR] Code generation failed',
        '[ERROR] Invalid strategy logic: circular dependency detected',
      ];
      overallState = 'failed';
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
  if (overallState !== 'failed' && elapsedSec >= 6 && steps[2].status === 'done') {
    if (shouldFail && failStepIdx === 3 && elapsedSec >= 9) {
      steps[3].status = 'error';
      steps[3].durationMs = 3000;
      steps[3].logs = ['Compiled successfully', '[ERROR] Monte Carlo simulation diverged'];
      backtestProgress = 45;
      overallState = 'failed';
    } else if (elapsedSec < 12) {
      steps[3].status = 'running';
      backtestProgress = Math.min(99, Math.round(((elapsedSec - 6) / 6) * 100));
      steps[3].logs = ['Compiled successfully', 'Processing trade permutations...'];
    } else {
      steps[3].status = 'done';
      steps[3].durationMs = 3200;
      backtestProgress = 100;
      steps[3].logs = [
        'Compiled successfully',
        'Processing trade permutations...',
        'Monte Carlo simulation complete',
        '10,000 iterations processed',
      ];
      overallState = 'completed';
    }
  }

  // Persist state changes to database
  const fullCode = generateFullCode(run.prompt);
  const updateData: Record<string, any> = {
    state: overallState,
    steps,
    progress: backtestProgress,
  };

  if (overallState === 'completed') {
    const kpis = generateKPIs(run.seed!);
    const equity = generateEquityCurve(run.seed!);
    const trades = generateTrades(run.seed!);
    updateData.dsl = fullCode;
    updateData.kpis = kpis;
    updateData.equity = equity;
    updateData.completedAt = new Date();

    // Store trades in separate table
    const tradeRecords = trades.map((t, i) => ({
      runId: run.runId,
      tradeTimestamp: t.timestamp,
      symbol: t.symbol,
      action: t.action as 'BUY' | 'SELL',
      price: t.price,
      pnl: t.pnl,
      sortOrder: i,
    }));

    try {
      await insertBacktestTrades(tradeRecords);
    } catch (e) {
      // Trades may already be inserted from a previous poll
    }
  }

  if (overallState === 'failed') {
    const failedStep = steps.find((s) => s.status === 'error');
    updateData.errorMessage = failedStep
      ? failedStep.logs.find((l: string) => l.startsWith('[ERROR]')) || 'Unknown error'
      : 'Unknown error';
    updateData.completedAt = new Date();
  }

  await updateBacktestRun(run.runId, updateData);

  return {
    runId: run.runId,
    state: overallState,
    steps,
    progress: backtestProgress,
    artifacts:
      overallState === 'completed'
        ? {
            dsl: fullCode,
            reportUrl: `/api/runs/${run.runId}/report`,
            tradesCsvUrl: `/api/runs/${run.runId}/report?format=csv`,
          }
        : { dsl: '', reportUrl: '', tradesCsvUrl: '' },
  };
}
