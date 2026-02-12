// ============================================================
// WorkspaceStep - Individual step card in AI Workspace
// Design: Swiss Precision - vertical timeline, status icons, details
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

function BacktestContent({ progress, step }: { progress: number; step: StepInfo }) {
  const isRunning = step.status === 'running';
  const isDone = step.status === 'done';
  const displayProgress = isDone ? 100 : progress;
  const latestProgressLog = [...step.logs].reverse().find((log) => log.includes('Backtesting '));
  const progressMatch = latestProgressLog?.match(/Backtesting\s+(\d{4}-\d{2}-\d{2})\s+\((\d+)\/(\d+),\s*([\d.]+)%\)/);

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
      {progressMatch && (
        <div className="text-xs text-muted-foreground">
          Current date: {progressMatch[1]} ({progressMatch[2]}/{progressMatch[3]})
        </div>
      )}

      <div className="space-y-1.5">
        {step.logs.map((log, i) => {
          const isError = log.startsWith('[ERROR]');
          const logDone = !isError && (isDone || i < step.logs.length - 1);
          const logRunning = !isError && isRunning && i === step.logs.length - 1;
          
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              {logDone ? (
                <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              ) : logRunning ? (
                <ChevronRight className="w-3.5 h-3.5 text-foreground shrink-0" />
              ) : isError ? (
                <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              ) : (
                <Circle className="w-3 h-3 text-muted-foreground/40 shrink-0" />
              )}
              <span className={`${isError ? 'text-red-500' : logDone ? 'text-muted-foreground' : 'text-foreground font-medium'}`}>
                {log.replace('[ERROR] ', '').replace('[DEBUG] ', '')}
              </span>
            </div>
          );
        })}
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
  const isData = step.key === 'data';
  const isBacktest = step.key === 'backtest';

  // Localized step titles
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
        {/* Header */}
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
                {statusLabelMap['running']}
              </span>
            )}
          </div>
        </div>

        {isActive && step.logs.length > 0 && !isBacktest && (
          <p className="text-xs text-muted-foreground mt-1.5 ml-[30px]">{step.logs[0]}</p>
        )}

        {isActive && (
          <div className="ml-[30px]">
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
