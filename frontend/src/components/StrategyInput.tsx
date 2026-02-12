// ============================================================
// StrategyInput - Natural language prompt input + chips + Run button
// + Example prompt buttons in idle state
// ============================================================

import { Play, Sparkles } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';
import type { AppStatus, ChipFilter } from '@/hooks/useBacktest';

interface StrategyInputProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  filters: ChipFilter[];
  onToggleFilter: (id: string) => void;
  onRunBacktest: () => void;
  status: AppStatus;
}

const EXAMPLE_PROMPTS = [
  {
    labelKey: 'example.trend',
    prompt: 'Buy BTC when the 50-day MA crosses above the 200-day MA, with RSI below 30 as an entry filter. Use 5% stop-loss and 15% take-profit.',
  },
  {
    labelKey: 'example.meanReversion',
    prompt: 'Buy ETH when price drops 2 standard deviations below the 20-day Bollinger Band, sell when it returns to the mean. Position size 25% of portfolio.',
  },
  {
    labelKey: 'example.multiTimeframe',
    prompt: 'Sell 25% TQQQ when QQQ has a 4H MACD death cross and at 2 minutes before close it\'s still below the 5-day MA.',
  },
];

export default function StrategyInput({
  prompt,
  onPromptChange,
  filters,
  onToggleFilter,
  onRunBacktest,
  status,
}: StrategyInputProps) {
  const { t } = useI18n();
  const isRunning = status === 'running' || status === 'analyzing';
  const isIdle = status === 'idle';

  const filterLabels: Record<string, string> = {
    transactionCosts: t('filter.transactionCosts'),
    dateRange: t('filter.dateRange'),
    maxDrawdown: t('filter.maxDrawdown'),
  };

  return (
    <div className="space-y-3">
      {/* Textarea */}
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder={t('strategy.placeholder')}
        disabled={isRunning}
        rows={5}
        className="w-full px-4 py-3.5 border border-border rounded-lg bg-background text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed leading-relaxed"
      />

      {/* Example Prompts (only in idle state when no prompt) */}
      {isIdle && !prompt.trim() && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((ex, i) => (
            <button
              key={i}
              onClick={() => onPromptChange(ex.prompt)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50 border border-border rounded-full hover:bg-muted hover:text-foreground hover:border-foreground/20 transition-all duration-150"
            >
              <Sparkles className="w-3 h-3" />
              {t(ex.labelKey)}
            </button>
          ))}
        </div>
      )}

      {/* Bottom row: Chips + Run Button */}
      <div className="flex items-center justify-between">
        {/* Chips */}
        <div className="flex items-center gap-2">
          {filters.map((filter) => (
            <button
              key={filter.id}
              onClick={() => onToggleFilter(filter.id)}
              disabled={isRunning}
              className={`
                px-3 py-1.5 text-xs font-medium rounded-md border transition-all duration-150
                ${filter.active
                  ? 'bg-foreground text-primary-foreground border-foreground'
                  : 'bg-background text-foreground border-border hover:border-foreground/30'
                }
                disabled:opacity-40 disabled:cursor-not-allowed
              `}
            >
              {filterLabels[filter.id] || `+ ${filter.label}`}
            </button>
          ))}
        </div>

        {/* Run Backtest Button */}
        <button
          onClick={onRunBacktest}
          disabled={isRunning || !prompt.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-foreground text-primary-foreground text-sm font-medium rounded-lg hover:bg-foreground/90 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
        >
          {isRunning ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              {status === 'analyzing' ? t('strategy.analyzing') || 'Analyzing...' : t('strategy.running')}
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              {t('strategy.runBacktest')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
