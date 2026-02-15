// ============================================================
// StrategyInput - Natural language prompt input + chips + Run button
// + Example prompt buttons in idle state
// ============================================================

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Play, Plus, Sparkles } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';
import type { AppStatus } from '@/hooks/useBacktest';
import type { IndicatorPreferences } from '@/lib/api';
import { formatDateByLocale, isIsoDate, type BacktestWindowPreset } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface StrategyInputProps {
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
  status: AppStatus;
}

const EXAMPLE_PROMPTS = [
  {
    labelKey: 'strategy.examplePrompt',
    prompt: 'Sell 25% TQQQ when QQQ has a 4H MACD death cross and at 2 minutes before close it\'s still below the 5-day MA.',
  },
];

export default function StrategyInput({
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
  status,
}: StrategyInputProps) {
  const { t, locale } = useI18n();
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [advancedModule, setAdvancedModule] = useState<'indicators' | 'window'>('indicators');
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
  const rangePresets: Array<{ key: Exclude<BacktestWindowPreset, "custom">; label: string }> = [
    { key: 'all', label: t('strategy.backtestPresetAll') },
    { key: '1m', label: t('strategy.backtestPreset1m') },
    { key: '3m', label: t('strategy.backtestPreset3m') },
    { key: '6m', label: t('strategy.backtestPreset6m') },
    { key: '1y', label: t('strategy.backtestPreset1y') },
  ];
  const isDateRangeInvalid = useMemo(() => {
    if (!isIsoDate(backtestStartDate) || !isIsoDate(backtestEndDate)) return true;
    return backtestStartDate > backtestEndDate;
  }, [backtestEndDate, backtestStartDate]);
  const formattedRangeSummary = `${formatDateByLocale(backtestStartDate, locale)} ~ ${formatDateByLocale(backtestEndDate, locale)}`;

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
        <button
          type="button"
          onClick={() => onPromptChange('')}
          disabled={isRunning || !prompt.trim()}
          className="flex items-center gap-2 px-4 py-2.5 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-muted/40 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('strategy.clearPrompt')}
        </button>
        {/* Run Backtest Button */}
        <button
          onClick={onRunBacktest}
          disabled={isRunning || !prompt.trim() || isDateRangeInvalid}
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
      {isDateRangeInvalid && (
        <p className="text-xs text-red-500">{t('strategy.invalidDateRange')}</p>
      )}

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
            <Tabs value={advancedModule} onValueChange={(next) => setAdvancedModule(next as 'indicators' | 'window')}>
              <TabsList className="w-full">
                <TabsTrigger value="indicators" className="text-xs">{t('strategy.advancedModuleIndicators')}</TabsTrigger>
                <TabsTrigger value="window" className="text-xs">{t('strategy.advancedModuleBacktestWindow')}</TabsTrigger>
              </TabsList>

              <TabsContent value="indicators" className="space-y-3 mt-2">
                <div className="space-y-2">
                  <p className="text-[11px] font-medium text-muted-foreground">{t('strategy.maWindow')}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {maPresets.map((window) => (
                      <Button
                        key={window}
                        type="button"
                        size="sm"
                        variant={maSelection === 'preset' && indicatorPreferences.maWindowDays === window ? "default" : "outline"}
                        disabled={isRunning}
                        onClick={() => {
                          setMaSelection('preset');
                          updateIndicatorPreference({ maWindowDays: window });
                        }}
                        className="h-7 text-xs"
                      >
                        {`MA${window}`}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant={maSelection === 'custom' ? 'default' : 'outline'}
                      disabled={isRunning}
                      onClick={() => setMaSelection((v) => (v === 'custom' ? 'preset' : 'custom'))}
                      className="h-7 text-xs"
                    >
                      <Plus className="w-3 h-3" />
                      {t('strategy.addCustom')}
                    </Button>
                    {maSelection === 'custom' && (
                      <Input
                        type="number"
                        min={1}
                        disabled={isRunning}
                        value={indicatorPreferences.maWindowDays}
                        onChange={(e) => handleMaInputChange(e.target.value)}
                        className="w-32 h-7 text-xs"
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
                        <Button
                          key={`${preset.fast}-${preset.slow}-${preset.signal}`}
                          type="button"
                          size="sm"
                          variant={active ? 'default' : 'outline'}
                          disabled={isRunning}
                          onClick={() => {
                            setMacdSelection('preset');
                            updateIndicatorPreference({
                              macdFast: preset.fast,
                              macdSlow: preset.slow,
                              macdSignal: preset.signal,
                            });
                          }}
                          className="h-7 text-xs"
                        >
                          {`MACD ${preset.fast}/${preset.slow}/${preset.signal}`}
                        </Button>
                      );
                    })}
                    <Button
                      type="button"
                      size="sm"
                      variant={macdSelection === 'custom' ? 'default' : 'outline'}
                      disabled={isRunning}
                      onClick={() => setMacdSelection((v) => (v === 'custom' ? 'preset' : 'custom'))}
                      className="h-7 text-xs"
                    >
                      <Plus className="w-3 h-3" />
                      {t('strategy.addCustom')}
                    </Button>
                    {macdSelection === 'custom' && (
                      <>
                        <Input
                          type="number"
                          min={1}
                          disabled={isRunning}
                          value={indicatorPreferences.macdFast}
                          onChange={(e) => handleMacdInputChange('macdFast', e.target.value)}
                          className="w-24 h-7 text-xs"
                          placeholder={t('strategy.macdFastPlaceholder')}
                          aria-label="MACD fast"
                        />
                        <Input
                          type="number"
                          min={1}
                          disabled={isRunning}
                          value={indicatorPreferences.macdSlow}
                          onChange={(e) => handleMacdInputChange('macdSlow', e.target.value)}
                          className="w-24 h-7 text-xs"
                          placeholder={t('strategy.macdSlowPlaceholder')}
                          aria-label="MACD slow"
                        />
                        <Input
                          type="number"
                          min={1}
                          disabled={isRunning}
                          value={indicatorPreferences.macdSignal}
                          onChange={(e) => handleMacdInputChange('macdSignal', e.target.value)}
                          className="w-24 h-7 text-xs"
                          placeholder={t('strategy.macdSignalPlaceholder')}
                          aria-label="MACD signal"
                        />
                      </>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="window" className="space-y-3 mt-2">
                <div className="space-y-2">
                  <p className="text-[11px] font-medium text-muted-foreground">{t('strategy.backtestWindow')}</p>
                  <div className="flex flex-wrap gap-2">
                    {rangePresets.map((preset) => (
                      <Button
                        key={preset.key}
                        type="button"
                        size="sm"
                        variant={backtestWindowPreset === preset.key ? "default" : "outline"}
                        disabled={isRunning}
                        onClick={() => onBacktestWindowPresetChange(preset.key)}
                        className="h-7 text-xs"
                      >
                        {preset.label}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant={backtestWindowPreset === "custom" ? "default" : "outline"}
                      disabled={isRunning}
                      onClick={() => onBacktestWindowPresetChange("custom")}
                      className="h-7 text-xs"
                    >
                      {t('strategy.backtestPresetCustom')}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground">{t('strategy.startDate')}</p>
                    <Input
                      type="date"
                      value={backtestStartDate}
                      disabled={isRunning}
                      onChange={(e) => onBacktestDateRangeChange({ startDate: e.target.value, endDate: backtestEndDate })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground">{t('strategy.endDate')}</p>
                    <Input
                      type="date"
                      value={backtestEndDate}
                      disabled={isRunning}
                      onChange={(e) => onBacktestDateRangeChange({ startDate: backtestStartDate, endDate: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">{formattedRangeSummary}</p>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
