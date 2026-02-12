// ============================================================
// KPICards - 6 KPI metric cards (Return, CAGR, Sharpe, Max DD, Win Rate, Trades)
// Design: Swiss Precision - light border cards, large mono numbers
// Supports both legacy and enhanced report formats
// ============================================================

import { useI18n } from '@/contexts/I18nContext';
import type { LegacyKPIs, BacktestSummary } from '@/lib/api';

interface KPICardsProps {
  kpis: LegacyKPIs | null;
  summary?: BacktestSummary | null;
  loading: boolean;
}

function SkeletonCard() {
  return (
    <div className="border border-border rounded-lg p-4 space-y-2.5">
      <div className="h-3 w-14 bg-muted rounded animate-pulse" />
      <div className="h-8 w-24 bg-muted rounded animate-pulse" />
    </div>
  );
}

export default function KPICards({ kpis, summary, loading }: KPICardsProps) {
  const { t } = useI18n();

  if (loading || !kpis) {
    return (
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  // Build items array: always show legacy KPIs, add enhanced metrics if available
  const items: Array<{ label: string; value: string; color: string }> = [
    {
      label: t('sim.return'),
      value: `${kpis.returnPct >= 0 ? '+' : ''}${kpis.returnPct}%`,
      color: kpis.returnPct >= 0 ? 'text-emerald-600' : 'text-red-500',
    },
    {
      label: t('sim.cagr'),
      value: `${kpis.cagrPct}%`,
      color: 'text-foreground',
    },
    {
      label: t('sim.sharpe'),
      value: `${kpis.sharpe}`,
      color: kpis.sharpe >= 1 ? 'text-emerald-600' : kpis.sharpe >= 0 ? 'text-foreground' : 'text-red-500',
    },
    {
      label: t('sim.maxDd'),
      value: `${kpis.maxDdPct}%`,
      color: 'text-red-500',
    },
  ];

  // Add enhanced metrics from summary if available
  if (summary) {
    if (summary.winRate !== null && summary.winRate !== undefined) {
      const winRatePct = summary.winRate > 1 ? summary.winRate : summary.winRate * 100;
      items.push({
        label: 'Win Rate',
        value: `${winRatePct.toFixed(1)}%`,
        color: winRatePct >= 50 ? 'text-emerald-600' : 'text-amber-500',
      });
    }
    if (summary.totalTrades !== null && summary.totalTrades !== undefined) {
      items.push({
        label: 'Total Trades',
        value: `${summary.totalTrades}`,
        color: 'text-foreground',
      });
    }
  }

  // Use 3-column grid for 6 items, 4-column for 4 items
  const gridCols = items.length > 4 ? 'grid-cols-3' : 'grid-cols-4';

  return (
    <div className={`grid ${gridCols} gap-3`}>
      {items.map((item) => (
        <div
          key={item.label}
          className="border border-border rounded-lg p-4 bg-card hover:shadow-sm transition-shadow duration-200"
        >
          <div className="text-[11px] font-medium text-muted-foreground tracking-wider uppercase mb-2">
            {item.label}
          </div>
          <div className={`text-2xl font-semibold font-mono tracking-tight ${item.color}`}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
