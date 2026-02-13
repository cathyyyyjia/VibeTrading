// ============================================================
// StrategyInput - Natural language prompt input + chips + Run button
// + Example prompt buttons in idle state
// ============================================================

import { useState } from 'react';
import { ChevronDown, ChevronRight, Play, Plus, Sparkles } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';
import type { AppStatus } from '@/hooks/useBacktest';
import type { IndicatorPreferences } from '@/lib/api';

interface StrategyInputProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onRunBacktest: () => void;
  indicatorPreferences: IndicatorPreferences;
  onIndicatorPreferencesChange: (next: IndicatorPreferences) => void;
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
  onRunBacktest,
  indicatorPreferences,
  onIndicatorPreferencesChange,
  status,
}: StrategyInputProps) {
  const { t } = useI18n();
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [maSelection, setMaSelection] = useState<'preset' | 'custom'>('preset');
  const [macdSelection, setMacdSelection] = useState<'preset' | 'custom'>('preset');
  const isRunning = status === 'running' || status === 'analyzing';
  const isIdle = status === 'idle';
  const maPresets = [5, 10, 20, 50];
  const macdPresets = [
    { fast: 12, slow: 26, signal: 9 },
    { fast: 10, slow: 22, signal: 5 },
    { fast: 10, slow: 20, signal: 5 },
  ];

  const updateIndicatorPreference = (partial: Partial<IndicatorPreferences>) => {
    onIndicatorPreferencesChange({ ...indicatorPreferences, ...partial });
  };

  const handleMacdInputChange = (key: keyof Pick<IndicatorPreferences, 'macdFast' | 'macdSlow' | 'macdSignal'>, value: string) => {
    const n = Number(value);
    if (Number.isNaN(n)) return;
    updateIndicatorPreference({ [key]: Math.max(1, Math.floor(n)) } as Partial<IndicatorPreferences>);
  };

  const handleMaInputChange = (value: string) => {
    const n = Number(value);
    if (Number.isNaN(n)) return;
    updateIndicatorPreference({ maWindowDays: Math.max(1, Math.floor(n)) });
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

      {/* Row: Example Prompts (left) + Run Button (right) */}
      <div className="flex items-center gap-3">
        {isIdle && !prompt.trim() && (
          <div className="flex flex-wrap gap-2 flex-1">
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
        {/* Run Backtest Button */}
        <button
          onClick={onRunBacktest}
          disabled={isRunning || !prompt.trim()}
          className="ml-auto flex items-center gap-2 px-5 py-2.5 bg-foreground text-primary-foreground text-sm font-medium rounded-lg hover:bg-foreground/90 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
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

      <div className="border border-border rounded-lg bg-card/40">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-muted/30 transition-colors"
        >
          <p className="text-xs font-semibold tracking-wide text-foreground">{t('strategy.advancedParams')}</p>
          {advancedOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </button>

        {advancedOpen && (
          <div className="px-3 pb-3 space-y-3">
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">{t('strategy.maWindow')}</p>
              <div className="flex flex-wrap items-center gap-2">
                {maPresets.map((window) => (
                  <button
                    key={window}
                    type="button"
                    disabled={isRunning}
                    onClick={() => {
                      setMaSelection('preset');
                      updateIndicatorPreference({ maWindowDays: window });
                    }}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                      maSelection === 'preset' && indicatorPreferences.maWindowDays === window
                        ? 'bg-foreground text-primary-foreground border-foreground'
                        : 'bg-background border-border text-foreground hover:border-foreground/40'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {`MA${window}`}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => setMaSelection((v) => (v === 'custom' ? 'preset' : 'custom'))}
                  className={`h-7 px-2.5 text-xs rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1 ${
                    maSelection === 'custom'
                      ? 'bg-foreground text-primary-foreground border-foreground'
                      : 'border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
                  }`}
                >
                  <Plus className="w-3 h-3" />
                  {t('strategy.addCustom')}
                </button>
                {maSelection === 'custom' && (
                  <input
                    type="number"
                    min={1}
                    disabled={isRunning}
                    value={indicatorPreferences.maWindowDays}
                    onChange={(e) => handleMaInputChange(e.target.value)}
                    className="w-32 h-7 px-2.5 text-xs border border-border rounded-md bg-background text-foreground"
                    placeholder={t('strategy.maCustomPlaceholder')}
                    aria-label="MA window days"
                  />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">{t('strategy.macdParams')}</p>
              <div className="flex flex-wrap items-center gap-2">
                {macdPresets.map((preset) => {
                  const active =
                    macdSelection === 'preset' &&
                    indicatorPreferences.macdFast === preset.fast &&
                    indicatorPreferences.macdSlow === preset.slow &&
                    indicatorPreferences.macdSignal === preset.signal;
                  return (
                    <button
                      key={`${preset.fast}-${preset.slow}-${preset.signal}`}
                      type="button"
                      disabled={isRunning}
                      onClick={() =>
                        {
                          setMacdSelection('preset');
                          updateIndicatorPreference({
                            macdFast: preset.fast,
                            macdSlow: preset.slow,
                            macdSignal: preset.signal,
                          });
                        }
                      }
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                        active
                          ? 'bg-foreground text-primary-foreground border-foreground'
                          : 'bg-background border-border text-foreground hover:border-foreground/40'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {`MACD ${preset.fast}/${preset.slow}/${preset.signal}`}
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => setMacdSelection((v) => (v === 'custom' ? 'preset' : 'custom'))}
                  className={`h-7 px-2.5 text-xs rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1 ${
                    macdSelection === 'custom'
                      ? 'bg-foreground text-primary-foreground border-foreground'
                      : 'border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
                  }`}
                >
                  <Plus className="w-3 h-3" />
                  {t('strategy.addCustom')}
                </button>
                {macdSelection === 'custom' && (
                  <>
                    <input
                      type="number"
                      min={1}
                      disabled={isRunning}
                      value={indicatorPreferences.macdFast}
                      onChange={(e) => handleMacdInputChange('macdFast', e.target.value)}
                      className="w-24 h-7 px-2.5 text-xs border border-border rounded-md bg-background text-foreground"
                      placeholder={t('strategy.macdFastPlaceholder')}
                      aria-label="MACD fast"
                    />
                    <input
                      type="number"
                      min={1}
                      disabled={isRunning}
                      value={indicatorPreferences.macdSlow}
                      onChange={(e) => handleMacdInputChange('macdSlow', e.target.value)}
                      className="w-24 h-7 px-2.5 text-xs border border-border rounded-md bg-background text-foreground"
                      placeholder={t('strategy.macdSlowPlaceholder')}
                      aria-label="MACD slow"
                    />
                    <input
                      type="number"
                      min={1}
                      disabled={isRunning}
                      value={indicatorPreferences.macdSignal}
                      onChange={(e) => handleMacdInputChange('macdSignal', e.target.value)}
                      className="w-24 h-7 px-2.5 text-xs border border-border rounded-md bg-background text-foreground"
                      placeholder={t('strategy.macdSignalPlaceholder')}
                      aria-label="MACD signal"
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
