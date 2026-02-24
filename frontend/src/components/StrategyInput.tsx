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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
    promptEn:
      'On QQQ / NDX, if a 4H MACD death cross is confirmed and 2 minutes before close price is still below the broken 5-day MA (still under MA5), then sell part of TQQQ and treat the rebound as finished.',
    promptZh:
      '在 QQQ / NDX 上确认 4小时 MACD 死叉，且在收盘前 2 分钟仍未收回“跌破的 5日 MA”（仍在 MA5 下方），则卖出一部分 TQQQ，认为反弹结束。',
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
  const [confirmDateOpen, setConfirmDateOpen] = useState(false);
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
  const confirmTitle = locale === 'zh' ? '确认回测时间' : 'Confirm Backtest Window';
  const confirmDescription = locale === 'zh'
    ? `本次将使用 ${formatDateByLocale(backtestStartDate, locale)} 至 ${formatDateByLocale(backtestEndDate, locale)} 进行回测。是否继续？`
    : `This run will backtest from ${backtestStartDate} to ${backtestEndDate}. Continue?`;
  const confirmRunText = locale === 'zh' ? '确认回测' : 'Confirm';

  const divergence = indicatorPreferences.divergence ?? {
    enabled: false,
    indicator: 'MACD' as const,
    direction: 'bearish' as const,
    timeframe: '4h' as const,
    pivotLeft: 3,
    pivotRight: 3,
    lookbackBars: 60,
  };

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
  const updateDivergencePreference = (
    partial: Partial<NonNullable<IndicatorPreferences['divergence']>>
  ) => {
    updateIndicatorPreference({
      divergence: {
        ...divergence,
        ...partial,
      },
    });
  };
  const handleDivergenceIntChange = (
    key: keyof Pick<NonNullable<IndicatorPreferences['divergence']>, 'pivotLeft' | 'pivotRight' | 'lookbackBars'>,
    value: string
  ) => {
    const n = Number(value);
    if (Number.isNaN(n)) return;
    updateDivergencePreference({ [key]: Math.max(1, Math.floor(n)) });
  };
  const handleRunClick = () => {
    if (isRunning || !prompt.trim() || isDateRangeInvalid) return;
    setConfirmDateOpen(true);
  };
  const handleConfirmRun = () => {
    setConfirmDateOpen(false);
    onRunBacktest();
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
                onClick={() => onPromptChange(locale === 'zh' ? ex.promptZh : ex.promptEn)}
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
          type="button"
          onClick={handleRunClick}
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

                <div className="space-y-2 border border-border rounded-md p-3">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {locale === 'zh' ? '背离模块 (MACD / RSI / KDJ)' : 'Divergence Module (MACD / RSI / KDJ)'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={divergence.enabled ? 'default' : 'outline'}
                      disabled={isRunning}
                      onClick={() => updateDivergencePreference({ enabled: !divergence.enabled })}
                      className="h-7 text-xs"
                    >
                      {divergence.enabled ? (locale === 'zh' ? '已启用' : 'Enabled') : (locale === 'zh' ? '启用' : 'Enable')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={divergence.direction === 'bearish' ? 'default' : 'outline'}
                      disabled={isRunning || !divergence.enabled}
                      onClick={() => updateDivergencePreference({ direction: 'bearish' })}
                      className="h-7 text-xs"
                    >
                      {locale === 'zh' ? '顶背离(看空)' : 'Bearish'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={divergence.direction === 'bullish' ? 'default' : 'outline'}
                      disabled={isRunning || !divergence.enabled}
                      onClick={() => updateDivergencePreference({ direction: 'bullish' })}
                      className="h-7 text-xs"
                    >
                      {locale === 'zh' ? '底背离(看多)' : 'Bullish'}
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">{locale === 'zh' ? '指标' : 'Indicator'}</p>
                      <select
                        value={divergence.indicator}
                        disabled={isRunning || !divergence.enabled}
                        onChange={(e) => updateDivergencePreference({ indicator: e.target.value as 'MACD' | 'RSI' | 'KDJ' })}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      >
                        <option value="MACD">MACD</option>
                        <option value="RSI">RSI</option>
                        <option value="KDJ">KDJ</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">{locale === 'zh' ? '周期' : 'Timeframe'}</p>
                      <select
                        value={divergence.timeframe}
                        disabled={isRunning || !divergence.enabled}
                        onChange={(e) => updateDivergencePreference({ timeframe: e.target.value as '4h' | '1d' })}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      >
                        <option value="4h">4H</option>
                        <option value="1d">1D</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">{locale === 'zh' ? '回看Bars' : 'Lookback Bars'}</p>
                      <Input
                        type="number"
                        min={10}
                        value={divergence.lookbackBars}
                        disabled={isRunning || !divergence.enabled}
                        onChange={(e) => handleDivergenceIntChange('lookbackBars', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">Pivot Left</p>
                      <Input
                        type="number"
                        min={1}
                        value={divergence.pivotLeft}
                        disabled={isRunning || !divergence.enabled}
                        onChange={(e) => handleDivergenceIntChange('pivotLeft', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">Pivot Right</p>
                      <Input
                        type="number"
                        min={1}
                        value={divergence.pivotRight}
                        disabled={isRunning || !divergence.enabled}
                        onChange={(e) => handleDivergenceIntChange('pivotRight', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
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

      <AlertDialog open={confirmDateOpen} onOpenChange={setConfirmDateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRun}>{confirmRunText}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
