// ============================================================
// WorkspaceStep - Individual step card in AI Workspace
// ============================================================

import { useState } from 'react';
import { CheckCircle2, Loader2, Circle, AlertTriangle, AlertCircle, ChevronRight, Check, ChevronDown } from 'lucide-react';
import type { StepInfo } from '@/lib/api';

type StepStatus = StepInfo['status'];

interface WorkspaceStepProps {
  step: StepInfo;
  isLast: boolean;
  progress: number;
}

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />;
    case 'running':
      return <Loader2 className="w-5 h-5 text-foreground animate-spin shrink-0" />;
    case 'queued':
      return <Circle className="w-5 h-5 text-muted-foreground/30 shrink-0" />;
    case 'warn':
      return <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />;
    case 'error':
      return <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />;
  }
}

function DataSynthContent({ step }: { step: StepInfo }) {
  const isDone = step.status === 'done';
  const logs = step.logs.slice(-4);

  return (
    <div className="mt-2.5 border border-border rounded-md p-3 bg-muted/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">Market Data</span>
        {(step.status === 'running' || isDone) && (
          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
            {isDone ? 'Ready' : 'Loading'}
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {logs.length > 0 ? logs.map((log, i) => (
          <div key={i} className="text-xs text-muted-foreground truncate" title={log}>
            {log.replace('[INFO] ', '').replace('[DEBUG] ', '')}
          </div>
        )) : (
          <div className="text-xs text-muted-foreground">No data logs available</div>
        )}
      </div>
    </div>
  );
}

function ParseContent({ step }: { step: StepInfo }) {
  const latestLog = step.logs[step.logs.length - 1] || '';
  const model = latestLog.match(/"model":"([^"]+)"/)?.[1];
  const llmUsed = latestLog.match(/"llm_used":(true|false)/)?.[1];
  const fallbackApplied = latestLog.match(/"fallback_seed_applied":(true|false)/)?.[1];
  const llmUsedLabel = llmUsed === 'true' ? 'Yes' : llmUsed === 'false' ? 'No' : '-';
  const fallbackLabel = fallbackApplied === 'true' ? 'Yes' : fallbackApplied === 'false' ? 'No' : '-';

  return (
    <div className="mt-2.5 border border-border rounded-md p-3 bg-muted/30">
      <div className="text-xs font-medium text-foreground mb-2">Parse Metadata</div>
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          LLM Model: <span className="text-foreground">{model || '-'}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          LLM Driven: <span className="text-foreground">{llmUsedLabel}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Fallback Seed: <span className="text-foreground">{fallbackLabel}</span>
        </div>
      </div>
    </div>
  );
}

function BacktestContent({ progress, step }: { progress: number; step: StepInfo }) {
  const isRunning = step.status === 'running';
  const isDone = step.status === 'done';
  const latestProgressLog = [...step.logs].reverse().find((log) => log.includes('Backtesting '));
  const progressMatch = latestProgressLog?.match(/Backtesting\s+(\d{4}-\d{2}-\d{2})\s+\((\d+)\/(\d+),\s*([\d.]+)%\)/);
  const displayProgress = isDone ? 100 : (progressMatch ? Number(progressMatch[4]) : progress);
  const progressText = isDone
    ? 'Completed'
    : progressMatch?.[1]
      ? `Running... processing ${progressMatch[1]}`
      : 'Started';

  return (
    <div className="mt-2.5 space-y-2.5">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-foreground">Backtest Engine</span>
          <span className="text-xs font-mono text-muted-foreground">{displayProgress}%</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-foreground rounded-full transition-all duration-500 ease-out"
            style={{ width: `${displayProgress}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs">
        {isRunning ? (
          <ChevronRight className="w-3.5 h-3.5 text-foreground shrink-0" />
        ) : (
          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        )}
        <span className="text-muted-foreground">{progressText}</span>
      </div>
    </div>
  );
}

function ErrorLogs({ logs }: { logs: string[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-600 transition-colors"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        {expanded ? 'Hide error logs' : 'Show error logs'}
      </button>
      {expanded && (
        <div className="mt-2 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-md p-3 space-y-1">
          {logs.map((log, i) => (
            <div key={i} className="text-[11px] font-mono text-red-700 dark:text-red-400">
              {log}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WorkspaceStepCard({ step, isLast, progress }: WorkspaceStepProps) {
  const isActive = step.status === 'running' || step.status === 'done' || step.status === 'error';
  const isParse = step.key === 'parse';
  const isData = step.key === 'data';
  const isBacktest = step.key === 'backtest';

  const stepTitleMap: Record<string, string> = {
    parse: 'PARSE',
    plan: 'PLAN',
    data: 'DATA',
    backtest: 'BACKTEST',
    report: 'REPORT',
    deploy: 'DEPLOY',
  };

  const statusLabelMap: Record<string, string> = {
    running: 'Running',
    done: 'Done',
    error: 'Error',
  };

  return (
    <div className="relative">
      {!isLast && (
        <div className="absolute left-[18px] top-[40px] bottom-[-12px] w-px bg-border" />
      )}

      <div
        className={`
          relative border rounded-lg p-4 transition-all duration-200
          ${step.status === 'running'
            ? 'border-foreground/20 bg-card shadow-md ring-1 ring-foreground/5'
            : step.status === 'error'
              ? 'border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20'
              : step.status === 'done'
                ? 'border-border bg-card'
                : 'border-border/60 bg-card/60'
          }
        `}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <StatusIcon status={step.status} />
            <span className="text-xs font-bold tracking-wider text-foreground uppercase">
              {stepTitleMap[step.key] || step.title}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {step.durationMs !== null && step.status === 'done' && (
              <span className="text-[11px] font-mono text-muted-foreground">{(step.durationMs / 1000).toFixed(1)}s</span>
            )}
            {step.status === 'running' && (
              <span className="text-[10px] font-bold text-white bg-emerald-500 px-2 py-0.5 rounded-full">
                {statusLabelMap.running}
              </span>
            )}
          </div>
        </div>

        {isActive && step.logs.length > 0 && !isBacktest && !isParse && (
          <p className="text-xs text-muted-foreground mt-1.5 ml-[30px]">{step.logs[0]}</p>
        )}

        {isActive && (
          <div className="ml-[30px]">
            {isParse && step.status !== 'error' && (
              <ParseContent step={step} />
            )}
            {isData && step.status !== 'error' && (
              <DataSynthContent step={step} />
            )}
            {isBacktest && step.status !== 'error' && (
              <BacktestContent progress={progress} step={step} />
            )}
            {step.status === 'error' && (
              <ErrorLogs logs={step.logs} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
