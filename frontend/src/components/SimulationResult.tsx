// ============================================================
// SimulationResult - Latest Simulation section
// Design: Swiss Precision - green dot, simulation ID, KPI + chart + table
// ============================================================

import { useEffect, useState } from 'react';
import KPICards from './KPICards';
import EquityChart from './EquityChart';
import TradeTable from './TradeTable';
import { useI18n } from '@/contexts/I18nContext';
import type { AppStatus } from '@/hooks/useBacktest';
import * as api from '@/lib/api';
import type { RunReportResponse } from '@/lib/api';

interface SimulationResultProps {
  report: RunReportResponse | null;
  status: AppStatus;
  runId: string | null;
}

interface StrategySummary {
  signalSymbol: string;
  tradeSymbol: string;
  primaryTf: string;
  derivedTfs: string[];
  indicators: number;
  events: number;
  rules: number;
  actions: number;
}

function buildStrategySummary(content: any): StrategySummary | null {
  const spec = content?.dsl ? content : { dsl: content, universe: {} };
  if (!spec || typeof spec !== 'object') return null;
  const dsl = spec.dsl && typeof spec.dsl === 'object' ? spec.dsl : null;
  if (!dsl) return null;

  const universe = spec.universe && typeof spec.universe === 'object' ? spec.universe : {};
  const time = dsl.time && typeof dsl.time === 'object' ? dsl.time : {};
  const signal = dsl.signal && typeof dsl.signal === 'object' ? dsl.signal : {};
  const logic = dsl.logic && typeof dsl.logic === 'object' ? dsl.logic : {};
  const action = dsl.action && typeof dsl.action === 'object' ? dsl.action : {};

  const primaryTf = typeof time.primary_tf === 'string' ? time.primary_tf : '-';
  const derivedTfs = Array.isArray(time.derived_tfs) ? time.derived_tfs.filter((x: unknown): x is string => typeof x === 'string') : [];
  const indicators = Array.isArray(signal.indicators) ? signal.indicators.length : 0;
  const events = Array.isArray(signal.events) ? signal.events.length : 0;
  const rules = Array.isArray(logic.rules) ? logic.rules.length : 0;
  const actions = Array.isArray(action.actions) ? action.actions.length : 0;

  const signalSymbol = typeof universe.signal_symbol === 'string' ? universe.signal_symbol : '-';
  const tradeSymbol = typeof universe.trade_symbol === 'string' ? universe.trade_symbol : '-';

  return { signalSymbol, tradeSymbol, primaryTf, derivedTfs, indicators, events, rules, actions };
}

export default function SimulationResult({ report, status, runId }: SimulationResultProps) {
  const { t } = useI18n();
  const isLoading = status === 'running' || status === 'analyzing';
  const showResult = status === 'analyzing' || status === 'running' || status === 'completed' || status === 'failed';
  const [summary, setSummary] = useState<StrategySummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!runId || status !== 'completed') {
      setSummary(null);
      return () => {
        cancelled = true;
      };
    }

    api.getRunArtifact(runId, 'dsl.json')
      .then((artifact) => {
        if (cancelled) return;
        setSummary(buildStrategySummary(artifact?.content));
      })
      .catch(() => {
        if (cancelled) return;
        setSummary(null);
      });

    return () => {
      cancelled = true;
    };
  }, [runId, status]);

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

      {/* KPI Cards */}
      <KPICards kpis={report?.kpis || null} loading={isLoading && !report} />

      {/* Equity Chart */}
      <EquityChart data={report?.equity || null} loading={isLoading && !report} />

      {/* Strategy Summary */}
      {summary && (
        <div className="border border-border rounded-lg bg-card p-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase mb-3">Strategy Summary</div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="text-muted-foreground">Signal / Trade: <span className="text-foreground">{summary.signalSymbol} / {summary.tradeSymbol}</span></div>
            <div className="text-muted-foreground">Timeframes: <span className="text-foreground">{summary.primaryTf}{summary.derivedTfs.length ? ` + ${summary.derivedTfs.join(', ')}` : ''}</span></div>
            <div className="text-muted-foreground">Indicators / Events: <span className="text-foreground">{summary.indicators} / {summary.events}</span></div>
            <div className="text-muted-foreground">Rules / Actions: <span className="text-foreground">{summary.rules} / {summary.actions}</span></div>
          </div>
        </div>
      )}

      {/* Trade Table */}
      <TradeTable trades={report?.trades || null} loading={isLoading && !report} runId={runId} />
    </div>
  );
}
