// ============================================================
// WorkspaceStep - Individual step card in AI Workspace
// Design: Swiss Precision - vertical timeline, status icons, details
// ============================================================

import { useState } from 'react';
import { CheckCircle2, Loader2, Circle, AlertTriangle, AlertCircle, Code2, ChevronRight, Check, ChevronDown } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';
import type { StepInfo } from '@/lib/api';

type StepStatus = StepInfo['status'];

interface WorkspaceStepProps {
  step: StepInfo;
  isLast: boolean;
  progress: number;
  onViewCode?: (code: string) => void;
  dsl?: string;
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

function AnalysisContent({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium bg-card text-foreground rounded-md border border-border"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function DataSynthContent({ step }: { step: StepInfo }) {
  const isRunning = step.status === 'running';
  const progressPct = step.status === 'done' ? 100 : isRunning ? 60 : 0;

  return (
    <div className="mt-2.5 border border-border rounded-md p-3 bg-muted/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">BTC-USD Feed</span>
        {(isRunning || step.status === 'done') && (
          <span className="text-[10px] font-bold text-red-500 bg-red-50 dark:bg-red-950 px-1.5 py-0.5 rounded border border-red-100 dark:border-red-800">
            Live
          </span>
        )}
      </div>
      <div className="flex gap-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className={`h-3.5 flex-1 rounded-sm transition-colors duration-300 ${
              i < Math.floor(progressPct / 12.5) ? 'bg-foreground' : 'bg-muted'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function LogicContent({ onViewCode, t }: { onViewCode?: () => void; t: (key: string) => string }) {
  return (
    <div className="mt-2.5 space-y-2">
      <div className="code-block p-3 overflow-hidden">
        <div className="flex gap-1.5 mb-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
          <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
          <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
        </div>
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap">
          <code>
            <span className="text-blue-300">def </span>
            <span className="text-white font-bold">on_signal</span>
            <span className="text-white">(data):</span>
            {'\n'}
            <span className="text-white">    </span>
            <span className="text-purple-300">if </span>
            <span className="text-white">data.sma50 {'>'} data.sma200:</span>
            {'\n'}
            <span className="text-white">        </span>
            <span className="text-purple-300">return </span>
            <span className="text-emerald-400">"LONG"</span>
          </code>
        </pre>
      </div>
      {onViewCode && (
        <button
          onClick={onViewCode}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Code2 className="w-3.5 h-3.5" />
          {t('workspace.viewFullCode')}
        </button>
      )}
    </div>
  );
}

function BacktestContent({ progress, step }: { progress: number; step: StepInfo }) {
  const isRunning = step.status === 'running';
  const isDone = step.status === 'done';
  const displayProgress = isDone ? 100 : progress;

  return (
    <div className="mt-2.5 space-y-2.5">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-foreground">Monte Carlo Simulation</span>
          <span className="text-xs font-mono text-muted-foreground">{displayProgress}%</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-foreground rounded-full transition-all duration-500 ease-out"
            style={{ width: `${displayProgress}%` }}
          />
        </div>
      </div>

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

export default function WorkspaceStepCard({ step, isLast, progress, onViewCode, dsl }: WorkspaceStepProps) {
  const { t } = useI18n();
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
    running: t('step.running'),
    done: t('step.done'),
    error: t('step.error'),
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
