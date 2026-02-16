// ============================================================
// SimulationResult - Latest Simulation section
// Design: Swiss Precision - green dot, simulation ID, KPI + chart + table
// ============================================================

import { Sparkles } from 'lucide-react';
import KPICards from './KPICards';
import EquityChart from './EquityChart';
import TradeTable from './TradeTable';
import { useI18n } from '@/contexts/I18nContext';
import type { AppStatus } from '@/hooks/useBacktest';
import type { IndicatorPreferences, RunReportResponse, TradeRecord } from '@/lib/api';
import { useMemo, useState } from 'react';

interface SimulationResultProps {
  report: RunReportResponse | null;
  status: AppStatus;
  runId: string | null;
  indicatorPreferences: IndicatorPreferences;
  backtestStartDate: string;
  backtestEndDate: string;
}

export default function SimulationResult({
  report,
  status,
  runId,
  indicatorPreferences,
  backtestStartDate,
  backtestEndDate,
}: SimulationResultProps) {
  const { t, locale } = useI18n();
  const [hoveredTrade, setHoveredTrade] = useState<TradeRecord | null>(null);
  const [pinnedTrade, setPinnedTrade] = useState<TradeRecord | null>(null);
  const isLoading = status === 'running' || status === 'analyzing';
  const showResult = status === 'analyzing' || status === 'running' || status === 'completed' || status === 'failed';
  const range = `${backtestStartDate} - ${backtestEndDate}`;
  const activeTrade = useMemo(() => hoveredTrade ?? pinnedTrade, [hoveredTrade, pinnedTrade]);

  const getTradeKey = (trade: TradeRecord | null) => {
    if (!trade) return "";
    return `${trade.timestamp}|${trade.entryTime ?? ""}|${trade.symbol}|${trade.action}|${trade.price}`;
  };

  if (!showResult) return null;

  return (
    <div className="space-y-4 mt-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${status === 'completed' ? 'bg-emerald-500' : (status === 'running' || status === 'analyzing') ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-sm font-semibold text-foreground">{t('sim.latestSimulation')}</span>
        </div>
        {runId && (
          <span className="text-xs text-muted-foreground font-mono">ID: {runId}</span>
        )}
        {isLoading && !runId && (
          <div className="h-3 w-20 bg-muted rounded animate-pulse" />
        )}
      </div>

      {/* Run Metadata */}
      <div className="border border-border rounded-lg bg-card p-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div className="text-muted-foreground">
            MA/MACD: <span className="text-foreground">{`MA${indicatorPreferences.maWindowDays}, MACD ${indicatorPreferences.macdFast}/${indicatorPreferences.macdSlow}/${indicatorPreferences.macdSignal}`}</span>
          </div>
          <div className="text-muted-foreground">
            {locale === "zh" ? "回测时间" : "Backtest Window"}: <span className="text-foreground">{range}</span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <KPICards kpis={report?.kpis || null} loading={isLoading && !report} />

      {/* AI Summary */}
      {report?.aiSummary && (
        <div className="border rounded-lg px-4 py-3 bg-violet-50/70 border-violet-200 dark:bg-violet-950/25 dark:border-violet-800">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300 mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            {locale === "zh" ? t("sim.aiSummaryZh") : t("sim.aiSummaryEn")}
          </div>
          <p className="text-sm text-violet-900/90 dark:text-violet-100/90 leading-relaxed">
            {locale === "zh" ? (report.aiSummary.zh || report.aiSummary.en) : (report.aiSummary.en || report.aiSummary.zh)}
          </p>
        </div>
      )}

      {/* Equity Chart */}
      <EquityChart
        data={report?.equity || null}
        trades={report?.trades || null}
        selectedTrade={activeTrade}
        loading={isLoading && !report}
      />

      {/* Trade Table */}
      <TradeTable
        trades={report?.trades || null}
        loading={isLoading && !report}
        selectedTrade={activeTrade}
        onTradeHover={(trade) => setHoveredTrade(trade)}
        onTradeSelect={(trade) => {
          setPinnedTrade((prev) => (getTradeKey(prev) === getTradeKey(trade) ? null : trade));
        }}
        onTableLeave={() => {
          setHoveredTrade(null);
          setPinnedTrade(null);
        }}
      />
    </div>
  );
}
