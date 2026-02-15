// ============================================================
// StrategyDesigner - Left column: input + simulation results
// Design: Swiss Precision - clean hierarchy, generous spacing
// ============================================================

import StrategyInput from './StrategyInput';
import SimulationResult from './SimulationResult';
import ErrorCard from './ErrorCard';
import HistoryPanel from './HistoryPanel';
import { useI18n } from '@/contexts/I18nContext';
import type { AppStatus } from '@/hooks/useBacktest';
import type { BacktestWindowPreset } from '@/lib/date';
import type { IndicatorPreferences, RunReportResponse } from '@/lib/api';

interface StrategyDesignerProps {
  status: AppStatus;
  prompt: string;
  onPromptChange: (value: string) => void;
  onRunBacktest: () => void;
  indicatorPreferences: IndicatorPreferences;
  onIndicatorPreferencesChange: (next: IndicatorPreferences) => void;
  backtestWindowPreset: BacktestWindowPreset;
  backtestStartDate: string;
  backtestEndDate: string;
  onBacktestWindowPresetChange: (preset: BacktestWindowPreset) => void;
  onBacktestDateRangeChange: (next: { startDate: string; endDate: string }) => void;
  report: RunReportResponse | null;
  runId: string | null;
  error: string | null;
  onRetry: () => void;
}

export default function StrategyDesigner({
  status,
  prompt,
  onPromptChange,
  onRunBacktest,
  indicatorPreferences,
  onIndicatorPreferencesChange,
  backtestWindowPreset,
  backtestStartDate,
  backtestEndDate,
  onBacktestWindowPresetChange,
  onBacktestDateRangeChange,
  report,
  runId,
  error,
  onRetry,
}: StrategyDesignerProps) {
  const { t } = useI18n();

  return (
    <div className="px-6 py-6 pb-6">
      {/* Title */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-foreground tracking-tight">{t('strategy.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('strategy.subtitle')}
        </p>
      </div>

      {/* Input Area */}
      <StrategyInput
        prompt={prompt}
        onPromptChange={onPromptChange}
        onRunBacktest={onRunBacktest}
        indicatorPreferences={indicatorPreferences}
        onIndicatorPreferencesChange={onIndicatorPreferencesChange}
        backtestWindowPreset={backtestWindowPreset}
        backtestStartDate={backtestStartDate}
        backtestEndDate={backtestEndDate}
        onBacktestWindowPresetChange={onBacktestWindowPresetChange}
        onBacktestDateRangeChange={onBacktestDateRangeChange}
        status={status}
      />

      {/* Error State */}
      {status === 'failed' && error && (
        <ErrorCard message={error} onRetry={onRetry} />
      )}

      {/* Simulation Results */}
      <SimulationResult
        report={report}
        status={status}
        runId={runId}
        indicatorPreferences={indicatorPreferences}
        backtestStartDate={backtestStartDate}
        backtestEndDate={backtestEndDate}
      />

      {/* History Panel */}
      <HistoryPanel />
    </div>
  );
}
