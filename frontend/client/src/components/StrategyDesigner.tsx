// ============================================================
// StrategyDesigner - Left column: input + simulation results
// Design: Swiss Precision - clean hierarchy, generous spacing
// ============================================================

import StrategyInput from './StrategyInput';
import SimulationResult from './SimulationResult';
import ErrorCard from './ErrorCard';
import HistoryPanel from './HistoryPanel';
import { useI18n } from '@/contexts/I18nContext';
import type { AppStatus, ChipFilter } from '@/hooks/useBacktest';
import type { RunReportResponse } from '@/lib/api';

interface StrategyDesignerProps {
  status: AppStatus;
  prompt: string;
  onPromptChange: (value: string) => void;
  filters: ChipFilter[];
  onToggleFilter: (id: string) => void;
  onRunBacktest: () => void;
  report: RunReportResponse | null;
  runId: string | null;
  error: string | null;
  onRetry: () => void;
  onLoadHistoryPrompt?: (prompt: string) => void;
}

export default function StrategyDesigner({
  status,
  prompt,
  onPromptChange,
  filters,
  onToggleFilter,
  onRunBacktest,
  report,
  runId,
  error,
  onRetry,
  onLoadHistoryPrompt,
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
        filters={filters}
        onToggleFilter={onToggleFilter}
        onRunBacktest={onRunBacktest}
        status={status}
      />

      {/* Error State */}
      {status === 'failed' && error && (
        <ErrorCard message={error} onRetry={onRetry} />
      )}

      {/* Simulation Results */}
      <SimulationResult report={report} status={status} runId={runId} />

      {/* History Panel */}
      <HistoryPanel onSelectPrompt={onLoadHistoryPrompt} />
    </div>
  );
}
